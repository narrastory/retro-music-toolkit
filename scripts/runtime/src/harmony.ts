import {
  midi,
  pitchName,
  toTick,
  beatsPerBar,
  ToolkitError,
  type Score,
  type NoteEvent,
  type Diagnostic,
  type CompiledEvent,
  type CompiledScore,
} from "./model.js";

/** Pitch-class names accepted in `key.tonic` and chord roots. */
const PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

export const pitchClass = (name: string): number => {
  const pc = PC[name];
  if (pc === undefined)
    throw new ToolkitError("CHORD_PARSE", `Unknown note name: ${name}`);
  return pc;
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export type MusicalKey = { tonic: number; mode: "major" | "minor" };
export function keyOf(score: Score): MusicalKey | undefined {
  if (!score.key) return undefined;
  return { tonic: pitchClass(score.key.tonic), mode: score.key.mode };
}
export function scaleOf(key: MusicalKey): number[] {
  const base = key.mode === "major" ? MAJOR : MINOR;
  return base.map((n) => (n + key.tonic) % 12);
}

export type ChordQuality = {
  intervals: number[];
  name: string;
};
const QUALITIES: [string, number[], string][] = [
  ["maj7", [0, 4, 7, 11], "major seventh"],
  ["maj9", [0, 4, 7, 11, 14], "major ninth"],
  ["m7b5", [0, 3, 6, 10], "half-diminished"],
  ["dim7", [0, 3, 6, 9], "diminished seventh"],
  ["madd9", [0, 3, 7, 14], "minor add9"],
  ["add9", [0, 4, 7, 14], "add9"],
  ["sus2", [0, 2, 7], "suspended second"],
  ["sus4", [0, 5, 7], "suspended fourth"],
  ["maj", [0, 4, 7], "major"],
  ["min7", [0, 3, 7, 10], "minor seventh"],
  ["m7", [0, 3, 7, 10], "minor seventh"],
  ["dim", [0, 3, 6], "diminished"],
  ["aug", [0, 4, 8], "augmented"],
  ["m6", [0, 3, 7, 9], "minor sixth"],
  ["m9", [0, 3, 7, 10, 14], "minor ninth"],
  ["m", [0, 3, 7], "minor"],
  ["min", [0, 3, 7], "minor"],
  ["6", [0, 4, 7, 9], "sixth"],
  ["9", [0, 4, 7, 10, 14], "dominant ninth"],
  ["7", [0, 4, 7, 10], "dominant seventh"],
  ["5", [0, 7], "power chord"],
  ["", [0, 4, 7], "major"],
];
// Longest first so "maj7" is not read as "m" + "aj7".
QUALITIES.sort((a, b) => b[0].length - a[0].length);

export type ParsedChord = {
  symbol: string;
  root: number;
  intervals: number[];
  bass: number;
  quality: string;
};
const CHORD_RE = /^([A-G](?:#|b)?)([A-Za-z0-9+#]*)(?:\/([A-G](?:#|b)?))?$/;
export function parseChord(symbol: string): ParsedChord {
  const m = CHORD_RE.exec(symbol.trim());
  if (!m)
    throw new ToolkitError(
      "CHORD_PARSE",
      `Cannot parse chord symbol: ${symbol}`,
    );
  const root = pitchClass(m[1]!);
  const suffix = m[2] ?? "";
  const match = QUALITIES.find(([suffixKey]) => suffix === suffixKey);
  if (!match)
    throw new ToolkitError(
      "CHORD_PARSE",
      `Unknown chord quality "${suffix}" in ${symbol}; supported: ${[
        ...new Set(QUALITIES.map((q) => q[0] || "(major)")),
      ].join(", ")}`,
    );
  return {
    symbol,
    root,
    intervals: match[1],
    bass: m[3] ? pitchClass(m[3]) : root,
    quality: match[2],
  };
}
export const chordPitchClasses = (c: ParsedChord) =>
  c.intervals.map((i) => (c.root + i) % 12);
export const chordTones = (c: ParsedChord) =>
  c.intervals.map((i) => (c.root + i) % 12);

export type ChordWindow = ParsedChord & { at: number; until: number };
export function chordWindows(score: Score): ChordWindow[] {
  const sorted = [...score.harmony].sort((a, b) => a.at - b.at);
  return sorted.map((h, i) => {
    const next = sorted[i + 1]?.at ?? score.lengthBeats;
    const until = Math.min(
      score.lengthBeats,
      h.lengthBeats !== undefined ? h.at + h.lengthBeats : next,
    );
    return { ...parseChord(h.chord), at: h.at, until };
  });
}
export function chordAt(windows: ChordWindow[], beat: number) {
  let found: ChordWindow | undefined;
  for (const w of windows) if (beat >= w.at && beat < w.until) found = w;
  return found;
}

/** Diatonic pitch helpers. */
export function scaleDegreeToMidi(
  key: MusicalKey,
  degree: number,
  octaveAnchor: number,
): number {
  const scale = scaleOf(key);
  const octaves = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  const anchorPc = octaveAnchor % 12;
  // Place the anchor on the scale degree whose pitch class it matches, else 0.
  const anchorDegree = scale.indexOf(anchorPc);
  const base = octaveAnchor - (anchorDegree >= 0 ? 0 : 0);
  const target = scale[idx]!;
  const delta =
    (target - scale[anchorDegree >= 0 ? anchorDegree : 0]! + 12) % 12;
  return base + octaves * 12 + delta;
}
export function nearestScaleMidi(key: MusicalKey, target: number): number {
  const scale = scaleOf(key);
  let best = target;
  let bestDistance = Infinity;
  for (let n = target - 2; n <= target + 2; n++)
    if (scale.includes(((n % 12) + 12) % 12)) {
      const d = Math.abs(n - target);
      if (d < bestDistance) {
        best = n;
        bestDistance = d;
      }
    }
  return best;
}

/* ------------------------------------------------------------------ */
/* Harmony diagnostics                                                 */
/* ------------------------------------------------------------------ */

export type HarmonyRule =
  | "HARMONY_NON_CHORD_TONE"
  | "BASS_NON_CHORD_TONE"
  | "BASS_SLASH_CHORD"
  | "PARALLEL_FIFTHS"
  | "PARALLEL_OCTAVES"
  | "UNRESOLVED_LEAP"
  | "OUT_OF_KEY"
  | "MINOR_SECOND_CLASH"
  | "HARMONY_GAP"
  | "HARMONY_ZERO_LENGTH";

export type HarmonyFinding = {
  rule: HarmonyRule;
  severity: "info" | "warning";
  trackIds: string[];
  fromBeat: number;
  toBeat: number;
  bar: number;
  sourceEventIds: string[];
  evidence: Record<string, unknown>;
  message: string;
  suggestions: string[];
};

const STRONG_BEAT_TOLERANCE = 1e-6;

export function harmonyFindings(c: CompiledScore): HarmonyFinding[] {
  const s = c.score;
  const findings: HarmonyFinding[] = [];
  const windows = chordWindows(s);
  if (!windows.length) return findings;
  const barBeats = beatsPerBar(s.meter);
  const key = keyOf(s);
  const scale = key ? scaleOf(key) : undefined;
  const beatOf = (e: CompiledEvent) => e.tick / c.ppq;
  const barOf = (beat: number) => Math.floor(beat / barBeats) + 1;
  const emit = (
    rule: HarmonyRule,
    tracks: string[],
    from: number,
    to: number,
    ev: CompiledEvent[],
    evidence: Record<string, unknown>,
    message: string,
    suggestions: string[],
    severity: "info" | "warning" = "warning",
  ) =>
    findings.push({
      rule,
      severity,
      trackIds: [...new Set(tracks)],
      fromBeat: from,
      toBeat: to,
      bar: barOf(from),
      sourceEventIds: [...new Set(ev.map((e) => e.sourceId))].slice(0, 64),
      evidence,
      message,
      suggestions,
    });

  const notes = c.events.filter(
    (e) =>
      e.kind === "note" &&
      e.velocity > 0 &&
      !e.legatoFromId &&
      e.midi !== undefined,
  );
  const byTrack = new Map<string, CompiledEvent[]>();
  for (const e of notes) {
    const list = byTrack.get(e.trackId);
    if (list) list.push(e);
    else byTrack.set(e.trackId, [e]);
  }
  const melodyTracks = s.tracks.filter((t) => t.role === "melody");
  const bassTracks = s.tracks.filter((t) => t.role === "bass");

  /** Chords left uncovered by any marker inside the song. */
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    if (w.until > w.at + 1e-8) continue;
    emit(
      "HARMONY_ZERO_LENGTH",
      [],
      w.at,
      w.at,
      [],
      { chord: w.symbol },
      `Chord marker ${w.symbol} has zero length`,
      ["Give it lengthBeats or move the next marker later."],
    );
  }
  const covered = windows.reduce((n, w) => n + (w.until - w.at), 0);
  if (covered < s.lengthBeats - 1e-8)
    emit(
      "HARMONY_GAP",
      [],
      covered,
      s.lengthBeats,
      [],
      { coveredBeats: covered, songBeats: s.lengthBeats },
      `Harmony markers cover ${covered} of ${s.lengthBeats} beats`,
      ["Add a marker at the end of the gap, or treat the tail as intentional."],
      "info",
    );

  for (const track of melodyTracks) {
    const evs = byTrack.get(track.id) ?? [];
    for (const e of evs) {
      const beat = beatOf(e);
      const w = chordAt(windows, beat);
      if (!w) continue;
      const tones = chordTones(w);
      const pc = ((e.midi! % 12) + 12) % 12;
      const isStrong =
        Math.abs(beat - Math.round(beat / barBeats) * barBeats) <
          STRONG_BEAT_TOLERANCE ||
        Math.abs(beat - Math.round(beat)) < STRONG_BEAT_TOLERANCE;
      if (!isStrong) continue;
      const durationBeats = e.durationTicks / c.ppq;
      // A short off-chord passing note on a strong beat is common and fine.
      if (durationBeats < 0.5) continue;
      if (tones.includes(pc)) continue;
      // A chromatic note that is immediately resolved by step is a passing tone.
      const next = evs.find((x) => x.tick > e.tick);
      const prev = [...evs].reverse().find((x) => x.tick < e.tick);
      const stepAway = (other?: CompiledEvent) =>
        other !== undefined &&
        Math.abs(other.midi! - e.midi!) <= 2 &&
        chordTones(w).includes(((other.midi! % 12) + 12) % 12);
      if (stepAway(next) || stepAway(prev)) continue;
      emit(
        "HARMONY_NON_CHORD_TONE",
        [track.id],
        beat,
        beat + durationBeats,
        [e],
        {
          chord: w.symbol,
          pitch: pitchName(e.midi!),
          chordTones: tones.map((t) => pitchName(t + 60).replace(/-?\d+$/, "")),
          durationBeats,
        },
        `${pitchName(e.midi!)} is not in ${w.symbol} and is held on a strong beat`,
        [
          "Move to a chord tone, shorten it, or change the chord if the tension is intentional.",
        ],
      );
    }
  }

  // Bass vs chord root.
  for (const track of bassTracks) {
    for (const e of byTrack.get(track.id) ?? []) {
      const beat = beatOf(e);
      const w = chordAt(windows, beat);
      if (!w) continue;
      const pc = ((e.midi! % 12) + 12) % 12;
      const tones = chordTones(w);
      if (!tones.includes(pc)) {
        if (e.durationTicks / c.ppq < 0.5) continue;
        emit(
          "BASS_NON_CHORD_TONE",
          [track.id],
          beat,
          beat + e.durationTicks / c.ppq,
          [e],
          { chord: w.symbol, pitch: pitchName(e.midi!), chordTones: tones },
          `Bass ${pitchName(e.midi!)} clashes with ${w.symbol}`,
          [
            "Use the root, fifth or another chord tone; a suspended clash is possible but should be deliberate.",
          ],
        );
      } else if (pc !== w.bass && pc === w.root && w.bass !== w.root) {
        emit(
          "BASS_SLASH_CHORD",
          [track.id],
          beat,
          beat + e.durationTicks / c.ppq,
          [e],
          {
            chord: w.symbol,
            bass: pitchName(w.bass + 60).replace(/-?\d+$/, ""),
          },
          `${w.symbol} is written over ${pitchName(w.bass + 60).replace(/-?\d+$/, "")} but the bass plays the root`,
          [
            "Play the written bass note or restate the chord as a root-position triad.",
          ],
          "info",
        );
      }
    }
  }

  // Parallel perfect intervals between melody and bass.
  for (const mel of melodyTracks)
    for (const bass of bassTracks) {
      const m = byTrack.get(mel.id) ?? [];
      const b = byTrack.get(bass.id) ?? [];
      for (let i = 0; i + 1 < m.length; i++) {
        const a1 = m[i]!,
          a2 = m[i + 1]!;
        const lower1 = b.find((x) => x.tick <= a1.tick && x.endTick > a1.tick);
        const lower2 = b.find((x) => x.tick <= a2.tick && x.endTick > a2.tick);
        if (!lower1 || !lower2 || lower1 === lower2) continue;
        const i1 = (a1.midi! - lower1.midi! + 12) % 12;
        const i2 = (a2.midi! - lower2.midi! + 12) % 12;
        const motion = Math.sign(a2.midi! - a1.midi!);
        const lowerMotion = Math.sign(lower2.midi! - lower1.midi!);
        const same = motion !== 0 && motion === lowerMotion;
        if (!same) continue;
        if (i1 === 7 && i2 === 7)
          emit(
            "PARALLEL_FIFTHS",
            [mel.id, bass.id],
            beatOf(a1),
            beatOf(a2) + a2.durationTicks / c.ppq,
            [a1, a2, lower1, lower2],
            {
              first: `${pitchName(a1.midi!)}/${pitchName(lower1.midi!)}`,
              second: `${pitchName(a2.midi!)}/${pitchName(lower2.midi!)}`,
            },
            "Parallel perfect fifths between melody and bass",
            [
              "Move one voice to another chord tone; parallel fifths can be intentional in chiptune doubling, so audition it.",
            ],
          );
        else if (i1 === 0 && i2 === 0)
          emit(
            "PARALLEL_OCTAVES",
            [mel.id, bass.id],
            beatOf(a1),
            beatOf(a2) + a2.durationTicks / c.ppq,
            [a1, a2, lower1, lower2],
            {
              first: `${pitchName(a1.midi!)}/${pitchName(lower1.midi!)}`,
              second: `${pitchName(a2.midi!)}/${pitchName(lower2.midi!)}`,
            },
            "Parallel octaves between melody and bass",
            [
              "Change one voice's pitch; deliberate octave doubling is common in 8bit writing.",
            ],
            "info",
          );
      }
    }

  // Large unresolved leaps in the melody.
  for (const track of melodyTracks) {
    const evs = [...(byTrack.get(track.id) ?? [])].sort(
      (a, b) => a.tick - b.tick,
    );
    for (let i = 0; i + 1 < evs.length; i++) {
      const a = evs[i]!,
        b = evs[i + 1]!;
      const leap = b.midi! - a.midi!;
      if (Math.abs(leap) < 7) continue;
      const after = evs[i + 2];
      if (!after) continue;
      const recovery = after.midi! - b.midi!;
      if (
        Math.sign(recovery) === Math.sign(leap) ||
        Math.abs(recovery) > Math.abs(leap)
      )
        emit(
          "UNRESOLVED_LEAP",
          [track.id],
          beatOf(a),
          beatOf(after),
          [a, b, after],
          {
            leapSemitones: leap,
            nextMove: recovery,
            gapBeats: beatOf(b) - beatOf(a),
          },
          `Leap of ${leap} semitones continues instead of resolving by step`,
          [
            "Step back toward the previous pitch, or make the leap the deliberate high point of the phrase.",
          ],
          "info",
        );
    }
  }

  // Out-of-key notes.
  if (key && scale) {
    const perTrack = new Map<string, CompiledEvent[]>();
    for (const e of notes) {
      const pc = ((e.midi! % 12) + 12) % 12;
      if (scale.includes(pc)) continue;
      const list = perTrack.get(e.trackId);
      if (list) list.push(e);
      else perTrack.set(e.trackId, [e]);
    }
    for (const [trackId, evs] of perTrack) {
      const ratio =
        evs.length / Math.max(1, (byTrack.get(trackId) ?? []).length);
      emit(
        "OUT_OF_KEY",
        [trackId],
        beatOf(evs[0]!),
        beatOf(evs.at(-1)!) + evs.at(-1)!.durationTicks / c.ppq,
        evs,
        {
          count: evs.length,
          ratio,
          key: `${pitchName(key.tonic + 60).replace(/-?\d+$/, "")} ${key.mode}`,
          pitches: [...new Set(evs.map((e) => pitchName(e.midi!)))].slice(
            0,
            12,
          ),
        },
        `${evs.length} notes outside the declared ${pitchName(key.tonic + 60).replace(/-?\d+$/, "")} ${key.mode}`,
        [
          "Check for typos; chromatic passing tones and modal borrowing are valid if intended.",
        ],
        ratio > 0.25 ? "warning" : "info",
      );
    }
  }

  // Minor-second clashes between simultaneous notes on different tracks.
  const tracks = [...byTrack.entries()];
  for (let i = 0; i < tracks.length; i++)
    for (let j = i + 1; j < tracks.length; j++) {
      const [idA, a] = tracks[i]!;
      const [idB, b] = tracks[j]!;
      const clashes: CompiledEvent[] = [];
      for (const x of a)
        for (const y of b) {
          if (x.tick >= y.endTick || y.tick >= x.endTick) continue;
          if (Math.abs((((x.midi! - y.midi!) % 12) + 12) % 12) !== 1) continue;
          if (Math.abs(x.midi! - y.midi!) > 13) continue;
          clashes.push(x, y);
        }
      if (clashes.length >= 3)
        emit(
          "MINOR_SECOND_CLASH",
          [idA, idB],
          Math.min(...clashes.map((e) => beatOf(e))),
          Math.max(...clashes.map((e) => beatOf(e) + e.durationTicks / c.ppq)),
          clashes,
          { pairs: clashes.length / 2 },
          "Repeated semitone collisions between two tracks",
          ["Separate the registers or move one part to a chord tone."],
          "info",
        );
    }

  return findings;
}
