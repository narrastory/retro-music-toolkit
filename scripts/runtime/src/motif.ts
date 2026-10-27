import { z } from "zod";
import {
  EventSchema,
  midi,
  pitchName,
  toTick,
  ToolkitError,
  type MusicEvent,
  type NoteEvent,
  type Score,
} from "./model.js";
import { keyOf, scaleOf } from "./harmony.js";

/**
 * Motif development operators. Each returns a transformed copy of the selected
 * events; the caller decides where the result lands. Transformations never
 * invent new musical material beyond the operator itself, so reports can state
 * exactly what changed.
 */
export const MotifOperatorSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("transpose"),
    /** Chromatic semitones. Ignored when `degrees` is given. */
    semitones: z.number().int().min(-48).max(48).default(0),
    /** Diatonic steps in the declared key; 7 = one octave. */
    degrees: z.number().int().min(-28).max(28).optional(),
  }),
  z.strictObject({
    op: z.literal("invert"),
    /** Mirror axis. Defaults to the first selected note's pitch. */
    axisMidi: z.number().int().min(0).max(127).optional(),
  }),
  z.strictObject({ op: z.literal("retrograde") }),
  z.strictObject({
    op: z.literal("scaleDuration"),
    factor: z.number().min(0.125).max(8),
  }),
  z.strictObject({
    op: z.literal("scaleGate"),
    factor: z.number().min(0.1).max(4),
  }),
  z.strictObject({
    op: z.literal("velocityShape"),
    /** 0 = flat, positive = arch up then down, negative = valley. */
    amount: z.number().min(-1).max(1),
  }),
  z.strictObject({
    op: z.literal("ornament"),
    kind: z.enum(["upper", "lower", "turn"]),
    /** Seconds of the ornament notes, in beats. */
    lengthBeats: z.number().min(0.03125).max(1).default(0.125),
    velocity: z.number().min(0).max(1).default(0.6),
  }),
]);
export type MotifOperator = z.infer<typeof MotifOperatorSchema>;

export const MotifConfigSchema = z.strictObject({
  trackId: z.string().min(1),
  /** Source clip whose pattern is read. */
  clipId: z.string().min(1),
  /** New pattern to write; the source pattern is never mutated. */
  newPattern: z.string().min(1).max(64),
  /** Only transform notes starting at or after this beat. */
  fromBeat: z.number().min(0).default(0),
  /** Exclusive end of the transformed region. */
  toBeat: z.number().positive(),
  operators: z.array(MotifOperatorSchema).min(1).max(8),
  /** Point the source clip at the new pattern instead of appending a clip. */
  replaceClip: z.boolean().default(true),
});
export type MotifConfig = z.infer<typeof MotifConfigSchema>;

const SELECTABLE = (e: MusicEvent, from: number, to: number) =>
  e.kind === "note" && e.at >= from && e.at < to;

