import { useRef, useState } from "react";

const views = [
  {
    image: "/media/room-entry.webp",
    title: "The starting point",
    detail: "Look closer. The ordinary details are where the story begins.",
  },
  {
    image: "/media/room-corner.webp",
    title: "A different angle",
    detail:
      "Explore the captured space. Search the corners and follow what feels out of place.",
  },
  {
    image: "/media/room-window.webp",
    title: "Between the clues",
    detail: "One room, several stories. Find the evidence that connects them.",
  },
];

type Props = {
  ready: boolean;
  fatal: string;
  fraction: number | null;
  openCase: () => void;
  openCreate: () => void;
  openAbout: () => void;
};

export default function Landing({
  ready,
  fatal,
  fraction,
  openCase,
  openCreate,
  openAbout,
}: Props) {
  const [view, setView] = useState(0);
  const preview = useRef<HTMLDialogElement>(null);
  const canPlay = ready && !fatal;
  return (
    <div className="launch-site">
      <header className="launch-nav">
        <a className="launch-brand" href="#home" aria-label="RoomLock home">
          <svg viewBox="0 0 32 38" aria-hidden="true">
            <path d="M4 35V15C4 0 28 0 28 15v20H4Z" />
            <circle cx="16" cy="17" r="3" />
            <path d="m16 20-2 8h4Z" />
          </svg>
          <span>
            ROOMLOCK<small>CASE FILE</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#the-case">The case</a>
          <a href="#captured-rooms">Captured rooms</a>
          <a href="#how-to-play">How to play</a>
        </nav>
        <button className="nav-action" onClick={openAbout}>
          Behind the case <span aria-hidden="true">↗</span>
        </button>
      </header>

      <section className="launch-hero" id="home" aria-labelledby="hero-title">
        <div className="hero-art" aria-hidden="true">
          <div className="door-halo" />
          <img src="/media/case-door.webp" alt="" fetchPriority="high" />
          <span className="art-coordinate">
            THE LAST DOOR IS NEVER THE FIRST CLUE.
          </span>
        </div>
        <div className="hero-content">
          <p className="micro hero-kicker">
            <span /> A REAL ROOM. A FICTIONAL MYSTERY.
          </p>
          <h1 id="hero-title">
            Every room
            <br />
            has a <em>secret.</em>
          </h1>
          <p className="hero-description">
            An heirloom has vanished. Three stories don’t quite fit. Step into a
            real captured room and find what everyone else missed.
          </p>
          <div className="hero-actions">
            <button
              className="launch-button"
              disabled={!canPlay}
              onClick={openCase}
              aria-label={ready ? "Start the case" : "Preparing the room"}
            >
              {ready ? "Start the case" : "Preparing the room…"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
            <a className="launch-secondary" href="#captured-rooms">
              <span className="play-symbol" aria-hidden="true">
                ▷
              </span>{" "}
              Explore the capture
            </a>
          </div>
          {!ready && !fatal && (
            <div className="launch-loading" role="status">
              <progress value={fraction ?? undefined} max={1} />
              <span>
                {fraction === null
                  ? "Loading captured space"
                  : `${Math.round(fraction * 100)}% room downloaded`}
              </span>
            </div>
          )}
          {fatal && (
            <p role="alert" className="error">
              {fatal}
            </p>
          )}
        </div>
        <div className="hero-baseline">
          <div>
            <span className="micro">CASE NO. 001</span>
            <strong>The Missing Heirloom</strong>
          </div>
          <div>
            <span className="micro">PLAY TIME</span>
            <strong>8–12 minutes</strong>
          </div>
          <div>
            <span className="micro">PLAYERS</span>
            <strong>Just you. And the evidence.</strong>
          </div>
          <a
            href="#the-case"
            className="scroll-cue"
            aria-label="Discover the case"
          >
            ↓
          </a>
        </div>
      </section>

      <section
        className="case-intro launch-section"
        id="the-case"
        aria-labelledby="case-title"
      >
        <p className="micro section-index">
          <span>01</span> THE CASE
        </p>
        <div>
          <h2 id="case-title">
            Something’s missing.
            <br />
            <span>Someone knows why.</span>
          </h2>
          <p>
            The room is familiar. The story isn’t. A muddy boot, a stopped
            watch, a letter left behind. Piece together the evening, challenge
            an alibi, and uncover what lies beyond the wall.
          </p>
        </div>
        <div className="case-numbers">
          <div>
            <strong>06</strong>
            <span className="micro">HIDDEN CLUES</span>
          </div>
          <div>
            <strong>03</strong>
            <span className="micro">SUSPECTS</span>
          </div>
          <div>
            <strong>01</strong>
            <span className="micro">WAY TO THE TRUTH</span>
          </div>
        </div>
      </section>

      <section
        className="room-showcase launch-section"
        id="captured-rooms"
        aria-labelledby="rooms-title"
      >
        <div className="section-heading">
          <div>
            <p className="micro section-index">
              <span>02</span> CAPTURED ROOMS
            </p>
            <h2 id="rooms-title">
              Real spaces.
              <br />
              <span>Unreal mysteries.</span>
            </h2>
          </div>
          <p>
            Filmed on a phone. Rebuilt in 3D.
            <br />
            Your surroundings become somewhere
            <br className="desktop" /> worth getting lost in.
          </p>
        </div>
        <div className="capture-feature">
          <div className="capture-visual">
            <button
              className="capture-open"
              onClick={() => preview.current?.showModal()}
              aria-label={`Enlarge room capture: ${views[view].title}`}
            >
              <img
                src={views[view].image}
                alt={`Actual 3D room capture — ${views[view].title.toLowerCase()}`}
                loading="lazy"
                width="1440"
                height="900"
              />
              <span className="capture-badge micro">
                <i /> IN-GAME CAPTURE
              </span>
              <span className="capture-expand" aria-hidden="true">
                ↗
              </span>
              <span className="capture-caption">
                <span className="micro">VIEW 0{view + 1} / 03</span>
                <strong>{views[view].title}</strong>
              </span>
            </button>
            <div
              className="capture-views"
              role="group"
              aria-label="Room viewpoints"
            >
              {views.map((item, index) => (
                <button
                  key={item.image}
                  className={view === index ? "is-selected" : ""}
                  aria-pressed={view === index}
                  onClick={() => setView(index)}
                >
                  <span className="micro">0{index + 1}</span>
                  {item.title}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
          <div className="capture-info">
            <span className="micro available-label">
              <i /> PLAYABLE NOW
            </span>
            <h3>
              The Missing
              <br />
              Heirloom
            </h3>
            <p>{views[view].detail}</p>
            <dl>
              <div>
                <dt>Setting</dt>
                <dd>A real captured room</dd>
              </div>
              <div>
                <dt>Experience</dt>
                <dd>First-person mystery</dd>
              </div>
              <div>
                <dt>Case length</dt>
                <dd>8–12 minutes</dd>
              </div>
            </dl>
            <button
              className="launch-button"
              disabled={!canPlay}
              onClick={openCase}
            >
              Investigate this room <span aria-hidden="true">↗</span>
            </button>
            <small>Three views of our first room capture.</small>
          </div>
        </div>
        <div className="capture-footnote">
          <span className="micro">PHONE VIDEO → 3D ROOM → PLAYABLE CASE</span>
          <button onClick={openCreate}>
            Scan your room <span aria-hidden="true">↗</span>
          </button>
        </div>
      </section>

      <section
        className="how-section launch-section"
        id="how-to-play"
        aria-labelledby="how-title"
      >
        <div className="section-heading">
          <div>
            <p className="micro section-index">
              <span>03</span> HOW TO PLAY
            </p>
            <h2 id="how-title">
              Trust your eyes.
              <br />
              <span>Question everything.</span>
            </h2>
          </div>
          <p>
            No score to chase. No enemies to fight.
            <br />
            Just a room that rewards your attention.
          </p>
        </div>
        <div className="play-steps">
          <article>
            <span className="step-count">01 / EXPLORE</span>
            <span className="step-symbol" aria-hidden="true">
              ⌖
            </span>
            <h3>Look a little closer.</h3>
            <p>
              Move through the captured room. Get close to objects and inspect
              the details hiding in plain sight.
            </p>
            <span className="micro">WASD + MOUSE / TOUCH CONTROLS</span>
          </article>
          <article>
            <span className="step-count">02 / CONNECT</span>
            <span className="step-symbol" aria-hidden="true">
              ⌘
            </span>
            <h3>Build your version.</h3>
            <p>
              Pin clues to your timeline. As the evidence adds up, new leads
              unlock and the room begins to react.
            </p>
            <span className="micro">INSPECT → PIN → RECONSTRUCT</span>
          </article>
          <article>
            <span className="step-count">03 / REVEAL</span>
            <span className="step-symbol" aria-hidden="true">
              ◇
            </span>
            <h3>Make the accusation.</h3>
            <p>
              Compare the alibis. Name the person behind the disappearance and
              discover the room’s final secret.
            </p>
            <span className="micro">THREE SUSPECTS. ONE ANSWER.</span>
          </article>
        </div>
        <div className="plant-teaser">
          <span className="micro">A LITTLE CREATIVE LICENSE</span>
          <h3>Have something to add?</h3>
          <p>
            Inside the case, describe an object and watch it become a new piece
            of 3D evidence you can place and inspect.
          </p>
          <button className="launch-secondary" onClick={openAbout}>
            See how it works <span aria-hidden="true">↗</span>
          </button>
        </div>
      </section>

      <footer className="launch-footer">
        <p className="micro">THE TRUTH IS ALREADY IN THE ROOM.</p>
        <h2>Go find it.</h2>
        <button
          className="launch-button"
          disabled={!canPlay}
          onClick={openCase}
        >
          Begin the investigation <span aria-hidden="true">↗</span>
        </button>
        <div className="footer-bottom">
          <span className="footer-wordmark">ROOMLOCK</span>
          <span className="micro">A FICTIONAL CASE IN A REAL SPACE.</span>
          <button onClick={openCreate}>Scan your room ↗</button>
        </div>
      </footer>
      <dialog
        ref={preview}
        className="capture-dialog"
        aria-label="Room capture preview"
        onClick={(event) => {
          if (event.target === event.currentTarget) preview.current?.close();
        }}
      >
        <button
          className="capture-dialog-close"
          onClick={() => preview.current?.close()}
          aria-label="Close room preview"
        >
          ×
        </button>
        <img
          src={views[view].image}
          alt={`Actual 3D capture: ${views[view].title}`}
        />
        <div>
          <button
            onClick={() => setView((view + 2) % views.length)}
            aria-label="Previous room view"
          >
            ←
          </button>
          <p>
            <strong>{views[view].title}</strong>
            <span className="micro">
              ACTUAL ROOM CAPTURE · VIEW 0{view + 1} / 03
            </span>
          </p>
          <button
            onClick={() => setView((view + 1) % views.length)}
            aria-label="Next room view"
          >
            →
          </button>
        </div>
      </dialog>
    </div>
  );
}
