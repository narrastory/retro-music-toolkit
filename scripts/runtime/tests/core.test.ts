import { test } from "node:test";
import assert from "node:assert/strict";
import { compileScore, validateScore } from "../src/compiler.js";
import { midi, toTick, ScoreError } from "../src/model.js";
import { patchScore } from "../src/patch.js";
import { encodeWav, decodeWav } from "../src/wav.js";
import { analyzeChannels } from "../src/analysis.js";
import { fixture } from "./helpers.js";
import { bakeLoopCrossfade } from "../src/dsp.js";
import { findSustainLoop } from "../src/loop.js";
import { nesPulseWidth } from "../src/synthesis.js";
test("pitch, flats and tick accuracy", () => {
  assert.equal(midi("A4"), 69);
  assert.equal(midi("Bb3"), 58);
  assert.equal(toTick(1 / 3), 320);
  assert.throws(() => toTick(0.123456));
});
test("defaults, clip expansion, transposition and velocity clamping", () => {
  const s = fixture();
  s.lengthBeats = 8;
  Object.assign(s.tracks[0]!.clips[0]!, {
    repeats: 2,
    transpose: 12,
    velocityScale: 2,
  });
  const c = compileScore(s);
  assert.equal(c.events.length, 6);
  assert.equal(c.events[0]!.midi, 84);
  assert.equal(c.events[3]!.tick, 3840);
  assert.equal(c.events[0]!.velocity, 1);
});
test("unknown fields rejected", () =>
  assert.equal(validateScore({ ...fixture(), typo: 1 }).valid, false));
test("duplicate source IDs rejected", () => {
  const s = fixture();
  s.tracks[0]!.patterns.a.events[1]!.id = "n1";
  assert.throws(() => compileScore(s), ScoreError);
});
test("bad references and pattern bounds diagnosed", () => {
  const s = fixture();
  s.tracks[0]!.clips[0]!.pattern = "missing";
  assert.ok(
    validateScore(s).diagnostics.some((d) => d.code === "PATTERN_REFERENCE"),
  );
});
test("note duration cannot cross pattern boundary", () => {
  const s = fixture();
  s.tracks[0]!.patterns.a.events[0]!.duration = 5;
  assert.equal(validateScore(s).valid, false);
});
test("non-grid timing rejected", () => {
  const s = fixture();
  s.tracks[0]!.patterns.a.events[0]!.at = 0.123456;
  assert.equal(validateScore(s).valid, false);
});
test("release occupies a voice; explicit cut truncates it", () => {
  const s = fixture();
  s.tracks[0]!.patterns.a.events[0]!.duration = 2;
  s.tracks[0]!.voicePolicy = "error";
  assert.throws(() => compileScore(s), ScoreError);
  s.tracks[0]!.voicePolicy = "cut";
  const c = compileScore(s);
  assert.equal(c.events[0]!.cutTick, 960);
  assert.ok(c.diagnostics.some((d) => d.code === "VOICE_STEAL"));
});
test("loop boundary voice conflict checked", () => {
  const s = fixture();
  Object.assign(s.tracks[0]!.patterns.a.events[2]!, {
    at: 3,
    duration: 1,
    gate: 1,
  });
  s.tracks[0]!.voicePolicy = "error";
  assert.throws(() => compileScore(s), ScoreError);
  s.tracks[0]!.voicePolicy = "cut";
  assert.ok(
    compileScore(s).diagnostics.some((d) => d.code === "LOOP_VOICE_STEAL"),
  );
});
test("two-voice chord allocation succeeds", () => {
  const s = fixture();
  s.tracks[0]!.maxVoices = 2;
  s.tracks[0]!.voicePolicy = "error";
  s.tracks[0]!.patterns.a.events[1]!.at = 0;
  const c = compileScore(s);
  assert.notEqual(c.events[0]!.voice, c.events[1]!.voice);
});
test("hits and notes cannot use wrong preset", () => {
  const s = fixture("chip-drums");
  assert.equal(validateScore(s).valid, false);
});
test("mute removes all events and preserves original input", () => {
  const s = fixture();
  Object.assign(s.tracks[0]!.clips[0]!, { mute: true });
  assert.equal(compileScore(s).events.length, 0);
  assert.equal("gate" in s.tracks[0]!.patterns.a.events[0]!, false);
});
test("patch isolated and compiled atomically", () => {
  const s = fixture();
  const next = patchScore(s, {
    operations: [
      {
        op: "set-note",
        trackId: "lead",
        pattern: "a",
        eventId: "n1",
        set: { pitch: "D5" },
      },
    ],
  });
  assert.equal(s.tracks[0]!.patterns.a.events[0]!.pitch, "C5");
  assert.equal((next.tracks[0]!.patterns.a!.events[0] as any).pitch, "D5");
  assert.throws(() =>
    patchScore(s, {
      operations: [
        {
          op: "set-note",
          trackId: "lead",
          pattern: "a",
          eventId: "n1",
          set: { duration: 100 },
        },
      ],
    }),
  );
});
test("patch conflict and missing selectors rejected", () => {
  assert.throws(
    () =>
      patchScore(
        fixture(),
        {
          baseHash: "a".repeat(64),
          operations: [{ op: "set-song", set: { tempo: 130 } }],
        },
        "b".repeat(64),
      ),
    /PATCH_CONFLICT/,
  );
  assert.throws(
    () =>
      patchScore(fixture(), {
        operations: [
          {
            op: "set-clip",
            trackId: "absent",
            clipId: "clip-a",
            set: { mute: true },
          },
        ],
      }),
    /TRACK_NOT_FOUND/,
  );
});
test("cloned pattern has independent note IDs", () => {
  const c = patchScore(fixture(), {
    operations: [
      {
        op: "clone-pattern",
        trackId: "lead",
        pattern: "a",
        newPattern: "answer",
      },
    ],
  });
  assert.equal(c.tracks[0]!.patterns.answer!.events[0]!.id, "answer:n1");
});
test("PCM16 stereo interleave and numeric bounds", () => {
  const ch = [
    new Float32Array([-1, 0, 0.5, 1]),
    new Float32Array([1, 0.25, 0, -1]),
  ];
  const bytes = encodeWav(ch, 44100);
  assert.equal(bytes.length, 60);
  const d = decodeWav(bytes);
  assert.equal(d.sampleRate, 44100);
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < 4; i++)
      assert.ok(Math.abs(d.channels[c]![i]! - ch[c]![i]!) < 1 / 32000);
  assert.throws(() => decodeWav(bytes.subarray(0, bytes.length - 1)));
});
test("audio analysis detects silence, invalid values and overrange", () => {
  const a = analyzeChannels([new Float32Array([0, 0, 0])], 48000);
  assert.equal(a.silent, true);
  assert.equal(a.rmsDbfs, null);
  const b = analyzeChannels([new Float32Array([1.2, NaN, -0.2])], 48000);
  assert.equal(b.clippedSamples, 1);
  assert.equal(b.nonFiniteSamples, 1);
});

