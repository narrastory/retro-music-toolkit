import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ScoreSchema, ScoreError } from "../src/model.js";
import { compileScore } from "../src/compiler.js";
import { diagnoseScore } from "../src/diagnostics.js";
import {
  developMotif,
  harmonizeScore,
  arpeggiatePattern,
} from "../src/composition.js";
import { patchScoreWithReport } from "../src/patch.js";
import {
  describeScore,
  renderPianoRoll,
  buildReportHtml,
} from "../src/report.js";

const base = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.3",
  title: "Test",
  profile: "nes-inspired",
  tempo: 120,
  meter: [4, 4],
  lengthBeats: 8,
  seed: 1,
  key: { tonic: "C", mode: "major" },
  harmony: [
    { at: 0, chord: "C" },
    { at: 4, chord: "G" },
  ],
  sections: [{ id: "A1", label: "A", at: 0, lengthBeats: 8 }],
  tracks: [
    {
      id: "lead",
      role: "melody",
      instrument: "pulse-lead-soft",
      maxVoices: 1,
      voicePolicy: "cut",
      patterns: {
        A: {
          lengthBeats: 4,
          events: [
            {
              id: "n1",
              kind: "note",
              at: 0,
              pitch: "C5",
              duration: 2,
              gate: 1,
            },
            {
              id: "n2",
              kind: "note",
              at: 2,
              pitch: "E5",
              duration: 2,
              gate: 1,
            },
          ],
        },
      },
      clips: [
        { id: "c1", pattern: "A", at: 0 },
        { id: "c2", pattern: "A", at: 4 },
      ],
    },
  ],
  export: { mode: "one-shot" },
  ...overrides,
});

