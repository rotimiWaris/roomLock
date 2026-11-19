import test from "node:test";
import assert from "node:assert/strict";
import {
  readRooms,
  readActiveRoom,
  saveRoom,
  activateRoom,
  deleteRoom,
  saveRoomEdits,
  readRoomEdits,
} from "../src/room-storage.ts";
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const room = (id) => ({
  worldId: id,
  url: `https://store.public.blob.vercel-storage.com/rooms/${id}.spz`,
  upAxis: "Z",
});
test("rooms survive a new storage read with active selection and video name", () => {
  const s = storage();
  const first = saveRoom(room("one"), "living-room.mov", s);
  saveRoom(room("two"), "bedroom.mp4", s);
  activateRoom(first, s);
  assert.equal(readRooms(s).length, 2);
  assert.deepEqual(readActiveRoom(s), first);
  assert.equal(
    JSON.parse(s.getItem("roomlock.activeRoom")).blobUrl,
    room("one").url,
  );
  assert.equal(readRooms(s)[0].sourceVideoName, "living-room.mov");
});
test("re-saving a world updates its URL without duplicating or losing its original metadata", () => {
  const s = storage();
  const first = saveRoom(room("one"), "original.mov", s);
  const next = saveRoom(
    {
      ...room("one"),
      url: "https://store.public.blob.vercel-storage.com/recovered.spz",
    },
    "Recovered room",
    s,
  );
  assert.equal(readRooms(s).length, 1);
  assert.equal(next.createdAt, first.createdAt);
  assert.equal(next.sourceVideoName, "original.mov");
  assert.equal(readActiveRoom(s).blobUrl, next.blobUrl);
});
test("previous completed scan migrates into the room library", () => {
  const s = storage();
  s.setItem(
    "roomlock.scan.v1",
    JSON.stringify({ room: room("old"), sourceVideoName: "old.mov" }),
  );
  assert.equal(readActiveRoom(s).worldId, "old");
  assert.equal(readRooms(s)[0].sourceVideoName, "old.mov");
});
test("camera and evidence edits are isolated by worldId", () => {
  const s = storage();
  const edits = {
    camera: [1, 1.5, 2],
    lookAt: [1, 1.5, 1],
    evidence: [{ id: "watch", position: [0, 1, 0] }],
  };
  saveRoomEdits("one", edits, s);
  assert.equal(readRoomEdits("one", s).calibrated, true);
  assert.deepEqual(readRoomEdits("one", s).camera, edits.camera);
  assert.deepEqual(readRoomEdits("one", s).evidence, edits.evidence);
  assert.equal(readRoomEdits("two", s), null);
});
test("deleting the active room selects another and does not resurrect legacy rooms", () => {
  const s = storage();
  saveRoom(room("one"), "one.mov", s);
  saveRoom(room("two"), "two.mov", s);
  s.setItem("roomlock.scan.v1", JSON.stringify({ room: room("two") }));
  s.setItem("roomlock.cleanup." + room("two").url, "{}");
  saveRoomEdits("two", { camera: [], lookAt: [], evidence: [] }, s);
  assert.equal(deleteRoom("two", s).worldId, "one");
  assert.equal(readRoomEdits("two", s), null);
  assert.equal(s.getItem("roomlock.cleanup." + room("two").url), null);
  deleteRoom("one", s);
  assert.equal(readActiveRoom(s), null);
  assert.deepEqual(readRooms(s), []);
});
test("malformed storage is ignored and failed writes are reported with the world ID", () => {
  const s = storage();
  s.setItem("roomlock.rooms", "{broken");
  s.setItem("roomlock.activeRoom", "null");
  assert.equal(readActiveRoom(s), null);
  s.setItem = () => {
    throw Error("quota");
  };
  assert.throws(
    () => saveRoom(room("one"), "one.mov", s),
    /Room one.*could not remember/,
  );
});
