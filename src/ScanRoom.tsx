import { useEffect, useRef, useState } from "react";
import {
  compressVideo,
  scanRequest,
  uploadVideo,
  type SavedRoom,
  type ScanJob,
  type ScanProgress,
} from "./scan-client";
import "./scan.css";

const storageKey = "roomlock.scan.v1";
type Session = {
  proof?: string;
  url?: string;
  job?: ScanJob;
  room?: SavedRoom;
};
function readSession(): Session {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    return {};
  }
}
export default function ScanRoom({
  onReady,
}: {
  onReady: (room: SavedRoom) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [session, setSession] = useState<Session>(readSession);
  const sessionRef = useRef(session);
  const [progress, setProgress] = useState<ScanProgress>({
    stage: "Choose a video",
    fraction: null,
    detail: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pollRun, setPollRun] = useState(0);
  const cancel = useRef<() => void>(() => {});
  const alive = useRef(true);
  const compressed = useRef<File | null>(null);
  const save = (value: Session) => {
    sessionRef.current = value;
    setSession(value);
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel.current();
    };
  }, []);
  useEffect(() => {
    if (!session.job || session.room) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const startedAt = session.job.startedAt;
    const elapsedTimer = setInterval(
      () =>
        setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))),
      1000,
    );
    const poll = async () => {
      setBusy(true);
      try {
        const data = await scanRequest<{
          status: string;
          progress: number | null;
          raw: unknown;
        }>("status", { token: session.job!.token });
        if (!active) return;
        setError("");
        setProgress({
          stage: "Reconstructing",
          fraction: data.progress,
          detail: data.status,
        });
        if (data.status === "SUCCEEDED") {
          setProgress({
            stage: "Saving your room",
            fraction: null,
            detail:
              "Downloading the finished 3D room and saving it before its temporary link expires.",
          });
          const room = await scanRequest<SavedRoom>("save", {
            token: session.job!.token,
          });
          if (!active) return;
          save({ ...sessionRef.current, room });
          setProgress({
            stage: "Room ready",
            fraction: 1,
            detail:
              "Your capture is saved. Enter to explore and solve the case.",
          });
          setBusy(false);
          return;
        }
        if (!["PENDING", "PREPROCESSING", "RUNNING"].includes(data.status)) {
          setError(
            data.status === "FAILED"
              ? "Aholo couldn't read this video, try re-filming slowly for 20 to 60 seconds"
              : `Reconstruction stopped (${data.status}). Choose a new video and try again.`,
          );
          setProgress({
            stage: "Choose a new video",
            fraction: null,
            detail: "",
          });
          setFile(null);
          compressed.current = null;
          save({});
          setBusy(false);
          return;
        }
        failures = 0;
        timer = setTimeout(poll, 8000);
      } catch (cause) {
        if (!active) return;
        failures++;
        setError(String(cause instanceof Error ? cause.message : cause));
        if (failures < 4) timer = setTimeout(poll, 5000 * failures);
        else setBusy(false);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(elapsedTimer);
    };
  }, [session.job?.worldId, session.room?.url, pollRun]);
  function choose(value?: File) {
    if (!value) return;
    if (
      !/\.(mp4|mov|webm)$/i.test(value.name) &&
      !["video/mp4", "video/quicktime", "video/webm"].includes(value.type)
    ) {
      setError("Choose an MP4, MOV, or WebM video.");
      return;
    }
    setFile(value);
    compressed.current = null;
    setError("");
    save({});
    setProgress({
      stage: "Ready to compress",
      fraction: null,
      detail: `${value.name} · ${(value.size / 1000000).toFixed(1)} MB`,
    });
  }
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await scanRequest("config", {});
      let proof = sessionRef.current.proof;
      let url = sessionRef.current.url;
      if (!proof || !url) {
        if (!file) throw Error("Choose or record a video first.");
        compressed.current ??= await compressVideo(
          file,
          (p) => {
            if (alive.current) setProgress(p);
          },
          (fn) => {
            cancel.current = fn;
          },
        );
        if (!alive.current) return;
        const upload = await uploadVideo(compressed.current, setProgress);
        ({ proof, url } = upload);
        save(upload);
        if (!alive.current) return;
      }
      setProgress({
        stage: "Sending video to Aholo",
        fraction: null,
        detail:
          "Validating the MP4, transferring it to Aholo, and starting reconstruction. This may take a minute.",
      });
      const job = await scanRequest<ScanJob>("start", { proof, url });
      if (alive.current) save({ proof, url, job });
    } catch (cause) {
      if (alive.current) {
        setError(String(cause instanceof Error ? cause.message : cause));
        setBusy(false);
      }
    }
  }
  return (
    <div className="modal-padding scan-content">
      <p className="eyebrow">YOUR SPACE / A NEW CASE</p>
      <h2>Scan your room</h2>
      <p>
        Move slowly around the room in good light. Film the furniture from
        several angles. Keep the camera roughly at eye level.
      </p>
      <p className="scan-timing">
        Reconstruction takes about 10 minutes or longer. Keep this page open so
        the finished room can be saved straight away.
      </p>
      {!session.job && (
        <>
          <div className="scan-inputs">
            <label className="outline">
              Choose video
              <input
                type="file"
                accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                disabled={busy}
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
            <label className="outline">
              Record video
              <input
                type="file"
                accept="video/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
          </div>
          <p className="fineprint">
            MP4, MOV, or WebM, at least 10 seconds long. Longer clips use only
            the first 60 seconds. Videos keep their orientation and become
            silent, 15 fps MP4s with a 1280-pixel long edge, under 10 MB.
          </p>
        </>
      )}
      <div className="generation" aria-live="polite">
        <div className="generation-label">
          <strong>{session.room ? "Room ready" : progress.stage}</strong>
          {session.job && (
            <span>
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          )}
        </div>
        {progress.fraction !== null ? (
          <>
            <progress
              aria-label={`${progress.stage} progress`}
              value={progress.fraction}
              max={1}
            />
            <small>{Math.round(progress.fraction * 100)}%</small>
          </>
        ) : (
          busy && <div className="shimmer" />
        )}
        <small>{progress.detail}</small>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!session.job && (
        <button
          className="primary"
          disabled={busy || (!file && !session.proof)}
          onClick={() => void start()}
        >
          {error ? "Retry scan" : "Compress and scan"} <span>↗</span>
        </button>
      )}
      {session.job && !session.room && !busy && (
        <>
          <button
            className="primary"
            onClick={() => {
              setError("");
              setPollRun((n) => n + 1);
            }}
          >
            Retry status / save
          </button>
          <button
            className="outline"
            onClick={() => {
              save({});
              setFile(null);
              compressed.current = null;
              setProgress({
                stage: "Choose a new clip",
                fraction: null,
                detail: "Choose a video to begin a fresh reconstruction.",
              });
            }}
          >
            Start a new scan
          </button>
        </>
      )}
      {session.room && (
        <>
          <button className="primary" onClick={() => onReady(session.room!)}>
            Enter my room <span>→</span>
          </button>
          <button
            className="outline"
            onClick={() => {
              save({});
              setFile(null);
              compressed.current = null;
            }}
          >
            Scan another room
          </button>
        </>
      )}
      <p className="fineprint">
        Your video and finished room are stored at unlisted public links. Aholo
        reads the video to reconstruct your room. Avoid filming private
        information. Scanning uses the connected account’s generation credits.
      </p>
    </div>
  );
}
