import { z } from "zod";
import {
  EventSchema,
  midi,
  pitchName,
  ToolkitError,
  type Score,
} from "./model.js";

const id = z.string().min(1).max(80);
const target = { trackId: id, pattern: z.string().min(1) };
export const EditSchemas = [
  z.strictObject({
    op: z.literal("insert-events"),
    ...target,
    events: z.array(EventSchema).min(1).max(20000),
  }),
  z.strictObject({
    op: z.literal("delete-events"),
    ...target,
    eventIds: z.array(id).min(1).max(20000),
  }),
  z.strictObject({
    op: z.literal("clone-pattern-for-clip"),
    trackId: id,
    clipId: id,
    newPattern: id,
  }),
  z.strictObject({
    op: z.literal("transpose-phrase"),
    ...target,
    fromBeat: z.number().min(0),
    toBeat: z.number().positive(),
    semitones: z.number().int().min(-48).max(48),
  }),
  z.strictObject({
    op: z.literal("scale-rhythm"),
    ...target,
    factor: z.number().min(0.0625).max(16),
  }),
  z.strictObject({
    op: z.literal("duplicate-section"),
    sectionId: id,
    newSectionId: id,
    at: z.number().min(0),
    expandSong: z.boolean().default(false),
  }),
  z.strictObject({
    op: z.literal("quantize"),
    ...target,
    /** Grid in beats; 0.25 = sixteenths. */
    grid: z.number().min(0.03125).max(4).default(0.25),
    /** 0..1; 0 snaps fully to the grid. */
    strength: z.number().min(0).max(1).default(0),
    /** Include hits as well as notes. */
    includeHits: z.boolean().default(true),
  }),
  z.strictObject({
    op: z.literal("delete-pattern"),
    ...target,
  }),
  z.strictObject({
    op: z.literal("rename-pattern"),
    ...target,
    newPattern: id,
  }),
] as const;
export type EditOperation = z.infer<(typeof EditSchemas)[number]>;
const EDIT_OP_NAMES = new Set<string>(EditSchemas.map((s) => s.shape.op.value));
export function isEditOperation(op: { op: string }): op is EditOperation {
  return EDIT_OP_NAMES.has(op.op);
}

/** Every ID that must stay globally unique in the project. */
export function allIds(score: Score) {
  return new Set([
    ...score.sections.map((s) => s.id),
    ...score.tracks.flatMap((t) => [
      t.id,
      ...t.clips.map((c) => c.id),
      ...Object.values(t.patterns).flatMap((p) => p.events.map((e) => e.id)),
    ]),
  ]);
}
export function freshId(base: string, used: Set<string>) {
  const stem = base.slice(0, 68);
  let candidate = stem,
    n = 1;
  while (used.has(candidate)) candidate = `${stem}-${n++}`;
  used.add(candidate);
  return candidate;
}

function requireTrack(score: Score, trackId: string) {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track)
    throw new ToolkitError(
      "TRACK_NOT_FOUND",
      `No track ${trackId}; available: ${score.tracks.map((t) => t.id).join(", ")}`,
    );
  return track;
}
function requirePattern(track: Score["tracks"][number], name: string) {
  const pattern = track.patterns[name];
  if (!pattern)
    throw new ToolkitError(
      "PATTERN_NOT_FOUND",
      `No pattern ${name} on ${track.id}; available: ${Object.keys(track.patterns).join(", ")}`,
    );
  return pattern;
}