test("committed JSON Schema matches the runtime Zod schema", () => {
  const committed = JSON.parse(
    readFileSync(
      new URL("../schema/score.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const generated = JSON.parse(JSON.stringify(z.toJSONSchema(ScoreSchema)));
  assert.deepEqual(
    committed,
    generated,
    "schema/score.schema.json is stale; run `npm run schema -- --force`",
  );
});

test("drum hits never steal voices from each other", () => {
  const score: any = base();
  score.tracks = [
    {
      id: "drums",
      role: "drums",
      instrument: "chip-drums",
      maxVoices: 1,
      voicePolicy: "error",
      patterns: {
        a: {
          lengthBeats: 4,
          events: [
            { id: "k", kind: "hit", at: 0, sound: "kick" },
            { id: "s", kind: "hit", at: 0, sound: "snare" },
            { id: "h", kind: "hit", at: 0, sound: "hat" },
            { id: "h2", kind: "hit", at: 0.25, sound: "hat" },
          ],
        },
      },
      clips: [{ id: "c", pattern: "a", at: 0 }],
    },
  ];
  // Previously this threw VOICE_OVERLAP, and with policy "cut" silently
  // truncated the stolen hit to zero length.
  const c = compileScore(score);
  assert.equal(c.events.length, 4);
  assert.ok(
    c.events.every((e) => e.keyEndTick > e.tick),
    "no drum hit may be reduced to zero length",
  );
});

test("default voicePolicy is cut so ordinary melodies compile", () => {
  const score: any = base();
  delete score.tracks[0].voicePolicy;
  // Notes with long release and a short gap must not be a hard error by default.
  score.tracks[0].instrument = "sample-strings";
  score.tracks[0].patterns.A.events = [
    { id: "a", kind: "note", at: 0, pitch: "C5", duration: 0.5 },
    { id: "b", kind: "note", at: 0.5, pitch: "D5", duration: 0.5 },
  ];
  const c = compileScore(score);
  assert.equal(c.score.tracks[0]!.voicePolicy, "cut");
  const codes = c.diagnostics.map((d) => d.code);
  assert.ok(codes.includes("RELEASE_CUT"));
  assert.ok(!c.diagnostics.some((d) => d.severity === "error"));
});

test("release-tail overlap is distinguished from a real voice conflict", () => {
  const score: any = base();
  score.tracks[0].voicePolicy = "error";
  score.tracks[0].instrument = "sample-strings";
  score.tracks[0].patterns.A.events = [
    { id: "a", kind: "note", at: 0, pitch: "C5", duration: 0.5 },
    { id: "b", kind: "note", at: 0.5, pitch: "D5", duration: 0.5 },
  ];
  try {
    compileScore(score);
    assert.fail("expected a release overlap error");
  } catch (e) {
    assert.ok(e instanceof ScoreError);
    const codes = e.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("RELEASE_OVERLAP"));
    assert.ok(!codes.includes("VOICE_OVERLAP"));
    const d = e.diagnostics.find((x) => x.code === "RELEASE_OVERLAP")!;
    assert.ok(d.beat !== undefined);
  }
});

test("hold sustains across the pattern boundary", () => {
  const score: any = base();
  score.tracks[0].patterns.A.lengthBeats = 2;
  score.tracks[0].patterns.A.events = [
    { id: "long", kind: "note", at: 0, pitch: "C5", duration: 4, hold: true },
  ];
  score.tracks[0].clips = [{ id: "c1", pattern: "A", at: 0 }];
  score.lengthBeats = 8;
  score.sections = [{ id: "A1", label: "A", at: 0, lengthBeats: 8 }];
  const c = compileScore(score);
  // Held to the next event (pattern end), i.e. 2 beats, not the nominal 4.
  assert.equal(c.events[0]!.keyEndTick, 1920);
});

test("crossing the pattern boundary without hold suggests a repair", () => {
  const score: any = base();
  score.tracks[0].patterns.A.events = [
    { id: "x", kind: "note", at: 3, pitch: "C5", duration: 4 },
  ];
  try {
    compileScore(score);
    assert.fail("expected EVENT_BOUNDS");
  } catch (e) {
    const d = (e as ScoreError).diagnostics.find(
      (x) => x.code === "EVENT_BOUNDS",
    )!;
    assert.deepEqual(d.suggestion, { hold: true, maxDuration: 1 });
  }
});

test("clip lengthBeats crops the clip", () => {
  const score: any = base();
  score.tracks[0].clips = [{ id: "c1", pattern: "A", at: 0, lengthBeats: 2 }];
  const c = compileScore(score);
  assert.equal(c.events.length, 1);
  assert.equal(c.events[0]!.sourceId, "n1");
});

test("swing delays only the off-beat of each pair, deterministically", () => {
  const score: any = base();
  score.tracks[0].patterns.A.events = [0, 0.5, 1, 1.5].map((at, i) => ({
    id: `s${i}`,
    kind: "note",
    at,
    pitch: "C5",
    duration: 0.25,
    gate: 1,
  }));
  score.tracks[0].swing = 1;
  const ticks = compileScore(score).events.map((e) => e.tick);
  // Full swing moves an eighth to 2/3 of the beat; down-beats stay put.
  // The fixture has two clips, so the pattern appears twice.
  assert.deepEqual(ticks, [0, 640, 960, 1600, 3840, 4480, 4800, 5440]);
});

test("humanize is reproducible for the same seed", () => {
  const score: any = base();
  score.tracks[0].humanize = { timingBeats: 0.02, velocity: 0.1 };
  const a = compileScore(score).events.map((e) => [e.tick, e.velocity]);
  const b = compileScore(score).events.map((e) => [e.tick, e.velocity]);
  assert.deepEqual(a, b);
  const clean = compileScore({ ...base() }).events.map((e) => [
    e.tick,
    e.velocity,
  ]);
  assert.notDeepEqual(a, clean);
});

test("harmonic diagnostics read the harmony markers and declared key", () => {
  const score: any = base();
  score.tracks[0].patterns.A.events = [
    { id: "clash", kind: "note", at: 0, pitch: "C#5", duration: 2, hold: true },
    { id: "ok", kind: "note", at: 2, pitch: "E5", duration: 1, gate: 1 },
  ];
  score.tracks[0].clips = [{ id: "c1", pattern: "A", at: 0 }];
  const result = diagnoseScore(score);
  const rules = new Set(result.findings.map((f) => f.rule));
  assert.ok(rules.has("HARMONY_NON_CHORD_TONE"));
  assert.ok(rules.has("OUT_OF_KEY"));
  assert.equal(result.metrics.key, "C major");
  const finding = result.findings.find(
    (f) => f.rule === "HARMONY_NON_CHORD_TONE",
  )!;
  assert.ok(finding.bar >= 1);
  assert.ok(finding.sourceEventIds.includes("clash"));
});

test("diagnostic windows follow the meter instead of hardcoded 4-beat bars", () => {
  const sixEight = diagnoseScore({
    ...base(),
    meter: [6, 8],
    lengthBeats: 12,
    sections: [{ id: "A1", label: "A", at: 0, lengthBeats: 12 }],
    tracks: [
      {
        id: "lead",
        role: "melody",
        instrument: "pulse-lead-soft",
        maxVoices: 1,
        voicePolicy: "cut",
        patterns: {
          A: {
            lengthBeats: 12,
            events: [
              { id: "a", kind: "note", at: 0, pitch: "C5", duration: 1 },
              { id: "b", kind: "note", at: 3, pitch: "D5", duration: 1 },
              { id: "c", kind: "note", at: 6, pitch: "E5", duration: 1 },
              { id: "d", kind: "note", at: 9, pitch: "F5", duration: 1 },
            ],
          },
        },
        clips: [{ id: "c1", pattern: "A", at: 0 }],
      },
    ],
  });
  assert.equal(sixEight.metrics.barBeats, 3);
  assert.equal(sixEight.metrics.windowBeats, 3);
});

test("motif operators transform only the selected region", () => {
  const result = developMotif(base(), {
    trackId: "lead",
    clipId: "c2",
    newPattern: "A-inv",
    fromBeat: 0,
    toBeat: 4,
    operators: [{ op: "invert" }],
  });
  const pattern = result.score.tracks[0]!.patterns["A-inv"]!;
  const pitches = pattern.events
    .filter((e) => e.kind === "note")
    .map((e) => (e.kind === "note" ? e.pitch : ""));
  // The axis defaults to the first selected note (C5 = MIDI 72), so C5 stays
  // and E5 (76) mirrors to 68 = G#4.
  assert.deepEqual(pitches, ["C5", "G#4"]);
  // The source pattern is untouched.
  const original = result.score.tracks[0]!.patterns.A!;
  assert.deepEqual(
    original.events.map((e) => (e.kind === "note" ? e.pitch : "")),
    ["C5", "E5"],
  );
});

test("diatonic transpose needs a declared key", () => {
  const score: any = base();
  delete score.key;
  assert.throws(
    () =>
      developMotif(score, {
        trackId: "lead",
        clipId: "c1",
        newPattern: "x",
        fromBeat: 0,
        toBeat: 4,
        operators: [{ op: "transpose", degrees: 2 }],
      }),
    /NO_KEY/,
  );
});

test("harmonize builds a track from chord markers", () => {
  const result = harmonizeScore(base(), {
    style: "close",
    anchorMidi: 60,
    idPrefix: "h",
  });
  const harmony = result.score.tracks.find((t) => t.id === "harmony")!;
  const events = harmony.patterns.harmony!.events;
  // C major then G major, three voices each.
  assert.equal(events.length, 6);
  const first = events
    .slice(0, 3)
    .map((e) => (e.kind === "note" ? e.pitch : ""));
  assert.deepEqual(first, ["C4", "E4", "G4"]);
});

test("harmonize reports a missing harmony track instead of inventing one", () => {
  const score: any = base();
  score.harmony = [];
  assert.throws(() => harmonizeScore(score, {}), /NO_HARMONY/);
});

test("arpeggiate expands chord tones over the source pattern", () => {
  const score: any = base();
  score.tracks[0].patterns.A.events = [
    { id: "c", kind: "note", at: 0, pitch: "C5", duration: 2, gate: 1 },
    { id: "e", kind: "note", at: 0, pitch: "E5", duration: 2, gate: 1 },
    { id: "g", kind: "note", at: 0, pitch: "G5", duration: 2, gate: 1 },
    { id: "x", kind: "note", at: 2, pitch: "D5", duration: 2, gate: 1 },
  ];
  const result = arpeggiatePattern(score, {
    trackId: "lead",
    clipId: "c1",
    newPattern: "arpA",
    pattern: "up",
    stepBeats: 0.25,
    octaves: 1,
  });
  const generated = result.score.tracks[0]!.patterns.arpA!;
  // 2 beats at 0.25 step = 8 notes for the triad, 8 for the single note.
  assert.equal(generated.events.length, 16);
  const firstTriad = generated.events
    .slice(0, 3)
    .map((e) => (e.kind === "note" ? e.pitch : ""));
  assert.deepEqual(firstTriad, ["C5", "E5", "G5"]);
});

test("quantize snaps to the grid and respects pattern bounds", () => {
  const score: any = base();
  score.tracks[0].patterns.A.events = [
    { id: "a", kind: "note", at: 0.06, pitch: "C5", duration: 0.5, gate: 1 },
    { id: "b", kind: "note", at: 1.94, pitch: "D5", duration: 0.5, gate: 1 },
  ];
  const result = patchScoreWithReport(score, {
    operations: [
      {
        op: "quantize",
        trackId: "lead",
        pattern: "A",
        grid: 0.25,
      },
    ],
  });
  const events = result.score.tracks[0]!.patterns.A!.events;
  assert.deepEqual(
    events.map((e) => e.at),
    [0, 2],
  );
});

test("patch reports a machine-readable change log", () => {
  const result = patchScoreWithReport(base(), {
    operations: [
      {
        op: "set-note",
        trackId: "lead",
        pattern: "A",
        eventId: "n1",
        set: { pitch: "D5" },
      },
    ],
  });
  const change = result.report.changes.find((c) => c.path.endsWith("pitch"));
  assert.ok(
    change,
    `expected a pitch change, got ${JSON.stringify(result.report.changes)}`,
  );
  assert.match(change.detail!, /C5.*D5/);
  // The fixture pattern holds two source events; this counts authored events,
  // not the expanded per-clip instances.
  assert.equal(result.report.summary.eventsBefore, 2);
});

test("section overlap is rejected at validation time", () => {
  const score: any = base();
  score.sections = [
    { id: "A", at: 0, lengthBeats: 6 },
    { id: "B", at: 4, lengthBeats: 4 },
  ];
  try {
    compileScore(score);
    assert.fail("expected SECTION_OVERLAP");
  } catch (e) {
    assert.ok(
      (e as ScoreError).diagnostics.some((d) => d.code === "SECTION_OVERLAP"),
    );
  }
});

test("sample zone coverage is reported by validate rather than thrown by render", () => {
  const score: any = base();
  score.instrumentDefinitions = [
    {
      id: "narrow",
      engine: "sample",
      role: "melody",
      range: [48, 96],
      attack: 0.01,
      release: 0.1,
      description: "narrow zone",
      sample: {
        kind: "zones",
        zones: [
          {
            lowMidi: 60,
            highMidi: 64,
            rootMidi: 60,
            assetId: "a1",
          },
        ],
      },
    },
  ];
  // No asset and a note outside the zone: both must be reported by validate.
  score.tracks[0].instrument = "narrow";
  score.tracks[0].clips = [{ id: "c1", pattern: "A", at: 0, transpose: 12 }];
  try {
    compileScore(score);
    assert.fail("expected validation errors");
  } catch (e) {
    const codes = (e as ScoreError).diagnostics.map((d) => d.code);
    assert.ok(codes.includes("SAMPLE_REFERENCE"));
    assert.ok(codes.includes("SAMPLE_ZONE_RANGE"));
  }
});

test("drum kits require slots that exist in the kit", () => {
  const score: any = base();
  score.instrumentDefinitions = [
    {
      id: "kit",
      engine: "drums",
      role: "drums",
      range: [0, 127],
      attack: 0,
      release: 0,
      description: "partial kit",
      drumKit: { slots: [{ sound: "kick", assetId: "k1" }] },
    },
  ];
  score.tracks = [
    {
      id: "drums",
      role: "drums",
      instrument: "kit",
      patterns: {
        a: {
          lengthBeats: 4,
          events: [
            { id: "k", kind: "hit", at: 0, sound: "kick" },
            { id: "s", kind: "hit", at: 1, sound: "snare" },
          ],
        },
      },
      clips: [{ id: "c", pattern: "a", at: 0 }],
    },
  ];
  try {
    compileScore(score);
    assert.fail("expected SAMPLE_REFERENCE");
  } catch (e) {
    const diags = (e as ScoreError).diagnostics;
    assert.ok(diags.some((d) => d.code === "SAMPLE_REFERENCE"));
  }
});

/* ---------------- 1.0 first-tier additions ---------------- */

const chordScore = (over: Record<string, unknown> = {}) => {
  const score: any = base();
  score.lengthBeats = 8;
  score.tracks[0].patterns.A = {
    lengthBeats: 8,
    events: [
      { id: "c", kind: "note", at: 0, pitch: "C5", duration: 2, gate: 1 },
      { id: "e", kind: "note", at: 0, pitch: "E5", duration: 2, gate: 1 },
      { id: "g", kind: "note", at: 0, pitch: "G5", duration: 2, gate: 1 },
    ],
  };
  score.tracks[0].clips = [{ id: "c1", pattern: "A", at: 0 }];
  return { ...score, ...over };
};

test("single-voice arpeggio turns a chord into one sounding voice", () => {
  const plain = compileScore(chordScore());
  assert.ok(
    plain.diagnostics.some((d) => d.code === "VOICE_STEAL"),
    "without arpeggio the one-voice track must steal",
  );
  const score = chordScore();
  score.tracks[0].arpeggio = {
    enabled: true,
    rate: 16,
    gate: 1,
    order: "up",
  };
  const c = compileScore(score);
  // 16 steps per beat over 2 beats.
  assert.equal(c.events.length, 32);
  assert.equal(new Set(c.events.map((e) => e.voice)).size, 1);
  assert.equal(c.diagnostics.filter((d) => d.code === "VOICE_STEAL").length, 0);
  // Steps are one sixteenth apart and cycle the chord tones.
  assert.deepEqual(
    c.events.slice(0, 4).map((e) => e.tick),
    [0, 60, 120, 180],
  );
  assert.deepEqual(
    [...new Set(c.events.slice(0, 3).map((e) => e.midi))],
    [72, 76, 79],
  );
});

test("arpeggio order controls the pitch cycle", () => {
  const score = chordScore();
  score.tracks[0].arpeggio = {
    enabled: true,
    rate: 8,
    gate: 1,
    order: "down",
  };
  const c = compileScore(score);
  assert.deepEqual(
    c.events.slice(0, 3).map((e) => e.midi),
    [79, 76, 72],
  );
});

test("arpeggio can be disabled without changing anything else", () => {
  const score = chordScore();
  score.tracks[0].arpeggio = {
    enabled: false,
    rate: 16,
    gate: 1,
    order: "up",
  };
  const c = compileScore(score);
  assert.equal(c.events.length, 3);
});

test("authenticity defaults to modern and is echoed by the compiled score", () => {
  assert.equal(compileScore(base()).score.authenticity, "modern");
  const c = compileScore({ ...base(), authenticity: "hardware" });
  assert.equal(c.score.authenticity, "hardware");
});

test("loop closure flags a seam that does not lead back to the opening chord", () => {
  const bad = diagnoseScore({
    ...base(),
    export: { mode: "loop" },
    harmony: [
      { at: 0, chord: "C" },
      { at: 4, chord: "Am" },
    ],
  });
  const finding = bad.findings.find((f) => f.rule === "LOOP_HARMONY_RETURN");
  assert.ok(finding, "expected LOOP_HARMONY_RETURN");
  assert.equal(finding.severity, "warning");

  const good = diagnoseScore({
    ...base(),
    export: { mode: "loop" },
    harmony: [
      { at: 0, chord: "C" },
      { at: 4, chord: "G7" },
    ],
  });
  assert.ok(!good.findings.some((f) => f.rule === "LOOP_HARMONY_RETURN"));
});

test("loop closure is not checked for one-shot exports", () => {
  const result = diagnoseScore({
    ...base(),
    export: { mode: "one-shot" },
    harmony: [
      { at: 0, chord: "C" },
      { at: 4, chord: "Am" },
    ],
  });
  assert.ok(!result.findings.some((f) => f.rule === "LOOP_HARMONY_RETURN"));
});

test("describeScore reports register, density and section change", () => {
  const text = describeScore(compileScore(base()));
  assert.match(text, /C major/);
  assert.match(text, /lead \(pulse-lead-soft, melody\)/);
  assert.match(text, /range C5–E5/);
  assert.match(text, /Sections:/);
  assert.match(text, /Harmony: C@0 → G@4/);
});

test("piano roll SVG contains notes, bar lines and a legend", () => {
  const svg = renderPianoRoll(compileScore(base()));
  assert.match(svg, /^<svg /);
  assert.match(svg, /<rect /);
  assert.match(svg, /class="bar"/);
  assert.match(svg, /lead<\/text>/);
});

test("piano roll renders drum kits on their own rows", () => {
  const score: any = base();
  score.tracks.push({
    id: "drums",
    role: "drums",
    instrument: "chip-drums",
    maxVoices: 1,
    voicePolicy: "cut",
    patterns: {
      d: {
        lengthBeats: 8,
        events: [
          { id: "k", kind: "hit", at: 0, sound: "kick" },
          { id: "h", kind: "hit", at: 1, sound: "hat" },
        ],
      },
    },
    clips: [{ id: "dc", pattern: "d", at: 0 }],
  });
  const svg = renderPianoRoll(compileScore(score));
  assert.match(svg, />kick<\/text>/);
  assert.match(svg, />hat<\/text>/);
});

test("report HTML embeds the roll and escapes the title", () => {
  const score: any = base();
  score.title = "<script>alert(1)</script>";
  const html = buildReportHtml(compileScore(score));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<svg /);
  assert.match(html, /Structure/);
});
