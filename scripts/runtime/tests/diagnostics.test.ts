import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseScore, RULES } from "../src/diagnostics.js";
import { fixture } from "./helpers.js";
function dense() {
  const s = fixture();
  s.lengthBeats = 16;
  s.tracks[0]!.patterns.a.lengthBeats = 16;
  s.tracks[0]!.patterns.a.events = Array.from({ length: 32 }, (_, i) => ({
    id: `n${i}`,
    kind: "note",
    at: i * 0.5,
    pitch: "C5",
    duration: 0.5,
    gate: 1,
  }));
  return s;
}
test("no-breath finding gives source IDs, beat range and suggestions", () => {
  const r = diagnoseScore(dense());
  const f = r.findings.find((f) => f.rule === "MELODY_NO_BREATH")!;
  assert.equal(f.fromBeat, 0);
  assert.equal(f.toBeat, 8);
  assert.ok(f.sourceEventIds.includes("n0"));
  assert.equal(f.bar, 1);
  assert.ok(f.suggestions.length);
});
test("register crowding requires density and simultaneous key time", () => {
  const s = dense(),
    t = structuredClone(s.tracks[0]!);
  Object.assign(t, { id: "arp", role: "arp" });
  t.clips[0]!.id = "arp-clip";
  t.patterns.a.events.forEach((e) => (e.id = "arp-" + e.id));
  s.tracks.push(t);
  const r = diagnoseScore(s);
  assert.ok(
    r.findings.some(
      (f) => f.rule === "REGISTER_CROWDING" && f.trackIds.length === 2,
    ),
  );
});
test("all rules can be disabled without hiding compile errors", () => {
  assert.equal(
    diagnoseScore(dense(), { disabledRules: [...RULES] }).findings.length,
    0,
  );
  assert.throws(() => diagnoseScore({}, {}));
  assert.throws(() => diagnoseScore(dense(), { disabledRules: ["TYPO"] }));
});
test("short sample-string notes detected; ordinary sparse melody not overflagged", () => {
  const s = fixture("sample-strings", "snes-inspired");
  s.tracks[0]!.patterns.a.events.forEach((e) => (e.duration = 0.0625));
  assert.ok(
    diagnoseScore(s).findings.some((f) => f.rule === "SLOW_ATTACK_NOTES"),
  );
  assert.equal(diagnoseScore(fixture()).findings.length, 0);
});
test("section similarity is advisory; density changes remove the finding", () => {
  const s = dense();
  Object.assign(s, {
    sections: [
      { id: "A", at: 0, lengthBeats: 8 },
      { id: "B", at: 8, lengthBeats: 8 },
    ],
  });
  assert.ok(
    diagnoseScore(s).findings.some((f) => f.rule === "SECTION_SIMILARITY"),
  );
  s.tracks[0]!.patterns.a.events = s.tracks[0]!.patterns.a.events.filter(
    (e) => e.at < 8 || e.at === 8,
  );
  assert.ok(
    !diagnoseScore(s).findings.some((f) => f.rule === "SECTION_SIMILARITY"),
  );
});
test("thresholds are configurable and unknown fields rejected", () => {
  assert.ok(
    !diagnoseScore(dense(), {
      thresholds: { breathGapBeats: 0.01, noBreathSpanBeats: 32 },
    }).findings.some((f) => f.rule === "MELODY_NO_BREATH"),
  );
  assert.throws(() => diagnoseScore(fixture(), { thresholds: { typo: 1 } }));
});
test("hat density threshold responds to real hit spacing", () => {
  const s = fixture("chip-drums");
  Object.assign(s.tracks[0]!, { role: "drums" });
  s.tracks[0]!.patterns.a.events = Array.from({ length: 32 }, (_, i) => ({
    id: `hat-${i}`,
    kind: "hit",
    at: i / 8,
    sound: "hat",
    velocity: 0.3,
  })) as any;
  assert.ok(
    diagnoseScore(s).findings.some((f) => f.rule === "PERCUSSION_DENSITY"),
  );
  assert.ok(
    !diagnoseScore(s, { thresholds: { hatHitsPerBeat: 16 } }).findings.some(
      (f) => f.rule === "PERCUSSION_DENSITY",
    ),
  );
});
test("motif heuristic distinguishes exact transposed repetition from varying intervals", () => {
  const s = fixture();
  s.lengthBeats = 16;
  s.tracks[0]!.patterns.a.lengthBeats = 16;
  s.tracks[0]!.patterns.a.events = Array.from({ length: 8 }, (_, i) => ({
    id: `theme-${i}`,
    kind: "note",
    at: Math.floor(i / 2) * 4 + (i % 2) * 0.5,
    pitch: i % 2 ? ["C#5", "D5", "D#5", "E5"][Math.floor(i / 2)]! : "C5",
    duration: 0.25,
  }));
  assert.ok(diagnoseScore(s).findings.some((f) => f.rule === "MOTIF_VARIETY"));
  s.tracks[0]!.patterns.a.events.forEach((e, i) => {
    if (i % 2) e.pitch = "E5";
  });
  assert.ok(!diagnoseScore(s).findings.some((f) => f.rule === "MOTIF_VARIETY"));
});

test("harmony checks judge humanized notes at their written beat", () => {
  const s: any = fixture();
  s.schemaVersion = "1.3";
  s.lengthBeats = 8;
  s.harmony = [
    { at: 0, chord: "C" },
    { at: 4, chord: "F" },
  ];
  s.tracks[0].role = "bass";
  s.tracks[0].instrument = "triangle-bass";
  s.tracks[0].humanize = { timingBeats: 0.01, velocity: 0 };
  s.tracks[0].patterns.a = {
    lengthBeats: 8,
    events: [
      { id: "c", kind: "note", at: 0, pitch: "C3", duration: 3.5 },
      { id: "f", kind: "note", at: 4, pitch: "F2", duration: 3.5 },
    ],
  };
  // Any seed whose jitter pulls the F early would have been judged against C.
  for (let seed = 1; seed <= 20; seed++) {
    s.seed = seed;
    const findings = diagnoseScore(s).findings.filter(
      (f: any) => f.rule === "BASS_NON_CHORD_TONE",
    );
    assert.deepEqual(findings, [], `seed ${seed}`);
  }
});
