import { useState } from "react";
import { scanRequest, type SavedRoom } from "./scan-client";
import { saveRoom, type RoomRecord } from "./room-storage";

export default function SavedRooms({
  rooms,
  active,
  onSelect,
  onDelete,
  onScan,
}: {
  rooms: RoomRecord[];
  active: RoomRecord | null;
  onSelect: (room: RoomRecord) => void;
  onDelete: (worldId: string) => void;
  onScan: () => void;
}) {
  const [worldId, setWorldId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function recover() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const room = await scanRequest<SavedRoom>("recover", {
        worldId: worldId.trim(),
      });
      onSelect(saveRoom(room, `World ${room.worldId}`));
    } catch (cause) {
      setError(
        `World ${worldId.trim()}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-padding saved-rooms">
      <p className="eyebrow">YOUR CAPTURES</p>
      <h2>Saved rooms</h2>
      <p>Rooms and placement edits are remembered in this browser.</p>
      {rooms.length ? (
        <>
          <select
            aria-label="Saved room"
            value={active?.worldId ?? ""}
            onChange={(e) => {
              const room = rooms.find((r) => r.worldId === e.target.value);
              if (room) onSelect(room);
            }}
          >
            {!active && <option value="">Choose a room</option>}
            {rooms.map((room) => (
              <option key={room.worldId} value={room.worldId}>
                {room.sourceVideoName} · {room.worldId}
              </option>
            ))}
          </select>
          {active && (
            <>
              <p className="fineprint">
                World {active.worldId} · Saved{" "}
                {new Date(active.createdAt).toLocaleDateString()}
              </p>
              <button
                className="outline"
                onClick={() => onDelete(active.worldId)}
              >
                Delete room
              </button>
              <p className="fineprint">
                Removes this room and its edits from this browser. Its online
                files remain available for recovery.
              </p>
            </>
          )}
        </>
      ) : (
        <p>No saved rooms yet.</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void recover();
        }}
      >
        <label htmlFor="recover-world">Load room from worldId</label>
        <input
          id="recover-world"
          value={worldId}
          maxLength={100}
          required
          disabled={busy}
          onChange={(e) => setWorldId(e.target.value)}
          placeholder="Enter your Aholo world ID"
        />
        <button className="primary" disabled={busy || !worldId.trim()}>
          {busy ? "Saving room…" : "Load room from worldId"}
        </button>
      </form>
      {busy && (
        <p role="status">
          Downloading the completed room and saving a permanent copy.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="outline" onClick={onScan} disabled={busy}>
        Scan a new room
      </button>
    </div>
  );
}
