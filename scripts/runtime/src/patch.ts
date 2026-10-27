import { z } from "zod";
import {
  ScoreSchema,
  NoteSchema,
  HitSchema,
  ClipSchema,
  TrackSchema,
} from "./model.js";
import { compileScore } from "./compiler.js";
import { EditSchemas, applyEdit, isEditOperation } from "./editing.js";

// Zod defaults must never populate omitted update fields: a pitch-only patch
// must not reset gate, velocity, pan or mixer settings.
function updateFields(
  object: z.ZodObject,
): z.ZodObject<Record<string, z.ZodOptional<z.ZodType>>> {
  const field = (value: z.ZodType): z.ZodType => {
    if (value instanceof z.ZodDefault || value instanceof z.ZodOptional)
      return field(value.unwrap() as z.ZodType);
    if (value instanceof z.ZodObject) return updateFields(value);
    return value;
  };
  return z.strictObject(
    Object.fromEntries(
      Object.entries(object.shape).map(([key, value]) => [
        key,
        field(value as z.ZodType).optional(),
      ]),
    ),
  );
}
function mergeExplicit(target: object, change: Record<string, unknown>) {
  const dst = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      dst[key] !== null &&
      typeof dst[key] === "object" &&
      !Array.isArray(dst[key])
    )
      mergeExplicit(dst[key] as object, value as Record<string, unknown>);
    else dst[key] = structuredClone(value);
  }
}
const common = { trackId: z.string().min(1) };
export const PatchSchema = z.strictObject({
  baseHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  operations: z
    .array(
      z.discriminatedUnion("op", [
        ...EditSchemas,
        z.strictObject({
          op: z.literal("set-note"),
          ...common,
          pattern: z.string(),
          eventId: z.string(),
          set: updateFields(NoteSchema.omit({ id: true, kind: true })),
        }),
        z.strictObject({
          op: z.literal("set-hit"),
          ...common,
          pattern: z.string(),
          eventId: z.string(),
          set: updateFields(HitSchema.omit({ id: true, kind: true })),
        }),
        z.strictObject({
          op: z.literal("set-clip"),
          ...common,
          clipId: z.string(),
          set: updateFields(ClipSchema.omit({ id: true })),
        }),
        z.strictObject({
          op: z.literal("set-track"),
          ...common,
          set: updateFields(
            TrackSchema.omit({
              id: true,
              patterns: true,
              clips: true,
            }),
          ),
        }),
        z.strictObject({
          op: z.literal("set-section"),
          sectionId: z.string().min(1),
          set: z.strictObject({
            label: z.string().max(16).optional(),
            energy: z.number().min(0).max(1).optional(),
            at: z.number().min(0).optional(),
            lengthBeats: z.number().positive().optional(),
          }),
        }),
        z.strictObject({
          op: z.literal("set-harmony"),
          /** Replace the whole harmony track, or insert a single marker. */
          harmony: z
            .array(
              z.strictObject({
                at: z.number().min(0),
                chord: z.string().min(1).max(32),
                lengthBeats: z.number().positive().optional(),
              }),
            )
            .max(1024)
            .optional(),
          insert: z
            .strictObject({
              at: z.number().min(0),
              chord: z.string().min(1).max(32),
              lengthBeats: z.number().positive().optional(),
            })
            .optional(),
        }),
        z.strictObject({
          op: z.literal("set-song"),
          set: updateFields(
            ScoreSchema.pick({
              title: true,
              tempo: true,
              meter: true,
              mixer: true,
              export: true,
              seed: true,
              key: true,
              profile: true,
            }),
          ),
        }),
        z.strictObject({
          op: z.literal("clone-pattern"),
          ...common,
          pattern: z.string(),
          newPattern: z.string().min(1),
        }),
      ]),
    )
    .min(1)
    .max(1000),
});

export type ChangeRecord = {
  index: number;
  op: string;
  path: string;
  detail?: string;
};

