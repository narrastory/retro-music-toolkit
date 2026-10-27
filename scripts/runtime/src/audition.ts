import { ScoreSchema, type MusicEvent, type Score } from "./model.js";
import { preset, INSTRUMENTS } from "./instruments.js";
import { SUPPORTED_SCHEMA } from "./version.js";

export function instrumentGuidance(id: string, source?: Score) {
  const p = preset(id, source);
  return {
    preferredArticulation:
      p.attack >= 0.05
        ? "Long notes; allow the attack to speak."
        : p.role === "arp"
          ? "Short, separated answers and accompaniment."
          : "Short phrases and sustained notes with deliberate rests.",
    watchFor:
      p.engine === "fm"
        ? "High brightness and continuous long notes may fatigue."
        : p.engine === "sample"
          ? "Check register extremes, loop texture and fast passages; verify sample provenance."
          : p.engine === "drums"
            ? "Keep noise tails and hit density restrained."
            : "Check high-register harshness and melody/accompaniment masking.",
    auditionStatus: "reference available; human listening review pending",
  };
}
function pitch(n: number) {
  return `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12]}${Math.floor(n / 12) - 1}`;
}
export function createAuditionScore(id: string, source?: Score) {
  const p = preset(id, source);
  const events: MusicEvent[] = [];
  if (p.engine === "drums")
    for (let group = 0; group < 8; group++)
      for (let i = 0; i < 4; i++)
        events.push({
          id: `hit-${group}-${i}`,
          kind: "hit",
          at: group * 4 + i,
          sound: (
            [
              "kick",
              "snare",
              "hat",
              "openhat",
              "tom",
              "crash",
              "rim",
              "clap",
            ] as const
          )[group]!,
          velocity: i % 2 ? 0.8 : 0.4,
          detuneCents: 0,
        });
  else {
    const registers = [
      p.range[0],
      Math.round((p.range[0] + p.range[1]) / 2),
      p.range[1],
    ];
    for (let group = 0; group < 3; group++)
      for (const [i, at, duration, velocity] of [
        [0, 0, 0.25, 0.4],
        [1, 0.75, 0.25, 0.8],
        [2, 1.5, 1.5, 0.4],
        [3, 4, 1.5, 0.8],
      ])
        events.push({
          id: `note-${group}-${i}`,
          kind: "note",
          at: group * 8 + at!,
          pitch: pitch(registers[group]!),
          duration: duration!,
          gate: 0.8,
          velocity: velocity!,
          hold: false,
        });
  }
  return ScoreSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA,
    instrumentDefinitions: source?.instrumentDefinitions,
    sampleAssets: source?.sampleAssets,
    title: `Audition: ${id}`,
    profile:
      p.engine === "fm"
        ? "genesis-inspired"
        : p.engine === "sample"
          ? "snes-inspired"
          : "nes-inspired",
    tempo: 120,
    meter: [4, 4],
    // 3 tonal groups or 8 drum groups, four beats each: no trailing silence.
    lengthBeats: p.engine === "drums" ? 32 : 24,
    seed: 427,
    tracks: [
      {
        id: "audition",
        role: p.role,
        instrument: id,
        gainDb: -6,
        maxVoices: 1,
        voicePolicy: "cut",
        send: 0,
        patterns: {
          reference: { lengthBeats: p.engine === "drums" ? 32 : 24, events },
        },
        clips: [{ id: "reference-clip", pattern: "reference", at: 0 }],
      },
    ],
    mixer: { masterDb: -6, feedback: 0 },
    export: { mode: "one-shot", tailSeconds: 1 },
  });
}
export const AUDITION_IDS = INSTRUMENTS.map((p) => p.id);
