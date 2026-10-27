import { test } from "node:test";
import assert from "node:assert/strict";
import { renderScore } from "../src/renderer.js";
import { decodeWav } from "../src/wav.js";
import { fixture } from "./helpers.js";
for (const [instrument, profile] of [
  ["pulse-lead-soft", "nes-inspired"],
  ["fm-epiano", "genesis-inspired"],
  ["sample-flute", "snes-inspired"],
]) {
  test(`real Chromium render: ${instrument}`, async () => {
    const result = await renderScore(fixture(instrument, profile));
    const a = decodeWav(result.wav);
    assert.equal(a.channels[0]!.length, 88200);
    assert.equal(result.report.silent, false);
    assert.equal(result.report.clippedSamples, 0);
    assert.equal(result.report.nonFiniteSamples, 0);
    assert.ok(result.report.rms > 0.001);
    assert.equal(result.report.render.loopFrames, 88200);
  });
}
test("partial render includes earlier sustained note state and correct length", async () => {
  const s = fixture("sample-flute", "snes-inspired");
  s.tracks[0]!.patterns.a.events = [
    { id: "long", kind: "note", at: 0, pitch: "C5", duration: 4 },
  ];
  const a = await renderScore(s, { mode: "one-shot", fromBeat: 1, toBeat: 2 });
  assert.equal(a.report.frames, 110250);
  assert.ok(a.report.rms > 0.001);
});
test("solo, seam preview and invalid options", async () => {
  const s = fixture();
  const a = await renderScore(s, { solo: ["lead"], seam: true });
  assert.equal(a.report.frames, 176400);
  await assert.rejects(
    () => renderScore(s, { solo: ["missing"] }),
    /Unknown solo track/,
  );
  await assert.rejects(
    () => renderScore(s, { mode: "loop", fromBeat: 1 }),
    /Partial ranges/,
  );
});

function segmentRms(
  channel: Float32Array,
  sr: number,
  start: number,
  end: number,
) {
  const part = channel.subarray(Math.round(start * sr), Math.round(end * sr));
  return Math.sqrt(part.reduce((n, x) => n + x * x, 0) / part.length);
}
for (const [instrument, profile] of [
  ["pulse-lead-soft", "nes-inspired"],
  ["fm-epiano", "genesis-inspired"],
  ["sample-flute", "snes-inspired"],
]) {
  test(`repeated stealing and same-pitch retrigger stay audible: ${instrument}`, async () => {
    const s = fixture(instrument, profile);
    s.tracks[0]!.patterns.a.events = [
      { id: "long", kind: "note", at: 0, pitch: "C5", duration: 3 },
      { id: "repeat", kind: "note", at: 0.5, pitch: "C5", duration: 1 },
      { id: "after", kind: "note", at: 1, pitch: "C5", duration: 3 },
    ];
    const r = await renderScore(s, { mode: "one-shot" }),
      a = decodeWav(r.wav);
    assert.equal(r.report.nonFiniteSamples, 0);
    assert.equal(r.report.clippedSamples, 0);
    for (const [start, end] of [
      [0.32, 0.4],
      [0.65, 0.8],
      [1.4, 1.6],
    ])
      assert.ok(
        segmentRms(a.channels[0]!, a.sampleRate, start!, end!) > 0.0001,
        `Unexpected silence ${start}..${end}`,
      );
  });
}
test("detune from stolen vibrato resets before the following note", async () => {
  const s = fixture("triangle-bass");
  s.tracks[0]!.patterns.a.events = [
    {
      id: "vibrato",
      kind: "note",
      at: 0,
      pitch: "C4",
      duration: 3,
      vibrato: { depthCents: 100, rateHz: 1, delayBeats: 0 },
    },
    { id: "plain", kind: "note", at: 1.5, pitch: "C4", duration: 2 },
  ] as any;
  const r = await renderScore(s, { mode: "one-shot" }),
    a = decodeWav(r.wav),
    channel = a.channels[0]!;
  const start = Math.round(0.9 * a.sampleRate),
    end = Math.round(1.4 * a.sampleRate);
  let rising = 0;
  for (let i = start + 1; i < end; i++)
    if (channel[i - 1]! <= 0 && channel[i]! > 0) rising++;
  const measured = rising / ((end - start) / a.sampleRate);
  assert.ok(
    Math.abs(measured - 261.6256) / 261.6256 < 0.025,
    `Detune leaked: ${measured}`,
  );
});
test("loop pre-roll preserves a previous-cycle sample release tail", async () => {
  const s = fixture("sample-strings", "snes-inspired");
  s.tracks[0]!.patterns.a.events = [
    { id: "middle", kind: "note", at: 1, pitch: "E5", duration: 0.25 },
    { id: "tail", kind: "note", at: 3.75, pitch: "C5", duration: 0.25 },
  ];
  const r = await renderScore(s),
    a = decodeWav(r.wav);
  assert.ok(segmentRms(a.channels[0]!, a.sampleRate, 0.02, 0.08) > 0.0001);
  assert.equal(r.report.frames, 88200);
});
test("two-voice chord changes render across multiple loops", async () => {
  const s = fixture("fm-epiano", "genesis-inspired");
  s.tracks[0]!.maxVoices = 2;
  s.tracks[0]!.voicePolicy = "error";
  s.tracks[0]!.patterns.a.events = Array.from({ length: 8 }, (_, i) => ({
    id: `chord-${i}`,
    kind: "note",
    at: Math.floor(i / 2),
    pitch: i % 2 ? "E5" : "C5",
    duration: 0.5,
  }));
  const r = await renderScore(s);
  assert.ok(r.report.rms > 0.001);
  assert.equal(
    r.report.diagnostics.some((d) => d.code === "VOICE_OVERLAP"),
    false,
  );
});
test("dry/wet loop diagnostics and optional level matching report separate measurements", async () => {
  const s = fixture("sample-flute", "snes-inspired");
  Object.assign(s.tracks[0]!, { send: 0.3 });
  const r = await renderScore(s, {
    loopDiagnostics: true,
    normalization: { targetRmsDbfs: -24 },
  });
  assert.ok(r.report.loopDiagnostics!.dry.rms > 0);
  assert.ok(r.report.loopDiagnostics!.wet.rms > 0);
  assert.ok(r.report.loopDiagnostics!.mix.cycleComparison);
  assert.ok(r.report.normalization);
  assert.ok(r.report.peakDbfs! <= -3 + 0.0001);
});
test("one-shot override bypasses loop-only voice conflicts and rejects invalid options", async () => {
  const s = fixture("sample-strings", "snes-inspired");
  s.tracks[0]!.voicePolicy = "error";
  s.tracks[0]!.patterns.a.events = [
    { id: "first", kind: "note", at: 0, pitch: "C5", duration: 0.25 },
    { id: "last", kind: "note", at: 3.75, pitch: "C5", duration: 0.25 },
  ];
  const r = await renderScore(s, { mode: "one-shot" });
  assert.equal(r.score.export.mode, "one-shot");
  await assert.rejects(() => renderScore(s, { effects: "typo" as any }));
});
