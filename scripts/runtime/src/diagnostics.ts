import { z } from "zod";
import { compileScore } from "./compiler.js";
import { preset, isDrumEngine } from "./instruments.js";
import { beatsPerBar, type CompiledEvent, type Diagnostic } from "./model.js";
import { harmonyFindings, type HarmonyFinding } from "./harmony.js";

export const RULES = [
  "MELODY_NO_BREATH",
  "REGISTER_CROWDING",
  "PERCUSSION_DENSITY",
  "SLOW_ATTACK_NOTES",
  "SECTION_SIMILARITY",
  "MOTIF_VARIETY",
  "HARMONY_NON_CHORD_TONE",
  "BASS_NON_CHORD_TONE",
  "PARALLEL_FIFTHS",
  "PARALLEL_OCTAVES",
  "UNRESOLVED_LEAP",
  "OUT_OF_KEY",
  "MINOR_SECOND_CLASH",
  "HARMONY_GAP",
  "HARMONY_ZERO_LENGTH",
  "BASS_SLASH_CHORD",
] as const;
export type RuleName = (typeof RULES)[number];

export const DiagnosticOptionsSchema = z.strictObject({
  disabledRules: z.array(z.enum(RULES)).default([]),
  thresholds: z
    .strictObject({
      windowBeats: z.number().min(1).max(32).optional(),
      crowdingSemitones: z.number().min(0).max(24).default(7),
      crowdingNotesPerBeat: z.number().positive().max(16).default(0.75),
      hatHitsPerBeat: z.number().positive().max(32).default(3),
      breathGapBeats: z.number().min(0.01).max(2).default(0.125),
      noBreathSpanBeats: z.number().min(4).max(64).optional(),
      sectionSimilarityThreshold: z.number().min(0).max(1).default(0.1),
    })
    .default({
      crowdingSemitones: 7,
      crowdingNotesPerBeat: 0.75,
      hatHitsPerBeat: 3,
      breathGapBeats: 0.125,
      sectionSimilarityThreshold: 0.1,
    }),
});
export type ArrangementFinding = Omit<HarmonyFinding, "rule"> & {
  rule: RuleName;
  clipIds: string[];
};

const median = (a: number[]) => {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2;
};

