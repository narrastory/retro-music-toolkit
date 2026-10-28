import { z } from "zod";
import {
  ScoreSchema,
  EventSchema,
  toTick,
  beatsPerBar,
  ToolkitError,
  type Score,
  type MusicEvent,
  type NoteEvent,
} from "./model.js";
import { compileScore } from "./compiler.js";
import { applyEdit, freshId, allIds } from "./editing.js";
import { preset } from "./instruments.js";
import { keyOf, scaleOf } from "./harmony.js";
import { MotifConfigSchema, selectMotif, transformNotes } from "./motif.js";
import {
  ArpeggioConfigSchema,
  HarmonizeConfigSchema,
  buildArpeggioPattern,
  buildHarmonyPattern,
} from "./voicing.js";

const FORM_LABELS = ["A", "B", "C", "D"] as const;

export const ArrangementSchema = z.strictObject({
  title: z.string().min(1).default("Untitled arrangement"),
  scene: z
    .enum(["exploration", "battle", "town", "stealth", "boss", "ending"])
    .default("exploration"),
  profile: z
    .enum(["nes-inspired", "genesis-inspired", "snes-inspired"])
    .default("nes-inspired"),
  form: z
    .string()
    .regex(/^[A-D]{2,8}$/)
    .default("AABA"),
  barsPerSection: z.number().int().min(1).max(16).default(4),
  tempo: z.number().min(30).max(300).default(120),
  meter: z
    .tuple([
      z.number().int().min(1).max(16),
      z.union([z.literal(4), z.literal(8)]),
    ])
    .default([4, 4]),
  key: z
    .strictObject({
      tonic: z.string().regex(/^[A-G](?:#|b)?$/),
      mode: z.enum(["major", "minor"]),
    })
    .optional(),
  /** Optional starting chord progression, one symbol per bar, cycled. */
  progression: z.array(z.string().min(1).max(32)).max(32).optional(),
  seed: z.number().int().min(0).max(4294967295).default(1),
});

const SCENE_PROFILE = {
  exploration: {
    energy: [0.45, 0.6, 0.3, 0.75],
    activeRoles: ["melody", "bass", "arp", "drums"],
  },
  battle: {
    energy: [0.7, 0.85, 0.35, 1],
    activeRoles: ["melody", "bass", "arp", "drums"],
  },
  town: {
    energy: [0.4, 0.55, 0.25, 0.6],
    activeRoles: ["melody", "bass", "arp", "drums"],
  },
  stealth: {
    energy: [0.2, 0.35, 0.15, 0.45],
    activeRoles: ["melody", "bass", "drums"],
  },
  boss: {
    energy: [0.8, 1, 0.5, 1],
    activeRoles: ["melody", "bass", "arp", "drums"],
  },
  ending: {
    energy: [0.35, 0.6, 0.25, 0.4],
    activeRoles: ["melody", "bass", "arp"],
  },
} as const;

export function createArrangement(input: unknown = {}) {
  const config = ArrangementSchema.parse(input);
  const barBeats = beatsPerBar(config.meter);
  const length = config.barsPerSection * barBeats;
  const instruments =
    config.profile === "nes-inspired"
      ? ["pulse-lead-soft", "triangle-bass", "pulse-pluck", "chip-drums"]
      : config.profile === "genesis-inspired"
        ? ["fm-brass", "fm-bass-round", "fm-epiano", "chip-drums"]
        : ["sample-flute", "sample-bass", "sample-pluck", "chip-drums"];
  const roles = ["melody", "bass", "arp", "drums"] as const;
  const sceneProfile = SCENE_PROFILE[config.scene];
  const energy = sceneProfile.energy;
  const letters = [...config.form];
  const unique = [...new Set(letters)];

  const sections = letters.map((label, i) => {
    const bar = i * config.barsPerSection + 1;
    return {
      id: `${label}-${bar}`,
      label,
      at: i * length,
      lengthBeats: length,
      energy: energy[Math.min(i, energy.length - 1)]!,
    };
  });

  const tracks = roles.map((role, i) => ({
    id: role === "melody" ? "lead" : role,
    instrument: instruments[i]!,
    role,
    gainDb: role === "arp" ? -14 : -6,
    maxVoices: 1,
    voicePolicy: "cut" as const,
    patterns: Object.fromEntries(
      unique.map((letter) => [letter, { lengthBeats: length, events: [] }]),
    ),
    clips: letters.map((letter, n) => ({
      id: `${role}-section-${n + 1}`,
      pattern: letter,
      at: n * length,
      // The contrasting middle section drops the arpeggio: subtraction is the
      // cheapest way to create contrast without adding new material.
      mute: role === "arp" && letters.length >= 3 && n === 2,
    })),
  }));

  const harmony = config.progression
    ? buildProgression(
        config.progression,
        letters.length * config.barsPerSection,
        barBeats,
      )
    : [];

  const score = ScoreSchema.parse({
    schemaVersion: "1.3",
    title: config.title,
    profile: config.profile,
    tempo: config.tempo,
    meter: config.meter,
    lengthBeats: length * letters.length,
    seed: config.seed,
    key: config.key,
    harmony,
    sections,
    tracks,
  });
  compileScore(score);
  return {
    score,
    plan: {
      kind: "empty-composition-scaffold",
      config,
      barBeats,
      sections: sections.map((section, i) => ({
        ...section,
        focus: "melody",
        activeRoles:
          i === 2
            ? sceneProfile.activeRoles.filter((r) => r !== "arp")
            : sceneProfile.activeRoles,
        harmony: harmony
          .filter(
            (h) =>
              h.at >= section.at && h.at < section.at + section.lengthBeats,
          )
          .map((h) => h.chord),
        tasks: [
          i === 0
            ? "Write a recognisable motif and a clear phrase ending."
            : i === 2
              ? "Create contrast through subtraction, register or rhythm rather than new material."
              : letters[i] === letters[0]
                ? "Keep the motif identity; consider a changed ending via `vary`."
                : "Develop the motif with the `motif` command before adding layers.",
          "Write bass and harmony parts explicitly; energy metadata does not generate notes.",
          i === letters.length - 1
            ? "Connect the final phrase back to the loop opening."
            : "Leave space for an answering voice (see `answer`).",
        ],
      })),
      limitations:
        "Empty score skeleton, not automatically composed music. Repeated letters share a pattern; use `vary` or `motif` to differentiate an instance.",
    },
  };
}

function buildProgression(
  progression: string[],
  bars: number,
  barBeats: number,
) {
  return Array.from({ length: bars }, (_, bar) => ({
    at: bar * barBeats,
    chord: progression[bar % progression.length]!,
  }));
}

export const VariationSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    newPattern: z.string().min(1).max(64),
    fromBeat: z.number().min(0),
    mode: z.literal("ending"),
    replacementEvents: z.array(EventSchema).min(1).max(20000),
  }),
  z.strictObject({
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    newPattern: z.string().min(1).max(64),
    fromBeat: z.number().min(0),
    mode: z.literal("simplify"),
    removeEventIds: z.array(z.string()).min(1).max(20000),
  }),
]);

