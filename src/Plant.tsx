import { useEffect, useRef, useState } from "react";
import { clockText } from "./case";
type Job = { id: string; token: string; started: number; prompt: string };
type Phase =
  | "idle"
  | "Sending"
  | "Generating"
  | "Downloading"
  | "Placing"
  | "done"
  | "error";
export default function Plant({
  onPlace,
}: {
  onPlace: (url: string, prompt: string) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [total, setTotal] = useState(0);
  const [terminal, setTerminal] = useState(false);
  const [job, setJob] = useState<Job | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("roomlock-job") || "null");
    } catch {
      return null;
    }
  });
  const alive = useRef(true);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const started = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (started.current)
        setElapsed(Math.floor((Date.now() - started.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  async function json(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || `Connection returned HTTP ${res.status}`);
    return data;
  }
  async function run(resume: Job | null) {
    if (running.current) return;
    running.current = true;
    setError("");
    setTerminal(false);
    setBytes(0);
    setTotal(0);
    controller.current = new AbortController();
    const signal = controller.current.signal;
    started.current = resume?.started ?? Date.now();
    try {
      let current = resume;
      if (!current) {
        setPhase("Sending");
        const data = await json("/api/plant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal,
        });
        current = {
          id: String(data.id),
          token: data.token,
          started: Date.now(),
          prompt,
        };
        setJob(current);
        sessionStorage.setItem("roomlock-job", JSON.stringify(current));
        started.current = current.started;
      }
      setPhase("Generating");
      let result;
      while (alive.current) {
        let failures = 0;
        while (true) {
          try {
            result = await json(
              `/api/plant-status?id=${encodeURIComponent(current.id)}&token=${encodeURIComponent(current.token)}`,
              { signal },
            );
            break;
          } catch (e) {
            if (signal.aborted || ++failures >= 3) throw e;
            setError(
              `Connection interrupted. Retrying status check (${failures}/3)…`,
            );
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
        setError("");
        if (result.status === 3) break;
        if (result.status !== 1) {
          setTerminal(true);
          throw new Error(
            `Generation failed. Raw status: ${JSON.stringify(result.raw)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 5000));
        if (signal.aborted) return;
      }
      if (!alive.current) return;
      setPhase("Downloading");
      const res = await fetch(result.url, { signal });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const contentLength = Number(res.headers.get("content-length")) || 0;
      setTotal(contentLength);
      if (!res.body)
        throw new Error("Download stream unavailable. Please retry.");
      const reader = res.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let loaded = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(new Uint8Array(part.value));
        loaded += part.value.length;
        setBytes(loaded);
      }
      const blob = new Blob(chunks, { type: "model/gltf-binary" });
      const header = new DataView(await blob.slice(0, 12).arrayBuffer());
      if (
        blob.size < 12 ||
        header.getUint32(0, true) !== 0x46546c67 ||
        header.getUint32(8, true) !== blob.size
      )
        throw new Error(
          "Downloaded asset is not a complete GLB. Retry the download.",
        );
      setPhase("Placing");
      const url = URL.createObjectURL(blob);
      await onPlace(url, current.prompt);
      sessionStorage.removeItem("roomlock-job");
      setJob(null);
      setPhase("done");
    } catch (e) {
      if (!signal.aborted) {
        setPhase("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      running.current = false;
    }
  }
  const busy = ["Sending", "Generating", "Downloading", "Placing"].includes(
    phase,
  );
  return (
    <div className="plant-content">
      <p className="eyebrow">LEAVE YOUR OWN TRACE</p>
      <h2>Plant a little mystery.</h2>
      <p>
        Create a new object and place it in this room. Your planted clues are
        marked as extras and do not change the original solution.
      </p>
      <label htmlFor="prompt">Describe one object</label>
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        maxLength={240}
        placeholder="An antique glove with a secret stitched inside…"
        disabled={busy}
      />
      <div className="field-meta">
        <span>One object · 3–240 characters</span>
        <span>{prompt.length}/240</span>
      </div>
      {busy && (
        <div className="generation" role="status" aria-live="polite">
          <div className="generation-label">
            <strong>{phase}</strong>
            <span>{clockText(elapsed)}</span>
          </div>
          <div className="stage-track">
            {["Sending", "Generating", "Downloading", "Placing"].map((s) => (
              <span className={s === phase ? "current" : ""} key={s}>
                {s}
              </span>
            ))}
          </div>
          {phase === "Downloading" ? (
            <>
              <progress
                max={total || undefined}
                value={total ? bytes : undefined}
              />
              <small>
                {(bytes / 1000000).toFixed(2)} MB received
                {total ? ` / ${(total / 1000000).toFixed(2)} MB` : ""}
              </small>
            </>
          ) : (
            <div className="shimmer" />
          )}
          <small>
            {phase === "Generating"
              ? "Running · No percentage is supplied. Our first test took about 7 minutes."
              : "Progress reflects the current operation."}
          </small>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {terminal && !busy && (
        <button
          className="outline"
          onClick={() => {
            setPrompt(job?.prompt ?? prompt);
            sessionStorage.removeItem("roomlock-job");
            setJob(null);
            setTerminal(false);
            setPhase("idle");
            setError("");
          }}
        >
          Clear failed task and prepare a new attempt
        </button>
      )}
      {phase === "done" && (
        <p className="success">
          Your object is in the room. Find it in front of your last position.
        </p>
      )}
      {!busy && (
        <button
          className="primary"
          onClick={() => void run(job)}
          disabled={!job && prompt.trim().length < 3}
        >
          {job
            ? "Resume / retry existing job"
            : phase === "error"
              ? "Retry connection"
              : "Generate & plant"}{" "}
          <span>↗</span>
        </button>
      )}
      {job && !busy && (
        <p className="muted">
          An existing task is saved. Retrying polls that task; it does not buy
          another generation.
        </p>
      )}
      <p className="fineprint">
        One generation can run on this account at a time. If it is busy, wait
        and retry. Keep this panel open while the object generates.
      </p>
    </div>
  );
}
