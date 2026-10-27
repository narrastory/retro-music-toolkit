import {
  ScoreSchema,
  ScoreError,
  toTick,
  midi,
  pitchName,
  PPQ,
  beatsPerBar,
  type Score,
  type Diagnostic,
  type CompiledEvent,
  type CompiledScore,
} from "./model.js";
import {
  INSTRUMENTS,
  preset,
  hitDuration,
  isDrumEngine,
} from "./instruments.js";
import { validateExtensions } from "./score-validation.js";
import { findZone, findDrumSlot } from "./instrument-model.js";

/** Deterministic 32-bit hash used for per-event, per-track jitter. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * Swing displacement in ticks for an event that starts on `tick`.
 * Straight off-beats are delayed toward a triplet feel; down-beats never move.
 */
/** Round a tick to 3 decimals of a beat for diagnostic messages. */
const beatOfTick = (tick: number) => Number((tick / PPQ).toFixed(3));

export function swingShift(tick: number, swing: number, unitBeats: number) {
  if (swing <= 0) return 0;
  const unit = toTick(unitBeats);
  const position = tick % (unit * 2);
  // Only the second half of each swing pair moves.
  if (position !== unit) return 0;
  // Full swing moves an eighth to 2/3 of the beat: delay by unit/3.
  return Math.round((unit / 3) * swing);
}

