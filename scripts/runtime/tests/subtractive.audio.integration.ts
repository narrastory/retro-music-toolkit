import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { renderScore } from "../src/renderer.js";
import { decodeWav } from "../src/wav.js";
import { checkRootPitch } from "../src/pitch.js";

const SR = 44100;

/** One held note (duration in beats; the fixture runs at 120 BPM). */
function note(instrument: string | object, pitch: string, seconds = 1.5) {
  const s: any = fixture();
  s.schemaVersion = "1.3";
  s.export = { mode: "one-shot", tailSeconds: 1 };
  if (typeof instrument === "object") {
    s.instrumentDefinitions = [instrument];
    instrument = (instrument as { id: string }).id;
  }
  s.tracks[0].instrument = instrument;
  s.tracks[0].role = "harmony";
  s.tracks[0].patterns.a.events = [
    {
      id: "n",
      kind: "note",
      at: 0,
      pitch,
      duration: seconds,
      gate: 1,
      velocity: 0.8,
    },
  ];
  return s;
}
async function render(s: any) {
  return decodeWav(
    (await renderScore(s, { mode: "one-shot", dither: false })).wav,
  ).channels[0]!;
}
/** Spectral centroid in Hz of a Hann-windowed slice, by direct DFT bins. */
function centroid(x: Float32Array, start: number, size = 1024) {
  let weighted = 0,
    total = 0;
  for (let k = 1; k < size / 2; k++) {
    let re = 0,
      im = 0;
    for (let i = 0; i < size; i++) {
      const v =
        x[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
      re += v * Math.cos((2 * Math.PI * k * i) / size);
      im -= v * Math.sin((2 * Math.PI * k * i) / size);
    }
    const m = Math.hypot(re, im);
    weighted += m * ((k * SR) / size);
    total += m;
  }
  return weighted / total;
}

test("subtractive pluck: filter envelope closes after the attack", async () => {
  const x = await render(note("analog-pluck", "C4", 1));
  // The 0.22 s filter decay is exponential: most of the sweep is over by 60 ms.
  const early = centroid(x, Math.round(0.003 * SR)),
    late = centroid(x, Math.round(0.06 * SR));
  assert.ok(early > late * 1.5, `centroid ${early} → ${late}`);
});

test("subtractive unison stays centred on the written pitch", async () => {
  for (const [id, pitch, midi] of [
    ["analog-bass", "A1", 33],
    ["analog-lead", "A4", 69],
    ["analog-pad", "C4", 60],
  ] as const) {
    const x = await render(note(id, pitch));
    const check = checkRootPitch(x.subarray(Math.round(0.5 * SR)), SR, midi);
    assert.equal(check.octaveError, 0, id);
    assert.ok(Math.abs(check.centsOffset) < 10, `${id}: ${check.centsOffset}`);
  }
});

test("subtractive LFO tremolo and track brightness are audible", async () => {
  const tremolo = {
    id: "tremolo-test",
    engine: "subtractive",
    role: "harmony",
    range: [36, 84],
    attack: 0.005,
    release: 0.05,
    description: "Sine with 4 Hz tremolo",
    synthesis: { sustain: 1, volumeDb: -12 },
    subtractive: {
      oscillator: "sine",
      filter: { cutoffHz: 20000 },
      lfo: { rateHz: 4, amplitude: 0.5 },
    },
  };
  const x = await render(note(tremolo, "A4", 2));
  const levels: number[] = [];
  // Two beats at 120 BPM: the note sounds for one second.
  for (let t = 0.2; t < 0.9; t += 0.01) {
    let sum = 0;
    const from = Math.round(t * SR);
    for (let i = from; i < from + 441; i++) sum += x[i]! ** 2;
    levels.push(Math.sqrt(sum / 441));
  }
  const ratio = Math.min(...levels) / Math.max(...levels);
  assert.ok(ratio > 0.4 && ratio < 0.6, `tremolo min/max ${ratio}`);

  const dark = note("analog-pad", "C4"),
    bright = note("analog-pad", "C4");
  dark.tracks[0].controls = { brightness: 0, pluckiness: 0.5 };
  bright.tracks[0].controls = { brightness: 1, pluckiness: 0.5 };
  // Mid-sustain, before the one-second note releases.
  const at = Math.round(0.4 * SR);
  const [d, b] = [
    centroid(await render(dark), at),
    centroid(await render(bright), at),
  ];
  assert.ok(b > d * 1.3, `brightness centroid ${d} → ${b}`);
});
