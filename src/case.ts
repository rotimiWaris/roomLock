export type Vec3 = [number, number, number];
export type Placement = {
  id?: string;
  position: Vec3;
  rotation: Vec3;
  size: number;
};
export type RoomConfig = {
  captured?: boolean;
  calibrated?: boolean;
  evidenceEdited?: boolean;
  seed?: number;
  upAxis?: "Y" | "Z";
  name: string;
  url: string;
  rotation: Vec3;
  scale: number;
  offset: Vec3;
  camera: Vec3;
  lookAt: Vec3;
  crop: { min: Vec3; max: Vec3 };
  walkBounds: { min: Vec3; max: Vec3 };
  walkRadius: number;
  cleanup: { minOpacity: number; maxScaleMultiple: number; nearRadius: number };
  door: Placement;
  heirloom: Placement;
  footprints: Vec3[];
  evidence: (Placement & { id: string })[];
};
export type Clue = {
  id: string;
  name: string;
  time: string;
  minute: number;
  clue: string;
  detail: string;
  tag: string;
  custom?: boolean;
  url?: string;
};
export const clues: Clue[] = [
  {
    id: "muddy-boot",
    name: "The muddy boot",
    time: "20:42",
    minute: 42,
    tag: "TRACE",
    clue: "Fresh red clay matches the conservatory path. An embroidered “M” is tucked inside the cuff.",
    detail:
      "Mara wore these boots tonight. The clay is still wet, despite her claim that she never left the library.",
  },
  {
    id: "cracked-vase",
    name: "The cracked vase",
    time: "20:44",
    minute: 44,
    tag: "DISTURBANCE",
    clue: "A shard sits beneath the clock shelf. Theo heard the crash at 20:44 while carrying tea.",
    detail:
      "The vase was struck on the way to the hidden passage. It was not broken earlier in the evening.",
  },
  {
    id: "torn-letter",
    name: "The torn letter",
    time: "20:35",
    minute: 35,
    tag: "MOTIVE",
    clue: "“Mara — the necklace must stay in the house. The passage behind the north wall is not a hiding place.”",
    detail:
      "The writer knew Mara planned to hide the heirloom. This is a family prank that went too far, not a burglary.",
  },
  {
    id: "music-box",
    name: "The silent music box",
    time: "20:40",
    minute: 40,
    tag: "WITNESS",
    clue: "The box is empty. Iris wound it at 20:40, then watched Theo carry a tea tray into the hall.",
    detail:
      "Iris places Theo away from the display when the heirloom disappeared. The box once held the necklace.",
  },
  {
    id: "pocket-watch",
    name: "The stopped watch",
    time: "20:44",
    minute: 44,
    tag: "TIME",
    clue: "The hands stopped at 20:44 when the watch fell beside the shattered vase.",
    detail:
      "The impact fixes the time of the disturbance. The clue text supplies the exact time regardless of the generated dial.",
  },
  {
    id: "jewelry-box",
    name: "The velvet box",
    time: "20:46",
    minute: 46,
    tag: "DESTINATION",
    clue: "Red clay marks the velvet. A note inside reads: “Behind the arch. — M.”",
    detail:
      "The same clay connects the boots, the missing necklace, and the passage. Mara left a trail home.",
  },
];
export const suspects = [
  {
    id: "mara",
    name: "Mara Vale",
    role: "The niece",
    initial: "M",
    alibi: "“I was in the library all evening.”",
  },
  {
    id: "theo",
    name: "Theo Finch",
    role: "The caretaker",
    initial: "T",
    alibi: "“I was serving tea in the hall.”",
  },
  {
    id: "iris",
    name: "Iris Bell",
    role: "The guest",
    initial: "I",
    alibi: "“I wound the music box, then stayed by the fire.”",
  },
];
export const clockText = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
