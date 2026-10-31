import { test } from "node:test";
import assert from "node:assert/strict";
import { renderScore } from "../src/renderer.js";
import { decodeWav } from "../src/wav.js";
import { ScoreSchema } from "../src/model.js";
import { fixture } from "./helpers.js";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  importInstrumentCollection,
  bundledStarterManifest,
} from "../src/instrument-collection.js";
const energy = (a: Float32Array, from: number, to: number) => {
  const part = a.subarray(Math.round(from * 44100), Math.round(to * 44100));
  return Math.sqrt(
    part.reduce((sum, value) => sum + value * value, 0) / part.length,
  );
};
function score() {
  const s = ScoreSchema.parse(fixture("sample-pluck", "snes-inspired"));
  s.tracks[0]!.patterns.a!.events = [
    {
      id: "pluck",
      kind: "note",
      at: 0,
      pitch: "C5",
      duration: 0.125,
      gate: 0.8,
      velocity: 0.7,
      hold: false,
    },
  ];
  s.mixer.reverb = {
    enabled: true,
    decaySeconds: 1.2,
    preDelaySeconds: 0.08,
    damping: 0.45,
    returnDb: -6,
  };
  s.export.mode = "one-shot";
  s.export.tailSeconds = 2;
  return s;
}
test("reverb adds an audible decaying stereo tail with independent sends and a clean wet-only pre-delay", async () => {
  const s = score();
  s.tracks[0]!.reverbSend = 0.7;
  const mixed = await renderScore(s),
    wet = await renderScore(s, { effects: "wet" });
  const a = decodeWav(mixed.wav),
    b = decodeWav(wet.wav);
  assert.ok(
    energy(a.channels[0]!, 0.3, 0.6) > 0.00001,
    "reverb tail must be audible after the dry note has stopped",
  );
  assert.ok(
    energy(b.channels[0]!, 0.01, 0.06) < 0.000001,
    "pre-delay must remain silent",
  );
  assert.ok(energy(b.channels[0]!, 0.12, 0.4) > 0.00001);
  assert.notDeepEqual(b.channels[0], b.channels[1]);
  assert.equal(mixed.report.clippedSamples, 0);
  assert.equal(mixed.report.nonFiniteSamples, 0);
  const repeated = decodeWav((await renderScore(s, { effects: "wet" })).wav);
  const difference = b.channels[0]!.reduce(
    (sum, v, i) => sum + (v - repeated.channels[0]![i]!) ** 2,
    0,
  );
  assert.ok(Math.sqrt(difference / b.channels[0]!.length) < 0.00001);
});
test("zero send has no wet output and effects=dry bypasses an enabled reverb", async () => {
  const s = score();
  assert.equal((await renderScore(s, { effects: "wet" })).report.silent, true);
  s.tracks[0]!.reverbSend = 0.7;
  const dry = decodeWav((await renderScore(s, { effects: "dry" })).wav);
  s.mixer.reverb!.enabled = false;
  const bypassed = decodeWav((await renderScore(s, { effects: "dry" })).wav);
  assert.deepEqual(dry.channels, bypassed.channels);
  assert.ok(energy(dry.channels[0]!, 0.3, 0.6) < 0.000001);
});
test("all four bundled sampled instruments render safely through real Chromium", async () => {
  const manifest = JSON.parse(await readFile(bundledStarterManifest, "utf8"));
  for (const id of [
    "starter-recorder",
    "starter-piano",
    "starter-kalimba",
    "starter-glock",
  ]) {
    const input = await importInstrumentCollection(
      fixture("sample-flute", "snes-inspired"),
      manifest,
      dirname(bundledStarterManifest),
      [id],
    );
    input.tracks[0]!.instrument = id;
    const result = await renderScore(input);
    assert.equal(result.report.silent, false, id);
    assert.equal(result.report.nonFiniteSamples, 0, id);
    assert.equal(result.report.clippedSamples, 0, id);
    assert.ok(result.report.rms > 0.0001, id);
  }
});
