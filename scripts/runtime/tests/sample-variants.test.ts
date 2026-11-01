import { test } from "node:test";
import assert from "node:assert/strict";
import { compileScore } from "../src/compiler.js";
import { findZone } from "../src/instrument-model.js";
import { layeredFixture } from "./sample-variant-helpers.js";
test("sample layers select inclusive MIDI velocity bounds and round robin cycles per layer", () => {
  const s = layeredFixture(),
    c = compileScore(s),
    p = c.score.instrumentDefinitions![0]!;
  assert.equal(findZone(p, 60, 64 / 127)?.lowVelocity, 1);
  assert.equal(findZone(p, 60, 65 / 127)?.lowVelocity, 65);
  const indices = c.events.map((e) => e.sampleZoneIndex!);
  assert.deepEqual(indices.slice(0, 4), [
    indices[0],
    1 - indices[0]!,
    indices[0],
    1 - indices[0]!,
  ]);
  assert.ok(indices.slice(4).every((i) => i === 2 || i === 3));
  assert.notEqual(indices[4], indices[5]);
  assert.deepEqual(compileScore(s).events, c.events);
  const changed = structuredClone(s);
  changed.seed = 428;
  assert.notDeepEqual(
    compileScore(changed).events.map((e) => e.sampleZoneIndex),
    indices,
  );
});
test("drum variants use the same velocity and seed-controlled round-robin rules", () => {
  const c = compileScore(layeredFixture(true));
  const slots = c.score.instrumentDefinitions![0]!.drumKit!.slots;
  const indices = c.events.map((e) => e.sampleDrumSlotIndex!);
  assert.ok(indices.slice(0, 4).every((i) => slots[i]!.highVelocity === 64));
  assert.ok(indices.slice(4).every((i) => slots[i]!.lowVelocity === 65));
  assert.notEqual(indices[0], indices[1]);
  assert.equal(indices[0], indices[2]);
});
test("clip velocity selects the effective layer; silent notes do not consume round robin", () => {
  const s = layeredFixture();
  s.tracks[0].clips[0].velocityScale = 0.4;
  assert.ok(compileScore(s).events.every((e) => e.sampleZoneIndex! < 2));
  const original = layeredFixture();
  const base = compileScore(original).events.map((e) => e.sampleZoneIndex);
  original.tracks[0].patterns.a.events.unshift({
    id: "silent",
    kind: "note",
    at: 0.25,
    pitch: "C4",
    duration: 0.1,
    velocity: 0,
  });
  assert.deepEqual(
    compileScore(original)
      .events.filter((e) => e.velocity > 0)
      .map((e) => e.sampleZoneIndex),
    base,
  );
});
test("ambiguous overlapping maps fail but disjoint velocity layers and RR alternatives compile", () => {
  const s = layeredFixture();
  assert.doesNotThrow(() => compileScore(s));
  s.instrumentDefinitions[0].sample.zones[1].roundRobin = 1;
  assert.throws(() => compileScore(s), /Score validation failed/);
  const d = layeredFixture(true);
  d.instrumentDefinitions[0].drumKit.slots[2].lowVelocity = 64;
  assert.throws(() => compileScore(d), /Score validation failed/);
});
test("sample legato retains the current RR sample and rejects a velocity-layer switch", () => {
  const s = layeredFixture();
  s.tracks[0].patterns.a.events = [
    {
      id: "first",
      kind: "note",
      at: 0,
      pitch: "C4",
      duration: 1,
      hold: true,
      velocity: 0.4,
    },
    {
      id: "second",
      kind: "note",
      at: 1,
      pitch: "D4",
      duration: 1,
      articulation: "legato",
      velocity: 0.4,
    },
  ];
  const events = compileScore(s).events;
  assert.equal(events[0]!.sampleZoneIndex, events[1]!.sampleZoneIndex);
  s.tracks[0].patterns.a.events[1].velocity = 0.8;
  assert.throws(() => compileScore(s), /Score validation failed/);
});
test("velocity crossfade blends adjacent layers at equal power with aligned round robin", () => {
  const s = layeredFixture();
  s.instrumentDefinitions[0].velocityCrossfade = 16;
  const zones = s.instrumentDefinitions[0].sample.zones;
  // Effective weight of the upper (65–127) layer across the boundary at 64.5.
  const upperWeight: number[] = [];
  for (let v = 52; v <= 77; v++) {
    s.tracks[0].patterns.a.events = [
      {
        id: "n",
        kind: "note",
        at: 0,
        pitch: "C4",
        duration: 1,
        velocity: v / 127,
      },
    ];
    const [e] = compileScore(s).events;
    const primary = zones[e!.sampleZoneIndex!];
    const blend = e!.sampleBlend;
    if (blend) {
      assert.equal(zones[blend.index].roundRobin, primary.roundRobin);
      assert.notEqual(zones[blend.index].lowVelocity, primary.lowVelocity);
    }
    const primaryWeight = Math.sqrt(1 - (blend?.weight ?? 0) ** 2);
    upperWeight.push(
      primary.lowVelocity === 65 ? primaryWeight : (blend?.weight ?? 0),
    );
  }
  assert.equal(upperWeight[0], 0, "outside the fade: lower layer only");
  assert.equal(upperWeight.at(-1), 1, "outside the fade: upper layer only");
  for (let i = 1; i < upperWeight.length; i++)
    assert.ok(upperWeight[i]! >= upperWeight[i - 1]! - 1e-9, `step ${i}`);
  const middle = upperWeight[64 - 52]!;
  assert.ok(middle > 0.5 && middle < 0.8, `${middle}`);
});
test("velocity crossfade is opt-in and also applies to drum slots", () => {
  assert.ok(compileScore(layeredFixture()).events.every((e) => !e.sampleBlend));
  const s = layeredFixture(true);
  s.instrumentDefinitions[0].velocityCrossfade = 16;
  s.tracks[0].patterns.a.events = [
    { id: "h", kind: "hit", at: 0, sound: "snare", velocity: 64 / 127 },
  ];
  const [e] = compileScore(s).events;
  const slots = s.instrumentDefinitions[0].drumKit.slots;
  assert.equal(slots[e!.sampleDrumSlotIndex!].highVelocity, 64);
  assert.equal(slots[e!.sampleBlend!.index].lowVelocity, 65);
});
test("legato keeps the held note's velocity blend", () => {
  const s = layeredFixture();
  s.instrumentDefinitions[0].velocityCrossfade = 16;
  s.tracks[0].patterns.a.events = [
    {
      id: "a",
      kind: "note",
      at: 0,
      pitch: "C4",
      duration: 1,
      hold: true,
      velocity: 62 / 127,
    },
    {
      id: "b",
      kind: "note",
      at: 1,
      pitch: "D4",
      duration: 1,
      articulation: "legato",
      velocity: 60 / 127,
    },
  ];
  const [a, b] = compileScore(s).events;
  assert.ok(a!.sampleBlend);
  assert.deepEqual(b!.sampleBlend, a!.sampleBlend);
});
