import type { RoomConfig } from "./case";
import type { SavedRoom } from "./scan-client";

export type RoomRecord = {
  worldId: string;
  blobUrl: string;
  createdAt: string;
  sourceVideoName: string;
  upAxis: "Y" | "Z";
};
const roomsKey = "roomlock.rooms";
const activeKey = "roomlock.activeRoom";
const editsKey = (worldId: string) => "roomlock.edits." + worldId;
export const roomsChanged = "roomlock:rooms";
function read(key: string, storage: Storage): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function record(value: unknown): RoomRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RoomRecord & SavedRoom>;
  const blobUrl = item.blobUrl ?? item.url;
  if (
    typeof item.worldId !== "string" ||
    !item.worldId ||
    typeof blobUrl !== "string" ||
    !blobUrl ||
    blobUrl.startsWith("blob:")
  )
    return null;
  return {
    worldId: item.worldId,
    blobUrl,
    createdAt: item.createdAt ?? new Date().toISOString(),
    sourceVideoName: item.sourceVideoName ?? "Recovered room",
    upAxis: item.upAxis === "Y" ? "Y" : "Z",
  };
}
function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(roomsChanged));
}
export function readRooms(storage: Storage = localStorage): RoomRecord[] {
  const saved = read(roomsKey, storage);
  if (Array.isArray(saved))
    return saved.map(record).filter((r): r is RoomRecord => !!r);
  const legacy = read("roomlock.scan.v1", storage) as {
    room?: unknown;
    sourceVideoName?: string;
  } | null;
  const migrated = record(legacy?.room);
  if (!migrated) return [];
  if (legacy?.sourceVideoName)
    migrated.sourceVideoName = legacy.sourceVideoName;
  try {
    storage.setItem(roomsKey, JSON.stringify([migrated]));
    storage.setItem(activeKey, JSON.stringify(migrated));
  } catch {}
  return [migrated];
}
export function readActiveRoom(
  storage: Storage = localStorage,
): RoomRecord | null {
  const rooms = readRooms(storage);
  const active = record(read(activeKey, storage));
  return active ?? rooms[0] ?? null;
}
export function saveRoom(
  room: SavedRoom,
  sourceVideoName: string,
  storage: Storage = localStorage,
): RoomRecord {
  const rooms = readRooms(storage);
  const old = rooms.find((r) => r.worldId === room.worldId);
  const next: RoomRecord = {
    worldId: room.worldId,
    blobUrl: room.url,
    upAxis: room.upAxis,
    createdAt: old?.createdAt ?? new Date().toISOString(),
    sourceVideoName: old?.sourceVideoName ?? sourceVideoName,
  };
  try {
    storage.setItem(
      roomsKey,
      JSON.stringify([
        ...rooms.filter((r) => r.worldId !== next.worldId),
        next,
      ]),
    );
    storage.setItem(activeKey, JSON.stringify(next));
  } catch {
    throw Error(
      `Room ${room.worldId} was saved online, but this browser could not remember it. Enable local storage and retry.`,
    );
  }
  notify();
  return next;
}
export function activateRoom(
  room: RoomRecord,
  storage: Storage = localStorage,
) {
  storage.setItem(activeKey, JSON.stringify(room));
  notify();
}
export function deleteRoom(
  worldId: string,
  storage: Storage = localStorage,
): RoomRecord | null {
  const currentRooms = readRooms(storage);
  const removed = currentRooms.find((r) => r.worldId === worldId);
  const rooms = currentRooms.filter((r) => r.worldId !== worldId);
  const active = readActiveRoom(storage);
  const next = active?.worldId === worldId ? (rooms[0] ?? null) : active;
  storage.setItem(roomsKey, JSON.stringify(rooms));
  if (next) storage.setItem(activeKey, JSON.stringify(next));
  else storage.removeItem(activeKey);
  storage.removeItem(editsKey(worldId));
  if (removed) storage.removeItem("roomlock.cleanup." + removed.blobUrl);
  const legacy = read("roomlock.scan.v1", storage) as {
    room?: { worldId?: string };
  } | null;
  if (legacy?.room?.worldId === worldId) storage.removeItem("roomlock.scan.v1");
  notify();
  return next;
}
export function readRoomEdits(
  worldId: string,
  storage: Storage = localStorage,
): RoomConfig | null {
  const value = read(editsKey(worldId), storage) as RoomConfig | null;
  if (
    !value ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.camera) ||
    !Array.isArray(value.lookAt)
  )
    return null;
  return value;
}
export function saveRoomEdits(
  worldId: string,
  config: RoomConfig,
  storage: Storage = localStorage,
) {
  storage.setItem(
    editsKey(worldId),
    JSON.stringify({ ...config, calibrated: true }),
  );
}