function deepDiff(
  before: unknown,
  after: unknown,
  path: string,
  out: ChangeRecord[],
  limit = 200,
): void {
  if (out.length >= limit) return;
  if (before === after) return;
  const bothObjects =
    before && after && typeof before === "object" && typeof after === "object";
  if (!bothObjects) {
    out.push({
      index: -1,
      op: "set",
      path,
      detail: `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
    });
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Rebuilding the score creates new array identities every operation, so
    // compare contents. Same length: diff element by element so the log names
    // the field that changed rather than the whole array. Different length:
    // report the array wholesale, since note-list plumbing is not useful.
    if (before.length === after.length) {
      for (let i = 0; i < before.length; i++)
        deepDiff(before[i], after[i], `${path}[${i}]`, out, limit);
      return;
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    out.push({
      index: -1,
      op: "set",
      path,
      detail: `${before.length} → ${after.length} items`,
    });
    return;
  }
  const keys = new Set([
    ...Object.keys(before as object),
    ...Object.keys(after as object),
  ]);
  for (const key of keys)
    deepDiff(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
      out,
      limit,
    );
}

/** Count events in a score, for a compact before/after summary. */
function eventCount(score: {
  tracks: { patterns: Record<string, { events: unknown[] }> }[];
}) {
  return score.tracks.reduce(
    (n, t) =>
      n + Object.values(t.patterns).reduce((m, p) => m + p.events.length, 0),
    0,
  );
}

/** Backwards-compatible API: applies a patch and returns the compiled score. */
export function patchScore(
  input: unknown,
  patch: unknown,
  currentHash?: string,
) {
  return patchScoreWithReport(input, patch, currentHash).score;
}

/** Same transaction, plus a change log for agent self-checks. */
export function patchScoreWithReport(
  input: unknown,
  patch: unknown,
  currentHash?: string,
) {
  const original = ScoreSchema.parse(input);
  const score = structuredClone(original);
  const p = PatchSchema.parse(patch);
  if (p.baseHash && p.baseHash !== currentHash)
    throw new Error(
      `PATCH_CONFLICT: score SHA-256 ${currentHash ?? "(unknown)"} does not match baseHash ${p.baseHash}`,
    );
  const changes: ChangeRecord[] = [];
  for (const [index, op] of p.operations.entries()) {
    const before = structuredClone(score);
    if (isEditOperation(op)) {
      applyEdit(score, op);
      const start = changes.length;
      deepDiff(before, score, "", changes);
      for (const rec of changes.slice(start)) {
        rec.index = index;
        rec.op = op.op;
      }
      continue;
    }
    if (op.op === "set-song") {
      mergeExplicit(score, op.set);
    } else if (op.op === "set-harmony") {
      if (op.harmony)
        score.harmony = structuredClone(op.harmony).sort((a, b) => a.at - b.at);
      if (op.insert) {
        score.harmony.push(structuredClone(op.insert));
        score.harmony.sort((a, b) => a.at - b.at);
      }
    } else if (op.op === "set-section") {
      const section = score.sections.find((s) => s.id === op.sectionId);
      if (!section) throw new Error(`SECTION_NOT_FOUND: ${op.sectionId}`);
      mergeExplicit(section, op.set);
    } else {
      const t = score.tracks.find((t) => t.id === op.trackId);
      if (!t) throw new Error(`TRACK_NOT_FOUND: ${op.trackId}`);
      if (op.op === "set-track") {
        mergeExplicit(t, op.set);
      } else if (op.op === "set-clip") {
        const clip = t.clips.find((c) => c.id === op.clipId);
        if (!clip) throw new Error(`CLIP_NOT_FOUND: ${op.clipId}`);
        mergeExplicit(clip, op.set);
      } else {
        const pattern = t.patterns[op.pattern];
        if (!pattern) throw new Error(`PATTERN_NOT_FOUND: ${op.pattern}`);
        if (op.op === "clone-pattern") {
          if (t.patterns[op.newPattern])
            throw new Error(`PATTERN_ALREADY_EXISTS: ${op.newPattern}`);
          const copy = structuredClone(pattern);
          for (const e of copy.events) e.id = `${op.newPattern}:${e.id}`;
          t.patterns[op.newPattern] = copy;
        } else {
          const event = pattern.events.find((e) => e.id === op.eventId);
          if (!event) throw new Error(`EVENT_NOT_FOUND: ${op.eventId}`);
          if (
            (op.op === "set-note" && event.kind !== "note") ||
            (op.op === "set-hit" && event.kind !== "hit")
          )
            throw new Error("EVENT_KIND_MISMATCH");
          mergeExplicit(event, op.set);
        }
      }
    }
    const start = changes.length;
    deepDiff(before, score, "", changes);
    for (const rec of changes.slice(start)) {
      rec.index = index;
      rec.op = op.op;
    }
  }
  const compiled = compileScore(score);
  return {
    score: compiled.score,
    report: {
      operationCount: p.operations.length,
      changes: changes.filter((c) => c.index >= 0).slice(0, 200),
      truncated: changes.length > 200,
      summary: {
        eventsBefore: eventCount(original),
        eventsAfter: eventCount(compiled.score),
        tracks: compiled.score.tracks.length,
        diagnostics: compiled.diagnostics.filter((d) => d.severity !== "info")
          .length,
      },
      diagnostics: compiled.diagnostics,
    },
  };
}