export function validateScore(input: unknown): {
  valid: boolean;
  score?: Score;
  diagnostics: Diagnostic[];
} {
  const parsed = ScoreSchema.safeParse(input);
  if (!parsed.success)
    return {
      valid: false,
      diagnostics: parsed.error.issues.map((i) => ({
        severity: "error" as const,
        code: "SCHEMA",
        message: `${i.path.join(".") || "(root)"}: ${i.message}`,
        path: i.path.join("."),
      })),
    };
  const score = parsed.data;
  const { diagnostics: d } = validateExtensions(score);
  const add = (
    code: string,
    message: string,
    path?: string,
    extra?: Partial<Diagnostic>,
  ) => d.push({ severity: "error", code, message, path, ...extra });
  /** Cached preset lookup: the per-event loop must not re-scan the catalog. */
  const presets = new Map<string, ReturnType<typeof preset>>();
  const getPreset = (id: string) => {
    let p = presets.get(id);
    if (!p) {
      p = preset(id, score);
      presets.set(id, p);
    }
    return p;
  };
  const ids = new Set<string>();
  const unique = (id: string, path: string) => {
    if (ids.has(id)) add("DUPLICATE_ID", `Duplicate ID: ${id}`, path);
    ids.add(id);
  };
  const tick = (n: number, path: string) => {
    try {
      toTick(n);
    } catch (e) {
      add("TIME_GRID", String(e), path);
    }
  };
  tick(score.lengthBeats, "lengthBeats");

  // Sections: bounds plus non-overlap, sorted view so order does not matter.
  const sections = [...score.sections].sort((a, b) => a.at - b.at);
  score.sections.forEach((s, i) => {
    unique(s.id, `sections.${i}`);
    tick(s.at, `sections.${i}.at`);
    tick(s.lengthBeats, `sections.${i}.lengthBeats`);
    if (s.at + s.lengthBeats > score.lengthBeats + 1e-8)
      add("SECTION_BOUNDS", "Section exceeds song length", `sections.${i}`);
  });
  for (let i = 1; i < sections.length; i++) {
    const prior = sections[i - 1]!,
      cur = sections[i]!;
    if (prior.at + prior.lengthBeats > cur.at + 1e-8)
      add(
        "SECTION_OVERLAP",
        `Sections ${prior.id} and ${cur.id} overlap`,
        "sections",
        { eventIds: [prior.id, cur.id] },
      );
  }

  const harmony = [...score.harmony].sort((a, b) => a.at - b.at);
  score.harmony.forEach((h, i) => {
    tick(h.at, `harmony.${i}.at`);
    if (h.at >= score.lengthBeats)
      add("HARMONY_BOUNDS", "Harmony marker outside song", `harmony.${i}`);
    if (h.lengthBeats !== undefined) tick(h.lengthBeats, `harmony.${i}`);
  });
  for (let i = 1; i < harmony.length; i++)
    if (harmony[i - 1]!.at === harmony[i]!.at)
      add(
        "HARMONY_DUPLICATE",
        `Two chords declared at beat ${harmony[i]!.at}`,
        "harmony",
      );

  const barBeats = beatsPerBar(score.meter);
  let estimate = 0;
  for (const [ti, t] of score.tracks.entries()) {
    const path = `tracks.${ti}`;
    unique(t.id, path);
    let p: ReturnType<typeof preset> | undefined;
    try {
      p = getPreset(t.instrument);
    } catch {
      add("INSTRUMENT", `Unknown instrument: ${t.instrument}`, path);
    }
    if (p && p.role !== t.role && !isDrumEngine(p))
      d.push({
        severity: "info",
        code: "ROLE_MISMATCH",
        message: `Track role "${t.role}" differs from preset role "${p.role}" for ${p.id}`,
        trackId: t.id,
        path,
      });
    if (t.maxVoices > 1 && p && isDrumEngine(p))
      d.push({
        severity: "info",
        code: "DRUM_VOICE_HINT",
        message:
          "Drum tracks ignore maxVoices; each hit is an independent one-shot",
        trackId: t.id,
        path,
      });
    if (t.swing > 0) {
      try {
        toTick(t.swingUnit);
      } catch {
        add("TIME_GRID", "swingUnit must be representable at PPQ", path);
      }
    }

    for (const [name, pat] of Object.entries(t.patterns)) {
      const pp = `${path}.patterns.${name}`;
      tick(pat.lengthBeats, `${pp}.lengthBeats`);
      for (const [ei, e] of pat.events.entries()) {
        const ep = `${pp}.events.${ei}`;
        unique(e.id, ep);
        tick(e.at, ep + ".at");
        if (e.at >= pat.lengthBeats)
          add("EVENT_BOUNDS", "Event starts outside pattern", ep);
        if (e.kind === "note") {
          tick(e.duration, ep + ".duration");
          // A held note is allowed to run past the pattern and across bars.
          if (!e.hold && e.at + e.duration > pat.lengthBeats + 1e-8)
            add(
              "EVENT_BOUNDS",
              "Note duration extends beyond pattern; set hold:true or shorten it",
              ep,
              {
                suggestion: {
                  hold: true,
                  maxDuration: Number((pat.lengthBeats - e.at).toFixed(6)),
                },
              },
            );
          if (e.vibrato) tick(e.vibrato.delayBeats, ep + ".vibrato.delayBeats");
          if (p && isDrumEngine(p))
            add(
              "EVENT_KIND",
              "Drum presets require hit events; tonal presets require notes",
              ep,
            );
          else if (p && p.sample?.kind === "zones") {
            const n = midi(e.pitch);
            if (!findZone(p, n))
              add(
                "SAMPLE_ZONE_RANGE",
                `No sample zone covers ${e.pitch} (MIDI ${n}) for ${p.id}`,
                ep,
                {
                  suggestion: {
                    available: p.sample.zones.map((z) => [
                      z.lowMidi,
                      z.highMidi,
                    ]),
                  },
                },
              );
          }
        } else if (p && !isDrumEngine(p))
          add(
            "EVENT_KIND",
            "Drum presets require hit events; tonal presets require notes",
            ep,
          );
        else if (p?.drumKit && !findDrumSlot(p, e.sound))
          d.push({
            severity: "warning",
            code: "DRUM_SLOT_MISSING",
            message: `${p.id} has no sampled ${e.sound}; the hit will be silent`,
            trackId: t.id,
            eventIds: [e.id],
            beat: e.at,
          });
      }
    }
    for (const [ci, c] of t.clips.entries()) {
      const cp = `${path}.clips.${ci}`;
      unique(c.id, cp);
      tick(c.at, cp + ".at");
      const pat = t.patterns[c.pattern];
      if (!pat) {
        add("PATTERN_REFERENCE", `Missing pattern: ${c.pattern}`, cp);
        continue;
      }
      if (c.lengthBeats !== undefined) {
        tick(c.lengthBeats, cp + ".lengthBeats");
        if (c.lengthBeats > pat.lengthBeats * c.repeats + 1e-8)
          add(
            "CLIP_BOUNDS",
            "Clip length exceeds pattern length × repeats",
            cp,
            { suggestion: { maxLengthBeats: pat.lengthBeats * c.repeats } },
          );
      }
      const playLength = c.lengthBeats ?? pat.lengthBeats * c.repeats;
      estimate += pat.events.length * c.repeats;
      if (c.at + playLength > score.lengthBeats + 1e-8)
        add("CLIP_BOUNDS", "Clip exceeds song length", cp, {
          suggestion: {
            maxAt: Number((score.lengthBeats - playLength).toFixed(6)),
          },
        });
      if (p)
        for (const e of pat.events)
          if (e.kind === "note") {
            const n = midi(e.pitch) + c.transpose;
            if (n < 0 || n > 127)
              add("MIDI_RANGE", "Transposed pitch is outside MIDI 0..127", cp);
            else if (n < p.range[0] || n > p.range[1])
              d.push({
                severity: "warning",
                code: "PRESET_RANGE",
                message: `Pitch ${pitchName(n)} outside recommended ${p.range.join("..")}`,
                trackId: t.id,
                eventIds: [e.id],
              });
            else if (p.sample?.kind === "zones" && !findZone(p, n))
              add(
                "SAMPLE_ZONE_RANGE",
                `Transposed ${pitchName(n)} has no sample zone in ${p.id}`,
                cp,
                {
                  suggestion: {
                    available: p.sample.zones.map((z) => [
                      z.lowMidi,
                      z.highMidi,
                    ]),
                  },
                },
              );
          }
    }
  }
  if (estimate > 100000)
    add("EVENT_LIMIT", "Expanded score exceeds 100,000 events");
  return {
    valid: !d.some((x) => x.severity === "error"),
    score,
    diagnostics: d,
  };
}

