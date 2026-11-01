import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  bundledCollectionManifest,
  importInstrumentCollection,
} from "../src/instrument-collection.js";
import { compileScore } from "../src/compiler.js";
import { decodeWav } from "../src/wav.js";
import { bakeLoopCrossfade } from "../src/dsp.js";
import { fixture } from "./helpers.js";

const path = bundledCollectionManifest("orchestra");
const load = async () => JSON.parse(await readFile(path, "utf8"));

test("orchestra pack: ten CC0 instruments, each importable within the score budget", async () => {
  const pack = await load();
  assert.equal(pack.license, "CC0-1.0");
  assert.deepEqual(
    pack.instruments.map((i: any) => i.instrument.id),
    [
      "orch-strings",
      "orch-pizzicato",
      "orch-flute",
      "orch-clarinet",
      "orch-horn",
      "orch-harp",
      "orch-marimba",
      "orch-vibraphone",
      "orch-ocarina",
      "orch-harpsichord",
    ],
  );
  // A typical Stardew-style palette fits one score together.
  const score: any = await importInstrumentCollection(
    fixture(),
    pack,
    dirname(path),
    [
      "orch-strings",
      "orch-pizzicato",
      "orch-flute",
      "orch-harp",
      "orch-marimba",
    ],
  );
  assert.doesNotThrow(() => compileScore(score));
  for (const item of pack.instruments) {
    const zones = item.instrument.sample.zones;
    for (const z of zones) {
      assert.ok(
        Math.max(z.rootMidi - z.lowMidi, z.highMidi - z.rootMidi) <= 3,
        `${z.assetId} shifts more than 3 semitones`,
      );
      for (const a of item.assets)
        assert.match(
          a.provenance,
          /Versilian Studios, CC0-1\.0; [0-9a-f]{40}; /,
        );
    }
  }
});

test("orchestra sustain loops join without a click once the crossfade is baked", async () => {
  const pack = await load();
  let looped = 0;
  for (const item of pack.instruments)
    for (const z of item.instrument.sample.zones) {
      if (z.loopStartFrame === undefined) continue;
      looped++;
      const asset = item.assets.find((a: any) => a.id === z.assetId);
      const x = decodeWav(await readFile(resolve(dirname(path), asset.file)))
        .channels[0]!;
      assert.ok(z.loopStartFrame >= z.loopCrossfadeFrames, z.assetId);
      assert.ok(
        z.loopEndFrame < x.length - 0.06 * 32000,
        `${z.assetId} loop reaches the end fade`,
      );
      const [baked] = bakeLoopCrossfade(
        [x],
        z.loopStartFrame,
        z.loopEndFrame,
        z.loopCrossfadeFrames,
        z.loopCrossfadeShape,
      );
      // Typical frame-to-frame change inside the loop vs the change at the seam.
      let typical = 0;
      for (let i = z.loopStartFrame + 1; i < z.loopEndFrame; i++)
        typical = Math.max(typical, Math.abs(baked![i]! - baked![i - 1]!));
      const seam = Math.abs(
        baked![z.loopStartFrame]! - baked![z.loopEndFrame - 1]!,
      );
      assert.ok(
        seam <= typical * 1.05,
        `${z.assetId}: seam ${seam} vs ${typical}`,
      );
    }
  assert.equal(looped, 49);
});
