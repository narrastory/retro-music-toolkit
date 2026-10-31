import { z } from "zod";
import {
  InstrumentDefinitionSchema,
  SampleAssetSchema,
  DrumSoundSchema,
  type DrumSound,
} from "./instrument-model.js";
export { DrumSoundSchema, type DrumSound } from "./instrument-model.js";

/** Ticks per quarter note. Triplets (3, 6, 12 subdivisions) map to exact integers. */
export const PPQ = 960;
/** Preferred schema for new work; 1.0 and 1.1 remain accepted. */
export const SCORE_SCHEMA_VERSION = "1.3";

const beat = z.number().min(0).max(4096);
const duration = z.number().positive().max(4096);

export const PitchPointSchema = z.strictObject({
  offsetBeats: z.number().min(0).max(4096),
  value: z.number().min(-2400).max(2400),
});
export const ExpressionSchema = z.strictObject({
  portamentoBeats: z.number().min(0).max(4).optional(),
  pitchBendCents: z.array(PitchPointSchema).min(1).max(128).optional(),
});
export const AutomationSchema = z.strictObject({
  parameter: z.enum(["gainDb", "pan", "brightness", "send"]),
  points: z
    .array(
      z.strictObject({ at: z.number().min(0).max(4096), value: z.number() }),
    )
    .min(1)
    .max(128),
});
export const NoteSchema = z.strictObject({
  id: z.string().min(1).max(80),
  kind: z.literal("note"),
  at: beat,
  pitch: z.string().regex(/^[A-G](?:#|b)?[0-8]$/),
  duration,
  gate: z.number().min(0.01).max(1).default(0.85),
  velocity: z.number().min(0).max(1).default(0.75),
  /** Sustain until the next event on the same track instead of using gate. */
  hold: z.boolean().default(false),
  articulation: z.enum(["retrigger", "legato"]).optional(),
  expression: ExpressionSchema.optional(),
  vibrato: z
    .strictObject({
      depthCents: z.number().min(0).max(100),
      rateHz: z.number().min(1).max(12),
      delayBeats: beat,
    })
    .optional(),
});
export const HitSchema = z.strictObject({
  id: z.string().min(1).max(80),
  kind: z.literal("hit"),
  at: beat,
  sound: DrumSoundSchema,
  velocity: z.number().min(0).max(1).default(0.6),
  /** Optional per-hit pitch offset for tom/kick-style drums. */
  detuneCents: z.number().min(-1200).max(1200).default(0),
});
export const EventSchema = z.discriminatedUnion("kind", [
  NoteSchema,
  HitSchema,
]);
export const PatternSchema = z.strictObject({
  lengthBeats: duration,
  events: z.array(EventSchema).max(20000),
});
export const ClipSchema = z.strictObject({
  id: z.string().min(1).max(80),
  pattern: z.string().min(1),
  at: beat,
  repeats: z.number().int().min(1).max(128).default(1),
  /** Play only this many beats instead of the full repeated pattern length. */
  lengthBeats: z.number().positive().max(4096).optional(),
  transpose: z.number().int().min(-48).max(48).default(0),
  velocityScale: z.number().min(0).max(2).default(1),
  mute: z.boolean().default(false),
});
export const ArpeggioSchema = z.strictObject({
  enabled: z.boolean().default(true),
  /** Pitch steps per beat. 16 at 120 BPM is 32 steps/second. */
  rate: z.number().min(1).max(32).default(16),
  /** Fraction of each step the pitch is held; 1 keeps the envelope continuous. */
  gate: z.number().min(0.05).max(1).default(1),
  /** Ascending cycle order, or "as-written" to keep the authored order. */
  order: z.enum(["up", "down", "updown", "as-written"]).default("up"),
});
export type ArpeggioConfig = z.infer<typeof ArpeggioSchema>;

export const HumanizeSchema = z.strictObject({
  timingBeats: z.number().min(0).max(0.25).default(0),
  velocity: z.number().min(0).max(0.5).default(0),
});
export const TrackSchema = z.strictObject({
  id: z.string().min(1).max(80),
  role: z.enum(["melody", "bass", "harmony", "arp", "drums", "texture"]),
  instrument: z.string().min(1),
  gainDb: z.number().min(-60).max(6).default(-6),
  pan: z.number().min(-1).max(1).default(0),
  send: z.number().min(0).max(1).default(0),
  reverbSend: z.number().min(0).max(1).default(0),
  maxVoices: z.number().int().min(1).max(16).default(1),
  voicePolicy: z.enum(["error", "cut"]).default("cut"),
  /** 0 = straight, 1 = full triplet swing on the swingUnit grid. */
  swing: z.number().min(0).max(1).default(0),
  /** Grid the swing displaces; 0.5 = eighth notes, 0.25 = sixteenths. */
  swingUnit: z.number().min(0.0625).max(2).default(0.5),
  humanize: HumanizeSchema.optional(),
  /**
   * Single-voice chord arpeggio. Notes that start together are merged into one
   * voice whose pitch steps rapidly through the chord tones, the standard way a
   * one-channel sound chip fakes a chord.
   */
  arpeggio: ArpeggioSchema.optional(),
  controls: z
    .strictObject({
      brightness: z.number().min(0).max(1).default(0.5),
      pluckiness: z.number().min(0).max(1).default(0.5),
    })
    .default({ brightness: 0.5, pluckiness: 0.5 }),
  automation: z.array(AutomationSchema).max(4).optional(),
  patterns: z.record(z.string(), PatternSchema),
  clips: z.array(ClipSchema).max(1024),
});
export const KeySchema = z.strictObject({
  tonic: z.string().regex(/^[A-G](?:#|b)?$/),
  mode: z.enum(["major", "minor"]),
});
export const EchoSchema = z.strictObject({
  enabled: z.boolean().default(true),
  delayBeats: z.number().min(0.0625).max(4).default(0.5),
  feedback: z.number().min(0).max(0.9).default(0.35),
  /** Coefficients for taps 0..7; shorter arrays are padded with zeros. */
  taps: z
    .array(z.number().min(-1).max(1))
    .min(1)
    .max(8)
    .default([0.6, -0.3, 0.2, -0.1]),
  returnDb: z.number().min(-60).max(0).default(-14),
});
export type EchoConfig = z.infer<typeof EchoSchema>;
export const ReverbSchema = z.strictObject({
  enabled: z.boolean().default(true),
  decaySeconds: z.number().min(0.1).max(4).default(1.2),
  preDelaySeconds: z.number().min(0).max(0.2).default(0.02),
  damping: z.number().min(0).max(1).default(0.55),
  returnDb: z.number().min(-60).max(0).default(-10),
});

export const ScoreSchema = z.strictObject({
  schemaVersion: z.enum(["1.0", "1.1", "1.2", "1.3"]),
  instrumentDefinitions: z.array(InstrumentDefinitionSchema).max(64).optional(),
  sampleAssets: z.record(z.string(), SampleAssetSchema).optional(),
  title: z.string().min(1).max(120),
  profile: z.enum(["nes-inspired", "genesis-inspired", "snes-inspired"]),
  /**
   * "modern" uses the toolkit's polished voice; "hardware" removes the safety
   * low-pass, quantises pulse duty cycles and volume, and enables the SNES echo
   * when the profile is snes-inspired. It is an audible approximation, not a
   * bit-accurate emulation.
   */
  authenticity: z.enum(["modern", "hardware"]).default("modern"),
  tempo: z.number().min(30).max(300),
  meter: z.tuple([
    z.number().int().min(1).max(16),
    z.union([z.literal(4), z.literal(8)]),
  ]),
  lengthBeats: duration,
  seed: z.number().int().min(0).max(4294967295).default(1),
  /** Declared tonal centre; used by diagnostics only, never by the synthesizer. */
  key: KeySchema.optional(),
  /** Chord markers. Read by harmony diagnostics and the harmonize/arpeggiate tools. */
  harmony: z
    .array(
      z.strictObject({
        at: beat,
        chord: z.string().min(1).max(32),
        /** Optional written length; a marker lasts until the next one when omitted. */
        lengthBeats: z.number().positive().max(4096).optional(),
      }),
    )
    .max(1024)
    .default([]),
  sections: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        at: beat,
        lengthBeats: duration,
        label: z.string().max(16).optional(),
        energy: z.number().min(0).max(1).optional(),
      }),
    )
    .max(128)
    .default([]),
  tracks: z.array(TrackSchema).min(1).max(32),
  mixer: z
    .strictObject({
      masterDb: z.number().min(-36).max(0).default(-6),
      delayBeats: z.number().min(0.0625).max(4).default(0.75),
      feedback: z.number().min(0).max(0.65).default(0.22),
      returnDb: z.number().min(-60).max(0).default(-12),
      /**
       * Eight-tap FIR echo, the SNES signature. Each tap is an additional
       * multiple of delayBeats; the summed taps feed back into the line.
       */
      echo: EchoSchema.optional(),
      reverb: ReverbSchema.optional(),
    })
    .default({ masterDb: -6, delayBeats: 0.75, feedback: 0.22, returnDb: -12 }),
  export: z
    .strictObject({
      sampleRate: z.union([z.literal(44100), z.literal(48000)]).default(44100),
      format: z.literal("pcm16-wav").default("pcm16-wav"),
      mode: z.enum(["one-shot", "loop"]).default("loop"),
      tailSeconds: z.number().min(0).max(10).default(2),
      warmupCycles: z.number().int().min(2).max(8).default(4),
      /** Deterministic TPDF dither before PCM16 quantisation. */
      dither: z.boolean().default(false),
      /** Look-ahead peak limiter on the master bus; off by default. */
      limiter: z
        .strictObject({
          enabled: z.boolean().default(false),
          ceilingDbfs: z.number().min(-12).max(-0.1).default(-1),
          lookaheadSeconds: z.number().min(0.001).max(0.02).default(0.005),
        })
        .default({ enabled: false, ceilingDbfs: -1, lookaheadSeconds: 0.005 }),
    })
    .default({
      sampleRate: 44100,
      format: "pcm16-wav",
      mode: "loop",
      tailSeconds: 2,
      warmupCycles: 4,
      dither: false,
      limiter: { enabled: false, ceilingDbfs: -1, lookaheadSeconds: 0.005 },
    }),
});
export type Score = z.infer<typeof ScoreSchema>;
export type Track = Score["tracks"][number];
export type MusicEvent = z.infer<typeof EventSchema>;
export type NoteEvent = z.infer<typeof NoteSchema>;
export type HitEvent = z.infer<typeof HitSchema>;
export type Diagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  trackId?: string;
  eventIds?: string[];
  beat?: number;
  /** Machine-usable repair hint, e.g. a maximum gate that would fit. */
  suggestion?: string | number | Record<string, unknown>;
};
export type CompiledEvent = {
  id: string;
  sourceId: string;
  clipId: string;
  trackId: string;
  kind: "note" | "hit";
  tick: number;
  durationTicks: number;
  velocity: number;
  midi?: number;
  sound?: DrumSound;
  detuneCents?: number;
  vibrato?: z.infer<typeof NoteSchema>["vibrato"];
  articulation?: z.infer<typeof NoteSchema>["articulation"];
  expression?: z.infer<typeof ExpressionSchema>;
  hold?: boolean;
  legatoFromId?: string;
  legatoToId?: string;
  voice: number;
  /** Key-release tick (gate end) before release tail. */
  keyEndTick: number;
  /** Last sounding tick including release. */
  endTick: number;
  cutTick?: number;
  swingShiftTicks?: number;
  humanizeVelocity?: number;
  /** Compiled once so crop, solo and repeated loop renders use identical samples. */
  sampleZoneIndex?: number;
  sampleDrumSlotIndex?: number;
};
export type CompiledScore = {
  score: Score;
  ppq: number;
  lengthTicks: number;
  events: CompiledEvent[];
  diagnostics: Diagnostic[];
};
export function toTick(value: number): number {
  const t = Math.round(value * PPQ);
  if (Math.abs(t / PPQ - value) > 1e-8)
    throw new Error(`Beat ${value} is not representable at PPQ=${PPQ}`);
  return t;
}
export function fromTick(t: number): number {
  return t / PPQ;
}
export function midi(pitch: string): number {
  const m = /^([A-G])([#b]?)([0-8])$/.exec(pitch);
  if (!m) throw new Error(`Invalid pitch: ${pitch}`);
  return (
    (Number(m[3]) + 1) * 12 +
    ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"] ?? 0) +
    (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0)
  );
}
export const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** MIDI number → scientific pitch name. Accepts 0..127. */
export function pitchName(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 127)
    throw new Error(`MIDI ${value} is outside 0..127`);
  return `${NAMES[value % 12]}${Math.floor(value / 12) - 1}`;
}
/** Beats in one bar under the score's meter; beats are always quarter notes. */
export const beatsPerBar = (meter: readonly [number, number]) =>
  (meter[0] * 4) / meter[1];
export class ScoreError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super("Score validation failed");
    this.name = "ScoreError";
  }
}
/** Structured error for tool failures, so agents can branch on `code`. */
export class ToolkitError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    // Prefix the code so logs and older regex-based callers still see it.
    super(`${code}: ${message}`);
    this.name = "ToolkitError";
  }
}
