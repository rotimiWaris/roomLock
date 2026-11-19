import { useEffect, useRef, useState } from "react";
import { clues, suspects, clockText, type Clue, type RoomConfig } from "./case";
import { Room } from "./Room";
import Inspect from "./Inspect";
import Plant from "./Plant";
import Landing from "./Landing";
import ScanRoom from "./ScanRoom";
import type { SavedRoom } from "./scan-client";
import SavedRooms from "./SavedRooms";
import {
  readActiveRoom,
  readRooms,
  saveRoom,
  activateRoom,
  deleteRoom,
  readRoomEdits,
  saveRoomEdits,
  roomsChanged,
  type RoomRecord,
} from "./room-storage";
type Panel =
  | "brief"
  | "board"
  | "suspects"
  | "plant"
  | "about"
  | "create"
  | "scan"
  | "rooms"
  | null;
export default function App() {
  const [scannedRoom, setScannedRoom] = useState<RoomRecord | null>(
    readActiveRoom,
  );
  const [rooms, setRooms] = useState<RoomRecord[]>(readRooms);
  const [edit, setEdit] = useState(
    () => new URLSearchParams(location.search).get("edit") === "1",
  );
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<Room | null>(null);
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [mode, setMode] = useState("Loading room");
  const [fraction, setFraction] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [reloadRoom, setReloadRoom] = useState(0);
  const [started, setStarted] = useState(!!scannedRoom && edit);
  const [panel, setPanel] = useState<Panel>(() =>
    scannedRoom ? (edit ? null : "brief") : "scan",
  );
  const [selected, setSelected] = useState<Clue | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [extras, setExtras] = useState<Clue[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState("");
  const [accusation, setAccusation] = useState("");
  const [solving, setSolving] = useState(false);
  const [closed, setClosed] = useState(false);
  const [fatal, setFatal] = useState("");
  const [editId, setEditId] = useState("");
  const [editText, setEditText] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const all = useRef<Clue[]>(clues);
  const began = useRef(Date.now());
  useEffect(() => {
    const changed = () => setRooms(readRooms());
    const navigation = () => {
      setEdit(new URLSearchParams(location.search).get("edit") === "1");
      setEditId("");
      if (engine.current) engine.current.editId = "";
    };
    window.addEventListener(roomsChanged, changed);
    window.addEventListener("storage", changed);
    window.addEventListener("popstate", navigation);
    return () => {
      window.removeEventListener(roomsChanged, changed);
      window.removeEventListener("storage", changed);
      window.removeEventListener("popstate", navigation);
    };
  }, []);
  function toggleEdit() {
    const url = new URL(location.href);
    if (edit) url.searchParams.delete("edit");
    else url.searchParams.set("edit", "1");
    history.pushState(null, "", url);
    setEdit(!edit);
    setEditId("");
    if (engine.current) engine.current.editId = "";
  }
  function rememberEdits(c: RoomConfig) {
    setConfig(c);
    setEditText(JSON.stringify(c, null, 2));
    try {
      saveRoomEdits(scannedRoom?.worldId ?? "demo", c);
      return true;
    } catch {
      setToast(
        "Your browser could not save room edits. Enable local storage and try again.",
      );
      return false;
    }
  }
  const caseCount = pinned.filter((id) =>
    clues.some((c) => c.id === id),
  ).length;
  useEffect(() => {
    let live = true;
    void fetch("/rooms/room.json")
      .then((r) => {
        if (!r.ok) throw Error("Room configuration unavailable");
        return r.json();
      })
      .then((c: RoomConfig) => {
        if (!live) return;
        if (scannedRoom) {
          const saved = readRoomEdits(scannedRoom.worldId);
          if (saved) c = { ...c, ...saved, calibrated: true };
          c.url = scannedRoom.blobUrl;
          c.captured = true;
          c.upAxis = scannedRoom.upAxis;
          if (!saved) {
            c.rotation = [scannedRoom.upAxis === "Y" ? 0 : -Math.PI / 2, 0, 0];
            c.scale = 1;
            c.offset = [0, 0, 0];
          }
        } else {
          const saved = readRoomEdits("demo");
          if (saved) c = { ...c, ...saved };
        }
        try {
          const saved = JSON.parse(
            localStorage.getItem("roomlock.cleanup." + c.url) ?? "null",
          );
          if (
            saved &&
            Number.isFinite(saved.minOpacity) &&
            Number.isFinite(saved.maxScaleMultiple)
          )
            if (!readRoomEdits(scannedRoom?.worldId ?? "demo"))
              c.cleanup = saved;
        } catch {}
        setConfig(c);
        setEditText(JSON.stringify(c, null, 2));
        try {
          engine.current = new Room(host.current!, c, {
            inspect: (id) =>
              setSelected(all.current.find((c) => c.id === id) ?? null),
            ready: (m) => {
              setMode(m);
              setReady(true);
            },
            message: setToast,
            progress: setFraction,
            focus: setFocused,
            failed: (message) =>
              setFatal(
                scannedRoom
                  ? `Could not load saved room ${scannedRoom.worldId}. ${message} Open Saved rooms to recover it by worldId.`
                  : message,
              ),
            placed: rememberEdits,
            closed: () => {
              setClosed(true);
              setSolving(false);
            },
          });
        } catch {
          setFatal(
            "This browser could not start WebGL. Try an up-to-date browser with hardware acceleration enabled.",
          );
        }
      })
      .catch((e) => setFatal(String(e)));
    return () => {
      live = false;
      engine.current?.dispose();
    };
  }, [scannedRoom, reloadRoom]);
  useEffect(() => {
    all.current = [...clues, ...extras];
  }, [extras]);
  useEffect(() => {
    if (import.meta.env.DEV && edit && ready)
      Object.assign(window, { roomlock: engine.current });
  }, [edit, ready]);
  useEffect(() => {
    if (!engine.current) return;
    engine.current.active = started && !closed;
    engine.current.suspended = panel === "scan";
    engine.current.blocked = !!panel || !!selected || solving || closed;
  }, [started, panel, selected, solving, closed, ready]);
  useEffect(() => {
    if (!started || closed) return;
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - began.current) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [started, closed]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !solving) {
        if (panel === "plant" || panel === "scan") return;
        setSelected(null);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [panel, solving]);
  useEffect(() => {
    const locked = started || !!panel || !!selected;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [started, panel, selected]);
  function selectRoom(room: RoomRecord | null) {
    if (room) {
      try {
        activateRoom(room);
      } catch {
        setToast("Could not remember the active room in this browser.");
      }
    }
    setStarted(false);
    setClosed(false);
    setSolving(false);
    setReady(false);
    setFatal("");
    setPinned([]);
    setExtras([]);
    setSelected(null);
    setElapsed(0);
    setFraction(null);
    setEditId("");
    setPanel(room ? "brief" : "scan");
    setMode("Loading your capture");
    setScannedRoom(room ? { ...room } : null);
    setReloadRoom((n) => n + 1);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function enterScannedRoom(room: SavedRoom) {
    try {
      selectRoom(saveRoom(room, "Scanned room"));
    } catch (error) {
      setToast(String(error));
    }
  }
  function removeRoom(worldId: string) {
    try {
      const next = deleteRoom(worldId);
      if (scannedRoom?.worldId === worldId) selectRoom(next);
      else setRooms(readRooms());
    } catch {
      setToast("Could not delete this room from browser storage.");
    }
  }
  function pin() {
    if (!selected) return;
    if (!pinned.includes(selected.id)) {
      const next = [...pinned, selected.id];
      setPinned(next);
      engine.current?.pin(selected.id);
      const n = next.filter((id) => clues.some((c) => c.id === id)).length;
      engine.current?.react(n);
      setToast(
        n === 2 && caseCount < 2
          ? "New lead: suspects unlocked. Your flashlight is now on."
          : n === 4
            ? "A trail is appearing. Follow the traces toward the wall."
            : "Evidence pinned to your timeline.",
      );
    }
    setSelected(null);
  }
  function accuse(id: string) {
    if (caseCount < 4) return;
    if (id !== "mara") {
      setAccusation(
        "That alibi holds up. Compare the red clay, the initial, and who knew about the passage.",
      );
      return;
    }
    setPanel(null);
    setSolving(true);
    engine.current?.solve();
  }
  async function plant(url: string, prompt: string) {
    const id = `planted-${Date.now()}`;
    const clue: Clue = {
      id,
      name: prompt,
      time: "EXTRA",
      minute: 1000,
      tag: "PLANTED",
      clue: "You placed this object after the original events. It is an extra clue, not evidence against a suspect.",
      detail: prompt,
      custom: true,
      url,
    };
    try {
      await engine.current?.addEvidence(id, url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    all.current = [...all.current, clue];
    setExtras((old) => [...old, clue]);
  }
  const pinnedClues = [...clues, ...extras]
    .filter((c) => pinned.includes(c.id))
    .sort((a, b) => a.minute - b.minute);
  return (
    <main
      className={`${started ? "app playing" : "app"}${solving ? " finalizing" : ""}`}
    >
      <div className="room-canvas" ref={host} />
      <div className="vignette" />
      <div className="grain" />
      <nav className="room-library-bar" aria-label="Room library">
        <button onClick={() => setPanel("rooms")}>
          Saved rooms ({rooms.length})
        </button>
        {ready && (
          <button aria-pressed={edit} onClick={toggleEdit}>
            {edit ? "Play mode" : "Edit room"}
          </button>
        )}
      </nav>
      {fatal && panel !== "brief" && (
        <div className="room-load-error" role="alert">
          {fatal}
          <button onClick={() => setPanel("rooms")}>Saved rooms</button>
        </div>
      )}
      {started && (
        <header className="topbar">
          <a className="brand" href="/" aria-label="RoomLock home">
            <span className="brand-icon">⌑</span>
            <span>
              ROOMLOCK<small>CASE FILE</small>
            </span>
          </a>
          <div className="room-label">
            <i className={ready ? "live-dot" : ""} />
            {mode}
          </div>
          <button className="quiet" onClick={() => setPanel("about")}>
            Behind the case <span>↗</span>
          </button>
        </header>
      )}
      {!started && !closed && (
        <Landing
          ready={ready}
          fatal={fatal}
          fraction={fraction}
          openCase={() => setPanel("brief")}
          openCreate={() => setPanel("scan")}
          openAbout={() => setPanel("about")}
        />
      )}
      {started && !closed && (
        <>
          <div className="case-heading">
            <span className="eyebrow">CASE 001 / IN PROGRESS</span>
            <h2>The Missing Heirloom</h2>
            <p>
              {solving
                ? "The room has one last secret."
                : caseCount >= 4
                  ? "The trail is clear. Who moved the heirloom?"
                  : caseCount >= 2
                    ? "Follow the details. Build the timeline."
                    : "Explore the room. Inspect anything out of place."}
            </p>
          </div>
          <div className="case-stats">
            <div>
              <span>TIME ON CASE</span>
              <strong>{clockText(elapsed)}</strong>
            </div>
            <div>
              <span>EVIDENCE</span>
              <strong>
                {caseCount}
                <small> / 6</small>
              </strong>
            </div>
          </div>
          {!panel && !selected && !solving && (
            <div className={`crosshair${focused ? " can-inspect" : ""}`}>
              +{focused && <span className="inspect-prompt">Inspect</span>}
            </div>
          )}
          <nav className="game-dock" aria-label="Investigation tools">
            <button onClick={() => setPanel("board")}>
              <span>▧</span> Evidence board <b>{caseCount}</b>
            </button>
            {caseCount >= 2 && (
              <button onClick={() => setPanel("suspects")}>
                <span>♙</span> Suspects{" "}
                {caseCount >= 4 && <i className="live-dot" />}
              </button>
            )}
            <button onClick={() => setPanel("plant")}>
              <span>＋</span> Plant evidence
            </button>
            <button
              aria-label="Get a hint"
              onClick={() => {
                const next = clues.find((c) => !pinned.includes(c.id));
                setToast(
                  next
                    ? `Look for ${next.name.toLowerCase()}. Check low surfaces and furniture edges. Move closer until Inspect appears.`
                    : "Compare Mara’s alibi with the red clay and the signed note.",
                );
              }}
            >
              ?
            </button>
          </nav>
          <div className="controls-note">
            WASD to move · Drag to look · Click to inspect · Double-click for
            mouse look · Esc releases
          </div>
          <div className="mobile-controls">
            <button
              aria-label="Move left"
              onClick={() => engine.current?.move(0, -1)}
            >
              ←
            </button>
            <button
              aria-label="Move forward"
              onClick={() => engine.current?.move(1, 0)}
            >
              ↑
            </button>
            <button
              aria-label="Move backward"
              onClick={() => engine.current?.move(-1, 0)}
            >
              ↓
            </button>
            <button
              aria-label="Move right"
              onClick={() => engine.current?.move(0, 1)}
            >
              →
            </button>
            <span>Drag to look · Tap floor to move</span>
          </div>
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {(panel || selected) && (
        <div className="modal-backdrop">
          <section
            className={`modal ${panel === "board" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={selected?.name || `${panel} panel`}
          >
            <button
              className="close"
              aria-label="Close panel"
              onClick={() => {
                setPanel(null);
                setSelected(null);
              }}
            >
              ×
            </button>
            {selected && (
              <>
                <div className="modal-padding">
                  <p className="eyebrow">{selected.tag} / OBJECT INSPECTION</p>
                  <h2>{selected.name}</h2>
                </div>
                <Inspect url={selected.url || `/models/${selected.id}.glb`} />
                <div className="modal-padding clue-copy">
                  <span className="time-tag">{selected.time}</span>
                  <p>{selected.clue}</p>
                  <details>
                    <summary>Investigator’s note</summary>
                    <p>{selected.detail}</p>
                  </details>
                  <button className="primary" onClick={pin}>
                    {pinned.includes(selected.id)
                      ? "Already pinned · Return"
                      : "Pin as evidence"}{" "}
                    <span>↗</span>
                  </button>
                </div>
              </>
            )}
            {panel === "brief" && (
              <div className="modal-padding">
                {fatal && (
                  <>
                    <p className="error" role="alert">
                      {fatal}
                    </p>
                    {scannedRoom && (
                      <button
                        className="outline"
                        onClick={() => selectRoom(scannedRoom)}
                      >
                        Retry room loading
                      </button>
                    )}
                    <button
                      className="outline"
                      onClick={() => setPanel("rooms")}
                    >
                      Open saved rooms
                    </button>
                  </>
                )}
                <p className="eyebrow">CONFIDENTIAL / CASE BRIEFING</p>
                <h2>The Missing Heirloom</h2>
                <p>
                  At 20:45, the Vale family’s necklace vanished from its music
                  box. No doors were forced. Everyone is still in the house.
                </p>
                <p>
                  Find the six objects, pin their clues, and reconstruct the
                  evening. Four original clues unlock an accusation. A wrong
                  guess won’t end your investigation.
                </p>
                <div className="suspect-list">
                  {suspects.map((s) => (
                    <article key={s.id}>
                      <div className="portrait">{s.initial}</div>
                      <div>
                        <strong>{s.name}</strong>
                        <small>{s.role}</small>
                        <p>{s.alibi}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={!ready}
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: "instant" });
                    setStarted(true);
                    began.current = Date.now();
                    setPanel(null);
                  }}
                >
                  {ready ? "Enter the room" : "Loading your room…"}{" "}
                  <span>→</span>
                </button>
              </div>
            )}
            {panel === "board" && (
              <div className="modal-padding">
                <p className="eyebrow">YOUR WORKING THEORY</p>
                <h2>The evidence board</h2>
                <p>Every trace has a place in the evening.</p>
                <div className="timeline">
                  {pinnedClues.length ? (
                    pinnedClues.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setPanel(null);
                          setSelected(c);
                        }}
                      >
                        <span className="time-tag">{c.time}</span>
                        <div>
                          <small>{c.tag}</small>
                          <h3>{c.name}</h3>
                          <p>{c.clue}</p>
                        </div>
                        <span>↗</span>
                      </button>
                    ))
                  ) : (
                    <div className="empty">
                      <span>⌖</span>
                      <h3>A blank page. For now.</h3>
                      <p>
                        Inspect an object in the room and pin its clue to begin
                        your timeline.
                      </p>
                    </div>
                  )}
                </div>
                <button
                  className="primary"
                  disabled={caseCount < 4}
                  onClick={() => setPanel("suspects")}
                >
                  {caseCount < 4
                    ? `Find ${4 - caseCount} more original clues`
                    : "Make an accusation"}{" "}
                  <span>→</span>
                </button>
              </div>
            )}
            {panel === "suspects" && (
              <div className="modal-padding">
                <p className="eyebrow">THREE ACCOUNTS. ONE CONTRADICTION.</p>
                <h2>Who moved the heirloom?</h2>
                <p>
                  {caseCount >= 4
                    ? "Choose the person whose story fails the evidence."
                    : "Pin four original clues before making an accusation."}
                </p>
                <div className="suspect-list">
                  {suspects.map((s) => (
                    <article key={s.id}>
                      <div className="portrait">{s.initial}</div>
                      <div>
                        <strong>{s.name}</strong>
                        <small>{s.role}</small>
                        <p>{s.alibi}</p>
                        <button
                          className="outline"
                          disabled={caseCount < 4}
                          onClick={() => accuse(s.id)}
                        >
                          Accuse {s.name.split(" ")[0]} ↗
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {accusation && (
                  <p className="error" role="alert">
                    {accusation}
                  </p>
                )}
              </div>
            )}
            {panel === "plant" && (
              <div className="modal-padding">
                <Plant onPlace={plant} />
              </div>
            )}
            {panel === "about" && (
              <div className="modal-padding">
                <p className="eyebrow">BEHIND THE CASE</p>
                <h2>
                  A real room.
                  <br />
                  An invented mystery.
                </h2>
                <div className="process">
                  <article>
                    <b>01</b>
                    <h3>Capture</h3>
                    <p>A phone video records an actual room.</p>
                  </article>
                  <article>
                    <b>02</b>
                    <h3>Reconstruct</h3>
                    <p>
                      Aholo World turns the video into a navigable Gaussian
                      splat.
                    </p>
                  </article>
                  <article>
                    <b>03</b>
                    <h3>Investigate</h3>
                    <p>
                      Lux3D creates the evidence objects. We add the story,
                      interactions, and secret passage.
                    </p>
                  </article>
                </div>
                <p>
                  The original room and case objects are pre-generated because
                  generation takes several minutes. “Plant evidence” runs Lux3D
                  live. “Scan your room” reconstructs a new capture live and
                  uses the same mystery with automatic clue placement.
                </p>
                <p className="fineprint">
                  A fictional mystery game. Not a forensic tool or a measurement
                  system.
                </p>
              </div>
            )}
            {panel === "scan" && <ScanRoom onReady={enterScannedRoom} />}
            {panel === "rooms" && (
              <SavedRooms
                rooms={rooms}
                active={scannedRoom}
                onSelect={selectRoom}
                onDelete={removeRoom}
                onScan={() => setPanel("scan")}
              />
            )}
            {panel === "create" && (
              <div className="modal-padding">
                <p className="eyebrow">YOUR ROOM, NEXT</p>
                <h2>Make your own case.</h2>
                <ol className="steps">
                  <li>
                    <strong>Film your space.</strong>
                    <p>
                      Walk slowly through the room with overlapping views. Our
                      tested capture used 720p video at 15 fps.
                    </p>
                  </li>
                  <li>
                    <strong>Reconstruct and download.</strong>
                    <p>
                      Run the video through Aholo World, then save the SPZ
                      before its download link expires.
                    </p>
                  </li>
                  <li>
                    <strong>Write a fair mystery.</strong>
                    <p>
                      Choose suspects, clues, and a solution. Generate the
                      evidence with Lux3D.
                    </p>
                  </li>
                  <li>
                    <strong>Place the evidence.</strong>
                    <p>
                      Configure the room and use the hidden placement mode to
                      position each object.
                    </p>
                  </li>
                </ol>
                <p className="fineprint">
                  Scan your room to play this case in a new capture. Automatic
                  story writing is not included.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
      {closed && (
        <div className="closed-screen">
          <span className="seal">✓</span>
          <p className="eyebrow">CASE NO. 001 / RESOLVED</p>
          <h1>
            Case <em>closed.</em>
          </h1>
          <p>
            Mara hid the necklace behind the arch.
            <br />A family prank. A very real trail.
          </p>
          <div className="results">
            <div>
              <strong>{clockText(elapsed)}</strong>
              <span>TIME TO SOLVE</span>
            </div>
            <div>
              <strong>{caseCount}/6</strong>
              <span>EVIDENCE FOUND</span>
            </div>
          </div>
          <button className="primary" onClick={() => selectRoom(scannedRoom)}>
            Reopen the case <span>↻</span>
          </button>
        </div>
      )}
      {edit && config && (
        <aside className="editor">
          <strong>Placement mode</strong>
          <button
            disabled={!ready}
            onClick={() => engine.current?.saveCameraSpawn()}
          >
            Save current camera as spawn
          </button>
          <button onClick={toggleEdit}>Return to play mode</button>
          <select
            aria-label="Object to place"
            value={editId}
            onChange={(e) => {
              setEditId(e.target.value);
              if (engine.current) engine.current.editId = e.target.value;
            }}
          >
            <option value="">Inspect / navigate</option>
            {clues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <small>
            Select an object, then click a captured surface. Start the case to
            navigate.
          </small>
          <label>
            Minimum opacity: {config.cleanup.minOpacity.toFixed(2)}
            <input
              aria-label="Minimum splat opacity"
              type="range"
              min="0"
              max="0.5"
              step="0.01"
              value={config.cleanup.minOpacity}
              onChange={(e) => {
                const c = structuredClone(engine.current?.config ?? config);
                c.cleanup.minOpacity = Number(e.target.value);
                engine.current?.setCleanup(c.cleanup);
                try {
                  localStorage.setItem(
                    "roomlock.cleanup." + c.url,
                    JSON.stringify(c.cleanup),
                  );
                } catch {}
                rememberEdits(c);
              }}
            />
          </label>
          <label>
            Maximum scale: {config.cleanup.maxScaleMultiple.toFixed(1)} × median
            <input
              aria-label="Maximum splat scale multiple"
              type="range"
              min="1.5"
              max="20"
              step="0.5"
              value={config.cleanup.maxScaleMultiple}
              onChange={(e) => {
                const c = structuredClone(engine.current?.config ?? config);
                c.cleanup.maxScaleMultiple = Number(e.target.value);
                engine.current?.setCleanup(c.cleanup);
                try {
                  localStorage.setItem(
                    "roomlock.cleanup." + c.url,
                    JSON.stringify(c.cleanup),
                  );
                } catch {}
                rememberEdits(c);
              }}
            />
          </label>
          {ready && engine.current && (
            <small>
              {engine.current.cleanupStats.kept.toLocaleString()} /{" "}
              {engine.current.cleanupStats.total.toLocaleString()} splats
              retained. Camera clearance: {config.cleanup.nearRadius.toFixed(2)}{" "}
              m.
            </small>
          )}
          <textarea
            aria-label="Room configuration JSON"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <button
            onClick={() => {
              try {
                const c = JSON.parse(editText);
                if (!rememberEdits(c)) return;
                setReady(false);
                setFatal("");
                setReloadRoom((n) => n + 1);
                setToast("Room edits saved and applied.");
              } catch {
                setToast("Invalid JSON");
              }
            }}
          >
            Apply and save room
          </button>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(editText)
                .then(() => setToast("Room JSON copied"))
                .catch(() => setToast("Select the JSON and copy it manually."));
            }}
          >
            Copy JSON
          </button>
        </aside>
      )}
    </main>
  );
}