export function transformNotes(
  score: Score,
  notes: NoteEvent[],
  operators: MotifOperator[],
): NoteEvent[] {
  let current = notes.map((n) => ({ ...n }));
  for (const op of operators) {
    switch (op.op) {
      case "transpose": {
        if (op.degrees !== undefined) {
          const key = keyOf(score);
          if (!key)
            throw new ToolkitError(
              "NO_KEY",
              "Diatonic transpose needs score.key; add { tonic, mode } or use semitones",
            );
          const scale = scaleOf(key);
          const anchor = current[0]?.pitch ? midi(current[0].pitch) : 60;
          current = current.map((n) => {
            const m = midi(n.pitch);
            const pc = ((m % 12) + 12) % 12;
            const idx = scale.indexOf(pc);
            if (idx < 0)
              throw new ToolkitError(
                "NOT_IN_KEY",
                `${n.pitch} is not in the declared key; use chromatic semitones`,
              );
            const baseIdx = scale.indexOf(((anchor % 12) + 12) % 12);
            const base = baseIdx >= 0 ? baseIdx : 0;
            const octaves = Math.floor(op.degrees! / 7);
            const steps = op.degrees! - octaves * 7;
            const targetIdx = idx + steps;
            const wrapped = ((targetIdx % 7) + 7) % 7;
            const octaveShift = Math.floor(targetIdx / 7);
            // Keep the pitch octave stable relative to the original note.
            const anchorOctave = Math.floor(m / 12);
            const next =
              anchorOctave * 12 +
              scale[wrapped]! +
              (octaveShift - octaves) * 12;
            void base;
            return { ...n, pitch: pitchName(Math.max(0, Math.min(127, next))) };
          });
        } else if (op.semitones !== 0) {
          current = current.map((n) => {
            const m = midi(n.pitch) + op.semitones;
            if (m < 0 || m > 127)
              throw new ToolkitError(
                "MIDI_RANGE",
                `Transposing ${n.pitch} by ${op.semitones} leaves MIDI 0..127`,
              );
            return { ...n, pitch: pitchName(m) };
          });
        }
        break;
      }
      case "invert": {
        if (!current.length) break;
        const axis = op.axisMidi ?? Math.round(midi(current[0]!.pitch));
        current = current.map((n) => {
          const mirrored = axis * 2 - midi(n.pitch);
          if (mirrored < 0 || mirrored > 127)
            throw new ToolkitError(
              "MIDI_RANGE",
              `Inversion around MIDI ${axis} leaves the MIDI range; pick a lower axis`,
            );
          return { ...n, pitch: pitchName(mirrored) };
        });
        break;
      }
      case "retrograde": {
        if (!current.length) break;
        const start = Math.min(...current.map((n) => n.at));
        const end = Math.max(...current.map((n) => n.at + n.duration));
        const span = end - start;
        current = current.map((n) => ({
          ...n,
          at: start + (span - (n.at - start) - n.duration),
        }));
        break;
      }
      case "scaleDuration":
        current = current.map((n) => ({
          ...n,
          duration: n.duration * op.factor,
        }));
        break;
      case "scaleGate":
        current = current.map((n) => ({
          ...n,
          gate: Math.max(0.01, Math.min(1, n.gate * op.factor)),
        }));
        break;
      case "velocityShape": {
        if (current.length < 2) break;
        const ordered = [...current].sort((a, b) => a.at - b.at);
        const mid = (ordered.length - 1) / 2;
        current = current.map((n) => {
          const idx = ordered.findIndex((o) => o.id === n.id);
          const t = mid === 0 ? 0 : (idx - mid) / mid;
          const curve = 1 - t * t; // 1 at centre, 0 at edges
          const shaped =
            op.amount >= 0
              ? n.velocity + (curve - 0.5) * 2 * op.amount * 0.25
              : n.velocity - (curve - 0.5) * 2 * -op.amount * 0.25;
          return {
            ...n,
            velocity: Math.max(0, Math.min(1, Number(shaped.toFixed(4)))),
          };
        });
        break;
      }
      case "ornament": {
        const key = keyOf(score);
        const scale = key ? scaleOf(key) : [];

        const stepPitch = (from: number, dir: 1 | -1) => {
          if (!scale.length) return from + dir * 2;
          for (let d = 1; d <= 2; d++) {
            const cand = from + dir * d;
            if (scale.includes(((cand % 12) + 12) % 12)) return cand;
          }
          return from + dir * 2;
        };
        const extra: NoteEvent[] = [];
        for (const n of current) {
          const base = midi(n.pitch);
          const ornamentPitches =
            op.kind === "upper"
              ? [stepPitch(base, 1)]
              : op.kind === "lower"
                ? [stepPitch(base, -1)]
                : [stepPitch(base, 1), base, stepPitch(base, -1)];
          // Replace the front of the note with the ornament notes.
          const step = Math.min(
            op.lengthBeats,
            n.duration / (ornamentPitches.length + 1),
          );
          ornamentPitches.forEach((p, i) => {
            extra.push({
              ...n,
              id: `${n.id}~orn${i}`,
              at: n.at + i * step,
              duration: step,
              gate: 0.95,
              velocity: Math.min(1, n.velocity * op.velocity),
              pitch: pitchName(p),
              hold: false,
            });
          });
          n.at = n.at + step * ornamentPitches.length;
          n.duration = Math.max(
            step,
            n.duration - step * ornamentPitches.length,
          );
        }
        current = [...current, ...extra];
        break;
      }
    }
  }
  return current.map((n) => {
    toTick(n.at);
    toTick(n.duration);
    return n;
  });
}

export function selectMotif(events: MusicEvent[], from: number, to: number) {
  return events.filter((e) => SELECTABLE(e, from, to)) as NoteEvent[];
}

export { EventSchema };
