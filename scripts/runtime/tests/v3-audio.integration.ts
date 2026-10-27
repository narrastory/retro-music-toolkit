import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { renderScore } from "../src/renderer.js";
import { decodeWav, encodeWav } from "../src/wav.js";
const rms = (a: Float32Array, sr: number, start: number, end: number) => {
  const part = a.subarray(Math.round(start * sr), Math.round(end * sr));
  return Math.sqrt(part.reduce((s, v) => s + v * v, 0) / part.length);
};
function frequency(a: Float32Array, sr: number, start: number, end: number) {
  let crosses = 0;
  for (let i = Math.round(start * sr) + 1; i < Math.round(end * sr); i++)
    if (a[i - 1]! <= 0 && a[i]! > 0) crosses++;
  return crosses / (end - start);
}
function sampleScore() {
  const s: any = fixture();
  s.schemaVersion = "1.1";
  s.tracks[0].instrument = "sample-original";
  s.tracks[0].patterns.a.events = [
    { id: "held", kind: "note", at: 0, pitch: "A4", duration: 3, gate: 1 },
  ];
  s.instrumentDefinitions = [
    {
      id: "sample-original",
      engine: "sample",
      role: "melody",
      range: [48, 96],
      attack: 0.01,
      release: 0.05,
      description: "Original sine test",
      sample: {
        kind: "zones",
        zones: [
          {
            lowMidi: 48,
            highMidi: 96,
            rootMidi: 57,
            assetId: "sine",
            loopStartFrame: 0,
            loopEndFrame: 4400,
          },
        ],
      },
    },
  ];
  const data = Float32Array.from(
    { length: 4400 },
    (_, i) => Math.sin((2 * Math.PI * 220 * i) / 22000) * 0.4,
  );
  s.sampleAssets = {
    sine: {
      format: "wav-pcm16",
      dataBase64: Buffer.from(encodeWav([data], 22000)).toString("base64"),
      provenance: "Procedural test sine",
    },
  };
  return s;
}
test("external WAV honors original sample rate, root note and looping", async () => {
  const r = await renderScore(sampleScore(), { mode: "one-shot" }),
    a = decodeWav(r.wav);
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 0.4, 1) - 440) < 4,
  );
  assert.ok(rms(a.channels[0]!, a.sampleRate, 1.1, 1.3) > 0.001);
});
test("sample legato glides on one sustained source and remains audible", async () => {
  const s = sampleScore();
  s.tracks[0].patterns.a.events = [
    { id: "a", kind: "note", at: 0, pitch: "A4", duration: 1, gate: 1 },
    {
      id: "b",
      kind: "note",
      at: 1,
      pitch: "A5",
      duration: 2,
      gate: 1,
      articulation: "legato",
      expression: { portamentoBeats: 0.5 },
    },
  ];
  const r = await renderScore(s, { mode: "one-shot" }),
    a = decodeWav(r.wav);
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 1, 1.4) - 880) < 5,
  );
  assert.ok(rms(a.channels[0]!, a.sampleRate, 0.48, 0.52) > 0.001);
  assert.equal(r.report.clippedSamples, 0);
});
test("pitch bend reaches an octave and resets on the next sample note", async () => {
  const s = sampleScore();
  s.tracks[0].patterns.a.events = [
    {
      id: "bend",
      kind: "note",
      at: 0,
      pitch: "A4",
      duration: 2,
      gate: 1,
      expression: { pitchBendCents: [{ offsetBeats: 0, value: 1200 }] },
    },
    { id: "plain", kind: "note", at: 2, pitch: "A4", duration: 2, gate: 1 },
  ];
  const r = await renderScore(s, { mode: "one-shot" }),
    a = decodeWav(r.wav);
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 0.3, 0.7) - 880) < 5,
  );
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 1.2, 1.6) - 440) < 5,
  );
});
test("gain and pan automation affect stereo output at the authored positions", async () => {
  const s = sampleScore();
  s.tracks[0].automation = [
    {
      parameter: "gainDb",
      points: [
        { at: 0, value: -30 },
        { at: 1, value: 0 },
        { at: 4, value: 0 },
      ],
    },
    {
      parameter: "pan",
      points: [
        { at: 0, value: -1 },
        { at: 1, value: -1 },
        { at: 2, value: 1 },
        { at: 4, value: 1 },
      ],
    },
  ];
  const r = await renderScore(s, { mode: "one-shot" }),
    a = decodeWav(r.wav);
  assert.ok(
    rms(a.channels[0]!, a.sampleRate, 0.1, 0.2) >
      rms(a.channels[1]!, a.sampleRate, 0.1, 0.2) * 10,
  );
  assert.ok(
    rms(a.channels[1]!, a.sampleRate, 1.1, 1.3) >
      rms(a.channels[0]!, a.sampleRate, 1.1, 1.3) * 10,
  );
  assert.ok(
    rms(a.channels[0]!, a.sampleRate, 0.55, 0.65) >
      rms(a.channels[0]!, a.sampleRate, 0.03, 0.08) * 3,
  );
});
test("automated send drives the wet-only output", async () => {
  const s = sampleScore();
  s.tracks[0].send = 0;
  s.tracks[0].automation = [
    {
      parameter: "send",
      points: [
        { at: 0, value: 0 },
        { at: 1, value: 0.4 },
      ],
    },
  ];
  const r = await renderScore(s, { mode: "one-shot", effects: "wet" });
  assert.ok(r.report.rms > 0.0001);
});
test("sample-zone legato changes are rejected explicitly", async () => {
  const s = sampleScore();
  s.instrumentDefinitions[0].sample.zones = [
    { lowMidi: 48, highMidi: 74, rootMidi: 57, assetId: "sine" },
    { lowMidi: 75, highMidi: 96, rootMidi: 57, assetId: "sine" },
  ];
  s.tracks[0].patterns.a.events = [
    { id: "a", kind: "note", at: 0, pitch: "A4", duration: 1, gate: 1 },
    {
      id: "b",
      kind: "note",
      at: 1,
      pitch: "A5",
      duration: 2,
      gate: 1,
      articulation: "legato",
    },
  ];
  await assert.rejects(() => renderScore(s));
});
test("partial export omits future legato pitch changes from release tail", async () => {
  const s = sampleScore();
  s.tracks[0].patterns.a.events = [
    { id: "a", kind: "note", at: 0, pitch: "A4", duration: 2, gate: 1 },
    {
      id: "future",
      kind: "note",
      at: 2,
      pitch: "A5",
      duration: 2,
      gate: 1,
      articulation: "legato",
    },
  ];
  const r = await renderScore(s, {
      mode: "one-shot",
      fromBeat: 0,
      toBeat: 1.5,
    }),
    a = decodeWav(r.wav);
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 0.8, 0.95) - 440) < 8,
  );
  assert.ok(rms(a.channels[0]!, a.sampleRate, 1.3, 1.5) < 0.0001);
});
test("custom FM velocity-to-timbre response renders without clipping", async () => {
  const s: any = fixture("fm-epiano", "genesis-inspired");
  s.tracks[0].instrument = "fm-expressive";
  s.instrumentDefinitions = [
    {
      id: "fm-expressive",
      engine: "fm",
      role: "melody",
      range: [45, 96],
      attack: 0.005,
      release: 0.05,
      description: "Expressive FM test",
      synthesis: { harmonicity: 2, modulationIndex: 3 },
      velocityResponse: { filterOctaves: 2, fmIndexScale: 1.5 },
    },
  ];
  s.tracks[0].patterns.a.events.forEach(
    (e: any, i: number) => (e.velocity = i % 2 ? 0.9 : 0.3),
  );
  const r = await renderScore(s);
  assert.ok(r.report.rms > 0.0001);
  assert.equal(r.report.nonFiniteSamples, 0);
  assert.equal(r.report.clippedSamples, 0);
});
test("multi-zone samples use the selected zone root, not a shared root", async () => {
  const s = sampleScore();
  const high = Float32Array.from(
    { length: 4400 },
    (_, i) => Math.sin((2 * Math.PI * 880 * i) / 22000) * 0.4,
  );
  s.sampleAssets.high = {
    format: "wav-pcm16",
    dataBase64: Buffer.from(encodeWav([high], 22000)).toString("base64"),
    provenance: "Original high-root sine",
  };
  s.instrumentDefinitions[0].sample.zones = [
    {
      lowMidi: 48,
      highMidi: 74,
      rootMidi: 57,
      assetId: "sine",
      loopStartFrame: 0,
      loopEndFrame: 4400,
    },
    {
      lowMidi: 75,
      highMidi: 96,
      rootMidi: 81,
      assetId: "high",
      loopStartFrame: 0,
      loopEndFrame: 4400,
    },
  ];
  s.tracks[0].patterns.a.events = [
    { id: "low", kind: "note", at: 0, pitch: "A4", duration: 1, gate: 1 },
    { id: "high", kind: "note", at: 2, pitch: "A5", duration: 1, gate: 1 },
  ];
  const r = await renderScore(s, { mode: "one-shot" }),
    a = decodeWav(r.wav);
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 0.15, 0.35) - 440) < 6,
  );
  assert.ok(
    Math.abs(frequency(a.channels[0]!, a.sampleRate, 1.15, 1.35) - 880) < 6,
  );
});
test("automation resets at each loop entrance rather than inheriting the last value", async () => {
  const s = sampleScore();
  s.tracks[0].automation = [
    {
      parameter: "gainDb",
      points: [
        { at: 0, value: -18 },
        { at: 1, value: 0 },
        { at: 3, value: 0 },
      ],
    },
  ];
  const first = await renderScore(s, { mode: "one-shot" }),
    loop = await renderScore(s),
    a = decodeWav(first.wav),
    b = decodeWav(loop.wav);
  const x = rms(a.channels[0]!, a.sampleRate, 0.05, 0.25),
    y = rms(b.channels[0]!, b.sampleRate, 0.05, 0.25);
  assert.ok(Math.abs(x - y) / x < 0.02, `Loop inherited gain: ${x} vs ${y}`);
});