/** Mutates only patchScore's private working copy; callers validate the complete transaction. */
export function applyEdit(score: Score, op: EditOperation) {
  if (op.op === "duplicate-section") {
    const source = score.sections.find((s) => s.id === op.sectionId);
    if (!source)
      throw new ToolkitError("SECTION_NOT_FOUND", `No section ${op.sectionId}`);
    const start = source.at,
      end = start + source.lengthBeats,
      targetEnd = op.at + source.lengthBeats;
    const overlap = (a: number, b: number, c: number, d: number) =>
      a < d - 1e-9 && b > c + 1e-9;
    if (
      score.sections.some((s) =>
        overlap(s.at, s.at + s.lengthBeats, op.at, targetEnd),
      )
    )
      throw new ToolkitError(
        "SECTION_DESTINATION_OCCUPIED",
        `Beat ${op.at}..${targetEnd} already contains a section`,
        {
          occupiedBy: score.sections
            .filter((s) =>
              overlap(s.at, s.at + s.lengthBeats, op.at, targetEnd),
            )
            .map((s) => s.id),
        },
      );
    if (score.harmony.some((h) => h.at >= op.at && h.at < targetEnd))
      throw new ToolkitError(
        "SECTION_DESTINATION_OCCUPIED",
        "Destination interval already has harmony markers",
      );
    for (const t of score.tracks)
      for (const c of t.clips) {
        const ce =
          c.at +
          (c.lengthBeats ?? t.patterns[c.pattern]!.lengthBeats * c.repeats);
        if (overlap(c.at, ce, start, end) && (c.at < start || ce > end))
          throw new ToolkitError(
            "SECTION_CROSSES_CLIP",
            `Clip ${c.id} crosses the section boundary; split it before duplicating`,
          );
        if (overlap(c.at, ce, op.at, targetEnd))
          throw new ToolkitError(
            "SECTION_DESTINATION_OCCUPIED",
            `Clip ${c.id} already occupies the destination`,
          );
      }
    const used = allIds(score);
    if (used.has(op.newSectionId))
      throw new ToolkitError(
        "DUPLICATE_ID",
        `ID ${op.newSectionId} already exists`,
      );
    used.add(op.newSectionId);
    const delta = op.at - start;
    for (const t of score.tracks) {
      const copies = t.clips
        .filter(
          (c) =>
            c.at >= start - 1e-9 &&
            c.at + t.patterns[c.pattern]!.lengthBeats * c.repeats <= end + 1e-9,
        )
        .map((c) => ({
          ...c,
          id: freshId(`${op.newSectionId}:${c.id}`, used),
          at: c.at + delta,
        }));
      t.clips.push(...copies);
    }
    score.harmony.push(
      ...score.harmony
        .filter((h) => h.at >= start && h.at < end)
        .map((h) => ({ ...h, at: h.at + delta })),
    );
    score.harmony.sort((a, b) => a.at - b.at);
    score.sections.push({ ...source, id: op.newSectionId, at: op.at });
    score.sections.sort((a, b) => a.at - b.at);
    if (op.expandSong)
      score.lengthBeats = Math.max(score.lengthBeats, targetEnd);
    return;
  }

  const track = requireTrack(score, op.trackId);

  if (op.op === "delete-pattern") {
    const pattern = requirePattern(track, op.pattern);
    const usedBy = track.clips.filter((c) => c.pattern === op.pattern);
    if (usedBy.length)
      throw new ToolkitError(
        "PATTERN_IN_USE",
        `Pattern ${op.pattern} is used by ${usedBy.length} clip(s); repoint or delete them first`,
        { clipIds: usedBy.map((c) => c.id) },
      );
    void pattern;
    delete track.patterns[op.pattern];
    return;
  }
  if (op.op === "rename-pattern") {
    requirePattern(track, op.pattern);
    if (Object.hasOwn(track.patterns, op.newPattern))
      throw new ToolkitError(
        "PATTERN_ALREADY_EXISTS",
        `Pattern ${op.newPattern} already exists`,
      );
    track.patterns[op.newPattern] = track.patterns[op.pattern]!;
    delete track.patterns[op.pattern];
    for (const c of track.clips)
      if (c.pattern === op.pattern) c.pattern = op.newPattern;
    return;
  }
  if (op.op === "clone-pattern-for-clip") {
    const clip = track.clips.find((c) => c.id === op.clipId);
    if (!clip)
      throw new ToolkitError(
        "CLIP_NOT_FOUND",
        `No clip ${op.clipId} on ${track.id}`,
      );
    if (Object.hasOwn(track.patterns, op.newPattern))
      throw new ToolkitError(
        "PATTERN_ALREADY_EXISTS",
        `Pattern ${op.newPattern} already exists`,
      );
    const copy = structuredClone(track.patterns[clip.pattern]!);
    const used = allIds(score);
    for (const e of copy.events)
      e.id = freshId(`${op.newPattern}:${e.id}`, used);
    track.patterns[op.newPattern] = copy;
    clip.pattern = op.newPattern;
    return;
  }

  const pattern = requirePattern(track, op.pattern);
  if (op.op === "insert-events") {
    const existing = new Set(
      Object.values(track.patterns).flatMap((p) => p.events.map((e) => e.id)),
    );
    for (const e of op.events)
      if (existing.has(e.id))
        throw new ToolkitError(
          "DUPLICATE_ID",
          `Event ${e.id} already exists on ${track.id}`,
        );
    pattern.events.push(...structuredClone(op.events));
    pattern.events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return;
  }
  if (op.op === "delete-events") {
    const ids = new Set(op.eventIds);
    if (ids.size !== op.eventIds.length)
      throw new ToolkitError(
        "DUPLICATE_SELECTION",
        "eventIds contains duplicates",
      );
    for (const id of ids)
      if (!pattern.events.some((e) => e.id === id))
        throw new ToolkitError(
          "EVENT_NOT_FOUND",
          `No event ${id} in pattern ${op.pattern}`,
        );
    pattern.events = pattern.events.filter((e) => !ids.has(e.id));
    return;
  }
  if (op.op === "scale-rhythm") {
    pattern.lengthBeats *= op.factor;
    for (const e of pattern.events) {
      e.at *= op.factor;
      if (e.kind === "note") {
        e.duration *= op.factor;
        if (e.vibrato) e.vibrato.delayBeats *= op.factor;
        if (e.expression?.portamentoBeats !== undefined)
          e.expression.portamentoBeats *= op.factor;
        for (const point of e.expression?.pitchBendCents ?? [])
          point.offsetBeats *= op.factor;
      }
    }
    return;
  }
  if (op.op === "quantize") {
    const step = op.grid;
    const snap = (value: number) => {
      const target = Math.round(value / step) * step;
      return value + (target - value) * (1 - op.strength);
    };
    for (const e of pattern.events) {
      if (e.kind === "hit" && !op.includeHits) continue;
      const next = snap(e.at);
      // Rounding must not push an event onto or past the pattern end.
      const dur = e.kind === "note" ? e.duration : 0;
      e.at = Math.max(0, Math.min(pattern.lengthBeats - dur, next));
    }
    pattern.events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return;
  }
  if (op.fromBeat >= op.toBeat || op.toBeat > pattern.lengthBeats + 1e-9)
    throw new ToolkitError(
      "INVALID_PHRASE_RANGE",
      `Region ${op.fromBeat}..${op.toBeat} is outside pattern length ${pattern.lengthBeats}`,
    );
  const selected = pattern.events.filter(
    (e) => e.kind === "note" && e.at >= op.fromBeat && e.at < op.toBeat,
  );
  if (!selected.length)
    throw new ToolkitError(
      "EMPTY_PHRASE_SELECTION",
      "No notes start inside the region",
    );
  for (const e of selected)
    if (e.kind === "note") {
      const n = midi(e.pitch) + op.semitones;
      if (n < 0 || n > 127)
        throw new ToolkitError(
          "MIDI_RANGE",
          `Transposing ${e.pitch} by ${op.semitones} leaves MIDI 0..127`,
        );
      e.pitch = pitchName(n);
    }
}
