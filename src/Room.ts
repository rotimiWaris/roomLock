import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  SplatMesh,
  SparkRenderer,
  SplatEdit,
  SplatEditSdf,
  SplatEditSdfType,
} from "@sparkjsdev/spark";
import type { Placement, RoomConfig, Vec3 } from "./case";

export const modelLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export function fitModel(object: THREE.Object3D, size: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object),
    dimensions = box.getSize(new THREE.Vector3());
  const scale =
    size / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001);
  object.scale.multiplyScalar(scale);
  box.setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
}
type Hooks = {
  inspect: (id: string) => void;
  ready: (mode: string) => void;
  message: (text: string) => void;
  placed: (config: RoomConfig) => void;
  closed: () => void;
  progress: (fraction: number | null) => void;
  focus: (id: string | null) => void;
  failed?: (message: string) => void;
};
export class Room {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, 0.06, 90);
  renderer: THREE.WebGLRenderer;
  config: RoomConfig;
  models = new Map<string, THREE.Group>();
  pinned = new Set<string>();
  active = false;
  suspended = false;
  blocked = false;
  editId = "";
  disposed = false;
  private spark: SparkRenderer;
  private splat?: SplatMesh;
  private cropShape: SplatEditSdf;
  private nearShape: SplatEditSdf;
  private originalSplats?: Uint32Array;
  private originalSh: {
    key: "sh1" | "sh2" | "sh3";
    source: Uint32Array;
    width: number;
  }[] = [];
  private splatScales = new Float32Array();
  private splatOpacities = new Float32Array();
  private splatCenters = new Float32Array();
  cleanupStats = { total: 0, kept: 0, medianScale: 0 };
  private focused: string | null = null;
  private focusAt = 0;
  private ambient = new THREE.HemisphereLight(0xece6d2, 0x373a30, 1.2);
  private torch = new THREE.SpotLight(0xffe5ae, 0, 14, 0.65, 0.8);
  private footprints = new THREE.Group();
  private portal = new THREE.Group();
  private treasure = new THREE.Group();
  private panel = new THREE.Group();
  private doorLeaf = new THREE.Group();
  private keys = new Set<string>();
  private ray = new THREE.Raycaster();
  private pointer?: { x: number; y: number; travel: number; id: number };
  private walkTarget?: THREE.Vector3;
  private yaw = 0;
  private pitch = 0;
  private last = 0;
  private finishedAt = 0;
  private finaleStart = new THREE.Vector3();
  private observer: ResizeObserver;
  private abort = new AbortController();
  private surfaces: THREE.Object3D[] = [];
  private finaleReady: Promise<unknown>[] = [];
  constructor(
    private host: HTMLDivElement,
    config: RoomConfig,
    private hooks: Hooks,
  ) {
    this.config = structuredClone(config);
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#121a18");
    this.spark = new SparkRenderer({
      renderer: this.renderer,
      maxPixelRadius: 180,
      enableLod: false,
    });
    this.scene.add(
      this.spark,
      this.ambient,
      this.camera,
      this.footprints,
      this.portal,
      this.treasure,
    );
    this.camera.position.fromArray(config.camera);
    this.camera.lookAt(new THREE.Vector3(...config.lookAt));
    this.camera.rotation.order = "YXZ";
    this.yaw = this.camera.rotation.y;
    this.pitch = this.camera.rotation.x;
    this.camera.add(this.torch, this.torch.target);
    this.torch.target.position.set(0, 0, -3);
    const sun = new THREE.DirectionalLight(0xffe8bd, 0.65);
    sun.position.set(1, 4, 2);
    this.scene.add(sun);
    const crop = new SplatEdit({ name: "room-bounds", softEdge: 0.06 });
    this.cropShape = new SplatEditSdf({
      type: SplatEditSdfType.BOX,
      invert: true,
      opacity: 0,
    });
    crop.add(this.cropShape);
    this.scene.add(crop);
    this.setCrop(config.crop);
    const nearCut = new SplatEdit({ name: "camera-clearance", softEdge: 0.04 });
    this.nearShape = new SplatEditSdf({
      type: SplatEditSdfType.SPHERE,
      radius: config.cleanup.nearRadius,
      opacity: 0,
    });
    nearCut.add(this.nearShape);
    this.scene.add(nearCut);
    this.setupFinale();
    this.bindControls();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
    void this.load();
  }
  private async load() {
    const practice = new URLSearchParams(location.search).has("practice");
    let roomMode = "Captured room";
    try {
      if (practice) throw new Error("practice");
      const url = this.config.captured
        ? this.config.url
        : this.config.url.replace(
            /\.spz$/,
            matchMedia("(pointer:coarse)").matches ? ".mobile.spz" : ".web.spz",
          );
      this.splat = new SplatMesh({
        url,
        lod: false,
        enableLod: false,
        raycastable: true,
        onProgress: (e) =>
          this.hooks.progress(e.lengthComputable ? e.loaded / e.total : null),
      });
      this.splat.rotation.set(...this.config.rotation);
      this.splat.scale.setScalar(this.config.scale);
      this.splat.position.fromArray(this.config.offset);
      this.scene.add(this.splat);
      await this.splat.initialized;
      if (this.disposed) return;
      if (this.config.captured && !this.config.calibrated)
        this.fitCapturedRoom();
      this.prepareCleanup();
      if (this.config.captured && !this.config.calibrated) {
        await this.spark.update({ scene: this.scene, camera: this.camera });
        if (this.disposed) return;
        this.placeCapturedEvidence();
      }
    } catch (error) {
      if (this.disposed) return;
      if (this.splat) {
        this.scene.remove(this.splat);
        this.splat.dispose();
        this.splat = undefined;
      }
      if (this.config.captured) {
        this.hooks.failed?.(
          `Your room could not load: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      this.practiceRoom();
      roomMode = "Practice room";
      if (!practice)
        this.hooks.message(
          "Room capture could not load. You can explore the practice room or reload to retry.",
        );
    }
    for (const p of this.config.evidence)
      await this.addEvidence(p.id, `/models/${p.id}.glb`, p);
    await Promise.allSettled(this.finaleReady);
    if (!this.disposed) this.hooks.ready(roomMode);
  }
  private practiceRoom() {
    const box = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      color: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
      );
      m.position.set(x, y, z);
      this.scene.add(m);
      this.surfaces.push(m);
      return m;
    };
    box(10, 0.15, 10, 0, -0.1, 0, 0x343a30);
    box(10, 4, 0.12, 0, 2, -4.6, 0x39453c);
    box(0.12, 4, 10, -4.6, 2, 0, 0x28392f);
    box(0.12, 4, 10, 4.6, 2, 0, 0x28392f);
    for (let x = -4; x < 5; x++) box(0.025, 0.01, 9, x, 0, 0, 0x676052);
    box(1.4, 0.9, 1, -2.8, 0.45, -1.8, 0x554330);
    box(1.4, 0.94, 1, 2.6, 0.47, -1.8, 0x554330);
    box(1.3, 0.95, 1, 2.9, 0.475, 0.4, 0x554330);
    box(1.4, 0.52, 0.7, -1.2, 0.26, -2.9, 0x4c4236);
    box(1.3, 0.78, 0.8, 0.9, 0.39, -3.1, 0x4c4236);
    for (let i = 0; i < 5; i++)
      box(1.3, 0.08, 0.36, -3.5, 0.6 + i * 0.55, -4.3, 0x64543c);
  }
  private fitCapturedRoom() {
    const packed = this.splat!.packedSplats;
    if (!packed) throw Error("Room splat data is unavailable.");
    const axes: number[][] = [[], [], []];
    const stride = Math.max(1, Math.floor(packed.numSplats / 6000));
    const rotation = new THREE.Matrix4().makeRotationX(
      this.config.upAxis === "Y" ? 0 : -Math.PI / 2,
    );
    packed.forEachSplat((index, center, _scale, _rotation, opacity) => {
      if (index % stride || opacity < 0.05) return;
      center.applyMatrix4(rotation);
      [center.x, center.y, center.z].forEach((value, axis) =>
        axes[axis].push(value),
      );
    });
    if (axes[0].length < 20)
      throw Error("This capture has too few visible points to fit a room.");
    axes.forEach((values) => values.sort((a, b) => a - b));
    const low = axes.map((values) => values[Math.floor(values.length * 0.04)]);
    const high = axes.map((values) => values[Math.floor(values.length * 0.96)]);
    const scale = THREE.MathUtils.clamp(
      2.8 / Math.max(0.1, high[1] - low[1]),
      0.05,
      20,
    );
    const offset: Vec3 = [
      (-(low[0] + high[0]) * scale) / 2,
      -low[1] * scale,
      (-(low[2] + high[2]) * scale) / 2,
    ];
    this.config.rotation = [
      this.config.upAxis === "Y" ? 0 : -Math.PI / 2,
      0,
      0,
    ];
    this.config.scale = scale;
    this.config.offset = offset;
    const halfX = Math.max(1.2, ((high[0] - low[0]) * scale) / 2);
    const halfZ = Math.max(1.2, ((high[2] - low[2]) * scale) / 2);
    this.config.camera = [0, 1.5, 0];
    this.config.lookAt = [0, 1.3, -1];
    this.config.walkRadius = Math.min(0.9, halfX * 0.6, halfZ * 0.6);
    this.config.walkBounds = {
      min: [-halfX + 0.2, 0, -halfZ + 0.2],
      max: [halfX - 0.2, 2.8, halfZ - 0.2],
    };
    this.config.crop = {
      min: [-halfX, -0.15, -halfZ],
      max: [halfX, 2.9, halfZ],
    };
    this.splat!.rotation.set(...this.config.rotation);
    this.splat!.scale.setScalar(scale);
    this.splat!.position.fromArray(offset);
    this.splat!.updateMatrixWorld(true);
    this.camera.position.fromArray(this.config.camera);
    this.camera.lookAt(new THREE.Vector3(...this.config.lookAt));
    this.yaw = this.camera.rotation.y;
    this.pitch = this.camera.rotation.x;
    this.setCrop(this.config.crop);
    this.config.door.position = [0, 0, -halfZ + 0.15];
    this.config.heirloom.position = [0, 0, -halfZ - 3];
    this.portal.position.fromArray(this.config.door.position);
    this.treasure.position.fromArray(this.config.heirloom.position);
  }
  private placeCapturedEvidence() {
    this.config.evidence.forEach((placement, index) => {
      const angle = (index * Math.PI) / 3 + 0.25;
      const direction = new THREE.Vector3(
        Math.sin(angle),
        -0.9,
        -Math.cos(angle),
      ).normalize();
      this.ray.set(this.camera.position, direction);
      const hit = this.ray
        .intersectObject(this.splat!)
        .find((hit) => hit.distance > 0.5 && hit.distance < 2.4);
      const position = hit
        ? hit.point.clone().addScaledVector(direction, -0.04)
        : new THREE.Vector3(Math.sin(angle), 0.06, -Math.cos(angle));
      placement.position = position.toArray();
    });
    this.hooks.placed(structuredClone(this.config));
    this.hooks.message(
      "Your room is ready with automatic placement. Use ?edit=1 to fine-tune the crop, camera, and clue positions.",
    );
  }
  async addEvidence(id: string, url: string, placement?: Placement) {
    let group = this.models.get(id);
    if (!group) {
      group = new THREE.Group();
      group.userData.id = id;
      this.models.set(id, group);
      this.scene.add(group);
    }
    const p = placement ?? {
      position: this.frontPosition(),
      rotation: [0, 0, 0],
      size: 0.55,
    };
    group.position.fromArray(p.position);
    group.userData.baseY = p.position[1];
    try {
      const gltf = await modelLoader.loadAsync(url);
      if (this.disposed) return;
      const posed = new THREE.Group();
      posed.add(gltf.scene);
      posed.rotation.set(...p.rotation);
      fitModel(posed, p.size);
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        const adjusted = materials.map((original) => {
          const material = original.clone() as THREE.MeshStandardMaterial;
          material.emissive?.setScalar(0);
          material.emissiveIntensity = 0;
          material.roughness = Math.max(material.roughness ?? 0, 0.8);
          material.metalness = Math.min(material.metalness ?? 0, 0.15);
          return material;
        });
        object.material = Array.isArray(object.material)
          ? adjusted
          : adjusted[0];
      });
      group.add(posed);
      group.userData.model = posed;
      group.userData.loaded = true;
    } catch (error) {
      group.userData.loaded = false;
      if (!placement) {
        this.scene.remove(group);
        this.models.delete(id);
        throw error;
      }
      this.hooks.message(
        `Model unavailable: ${id}. Reload once its web asset is ready.`,
      );
    }
    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.13, 28),
      new THREE.MeshBasicMaterial({
        color: 0xdfbd7b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    beacon.rotation.x = -Math.PI / 2;
    beacon.position.y = 0.015;
    beacon.name = "marker";
    beacon.visible = false;
    beacon.raycast = () => {};
    group.add(beacon);
    const glintCanvas = document.createElement("canvas");
    glintCanvas.width = glintCanvas.height = 64;
    const glintContext = glintCanvas.getContext("2d")!;
    const glow = glintContext.createRadialGradient(32, 32, 0, 32, 32, 30);
    glow.addColorStop(0, "rgba(255,244,210,0.9)");
    glow.addColorStop(0.16, "rgba(255,231,170,0.4)");
    glow.addColorStop(1, "rgba(255,231,170,0)");
    glintContext.fillStyle = glow;
    glintContext.fillRect(0, 0, 64, 64);
    glintContext.strokeStyle = "rgba(255,244,210,0.7)";
    glintContext.lineWidth = 1;
    glintContext.beginPath();
    glintContext.moveTo(32, 13);
    glintContext.lineTo(32, 51);
    glintContext.moveTo(13, 32);
    glintContext.lineTo(51, 32);
    glintContext.stroke();
    const glint = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(glintCanvas),
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
      }),
    );
    glint.name = "glint";
    glint.position.y = Math.max(0.04, p.size * 0.65);
    glint.scale.setScalar(0.1);
    glint.raycast = () => {};
    group.add(glint);
    group.userData.glintOffset = this.models.size * 0.79;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(0,0,0,0.38)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(p.size * 1.2, p.size * 0.85),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    shadow.name = "contact-shadow";
    shadow.raycast = () => {};
    group.add(shadow);
    group.userData.url = url;
    group.userData.size = p.size;
    if (!placement) {
      group.userData.dropAt = performance.now();
      tone("drop");
    }
  }
  frontPosition(): Vec3 {
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    direction.y = 0;
    direction.normalize();
    const p = this.camera.position.clone().addScaledVector(direction, 1.3);
    p.y = 0.05;
    this.constrain(p);
    return p.toArray();
  }
  pin(id: string) {
    this.pinned.add(id);
    const object = this.models.get(id)?.getObjectByName("marker") as
      THREE.Mesh | undefined;
    if (object) {
      object.visible = true;
      (object.material as THREE.MeshBasicMaterial).color.set(0xbcecd4);
      object.scale.setScalar(1.5);
    }
    tone("pin");
  }
  react(count: number) {
    this.torch.intensity = count >= 2 ? 4 : 0;
    this.ambient.intensity = count >= 2 ? 0.4 : 1.2;
    if (this.splat) this.splat.recolor.setScalar(count >= 2 ? 0.65 : 1);
    this.footprints.visible = count >= 4;
  }
  saveCameraSpawn() {
    this.config.camera = this.camera.position.toArray() as Vec3;
    this.config.lookAt = this.camera.position
      .clone()
      .add(this.camera.getWorldDirection(new THREE.Vector3()))
      .toArray() as Vec3;
    this.hooks.placed(structuredClone(this.config));
  }
  setCrop(crop: RoomConfig["crop"]) {
    this.config.crop = structuredClone(crop);
    const min = new THREE.Vector3(...crop.min),
      max = new THREE.Vector3(...crop.max);
    this.cropShape.position.copy(min.clone().add(max).multiplyScalar(0.5));
    this.cropShape.scale.copy(max.sub(min).multiplyScalar(0.5));
    this.applyCleanup();
  }
  private prepareCleanup() {
    const packed = this.splat?.packedSplats;
    if (!packed?.packedArray) return;
    const count = packed.numSplats;
    this.originalSplats = packed.packedArray.slice(0, count * 4);
    for (const key of ["sh1", "sh2", "sh3"] as const) {
      const target = packed.extra[key];
      if (!target) continue;
      const width = key === "sh1" ? 2 : 4;
      this.originalSh.push({
        key,
        source: target.slice(0, count * width),
        width,
      });
    }
    this.splatScales = new Float32Array(count);
    this.splatOpacities = new Float32Array(count);
    this.splatCenters = new Float32Array(count * 3);
    this.splat!.updateMatrixWorld(true);
    packed.forEachSplat((i, center, scales, _rotation, opacity) => {
      this.splatScales[i] = Math.max(scales.x, scales.y, scales.z);
      this.splatOpacities[i] = opacity;
      center
        .applyMatrix4(this.splat!.matrixWorld)
        .toArray(this.splatCenters, i * 3);
    });
    const sorted = this.splatScales.slice().sort();
    this.cleanupStats = {
      total: count,
      kept: count,
      medianScale: sorted[Math.floor(count / 2)],
    };
    this.applyCleanup();
  }
  setCleanup(cleanup: RoomConfig["cleanup"]) {
    this.config.cleanup = { ...cleanup };
    this.nearShape.radius = cleanup.nearRadius;
    this.applyCleanup();
  }
  private applyCleanup() {
    const packed = this.splat?.packedSplats;
    if (!packed?.packedArray || !this.originalSplats) return;
    const { minOpacity, maxScaleMultiple } = this.config.cleanup;
    const limit = this.cleanupStats.medianScale * maxScaleMultiple;
    const { min, max } = this.config.crop;
    let kept = 0;
    for (let i = 0; i < this.cleanupStats.total; i++) {
      if (this.splatOpacities[i] < minOpacity || this.splatScales[i] > limit)
        continue;
      if (
        [0, 1, 2].some(
          (axis) =>
            this.splatCenters[i * 3 + axis] < min[axis] ||
            this.splatCenters[i * 3 + axis] > max[axis],
        )
      )
        continue;
      for (let word = 0; word < 4; word++)
        packed.packedArray[kept * 4 + word] = this.originalSplats[i * 4 + word];
      for (const { key, source, width } of this.originalSh) {
        const target = packed.extra[key]!;
        for (let word = 0; word < width; word++)
          target[kept * width + word] = source[i * width + word];
      }
      kept++;
    }
    packed.numSplats = kept;
    packed.needsUpdate = true;
    for (const key of ["sh1Texture", "sh2Texture", "sh3Texture"] as const) {
      const texture = packed.extra[key];
      if (texture) texture.value.needsUpdate = true;
    }
    this.splat!.needsUpdate = true;
    this.cleanupStats.kept = kept;
  }
  private setupFinale() {
    this.portal.visible = false;
    this.treasure.visible = false;
    this.footprints.visible = false;
    this.portal.position.fromArray(this.config.door.position);
    this.portal.rotation.set(...this.config.door.rotation);
    this.treasure.position.fromArray(this.config.heirloom.position);
    this.finaleReady.push(
      modelLoader.loadAsync("/models/archway-door.glb").then((g) => {
        if (this.disposed) return;
        fitModel(g.scene, this.config.door.size);
        this.buildOpeningDoor(g.scene);
      }),
    );
    this.finaleReady.push(
      modelLoader.loadAsync("/models/heirloom.glb").then((g) => {
        if (this.disposed) return;
        fitModel(g.scene, this.config.heirloom.size);
        this.treasure.add(g.scene);
      }),
    );
    void Promise.allSettled(this.finaleReady);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.45, 2.5),
      new THREE.MeshBasicMaterial({
        color: 0xc5e8bf,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    this.panel.position.set(-0.725, 0, 0.12);
    glow.position.set(0.725, 1.25, 0);
    this.panel.add(glow);
    this.portal.add(this.panel);
    const light = new THREE.PointLight(0xf4dca5, 8, 10);
    light.position.set(0, 1.7, 0.2);
    this.portal.add(light);
    const pedestalGlow = new THREE.PointLight(0xffcd77, 12, 6);
    pedestalGlow.position.y = 2;
    this.treasure.add(pedestalGlow);
    for (const [i, p] of this.config.footprints.entries()) {
      const mark = new THREE.Mesh(
        new THREE.CircleGeometry(0.11, 12),
        new THREE.MeshBasicMaterial({
          color: 0xc8e8b1,
          transparent: true,
          opacity: 0.8,
        }),
      );
      mark.position.fromArray(p);
      mark.position.x += i % 2 ? 0.1 : -0.1;
      mark.rotation.x = -Math.PI / 2;
      mark.scale.y = 1.8;
      this.footprints.add(mark);
    }
  }
  private buildOpeningDoor(object: THREE.Object3D) {
    object.updateMatrixWorld(true);
    const halfWidth = this.config.door.size * 0.195,
      doorHeight = this.config.door.size * 0.64;
    this.doorLeaf.position.x = -halfWidth;
    this.portal.add(this.doorLeaf);
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const source = child.geometry.index
        ? child.geometry.toNonIndexed()
        : child.geometry.clone();
      for (const name of ["position", "normal"]) {
        const attr = source.getAttribute(name);
        if (!attr) continue;
        const values = [];
        for (let i = 0; i < attr.count; i++)
          values.push(attr.getX(i), attr.getY(i), attr.getZ(i));
        source.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
      }
      source.applyMatrix4(child.matrixWorld);
      const position = source.getAttribute("position"),
        door: number[] = [],
        frame: number[] = [];
      for (let i = 0; i < position.count; i += 3) {
        const inside = [i, i + 1, i + 2].every(
          (j) =>
            Math.abs(position.getX(j)) < halfWidth &&
            position.getY(j) < doorHeight,
        );
        (inside ? door : frame).push(i, i + 1, i + 2);
      }
      for (const [indices, isDoor] of [
        [frame, false],
        [door, true],
      ] as [number[], boolean][]) {
        if (!indices.length) continue;
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(source.attributes) as [
          string,
          THREE.BufferAttribute,
        ][]) {
          const values = [];
          for (const index of indices)
            for (let c = 0; c < attribute.itemSize; c++)
              values.push(attribute.getComponent(index, c));
          geometry.setAttribute(
            name,
            new THREE.Float32BufferAttribute(values, attribute.itemSize),
          );
        }
        if (isDoor) geometry.translate(halfWidth, 0, 0);
        const mesh = new THREE.Mesh(geometry, child.material);
        (isDoor ? this.doorLeaf : this.portal).add(mesh);
      }
      source.dispose();
    });
  }
  solve() {
    if (this.finishedAt) return;
    this.finishedAt = performance.now();
    this.finaleStart.copy(this.camera.position);
    this.blocked = true;
    this.portal.visible = true;
    this.treasure.visible = true;
    document.exitPointerLock?.();
    tone("solve");
    const hole = new SplatEdit({ softEdge: 0.05 });
    const shape = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0 });
    shape.position.fromArray(this.config.door.position);
    shape.position.y += 1.4;
    shape.scale.set(0.85, 1.5, 2);
    shape.rotation.set(...this.config.door.rotation);
    hole.add(shape);
    this.scene.add(hole);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 7),
      new THREE.MeshStandardMaterial({ color: 0x25362b, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(
      this.config.door.position[0],
      -0.01,
      this.config.door.position[2] - 2,
    );
    this.scene.add(floor);
  }
  private constrain(p: THREE.Vector3) {
    const b = this.config.walkBounds;
    p.x = THREE.MathUtils.clamp(p.x, b.min[0], b.max[0]);
    p.z = THREE.MathUtils.clamp(p.z, b.min[2], b.max[2]);
    const dx = p.x - this.config.camera[0],
      dz = p.z - this.config.camera[2];
    const distance = Math.hypot(dx, dz);
    if (distance > this.config.walkRadius) {
      p.x = this.config.camera[0] + (dx / distance) * this.config.walkRadius;
      p.z = this.config.camera[2] + (dz / distance) * this.config.walkRadius;
    }
  }
  private bindControls() {
    const signal = this.abort.signal,
      canvas = this.renderer.domElement;
    window.addEventListener(
      "keydown",
      (e) => {
        if ((e.target as HTMLElement).matches("input,textarea,select")) return;
        this.keys.add(e.code);
        if (
          [
            "KeyW",
            "KeyA",
            "KeyS",
            "KeyD",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
          ].includes(e.code)
        )
          e.preventDefault();
        if (e.code === "KeyE" && this.active && !this.blocked) this.pick(0, 0);
      },
      { signal },
    );
    window.addEventListener("keyup", (e) => this.keys.delete(e.code), {
      signal,
    });
    window.addEventListener("blur", () => this.keys.clear(), { signal });
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.active || this.blocked) return;
        this.pointer = {
          x: e.clientX,
          y: e.clientY,
          travel: 0,
          id: e.pointerId,
        };
        canvas.setPointerCapture(e.pointerId);
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (!this.active || this.blocked) return;
        const locked = document.pointerLockElement === canvas;
        if (!locked && !this.pointer) return;
        const dx = locked ? e.movementX : e.clientX - this.pointer!.x,
          dy = locked ? e.movementY : e.clientY - this.pointer!.y;
        this.yaw -= dx * 0.003;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch - dy * 0.003,
          -1.25,
          1.25,
        );
        if (this.pointer) {
          this.pointer.travel += Math.abs(dx) + Math.abs(dy);
          this.pointer.x = e.clientX;
          this.pointer.y = e.clientY;
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerup",
      (e) => {
        if (!this.pointer) return;
        const tap = this.pointer.travel < 8;
        this.pointer = undefined;
        if (!tap || !this.active || this.blocked) return;
        const rect = canvas.getBoundingClientRect(),
          locked = document.pointerLockElement === canvas;
        this.pick(
          locked ? 0 : ((e.clientX - rect.left) / rect.width) * 2 - 1,
          locked ? 0 : (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          e.pointerType === "touch",
        );
      },
      { signal },
    );
    canvas.addEventListener(
      "dblclick",
      () => {
        if (this.active && !this.blocked && !this.editId)
          void canvas.requestPointerLock?.();
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), {
      signal,
    });
  }
  private pick(x: number, y: number, touch = false) {
    this.camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    if (this.editId) {
      const hits = this.splat
        ? this.ray.intersectObject(this.splat)
        : this.ray.intersectObjects(this.surfaces);
      const point =
        hits.find((hit) => hit.distance >= this.config.cleanup.nearRadius)
          ?.point ??
        (!this.splat
          ? this.ray.ray.intersectPlane(
              new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
              new THREE.Vector3(),
            )
          : null);
      if (point) {
        const p = this.config.evidence.find((p) => p.id === this.editId);
        if (p) {
          p.position = point.toArray().map((n) => Number(n.toFixed(3))) as Vec3;
          this.models.get(p.id)?.position.copy(point);
          this.hooks.placed(structuredClone(this.config));
        }
      }
      return;
    }
    const object = this.evidenceInReach();
    if (object) {
      document.exitPointerLock?.();
      tone("inspect");
      this.hooks.inspect(object);
      return;
    }
    if (touch) {
      const point = this.ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        new THREE.Vector3(),
      );
      if (point) {
        this.constrain(point);
        point.y = this.camera.position.y;
        this.walkTarget = point;
      }
    }
  }
  private evidenceInReach(): string | null {
    const hit = this.ray
      .intersectObjects([...this.models.values()], true)
      .find((h) => h.distance <= 1.5);
    if (!hit) return null;
    if (this.splat) {
      const surface = this.ray
        .intersectObject(this.splat)
        .find((h) => h.distance >= this.config.cleanup.nearRadius);
      if (surface && surface.distance + 0.08 < hit.distance) return null;
    }
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.id) object = object.parent;
    return object?.userData.id ?? null;
  }
  move(forward: number, side: number) {
    if (!this.active || this.blocked) return;
    const d = new THREE.Vector3(
      -Math.sin(this.yaw) * forward + Math.cos(this.yaw) * side,
      0,
      -Math.cos(this.yaw) * forward - Math.sin(this.yaw) * side,
    );
    this.camera.position.addScaledVector(d, 0.35);
    this.constrain(this.camera.position);
  }
  private frame = (now: number) => {
    if (this.suspended) {
      this.last = now;
      return;
    }
    if (this.disposed) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.active && !this.blocked) {
      const f =
        Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
        Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
      const s =
        Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
        Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
      if (f || s) {
        const d = new THREE.Vector3(
          -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s,
          0,
          -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s,
        ).normalize();
        this.camera.position.addScaledVector(d, dt * 1.7);
        this.walkTarget = undefined;
      }
      if (this.walkTarget) {
        const delta = this.walkTarget.clone().sub(this.camera.position);
        if (delta.length() < 0.08) this.walkTarget = undefined;
        else
          this.camera.position.addScaledVector(
            delta.normalize(),
            Math.min(dt * 1.7, delta.length()),
          );
      }
      this.constrain(this.camera.position);
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    }
    this.nearShape.position.copy(this.camera.position);
    if (now - this.focusAt > 100) {
      this.focusAt = now;
      this.camera.updateMatrixWorld(true);
      this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
      const focused =
        this.active && !this.blocked && !this.editId
          ? this.evidenceInReach()
          : null;
      if (focused !== this.focused) {
        this.focused = focused;
        this.hooks.focus(focused);
      }
    }
    for (const group of this.models.values()) {
      const glint = group.getObjectByName("glint") as THREE.Sprite | undefined;
      if (glint) {
        const phase = (now / 1000 + group.userData.glintOffset) % 5.5;
        glint.visible =
          !this.pinned.has(group.userData.id) && this.active && phase < 0.9;
        glint.material.opacity = glint.visible
          ? Math.sin((phase / 0.9) * Math.PI) * 0.55
          : 0;
      }
      const marker = group.getObjectByName("marker");
      if (marker) marker.rotation.z = now * 0.0003;
      if (group.userData.dropAt) {
        const t = (now - group.userData.dropAt) / 700;
        group.position.y = group.userData.baseY + Math.max(0, 1 - t * t) * 1.5;
        if (t >= 1) delete group.userData.dropAt;
      }
    }
    if (this.finishedAt) {
      const t = (now - this.finishedAt) / 1000;
      this.portal.position.y =
        this.config.door.position[1] - Math.max(0, 1 - t / 2) * 3;
      this.panel.rotation.y =
        -Math.min(1, Math.max(0, (t - 1.5) / 1.5)) * Math.PI * 0.65;
      this.doorLeaf.rotation.y = this.panel.rotation.y;
      const target = new THREE.Vector3(...this.config.heirloom.position);
      target.y += this.config.heirloom.size * 0.25;
      const end = target.clone().add(new THREE.Vector3(0, 1, 1.8));
      const approach = new THREE.Vector3(...this.config.door.position).add(
        new THREE.Vector3(0, 1.65, 1.6),
      );
      const q = THREE.MathUtils.smoothstep(t, 2, 5);
      this.camera.position.lerpVectors(this.finaleStart, approach, q);
      if (t > 5)
        this.camera.position.lerpVectors(
          approach,
          end,
          THREE.MathUtils.smoothstep(t, 5, 9),
        );
      this.camera.lookAt(target);
      if (t > 13) {
        this.finishedAt = 0;
        this.hooks.closed();
      }
    }
    this.renderer.render(this.scene, this.camera);
  };
  private resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.splat?.dispose();
    this.spark.dispose();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => {
          Object.values(m).forEach((value) => {
            if (value instanceof THREE.Texture) textures.add(value);
          });
          m.dispose();
        });
      }
    });
    textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
let audio: AudioContext | undefined;
export function tone(kind: "pin" | "inspect" | "drop" | "solve") {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.connect(g);
    g.connect(audio.destination);
    o.type = kind === "drop" ? "triangle" : "sine";
    o.frequency.setValueAtTime(
      kind === "pin"
        ? 660
        : kind === "solve"
          ? 440
          : kind === "drop"
            ? 100
            : 330,
      audio.currentTime,
    );
    o.frequency.exponentialRampToValueAtTime(
      kind === "drop" ? 35 : 880,
      audio.currentTime + 0.18,
    );
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    o.start();
    o.stop(audio.currentTime + 0.32);
  } catch {}
}