export function varyMotif(input: unknown, options: unknown) {
  const source = compileScore(input).score,
    score = structuredClone(source),
    o = VariationSchema.parse(options);
  const t = score.tracks.find((t) => t.id === o.trackId),
    clip = t?.clips.find((c) => c.id === o.clipId);
  if (!t || !clip)
    throw new ToolkitError(
      "VARIATION_TARGET_NOT_FOUND",
      `No clip ${o.clipId} on track ${o.trackId}`,
    );
  const original = t.patterns[clip.pattern]!;
  if (o.fromBeat >= original.lengthBeats)
    throw new ToolkitError(
      "VARIATION_RANGE",
      `fromBeat ${o.fromBeat} is past the pattern length ${original.lengthBeats}`,
    );
  let next = structuredClone(original.events);
  if (o.mode === "ending") {
    if (
      original.events.some(
        (e) =>
          e.kind === "note" &&
          e.at < o.fromBeat &&
          e.at + e.duration > o.fromBeat,
      )
    )
      throw new ToolkitError(
        "VARIATION_BOUNDARY",
        "A preserved note crosses the new ending; split it first or set hold:true on the ending note",
      );
    if (o.replacementEvents.some((e) => e.at < o.fromBeat))
      throw new ToolkitError(
        "PRESERVED_REGION",
        "Replacement events must start at or after fromBeat",
      );
    if (o.replacementEvents.some((e) => e.at >= original.lengthBeats))
      throw new ToolkitError(
        "VARIATION_RANGE",
        "Replacement events must lie inside the pattern",
      );
    next = [...next.filter((e) => e.at < o.fromBeat), ...o.replacementEvents];
  } else {
    const remove = new Set(o.removeEventIds);
    if (remove.size !== o.removeEventIds.length)
      throw new ToolkitError(
        "DUPLICATE_SELECTION",
        "removeEventIds contains duplicates",
      );
    for (const id of remove) {
      const e = original.events.find((e) => e.id === id);
      if (!e)
        throw new ToolkitError(
          "EVENT_NOT_FOUND",
          `No event ${id} in pattern ${clip.pattern}`,
        );
      if (e.at < o.fromBeat)
        throw new ToolkitError(
          "PRESERVED_REGION",
          `${id} is in the preserved region`,
        );
    }
    next = next.filter((e) => !remove.has(e.id));
  }
  applyEdit(score, {
    op: "clone-pattern-for-clip",
    trackId: t.id,
    clipId: clip.id,
    newPattern: o.newPattern,
  });
  const used = allIds(source);
  const renumbered = next
    .map((e) => ({ ...e, id: freshId(`${o.newPattern}:${e.id}`, used) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  score.tracks.find((t) => t.id === o.trackId)!.patterns[o.newPattern]!.events =
    renumbered;
  score.schemaVersion = "1.3";
  const compiled = compileScore(score);
  return {
    score: compiled.score,
    report: {
      mode: o.mode,
      clipId: o.clipId,
      newPattern: o.newPattern,
      preservedBeforeBeat: o.fromBeat,
      originalEventCount: original.events.length,
      resultEventCount: renumbered.length,
      removedEventIds: original.events
        .filter((e) => !renumbered.some((n) => n.id.endsWith(e.id)))
        .map((e) => e.id),
      diagnostics: compiled.diagnostics,
      limitations:
        "The requested transformation is constrained, not an automatic harmony judgement or listening approval.",
    },
  };
}

export const AnswerSchema = z.strictObject({
  leadTrackId: z.string(),
  leadClipId: z.string(),
  answerTrackId: z.string(),
  newPattern: z.string().min(1).max(64),
  candidates: z.array(EventSchema).min(1).max(20000),
});

export function placeAnswers(input: unknown, options: unknown) {
  const source = compileScore(input),
    score = structuredClone(source.score),
    o = AnswerSchema.parse(options);
  const lead = score.tracks.find((t) => t.id === o.leadTrackId),
    clip = lead?.clips.find((c) => c.id === o.leadClipId),
    answer = score.tracks.find((t) => t.id === o.answerTrackId);
  if (!lead || !clip || !answer || lead === answer)
    throw new ToolkitError(
      "ANSWER_TARGET_NOT_FOUND",
      `Need a lead clip ${o.leadClipId} and a different answer track ${o.answerTrackId}`,
    );
  if (Object.hasOwn(answer.patterns, o.newPattern))
    throw new ToolkitError(
      "PATTERN_ALREADY_EXISTS",
      `Pattern ${o.newPattern} already exists on ${answer.id}`,
    );
  const pattern = lead.patterns[clip.pattern]!;
  if (
    preset(answer.instrument, score).engine === "drums" ||
    o.candidates.some((e) => e.kind !== "note")
  )
    throw new ToolkitError(
      "ANSWER_REQUIRES_TONAL_EVENTS",
      "Answers must be note events on a tonal track",
    );
  const release = (preset(lead.instrument, score).release * score.tempo) / 60;
  const intervals = pattern.events
    .filter((e) => e.kind === "note" && e.velocity > 0)
    .map((e) => ({
      start: e.at,
      end: Math.min(
        pattern.lengthBeats,
        e.at + (e.kind === "note" ? e.duration * e.gate : 0) + release,
      ),
    }))
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  const gaps: { fromBeat: number; toBeat: number }[] = [];
  for (const interval of intervals) {
    if (interval.start > cursor)
      gaps.push({ fromBeat: cursor, toBeat: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < pattern.lengthBeats)
    gaps.push({ fromBeat: cursor, toBeat: pattern.lengthBeats });
  const answerRelease =
    (preset(answer.instrument, score).release * score.tempo) / 60;
  const leadEvents = source.events.filter(
    (e) => e.trackId === lead.id && e.velocity > 0 && e.endTick > e.tick,
  );
  const accepted = o.candidates.filter((e) => {
    const length =
      (e.kind === "note" ? e.duration * e.gate : 0) + answerRelease;
    if (!gaps.some((g) => e.at >= g.fromBeat && e.at + length <= g.toBeat))
      return false;
    for (let r = 0; r < clip.repeats; r++) {
      const start = clip.at + r * pattern.lengthBeats + e.at,
        end = start + length;
      for (const leadEvent of leadEvents)
        for (const shift of score.export.mode === "loop"
          ? [-score.lengthBeats, 0, score.lengthBeats]
          : [0])
          if (
            start < leadEvent.endTick / source.ppq + shift &&
            end > leadEvent.tick / source.ppq + shift
          )
            return false;
    }
    return true;
  });
  if (!accepted.length)
    throw new ToolkitError(
      "NO_ANSWER_FITS",
      "No candidate fits the lead gaps",
      { gaps },
    );
  const used = allIds(score);
  answer.patterns[o.newPattern] = {
    lengthBeats: pattern.lengthBeats,
    events: accepted.map((e) => ({
      ...e,
      id: freshId(`${o.newPattern}:${e.id}`, used),
    })),
  };
  answer.clips.push({
    id: freshId(`${o.newPattern}:clip`, used),
    pattern: o.newPattern,
    at: clip.at,
    repeats: clip.repeats,
    transpose: 0,
    velocityScale: 1,
    mute: false,
  });
  score.schemaVersion = "1.3";
  const result = compileScore(score);
  return {
    score: result.score,
    report: {
      gaps,
      acceptedCandidateIds: accepted.map((e) => e.id),
      rejectedCandidateIds: o.candidates
        .filter((e) => !accepted.includes(e))
        .map((e) => e.id),
      limitations:
        "Conservative gaps include release and all compiled lead clips, including loop tails. Check harmony and non-lead masking by listening.",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Motif development                                                    */
/* ------------------------------------------------------------------ */

export function developMotif(input: unknown, options: unknown) {
  const source = compileScore(input).score,
    score = structuredClone(source),
    o = MotifConfigSchema.parse(options);
  const track = score.tracks.find((t) => t.id === o.trackId);
  const clip = track?.clips.find((c) => c.id === o.clipId);
  if (!track || !clip)
    throw new ToolkitError(
      "MOTIF_TARGET_NOT_FOUND",
      `No clip ${o.clipId} on track ${o.trackId}`,
    );
  const pattern = track.patterns[clip.pattern];
  if (!pattern)
    throw new ToolkitError(
      "PATTERN_REFERENCE",
      `Missing pattern ${clip.pattern}`,
    );
  if (o.fromBeat >= o.toBeat || o.toBeat > pattern.lengthBeats + 1e-8)
    throw new ToolkitError(
      "INVALID_PHRASE_RANGE",
      `Region ${o.fromBeat}..${o.toBeat} is outside pattern length ${pattern.lengthBeats}`,
    );
  const selected = selectMotif(pattern.events, o.fromBeat, o.toBeat);
  if (!selected.length)
    throw new ToolkitError(
      "EMPTY_PHRASE_SELECTION",
      "No notes start inside the region",
    );
  const transformed = transformNotes(score, selected, o.operators);
  // Notes that were not selected are preserved untouched.
  const untouched = pattern.events.filter(
    (e) => !selected.some((s) => s.id === e.id),
  );
  const used = allIds(source);
  const merged = [...untouched, ...transformed]
    .map((e) => ({
      ...e,
      id: used.has(e.id) ? freshId(`${o.newPattern}:${e.id}`, used) : e.id,
    }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  track.patterns[o.newPattern] = {
    lengthBeats: pattern.lengthBeats,
    events: merged,
  };
  if (o.replaceClip) clip.pattern = o.newPattern;
  else
    track.clips.push({
      id: freshId(`${o.newPattern}:clip`, used),
      pattern: o.newPattern,
      at: clip.at,
      repeats: clip.repeats,
      transpose: 0,
      velocityScale: 1,
      mute: false,
    });
  score.schemaVersion = "1.3";
  const compiled = compileScore(score);
  return {
    score: compiled.score,
    report: {
      trackId: o.trackId,
      sourcePattern: clip.pattern,
      newPattern: o.newPattern,
      fromBeat: o.fromBeat,
      toBeat: o.toBeat,
      operators: o.operators.map((op) => op.op),
      selectedEventIds: selected.map((e) => e.id),
      resultPitches: transformed
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((e) => `${e.at}:${e.kind === "note" ? e.pitch : ""}`),
      preservedEventCount: untouched.length,
      diagnostics: compiled.diagnostics,
      limitations:
        "Mechanical transformation of the selected notes. Check the result musically; inversion and retrograde are not automatically idiomatic.",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Harmony generation                                                   */
/* ------------------------------------------------------------------ */

export function harmonizeScore(input: unknown, options: unknown) {
  const source = compileScore(input).score,
    score = structuredClone(source),
    o = HarmonizeConfigSchema.parse(options);
  const events = buildHarmonyPattern(score, o);
  const target = o.output ?? {
    kind: "new-track" as const,
    trackId: "harmony",
    role: "harmony" as const,
    instrument:
      score.profile === "nes-inspired"
        ? "pulse-pluck"
        : score.profile === "genesis-inspired"
          ? "fm-epiano"
          : "sample-strings",
    gainDb: -14,
    maxVoices: 4,
    voicePolicy: "cut" as const,
    pan: 0,
    send: 0.1,
  };
  const used = allIds(score);
  if (target.kind === "clip") {
    const entry = score.tracks
      .flatMap((t) => t.clips.map((c) => ({ t, c })))
      .find((x) => x.c.id === target.clipId);
    if (!entry)
      throw new ToolkitError("CLIP_NOT_FOUND", `No clip ${target.clipId}`);
    const patternName = freshId(`${target.clipId}-harm`, used);
    entry.t.patterns[patternName] = {
      lengthBeats: entry.t.patterns[entry.c.pattern]!.lengthBeats,
      events: events.map((e) => ({ ...e, id: freshId(e.id, used) })),
    };
    entry.c.pattern = patternName;
  } else {
    if (score.tracks.some((t) => t.id === target.trackId))
      throw new ToolkitError(
        "TRACK_EXISTS",
        `Track ${target.trackId} already exists`,
      );
    const patternName = "harmony";
    score.tracks.push({
      id: target.trackId,
      role: target.role,
      instrument: target.instrument,
      gainDb: target.gainDb,
      pan: target.pan,
      send: target.send,
      maxVoices: target.maxVoices,
      voicePolicy: target.voicePolicy,
      swing: 0,
      swingUnit: 0.5,
      controls: { brightness: 0.5, pluckiness: 0.5 },
      patterns: {
        [patternName]: {
          lengthBeats: score.lengthBeats,
          events: events.map((e) => ({ ...e, id: freshId(e.id, used) })),
        },
      },
      clips: [
        {
          id: freshId("harmony-clip", used),
          pattern: patternName,
          at: 0,
          repeats: 1,
          transpose: 0,
          velocityScale: 1,
          mute: false,
        },
      ],
    });
  }
  score.schemaVersion = "1.3";
  const compiled = compileScore(score);
  return {
    score: compiled.score,
    report: {
      style: o.style,
      anchorMidi: o.anchorMidi,
      eventCount: events.length,
      chords: score.harmony.length,
      target: target.kind,
      diagnostics: compiled.diagnostics,
      limitations:
        "Voicings follow the written chord symbols with no voice-leading optimisation across chord changes.",
    },
  };
}

export function arpeggiatePattern(input: unknown, options: unknown) {
  const source = compileScore(input).score,
    score = structuredClone(source),
    o = ArpeggioConfigSchema.parse(options);
  const track = score.tracks.find((t) => t.id === o.trackId);
  const clip = track?.clips.find((c) => c.id === o.clipId);
  if (!track || !clip)
    throw new ToolkitError(
      "ARPEGGIO_TARGET_NOT_FOUND",
      `No clip ${o.clipId} on track ${o.trackId}`,
    );
  if (Object.hasOwn(track.patterns, o.newPattern))
    throw new ToolkitError(
      "PATTERN_ALREADY_EXISTS",
      `Pattern ${o.newPattern} already exists`,
    );
  const pattern = track.patterns[clip.pattern]!;
  const notes = pattern.events.filter((e): e is NoteEvent => e.kind === "note");
  const generated = buildArpeggioPattern(score, notes, o, pattern.lengthBeats);
  const used = allIds(score);
  track.patterns[o.newPattern] = {
    lengthBeats: pattern.lengthBeats,
    events: generated.map((e) => ({ ...e, id: freshId(e.id, used) })),
  };
  clip.pattern = o.newPattern;
  score.schemaVersion = "1.3";
  const compiled = compileScore(score);
  return {
    score: compiled.score,
    report: {
      sourcePattern: clip.id,
      newPattern: o.newPattern,
      pattern: o.pattern,
      stepBeats: o.stepBeats,
      sourceNotes: notes.length,
      generatedNotes: generated.length,
      diagnostics: compiled.diagnostics,
      limitations:
        "Arpeggios inherit only the pitches present in the source pattern; they do not invent extensions.",
    },
  };
}

export type { MusicEvent };
