import { test } from "node:test";
import assert from "node:assert/strict";
import { patchScore, PatchSchema } from "../src/patch.js";
import { compileScore } from "../src/compiler.js";
import { fixture } from "./helpers.js";
const apply = (s: unknown, ...operations: unknown[]) =>
  patchScore(s, { operations });
test("pitch-only update preserves gate and velocity, no injected defaults", () => {
  const s = fixture();
  Object.assign(s.tracks[0]!.patterns.a.events[0]!, {
    gate: 0.45,
    velocity: 0.23,
  });
  const n = apply(s, {
    op: "set-note",
    trackId: "lead",
    pattern: "a",
    eventId: "n1",
    set: { pitch: "D5" },
  });
  assert.equal(n.tracks[0]!.patterns.a!.events[0]!.velocity, 0.23);
  assert.equal((n.tracks[0]!.patterns.a!.events[0] as any).gate, 0.45);
  assert.deepEqual(
    PatchSchema.parse({
      operations: [
        {
          op: "set-note",
          trackId: "lead",
          pattern: "a",
          eventId: "n1",
          set: { pitch: "D5" },
        },
      ],
    }).operations[0]!.set,
    { pitch: "D5" },
  );
});
test("nested mixer updates preserve omitted fields", () => {
  const s = fixture();
  Object.assign(s, {
    mixer: { masterDb: -13, feedback: 0.3, delayBeats: 1.5, returnDb: -18 },
  });
  const n = apply(s, { op: "set-song", set: { mixer: { feedback: 0.1 } } });
  assert.deepEqual(n.mixer, {
    masterDb: -13,
    feedback: 0.1,
    delayBeats: 1.5,
    returnDb: -18,
  });
});
test("track update preserves controls and pan", () => {
  const s = fixture();
  Object.assign(s.tracks[0]!, {
    pan: -0.4,
    send: 0.2,
    controls: { brightness: 0.9, pluckiness: 0.1 },
  });
  const n = apply(s, {
    op: "set-track",
    trackId: "lead",
    set: { gainDb: -12, controls: { brightness: 0.3 } },
  });
  assert.equal(n.tracks[0]!.pan, -0.4);
  assert.equal(n.tracks[0]!.controls.pluckiness, 0.1);
  assert.equal(n.tracks[0]!.controls.brightness, 0.3);
});
test("insert/delete events round trip and source remains unchanged", () => {
  const s = fixture();
  const n = apply(
    s,
    {
      op: "insert-events",
      trackId: "lead",
      pattern: "a",
      events: [{ id: "new", kind: "note", at: 3, pitch: "D5", duration: 0.25 }],
    },
    { op: "delete-events", trackId: "lead", pattern: "a", eventIds: ["n2"] },
  );
  assert.deepEqual(
    n.tracks[0]!.patterns.a!.events.map((e) => e.id),
    ["n1", "n3", "new"],
  );
  assert.equal(s.tracks[0]!.patterns.a.events.length, 3);
});
test("duplicate insertion and unknown delete fail atomically", () => {
  const s = fixture();
  assert.throws(() =>
    apply(s, {
      op: "insert-events",
      trackId: "lead",
      pattern: "a",
      events: [{ id: "n1", kind: "note", at: 3, pitch: "D5", duration: 0.25 }],
    }),
  );
  assert.throws(
    () =>
      apply(s, {
        op: "delete-events",
        trackId: "lead",
        pattern: "a",
        eventIds: ["missing"],
      }),
    /EVENT_NOT_FOUND/,
  );
  assert.equal(s.tracks[0]!.patterns.a.events.length, 3);
});
test("clone only one clip and keep other references unchanged", () => {
  const s = fixture();
  s.lengthBeats = 8;
  s.tracks[0]!.clips.push({ id: "clip-b", pattern: "a", at: 4 });
  const n = apply(s, {
    op: "clone-pattern-for-clip",
    trackId: "lead",
    clipId: "clip-b",
    newPattern: "answer",
  });
  assert.equal(n.tracks[0]!.clips[0]!.pattern, "a");
  assert.equal(n.tracks[0]!.clips[1]!.pattern, "answer");
  assert.notEqual(
    n.tracks[0]!.patterns.a!.events[0]!.id,
    n.tracks[0]!.patterns.answer!.events[0]!.id,
  );
});
test("transpose uses onset selection [from,to) and preserves rhythm", () => {
  const n = apply(fixture(), {
    op: "transpose-phrase",
    trackId: "lead",
    pattern: "a",
    fromBeat: 0,
    toBeat: 1,
    semitones: 2,
  });
  assert.equal((n.tracks[0]!.patterns.a!.events[0] as any).pitch, "D5");
  assert.equal((n.tracks[0]!.patterns.a!.events[1] as any).pitch, "E5");
  assert.equal(n.tracks[0]!.patterns.a!.events[0]!.at, 0);
  assert.throws(
    () =>
      apply(fixture(), {
        op: "transpose-phrase",
        trackId: "lead",
        pattern: "a",
        fromBeat: 3,
        toBeat: 4,
        semitones: 2,
      }),
    /EMPTY_PHRASE/,
  );
});
test("scale pattern rhythm expands repeat spacing with explicit bounds checking", () => {
  const s = fixture();
  s.lengthBeats = 8;
  const n = apply(s, {
    op: "scale-rhythm",
    trackId: "lead",
    pattern: "a",
    factor: 2,
  });
  assert.equal(n.tracks[0]!.patterns.a!.lengthBeats, 8);
  assert.equal(n.tracks[0]!.patterns.a!.events[1]!.at, 2);
  assert.throws(() =>
    apply(fixture(), {
      op: "scale-rhythm",
      trackId: "lead",
      pattern: "a",
      factor: 2,
    }),
  );
});
test("duplicate section reuses motifs and allocates new clip IDs", () => {
  const s = fixture();
  Object.assign(s, {
    sections: [{ id: "A", at: 0, lengthBeats: 4 }],
    harmony: [{ at: 0, chord: "C" }],
  });
  const n = apply(s, {
    op: "duplicate-section",
    sectionId: "A",
    newSectionId: "A2",
    at: 4,
    expandSong: true,
  });
  assert.equal(n.lengthBeats, 8);
  assert.equal(n.tracks[0]!.clips[1]!.pattern, "a");
  assert.equal(n.harmony[1]!.at, 4);
  assert.equal(n.sections[1]!.id, "A2");
  assert.equal(compileScore(n).events.length, 6);
});
test("section duplicate rejects occupied destinations and crossing clips", () => {
  const s = fixture();
  Object.assign(s, { sections: [{ id: "A", at: 0, lengthBeats: 2 }] });
  assert.throws(
    () =>
      apply(s, {
        op: "duplicate-section",
        sectionId: "A",
        newSectionId: "A2",
        at: 4,
        expandSong: true,
      }),
    /CROSSES_CLIP/,
  );
  Object.assign(s, { sections: [{ id: "A", at: 0, lengthBeats: 4 }] });
  assert.throws(
    () =>
      apply(s, {
        op: "duplicate-section",
        sectionId: "A",
        newSectionId: "A2",
        at: 2,
        expandSong: true,
      }),
    /DESTINATION_OCCUPIED/,
  );
});
test("loop allocator uses a spare lane before truncating a tail", () => {
  const s = fixture("sample-strings", "snes-inspired");
  s.tracks[0]!.maxVoices = 2;
  s.tracks[0]!.voicePolicy = "error";
  s.tracks[0]!.patterns.a.events = [
    { id: "first", kind: "note", at: 0, pitch: "C5", duration: 0.25 },
    { id: "last", kind: "note", at: 3.75, pitch: "E5", duration: 0.25 },
  ];
  const c = compileScore(s);
  assert.notEqual(c.events[0]!.voice, c.events[1]!.voice);
  assert.equal(c.diagnostics.filter((d) => d.severity === "error").length, 0);
});
