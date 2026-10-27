import { z } from "zod";
import {
  midi,
  pitchName,
  toTick,
  ToolkitError,
  type NoteEvent,
  type Score,
} from "./model.js";
import { chordWindows, parseChord, type ChordWindow } from "./harmony.js";

export const VoicingStyleSchema = z.enum([
  "close",
  "open",
  "drop2",
  "root-position",
]);
export type VoicingStyle = z.infer<typeof VoicingStyleSchema>;

export type VoicedChord = {
  at: number;
  durationBeats: number;
  chord: string;
  pitches: string[];
  midi: number[];
};

/**
 * Build chord voicings from the score's `harmony` markers.
 *
 * `close`: all tones packed within an octave above the register anchor.
 * `open`: every other tone dropped an octave, which widens the texture.
 * `drop2`: the second-highest tone dropped an octave.
 * `root-position`: root in the bass register, remaining tones clustered above
 * a separate anchor — useful for a bass + harmony split.
 */
export function voiceChord(
  chord: ChordWindow,
  style: VoicingStyle,
  anchorMidi: number,
  maxVoices: number,
): number[] {
  const pcs = chord.intervals.map((i) => (chord.root + i) % 12);
  // Place tones ascending from the anchor octave.
  const base = Math.floor(anchorMidi / 12) * 12;
  const tones: number[] = [];
  let octave = base;
  for (const pc of pcs) {
    let candidate = octave + pc;
    if (candidate < anchorMidi) candidate += 12;
    while (tones.length && candidate <= tones[tones.length - 1]!)
      candidate += 12;
    tones.push(candidate);
  }
  let voiced = tones;
  if (style === "open")
    voiced = tones
      .map((t, i) => (i % 2 === 1 ? t - 12 : t))
      .sort((a, b) => a - b);
  else if (style === "drop2" && tones.length >= 3) {
    const idx = tones.length - 2;
    voiced = tones
      .map((t, i) => (i === idx ? t - 12 : t))
      .sort((a, b) => a - b);
  } else if (style === "root-position") {
    // Root an octave below the anchor, the rest stacked above it.
    const rootBelow =
      base + chord.root - (base + chord.root > anchorMidi - 12 ? 12 : 0);
    voiced = [rootBelow, ...tones.filter((t) => t % 12 !== chord.root)];
  }
  // Honour maxVoices by dropping the inner voices, keeping root and top.
  if (voiced.length > maxVoices) {
    const keep = [voiced[0]!];
    const inner = voiced.slice(1, -1);
    const top = voiced.at(-1)!;
    while (keep.length + inner.length + 1 > maxVoices) inner.shift();
    voiced = [...keep, ...inner, top];
  }
  return voiced;
}

export const HarmonizeConfigSchema = z.strictObject({
  output: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("clip"), clipId: z.string().min(1) }),
      z.strictObject({
        kind: z.literal("new-track"),
        trackId: z.string().min(1),
        role: z.enum(["harmony", "arp", "texture"]).default("harmony"),
        instrument: z.string().min(1),
        gainDb: z.number().min(-60).max(6).default(-14),
        maxVoices: z.number().int().min(1).max(16).default(4),
        voicePolicy: z.enum(["error", "cut"]).default("cut"),
        pan: z.number().min(-1).max(1).default(0),
        send: z.number().min(0).max(1).default(0.1),
      }),
    ])
    .optional(),
  style: VoicingStyleSchema.default("close"),
  /** Lowest chord tone, as a MIDI number; the voicing starts from here. */
  anchorMidi: z.number().int().min(0).max(127).default(60),
  /** Restrict to a beat range; defaults to the whole song. */
  fromBeat: z.number().min(0).optional(),
  toBeat: z.number().positive().optional(),
  /** Event ID prefix so repeated runs stay stable. */
  idPrefix: z.string().min(1).max(40).default("harm"),
});

export function buildHarmonyPattern(
  score: Score,
  config: z.infer<typeof HarmonizeConfigSchema>,
): NoteEvent[] {
  const windows = chordWindows(score);
  if (!windows.length)
    throw new ToolkitError(
      "NO_HARMONY",
      "No harmony markers found; add score.harmony entries or use arpeggiate on an existing pattern",
    );
  const from = config.fromBeat ?? 0,
    to = config.toBeat ?? score.lengthBeats;
  const maxVoices = 8;
  const events: NoteEvent[] = [];
  for (const w of windows) {
    if (w.until <= from || w.at >= to) continue;
    // A chord that starts before the range is clipped to it.
    const start = Math.max(w.at, from);
    const end = Math.min(w.until, to);
    if (end <= start) continue;
    const pitches = voiceChord(w, config.style, config.anchorMidi, maxVoices);
    pitches.forEach((p, i) => {
      const id = `${config.idPrefix}-${events.length}-${i}`;
      events.push({
        id,
        kind: "note",
        at: start,
        pitch: pitchName(p),
        duration: end - start,
        gate: 1,
        velocity: 0.55,
        hold: false,
      });
    });
  }
  return events;
}