test("subtractive settings are limited to the subtractive engine and default sensibly", () => {
  const s: any = fixture();
  s.schemaVersion = "1.3";
  s.instrumentDefinitions = [
    {
      id: "wrong-engine",
      engine: "pulse",
      role: "melody",
      range: [48, 84],
      attack: 0.01,
      release: 0.1,
      description: "Pulse with stray filter settings",
      subtractive: { oscillator: "sawtooth" },
    },
  ];
  s.tracks[0].instrument = "wrong-engine";
  assert.throws(
    () => compileScore(s),
    (e: any) =>
      e.diagnostics.some((d: any) => d.code === "SUBTRACTIVE_DEFINITION"),
  );
  s.instrumentDefinitions[0].engine = "subtractive";
  const p = compileScore(s).score.instrumentDefinitions![0]!;
  assert.equal(p.subtractive!.unison.voices, 1);
  assert.equal(p.subtractive!.filter.type, "lowpass");
  assert.equal(p.subtractive!.lfo, undefined);
});

test("baked loop crossfade makes the end-to-start jump continuous", () => {
  // A ramp has a large jump from loop end back to loop start.
  const ramp = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  const [out] = bakeLoopCrossfade([ramp], 400, 900, 100);
  const jump = (x: Float32Array) => Math.abs(x[400]! - x[899]!);
  assert.ok(jump(ramp) > 0.4);
  assert.ok(jump(out!) < 0.002, `${jump(out!)}`);
  // Outside the fade region the data is untouched; the input is not mutated.
  assert.equal(out![700], ramp[700]);
  assert.ok(Math.abs(ramp[899]! - 0.899) < 1e-6);
  // Clamped to the material available before the loop start.
  const [short] = bakeLoopCrossfade([ramp], 10, 900, 100);
  assert.equal(short![880], ramp[880]);
});

test("sustain loop finder lands on whole periods with in-phase fade regions", () => {
  const sr = 32000,
    f = 440 * 2 ** ((57 - 69) / 12);
  // Harmonic tone with slow amplitude drift, like a held instrument note.
  const x = Float32Array.from({ length: sr * 2.5 }, (_, i) => {
    const t = i / sr;
    return (
      (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)) *
      (0.8 + 0.05 * Math.sin(2 * Math.PI * 0.7 * t))
    );
  });
  const loop = findSustainLoop(x, sr, 57, {
    endMarginSeconds: 0.1,
    loopSeconds: 1.2,
    crossfadeSeconds: 0.25,
  });
  assert.ok(loop.correlation > 0.99, `${loop.correlation}`);
  const cycles = (loop.end - loop.start) / (sr / f);
  assert.ok(Math.abs(cycles - Math.round(cycles)) < 0.05, `${cycles}`);
  assert.equal(loop.crossfade, 8000);
  // After baking, the jump from loop end back to loop start is seamless.
  const [baked] = bakeLoopCrossfade([x], loop.start, loop.end, loop.crossfade);
  const step = Math.abs(baked![loop.start]! - baked![loop.end - 1]!);
  const typical = Math.abs(x[loop.start]! - x[loop.start - 1]!);
  assert.ok(step < typical * 1.5 + 1e-3, `${step} vs ${typical}`);
});

test("hardware mode snaps pulse width to the 2A03 duty cycles", () => {
  // Tone width w has duty (1 + w) / 2: 0 → 50 %, -0.5 → 25 %, -0.75 → 12.5 %.
  assert.equal(nesPulseWidth(0), 0);
  assert.equal(nesPulseWidth(-0.5), -0.5);
  assert.equal(nesPulseWidth(-0.7), -0.75);
  // 75 % sounds like 25 %; it folds to the same channel setting.
  assert.equal(nesPulseWidth(0.5), -0.5);
  assert.equal(nesPulseWidth(0.1), 0);
});
