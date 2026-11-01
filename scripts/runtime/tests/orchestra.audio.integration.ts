import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  bundledCollectionManifest,
  importInstrumentCollection,
} from "../src/instrument-collection.js";
import { renderScore } from "../src/renderer.js";
import { decodeWav } from "../src/wav.js";
import { checkRootPitch } from "../src/pitch.js";
import { fixture } from "./helpers.js";

const SR = 44100;
// Held notes that cross several loop cycles (loops are ~1 s long).
for (const [id, pitch, midi] of [
  ["orch-strings", "D4", 62],
  ["orch-flute", "G5", 79],
  ["orch-clarinet", "A4", 69],
  ["orch-ocarina", "B5", 83],
] as const)
  test(`${id}: a 6 s held note keeps level and pitch through its loops`, async () => {
    const path = bundledCollectionManifest("orchestra");
    const s: any = await importInstrumentCollection(
      fixture(),
      JSON.parse(await readFile(path, "utf8")),
      dirname(path),
      [id],
    );
    s.tempo = 60;
    s.lengthBeats = 8;
    s.export = { mode: "one-shot", tailSeconds: 1 };
    s.tracks[0].instrument = id;
    s.tracks[0].patterns.a.lengthBeats = 8;
    s.tracks[0].patterns.a.events = [
      {
        id: "n",
        kind: "note",
        at: 0,
        pitch,
        duration: 6.5,
        gate: 1,
        velocity: 0.7,
      },
    ];
    const x = decodeWav(
      (await renderScore(s, { mode: "one-shot", dither: false })).wav,
    ).channels[0]!;
    // Recordings breathe (bowing, vibrato), and loops repeat that, so the
    // test looks for what a bad loop adds: holes from phase cancellation in
    // the crossfade or dropouts. 50 ms windows from 1 s to 6 s must stay
    // within 6 dB of the median level. Seam clicks are covered in
    // orchestra.test.ts.
    const levels: number[] = [];
    for (let t = 1; t < 6; t += 0.05) {
      let sum = 0;
      const from = Math.round(t * SR);
      for (let i = from; i < from + SR / 20; i++) sum += x[i]! ** 2;
      levels.push(10 * Math.log10(sum / (SR / 20)));
    }
    const median = [...levels].sort((a, b) => a - b)[levels.length >> 1]!;
    const hole = median - Math.min(...levels);
    assert.ok(hole < 6, `${id}: level hole ${hole.toFixed(2)} dB below median`);
    for (const at of [2, 4.5]) {
      const check = checkRootPitch(x.subarray(Math.round(at * SR)), SR, midi);
      assert.equal(check.octaveError, 0, `${id} at ${at}s`);
      assert.ok(
        Math.abs(check.centsOffset) < 20,
        `${id} at ${at}s: ${check.centsOffset}`,
      );
    }
  });