export function diagnoseScore(input: unknown, options: unknown = {}) {
  const c = compileScore(input),
    s = c.score,
    o = DiagnosticOptionsSchema.parse(options),
    th = o.thresholds;
  const barBeats = beatsPerBar(s.meter);
  // Windows default to one bar so 3/4 and 6/8 analyses stay bar-aligned.
  const windowBeats = th.windowBeats ?? barBeats;
  const spanBeats = th.noBreathSpanBeats ?? barBeats * 2;
  const findings: ArrangementFinding[] = [];
  const beat = (e: CompiledEvent) => e.tick / c.ppq;
  const skip = (rule: string) =>
    (o.disabledRules as readonly string[]).includes(rule);
  const events = c.events.filter((e) => e.velocity > 0 && e.endTick > e.tick),
    tonal = events.filter((e) => e.kind === "note");
  const emit = (
    rule: RuleName,
    tracks: string[],
    start: number,
    end: number,
    ev: CompiledEvent[],
    evidence: Record<string, unknown>,
    message: string,
    suggestions: string[],
    severity: "info" | "warning" = "info",
  ) => {
    if (skip(rule)) return;
    findings.push({
      rule,
      severity,
      trackIds: tracks,
      fromBeat: start,
      toBeat: end,
      bar: Math.floor(start / barBeats) + 1,
      sourceEventIds: [...new Set(ev.map((e) => e.sourceId))].slice(0, 128),
      clipIds: [...new Set(ev.map((e) => e.clipId))],
      evidence,
      message,
      suggestions,
    });
  };

  // Harmony rules come from the dedicated module.
  for (const f of harmonyFindings(c))
    if (!skip(f.rule)) findings.push({ ...f, clipIds: [] });

  const rows = [];
  for (const t of s.tracks) {
    const te = events.filter((e) => e.trackId === t.id),
      notes = te.filter((e) => e.kind === "note");
    rows.push({
      trackId: t.id,
      role: t.role,
      instrument: t.instrument,
      eventCount: te.length,
      notesPerBeat: te.length / s.lengthBeats,
      medianMidi: median(notes.map((e) => e.midi!)),
    });
    const p = preset(t.instrument, s),
      short = notes.filter(
        (e) =>
          !e.legatoFromId &&
          !e.hold &&
          ((e.durationTicks / c.ppq) * 60) / s.tempo < p.attack * 1.5,
      );
    if (short.length >= 3)
      emit(
        "SLOW_ATTACK_NOTES",
        [t.id],
        beat(short[0]!),
        Math.min(
          s.lengthBeats,
          beat(short.at(-1)!) + short.at(-1)!.durationTicks / c.ppq,
        ),
        short,
        {
          count: short.length,
          attackSeconds: p.attack,
          shortestGateSeconds: Math.min(
            ...short.map((e) => ((e.durationTicks / c.ppq) * 60) / s.tempo),
          ),
        },
        "Several notes may end before the preset attack becomes clear.",
        [
          `Lengthen gate/duration (the preset needs about ${(p.attack * 1.5).toFixed(3)}s) or choose a faster-attack preset.`,
        ],
        "warning",
      );
    for (let start = 0; start < s.lengthBeats; start += windowBeats) {
      const end = Math.min(s.lengthBeats, start + windowBeats),
        hat = te.filter(
          (e) =>
            (e.sound === "hat" || e.sound === "openhat") &&
            beat(e) >= start &&
            beat(e) < end,
        );
      if (hat.length / (end - start) >= th.hatHitsPerBeat)
        emit(
          "PERCUSSION_DENSITY",
          [t.id],
          start,
          end,
          hat,
          { hitsPerBeat: hat.length / (end - start) },
          "Dense repeated hi-hats may cause fatigue.",
          ["Audition this window; remove alternate hits or lower velocity."],
          "warning",
        );
    }
    if (t.role !== "melody") continue;
    for (
      let start = 0;
      start + spanBeats <= s.lengthBeats;
      start += spanBeats
    ) {
      const end = start + spanBeats,
        selected = notes.filter(
          (e) =>
            beat(e) < end &&
            Math.min(e.tick + e.durationTicks, e.endTick) / c.ppq > start,
        );
      let cursor = start,
        maxGap = 0;
      for (const e of selected) {
        maxGap = Math.max(maxGap, Math.max(0, beat(e) - cursor));
        cursor = Math.max(
          cursor,
          Math.min(end, Math.min(e.tick + e.durationTicks, e.endTick) / c.ppq),
        );
      }
      maxGap = Math.max(maxGap, end - cursor);
      if (selected.length >= 4 && maxGap < th.breathGapBeats)
        emit(
          "MELODY_NO_BREATH",
          [t.id],
          start,
          end,
          selected,
          { maxGapBeats: maxGap, spanBeats },
          "The melody has little key-release space in this span.",
          [
            "Try a phrase-ending rest; sustained or legato intent may justify keeping it.",
          ],
        );
    }
    if (s.lengthBeats >= 16) {
      const signatures = [];
      for (let start = 0; start + 4 <= s.lengthBeats; start += 4) {
        const ns = notes.filter((e) => beat(e) >= start && beat(e) < start + 4);
        if (ns.length < 2) continue;
        const root = ns[0]!.midi!;
        signatures.push(
          JSON.stringify(
            ns.map((e) => [
              e.tick - Math.round(start * c.ppq),
              e.durationTicks,
              e.midi! - root,
            ]),
          ),
        );
      }
      if (
        signatures.length >= 4 &&
        new Set(signatures).size === signatures.length
      )
        emit(
          "MOTIF_VARIETY",
          [t.id],
          0,
          s.lengthBeats,
          notes,
          { nonEmptyFourBeatWindows: signatures.length },
          "No exact transposition-invariant four-beat motif repetition was found.",
          [
            "Check whether the rhythmic identity is memorable; transformed motifs can intentionally evade this heuristic.",
          ],
        );
    }
  }

  const melodies = s.tracks.filter((t) => t.role === "melody");
  for (const lead of melodies)
    for (const other of s.tracks.filter((t) =>
      ["arp", "harmony"].includes(t.role),
    )) {
      for (let start = 0; start < s.lengthBeats; start += windowBeats) {
        const end = Math.min(s.lengthBeats, start + windowBeats);
        const a = tonal.filter(
            (e) => e.trackId === lead.id && beat(e) >= start && beat(e) < end,
          ),
          b = tonal.filter(
            (e) => e.trackId === other.id && beat(e) >= start && beat(e) < end,
          );
        if (
          a.length / (end - start) < th.crowdingNotesPerBeat ||
          b.length / (end - start) < th.crowdingNotesPerBeat
        )
          continue;
        const distance = Math.abs(
          median(a.map((e) => e.midi!))! - median(b.map((e) => e.midi!))!,
        );
        const simultaneous = a.some((x) =>
          b.some(
            (y) =>
              x.tick < Math.min(y.tick + y.durationTicks, y.endTick) &&
              y.tick < Math.min(x.tick + x.durationTicks, x.endTick),
          ),
        );
        if (distance <= th.crowdingSemitones && simultaneous)
          emit(
            "REGISTER_CROWDING",
            [lead.id, other.id],
            start,
            end,
            [...a, ...b],
            {
              medianDistanceSemitones: distance,
              leadNotesPerBeat: a.length / (end - start),
              otherNotesPerBeat: b.length / (end - start),
            },
            "Dense melody and accompaniment occupy nearby registers.",
            [
              "Solo these tracks; move accompaniment, shorten its gates, or leave the melody downbeats clear.",
            ],
            "warning",
          );
      }
    }

  const sections = s.sections
    .map((section) => {
      const ev = events.filter(
        (e) =>
          beat(e) >= section.at && beat(e) < section.at + section.lengthBeats,
      );
      return {
        sectionId: section.id,
        label: section.label,
        fromBeat: section.at,
        toBeat: section.at + section.lengthBeats,
        eventsPerBeat: ev.length / section.lengthBeats,
        activeTrackIds: [...new Set(ev.map((e) => e.trackId))].sort(),
        medianMidi: median(
          ev.filter((e) => e.kind === "note").map((e) => e.midi!),
        ),
      };
    })
    .sort((a, b) => a.fromBeat - b.fromBeat);
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!,
      b = sections[i]!;
    if (a.eventsPerBeat === 0 || b.eventsPerBeat === 0) continue;
    // Sections sharing a label are meant to be similar; only flag unrelated
    // neighbours so A1 vs A2 does not produce noise.
    if (a.label && b.label && a.label === b.label) continue;
    const relative =
      Math.abs(a.eventsPerBeat - b.eventsPerBeat) /
      Math.max(a.eventsPerBeat, b.eventsPerBeat);
    if (
      relative < th.sectionSimilarityThreshold &&
      a.activeTrackIds.join("|") === b.activeTrackIds.join("|") &&
      a.medianMidi !== null &&
      b.medianMidi !== null &&
      Math.abs(a.medianMidi - b.medianMidi) < 3
    )
      emit(
        "SECTION_SIMILARITY",
        b.activeTrackIds,
        b.fromBeat,
        b.toBeat,
        events.filter((e) => beat(e) >= b.fromBeat && beat(e) < b.toBeat),
        {
          sectionIds: [a.sectionId, b.sectionId],
          densityRelativeDifference: relative,
        },
        "Adjacent sections use similar density, active tracks and median register.",
        [
          "If contrast is intended, remove one layer or change rhythm/register; repetition may also be intentional.",
        ],
      );
  }

  return {
    schemaVersion: "diagnostics-1.1",
    sourceDiagnostics: c.diagnostics as Diagnostic[],
    findings,
    metrics: {
      tracks: rows,
      sections,
      barBeats,
      windowBeats,
      key: s.key ? `${s.key.tonic} ${s.key.mode}` : null,
      chordCount: s.harmony.length,
    },
    configuration: {
      ...o,
      resolvedWindowBeats: windowBeats,
      resolvedSpanBeats: spanBeats,
    },
    limitations:
      "Heuristics identify places to audition, not musical errors or an aesthetic quality score. Harmony rules only run when `harmony` markers exist; key rules only when `key` is declared.",
  };
}