export function compileScore(input: unknown): CompiledScore {
  const v = validateScore(input);
  if (!v.valid || !v.score) throw new ScoreError(v.diagnostics);
  const s = v.score;
  const diagnostics = [...v.diagnostics];
  const presets = new Map<string, ReturnType<typeof preset>>();
  const getPreset = (id: string) => {
    let p = presets.get(id);
    if (!p) {
      p = preset(id, s);
      presets.set(id, p);
    }
    return p;
  };
  const lengthTicks = toTick(s.lengthBeats);
  const events: CompiledEvent[] = [];

  for (const t of s.tracks) {
    const instrument = getPreset(t.instrument);
    const drums = isDrumEngine(instrument);
    const releaseTicks = Math.ceil(((instrument.release * s.tempo) / 60) * PPQ);
    for (const c of t.clips) {
      if (c.mute) continue;
      const p = t.patterns[c.pattern]!;
      const patternTicks = toTick(p.lengthBeats);
      // Clip cropping: only play up to lengthBeats when declared.
      const playTicks =
        c.lengthBeats !== undefined ? toTick(c.lengthBeats) : undefined;
      const clipStart = toTick(c.at);
      const sorted = [...p.events].sort(
        (a, b) => a.at - b.at || a.id.localeCompare(b.id),
      );
      // Next-source-event distance resolves `hold` within the pattern.
      const nextAt = new Map<string, number>();
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i]!,
          nxt = sorted[i + 1];
        if (nxt) nextAt.set(cur.id, nxt.at - cur.at);
      }
      for (let r = 0; r < c.repeats; r++) {
        for (const e of sorted) {
          const straightTick = r * patternTicks + toTick(e.at);
          // Swing displaces only the off-beat half of each swing-unit pair.
          const shift = swingShift(toTick(e.at), t.swing, t.swingUnit);
          const relativeTick = straightTick + shift;
          if (playTicks !== undefined && relativeTick >= playTicks) continue;
          const humanRng = t.humanize
            ? seeded(
                hashString(`${s.seed}:${t.id}:${c.id}:${r}:${e.id}:timing`),
              )
            : undefined;
          let tick = clipStart + relativeTick;
          const swingShiftTicks = shift || undefined;
          if (t.humanize && t.humanize.timingBeats > 0 && humanRng) {
            const jitter = Math.round(
              (humanRng() * 2 - 1) * t.humanize.timingBeats * PPQ,
            );
            tick = Math.max(0, tick + jitter);
          }

          let durationTicks: number;
          let keyEndTick: number;
          let endTick: number;

          if (e.kind === "note") {
            const nominal = toTick(e.duration);
            if (e.hold) {
              // Sustain to the next source event (or the pattern end), then release.
              const until = nextAt.get(e.id);
              const nominalHold =
                until !== undefined
                  ? toTick(until)
                  : patternTicks - toTick(e.at);
              const held = Math.max(1, nominalHold);
              durationTicks = held;
              keyEndTick = tick + held;
              // The release tail is allowed to ring until the next note
              // retriggers; that cut is intentional, not a voice conflict.
              endTick = keyEndTick + releaseTicks;
            } else {
              durationTicks = Math.max(1, Math.round(nominal * e.gate));
              keyEndTick = tick + durationTicks;
              endTick = keyEndTick + releaseTicks;
            }
          } else {
            durationTicks = Math.ceil(
              ((hitDuration(e.sound) * s.tempo) / 60) * PPQ,
            );
            keyEndTick = tick + durationTicks;
            endTick = keyEndTick;
          }
          if (playTicks !== undefined) {
            const clipEnd = clipStart + playTicks;
            if (keyEndTick > clipEnd) keyEndTick = clipEnd;
            if (endTick > clipEnd) endTick = clipEnd;
            if (keyEndTick <= tick) continue;
          }

          const humanVelocity =
            t.humanize && t.humanize.velocity > 0
              ? (() => {
                  const rng = seeded(
                    hashString(`${s.seed}:${t.id}:${c.id}:${r}:${e.id}:vel`),
                  );
                  return (rng() * 2 - 1) * t.humanize.velocity;
                })()
              : undefined;

          events.push({
            id: `${c.id}/${r}/${e.id}`,
            sourceId: e.id,
            clipId: c.id,
            trackId: t.id,
            kind: e.kind,
            tick,
            durationTicks,
            velocity: Math.max(
              0,
              Math.min(1, e.velocity * c.velocityScale + (humanVelocity ?? 0)),
            ),
            ...(e.kind === "note"
              ? {
                  midi: midi(e.pitch) + c.transpose,
                  vibrato: e.vibrato,
                  articulation: e.articulation,
                  expression: e.expression,
                  hold: e.hold,
                }
              : { sound: e.sound, detuneCents: e.detuneCents }),
            voice: 0,
            keyEndTick,
            endTick,
            ...(swingShiftTicks !== undefined ? { swingShiftTicks } : {}),
            ...(humanVelocity !== undefined
              ? { humanizeVelocity: humanVelocity }
              : {}),
          });
        }
        if (drums) continue;
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));

  /**
   * Release-tail cuts are overwhelmingly routine: a track with one voice will
   * cut the previous tail on nearly every note. Reporting one diagnostic per
   * event buries real problems, so info-level cuts are aggregated per track
   * while errors stay attached to the specific event pair.
   */
  const releaseCuts = new Map<
    string,
    {
      count: number;
      firstBeat: number;
      lastBeat: number;
      examples: string[];
      sourceIds: string[];
    }
  >();

  for (const t of s.tracks) {
    const instrument = getPreset(t.instrument);
    const trackEvents = events.filter((e) => e.trackId === t.id);

    // Drum hits are independent one-shots: no polyphony accounting at all.
    if (isDrumEngine(instrument)) {
      for (const e of trackEvents) {
        if (e.velocity === 0) {
          e.endTick = e.tick;
          e.keyEndTick = e.tick;
        }
      }
      continue;
    }

    const active: (CompiledEvent | undefined)[] = Array(t.maxVoices).fill(
      undefined,
    );
    const firstInLane: (CompiledEvent | undefined)[] = Array(t.maxVoices).fill(
      undefined,
    );
    for (const e of trackEvents) {
      if (e.velocity === 0) {
        e.endTick = e.tick;
        e.keyEndTick = e.tick;
        continue;
      }
      if (e.articulation === "legato") {
        const prior = active[0];
        const valid =
          t.maxVoices === 1 &&
          e.kind === "note" &&
          e.velocity > 0 &&
          prior?.kind === "note" &&
          prior.velocity > 0 &&
          prior.tick < e.tick &&
          prior.keyEndTick >= e.tick;
        if (!valid) {
          diagnostics.push({
            severity: "error",
            code: "LEGATO_PREDECESSOR",
            message: `${e.id}: legato needs one voice and a preceding held note in the same cycle`,
            trackId: t.id,
            eventIds: [e.id],
            beat: e.tick / PPQ,
            suggestion:
              "Use articulation:retrigger, or extend the previous note with hold:true",
          });
        } else if (
          instrument.sample?.kind === "zones" &&
          findZone(instrument, prior.midi!) !== findZone(instrument, e.midi!)
        ) {
          diagnostics.push({
            severity: "error",
            code: "LEGATO_SAMPLE_ZONE",
            message:
              "Legato may not cross sample zones; retrigger at the zone boundary",
            trackId: t.id,
            eventIds: [prior.id, e.id],
            beat: e.tick / PPQ,
          });
        } else {
          prior.legatoToId = e.id;
          e.legatoFromId = prior.id;
          prior.endTick = e.tick;
          prior.keyEndTick = e.tick;
          e.voice = 0;
          active[0] = e;
          continue;
        }
      }
      const available = active.flatMap((a, i) =>
        !a || a.endTick <= e.tick ? [i] : [],
      );
      // Prefer an available lane that also leaves room at the next loop entry.
      let voice =
        available.find(
          (i) =>
            s.export.mode !== "loop" ||
            !firstInLane[i] ||
            e.endTick <= lengthTicks + firstInLane[i]!.tick,
        ) ??
        available[0] ??
        -1;
      if (voice < 0) {
        const oldest = active.reduce(
          (best, a, i) => (a!.tick < active[best]!.tick ? i : best),
          0,
        );
        voice = oldest;
        const prior = active[voice]!;
        const error = t.voicePolicy === "error";
        // Release-tail overlap is the common case and is not a real conflict:
        // report it separately so genuine overlaps stay visible.
        const tailOnly = prior.keyEndTick <= e.tick;
        if (tailOnly && !error) {
          // Routine tail truncation: count it, do not shout about it.
          const beat = e.tick / PPQ;
          const entry = releaseCuts.get(t.id);
          if (entry) {
            entry.count++;
            entry.lastBeat = beat;
            if (entry.examples.length < 3) entry.examples.push(prior.sourceId);
            entry.sourceIds.push(prior.sourceId);
          } else
            releaseCuts.set(t.id, {
              count: 1,
              firstBeat: beat,
              lastBeat: beat,
              examples: [prior.sourceId],
              sourceIds: [prior.sourceId],
            });
        } else {
          diagnostics.push({
            severity: error ? "error" : "info",
            code: error
              ? tailOnly
                ? "RELEASE_OVERLAP"
                : "VOICE_OVERLAP"
              : "VOICE_STEAL",
            message: tailOnly
              ? `${t.id}: release tail of ${prior.sourceId} is cut at beat ${beatOfTick(e.tick)}; the note itself finished`
              : `${t.id}: voice ${voice} still held at beat ${beatOfTick(e.tick)}`,
            trackId: t.id,
            eventIds: [prior.id, e.id],
            beat: e.tick / PPQ,
            suggestion: error
              ? "increase maxVoices, shorten duration, or set voicePolicy:cut"
              : "shorten the following note or raise maxVoices",
          });
        }
        prior.cutTick = e.tick;
        prior.endTick = e.tick;
      }
      e.voice = voice;
      active[voice] = e;
      firstInLane[voice] ??= e;
    }
  }

  for (const [trackId, cut] of releaseCuts)
    diagnostics.push({
      severity: "info",
      code: "RELEASE_CUT",
      message:
        `${trackId}: ${cut.count} release tail${cut.count === 1 ? "" : "s"} truncated by the next note ` +
        `(first at beat ${beatOfTick(Math.round(cut.firstBeat * PPQ))}, last at beat ${beatOfTick(Math.round(cut.lastBeat * PPQ))}). ` +
        `The notes themselves finished; only the tails are clipped.`,
      trackId,
      beat: cut.firstBeat,
      eventIds: cut.sourceIds.slice(0, 32),
      suggestion: {
        count: cut.count,
        exampleSourceIds: cut.examples,
        fix: "Shorten gate, raise maxVoices, or accept the cut as part of the articulation",
      },
    });

  // Validate reuse across the circular boundary with the same compiled voice assignment.
  if (s.export.mode === "loop")
    for (const t of s.tracks) {
      if (isDrumEngine(getPreset(t.instrument))) continue;
      for (let voice = 0; voice < t.maxVoices; voice++) {
        const lane = events.filter(
          (e) => e.trackId === t.id && e.voice === voice && e.velocity > 0,
        );
        const first = lane[0],
          last = lane[lane.length - 1];
        if (!first || !last) continue;
        const boundary = lengthTicks + first.tick;
        if (last.endTick > boundary) {
          const error = t.voicePolicy === "error";
          diagnostics.push({
            severity: error ? "error" : "info",
            code: error ? "LOOP_VOICE_OVERLAP" : "LOOP_VOICE_STEAL",
            message: `${t.id}: tail overlaps the next loop on voice ${voice}`,
            trackId: t.id,
            eventIds: [last.id, first.id],
            suggestion: error
              ? "shorten the final note, reduce release, or set voicePolicy:cut"
              : undefined,
          });
          last.cutTick = boundary;
          last.endTick = boundary;
        }
      }
    }

  // Style budgets are diagnostic approximations, never claims of chip compatibility.
  if (s.profile === "nes-inspired") {
    for (const engine of ["pulse", "triangle", "drums"] as const) {
      const tracks = s.tracks.filter(
        (t) => getPreset(t.instrument).engine === engine,
      );
      const count = tracks.reduce(
          (n, t) =>
            n + (isDrumEngine(getPreset(t.instrument)) ? 1 : t.maxVoices),
          0,
        ),
        budget = engine === "pulse" ? 2 : 1;
      if (count > budget)
        diagnostics.push({
          severity: "warning",
          code: "STYLE_BUDGET",
          message: `NES-inspired ${engine} declared voice budget ${count} > ${budget}`,
        });
    }
  }
  if (
    s.profile === "snes-inspired" &&
    s.tracks.reduce((n, t) => n + t.maxVoices, 0) > 8
  )
    diagnostics.push({
      severity: "warning",
      code: "STYLE_BUDGET",
      message:
        "SNES-inspired declared voice capacity exceeds 8; no hardware compatibility implied",
    });
  const last = events.reduce((n, e) => Math.max(n, e.endTick), 0) / PPQ;
  if (
    s.export.mode === "one-shot" &&
    ((last - s.lengthBeats) * 60) / s.tempo > s.export.tailSeconds
  )
    diagnostics.push({
      severity: "warning",
      code: "TAIL_TRUNCATION",
      message: "Configured tail is shorter than final voice release",
      suggestion: {
        tailSeconds: Math.ceil(((last - s.lengthBeats) * 60) / s.tempo),
      },
    });
  if (!events.some((e) => e.velocity > 0))
    diagnostics.push({
      severity: "warning",
      code: "EMPTY_SCORE",
      message: "No audible events",
    });
  if (diagnostics.some((x) => x.severity === "error"))
    throw new ScoreError(diagnostics);
  return {
    score: s,
    ppq: PPQ,
    lengthTicks,
    events,
    diagnostics,
  };
}
