import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fitModel, modelLoader } from "./Room";
export default function Inspect({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = host.current!;
    let dead = false;
    setError("");
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(38, 1, 0.01, 30),
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    el.appendChild(renderer.domElement);
    camera.position.set(1.8, 1.3, 2.1);
    scene.add(new THREE.HemisphereLight(0xfff2cf, 0x444f45, 3));
    const light = new THREE.DirectionalLight(0xffffff, 4);
    light.position.set(2, 3, 2);
    scene.add(light);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enablePan = false;
    controls.minDistance = 1.3;
    controls.maxDistance = 5;
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    const obs = new ResizeObserver(resize);
    obs.observe(el);
    resize();
    let model: THREE.Object3D | undefined;
    void modelLoader
      .loadAsync(url)
      .then((g) => {
        if (dead) return;
        model = g.scene;
        fitModel(model, 1.35);
        scene.add(model);
      })
      .catch(() => {
        if (!dead) setError("Model unavailable. The clue can still be read.");
      });
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      dead = true;
      obs.disconnect();
      controls.dispose();
      renderer.setAnimationLoop(null);
      model?.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            m.dispose(),
          );
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);
  return (
    <div className="inspect-model" ref={host}>
      <span>{error || "DRAG TO ROTATE · SCROLL TO ZOOM"}</span>
    </div>
  );
}