export const ArpeggioConfigSchema = z.strictObject({
  trackId: z.string().min(1),
  clipId: z.string().min(1),
  newPattern: z.string().min(1).max(64),
  pattern: z
    .enum(["up", "down", "updown", "downup", "random"])
    .default("updown"),
  /** Seconds per arpeggio step, in beats. */
  stepBeats: z.number().min(0.0625).max(2).default(0.25),
  /** 0..1, how much of the step a note sounds. */
  gate: z.number().min(0.05).max(1).default(0.9),
  octaves: z.number().int().min(1).max(4).default(1),
  velocity: z.number().min(0).max(1).default(0.6),
  /** Optional accent on the first note of each arpeggio cycle. */
  accent: z.number().min(0).max(1).default(0),
  idPrefix: z.string().min(1).max(40).default("arp"),
});

/**
 * Expand the notes already present in a pattern into an arpeggio. This works on
 * a pattern rather than on `harmony` so it can be applied to hand-voiced chords
 * as well as generated ones.
 */
export function buildArpeggioPattern(
  score: Score,
  sourceEvents: NoteEvent[],
  config: z.infer<typeof ArpeggioConfigSchema>,
  totalBeats: number,
): NoteEvent[] {
  const byBeat = new Map<number, NoteEvent[]>();
  for (const e of sourceEvents) {
    const key = Math.round(e.at * 1e6) / 1e6;
    const list = byBeat.get(key);
    if (list) list.push(e);
    else byBeat.set(key, [e]);
  }
  const onsets = [...byBeat.keys()].sort((a, b) => a - b);
  if (!onsets.length)
    throw new ToolkitError(
      "EMPTY_SOURCE",
      "Source pattern has no notes to arpeggiate",
    );
  const out: NoteEvent[] = [];
  const step = config.stepBeats;
  onsets.forEach((onset, oi) => {
    const group = byBeat.get(onset)!;
    const chordEnd =
      oi + 1 < onsets.length
        ? onsets[oi + 1]!
        : Math.max(totalBeats, onset + step);
    const base = [...group].map((e) => midi(e.pitch)).sort((a, b) => a - b);
    const expanded: number[] = [];
    for (let oct = 0; oct < config.octaves; oct++)
      for (const m of base) expanded.push(m + oct * 12);
    let sequence: number[];
    switch (config.pattern) {
      case "up":
        sequence = expanded;
        break;
      case "down":
        sequence = [...expanded].reverse();
        break;
      case "updown":
        sequence =
          expanded.length > 2
            ? [...expanded, ...expanded.slice(1, -1).reverse()]
            : expanded;
        break;
      case "downup": {
        const down = [...expanded].reverse();
        sequence =
          down.length > 2 ? [...down, ...down.slice(1, -1).reverse()] : down;
        break;
      }
      case "random": {
        // Deterministic shuffle from the score seed and onset.
        let state = (score.seed ^ Math.round(onset * 960)) >>> 0;
        const rnd = () => {
          state = (state + 0x6d2b79f5) >>> 0;
          let t = state;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        sequence = [...expanded];
        for (let i = sequence.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [sequence[i], sequence[j]] = [sequence[j]!, sequence[i]!];
        }
        break;
      }
    }
    const span = chordEnd - onset;
    const steps = Math.max(1, Math.floor(span / step + 1e-9));
    for (let i = 0; i < steps; i++) {
      const m = sequence[i % sequence.length]!;
      if (m < 0 || m > 127) continue;
      const accent = i % sequence.length === 0 ? config.accent : 0;
      out.push({
        id: `${config.idPrefix}-${out.length}`,
        kind: "note",
        at: onset + i * step,
        pitch: pitchName(m),
        duration: step,
        gate: config.gate,
        velocity: Math.min(1, config.velocity + accent),
        hold: false,
      });
    }
  });
  // Drop anything that overruns the pattern.
  return out.filter((e) => {
    try {
      toTick(e.at);
      toTick(e.duration);
    } catch {
      return false;
    }
    return e.at + e.duration <= totalBeats + 1e-8 || e.hold;
  });
}

/** Human-readable summary of a voicing, used in tool reports. */
export function describeVoicing(pitches: string[]) {
  return pitches.join(" ");
}

export { parseChord };
