import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  listBundledCollections,
  bundledCollectionManifest,
  importInstrumentCollection,
} from "../src/instrument-collection.js";
import { fixture } from "./helpers.js";
import { compileScore } from "../src/compiler.js";
import { decodeWav } from "../src/wav.js";
test("common packs import all six usable instruments without any material-directory dependency", async () => {
  const available = await listBundledCollections();
  assert.deepEqual(
    available.map((p) => p.id),
    ["band", "drums", "piano", "starter"],
  );
  let score: any = fixture();
  let count = 0,
    bytes = 0;
  for (const id of ["band", "piano", "drums"]) {
    const path = bundledCollectionManifest(id),
      pack = JSON.parse(await readFile(path, "utf8"));
    score = await importInstrumentCollection(score, pack, dirname(path));
    count += pack.instruments.length;
    for (const item of pack.instruments)
      for (const a of item.assets) {
        assert.ok(a.file.startsWith("samples/"));
        assert.ok(!a.file.includes(".."));
        assert.match(a.provenance, /https:\/\//);
      }
  }
  assert.equal(count, 6);
  assert.doesNotThrow(() => compileScore(score));
  for (const a of Object.values(score.sampleAssets) as any[]) {
    const data = Buffer.from(a.dataBase64, "base64");
    bytes += data.length;
    assert.ok(
      decodeWav(data).channels[0]!.some((v) => Math.abs(v) > 0.0001),
      "curated samples must not be silent",
    );
  }
  assert.ok(bytes < 5_000_000);
  const bass = score.instrumentDefinitions.find(
    (p: any) => p.id === "band-bass",
  );
  assert.equal(bass.sample.zones.length, 12);
  assert.equal(
    new Set(bass.sample.zones.map((z: any) => z.roundRobin)).size,
    2,
  );
  assert.equal(
    score.instrumentDefinitions.find((p: any) => p.id === "drums-acoustic")
      .drumKit.slots.length,
    20,
  );
});
