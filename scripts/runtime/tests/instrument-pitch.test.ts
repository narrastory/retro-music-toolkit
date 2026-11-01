import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  listBundledCollections,
  InstrumentCollectionSchema,
} from "../src/instrument-collection.js";
import { decodeWav } from "../src/wav.js";
import { checkRootPitch } from "../src/pitch.js";

/** Largest tolerated gap between measured pitch and root + tuningCents. */
const MAX_CENTS = 25;

function sine(midi: number, seconds = 0.6, sampleRate = 32000) {
  const f = 440 * 2 ** ((midi - 69) / 12),
    out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++)
    for (let k = 1; k <= 6; k++)
      out[i]! += Math.sin((2 * Math.PI * f * k * i) / sampleRate) / k;
  return out;
}

test("root pitch check reports octave errors and cents offsets", () => {
  assert.deepEqual(
    [40, 52, 64].map((m) => checkRootPitch(sine(m), 32000, m).octaveError),
    [0, 0, 0],
  );
  assert.equal(checkRootPitch(sine(28), 32000, 40).octaveError, -1);
  assert.equal(checkRootPitch(sine(52), 32000, 40).octaveError, 1);
  const sharp = checkRootPitch(sine(45.2), 32000, 45);
  assert.equal(sharp.octaveError, 0);
  assert.ok(Math.abs(sharp.centsOffset - 20) <= 2, `${sharp.centsOffset}`);
});

test("every bundled sample zone sounds at its declared root", async () => {
  const failures: string[] = [];
  for (const summary of await listBundledCollections()) {
    const pack = InstrumentCollectionSchema.parse(
      JSON.parse(await readFile(summary.manifest, "utf8")),
    );
    for (const item of pack.instruments) {
      if (item.instrument.sample?.kind !== "zones") continue;
      const files = new Map(item.assets.map((a) => [a.id, a.file]));
      for (const zone of item.instrument.sample.zones) {
        const bytes = await readFile(
          resolve(dirname(summary.manifest), files.get(zone.assetId)!),
        );
        const wav = decodeWav(bytes);
        const check = checkRootPitch(
          wav.channels[0]!,
          wav.sampleRate,
          zone.rootMidi,
        );
        const cents = check.centsOffset - zone.tuningCents;
        if (check.octaveError || Math.abs(cents) > MAX_CENTS)
          failures.push(
            `${zone.assetId}: root ${zone.rootMidi}, octave ${check.octaveError}, ` +
              `${cents.toFixed(1)} cents off declared tuning`,
          );
      }
    }
  }
  assert.deepEqual(failures, []);
});
