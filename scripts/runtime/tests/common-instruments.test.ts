import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  listBundledCollections,
  bundledCollectionManifest,
  importInstrumentCollection,
  packFreshnessDiagnostics,
} from "../src/instrument-collection.js";
import { fixture } from "./helpers.js";
import { compileScore } from "../src/compiler.js";
import { decodeWav } from "../src/wav.js";
test("common packs import all six usable instruments without any material-directory dependency", async () => {
  const available = await listBundledCollections();
  assert.deepEqual(
    available.map((p) => p.id),
    ["band", "drums", "orchestra", "piano", "starter"],
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
  // band 1.2.0 / piano 1.1.0: a root every six semitones for bass, guitar
  // and piano (max shift ±3), 2 layers x 2 RR where available.
  assert.ok(bytes < 9_500_000, `${bytes} bytes`);
  for (const p of score.instrumentDefinitions.filter((p: any) => p.sample)) {
    const roots = [...new Set(p.sample.zones.map((z: any) => z.rootMidi))];
    for (const z of p.sample.zones)
      assert.ok(
        Math.max(z.rootMidi - z.lowMidi, z.highMidi - z.rootMidi) <= 3,
        `${p.id}: zone ${z.lowMidi}-${z.highMidi} shifts more than 3 semitones from ${z.rootMidi}`,
      );
    assert.ok(roots.length >= 6, p.id);
  }
  for (const id of ["band-bass", "band-guitar", "keys-grand", "drums-acoustic"])
    assert.equal(
      score.instrumentDefinitions.find((p: any) => p.id === id)
        .velocityCrossfade,
      24,
    );
  const bass = score.instrumentDefinitions.find(
    (p: any) => p.id === "band-bass",
  );
  assert.equal(bass.sample.zones.length, 24);
  assert.deepEqual(bass.range, [28, 60]);
  assert.deepEqual(bass.pack.id, "band");
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

test("pack freshness flags stale copies but not author gain tweaks", async () => {
  const path = bundledCollectionManifest("band"),
    pack = JSON.parse(await readFile(path, "utf8"));
  let score: any = await importInstrumentCollection(
    fixture(),
    pack,
    dirname(path),
    ["band-bass"],
  );
  assert.deepEqual(await packFreshnessDiagnostics(score), []);
  // Score authors rebalance imported zones; that is not staleness.
  score.instrumentDefinitions[0].sample.zones[0].gainDb = 3;
  assert.deepEqual(await packFreshnessDiagnostics(score), []);
  // A copy imported from an older pack release carries an older digest.
  score.instrumentDefinitions[0].pack.digest = "0".repeat(64);
  const [stale] = await packFreshnessDiagnostics(score);
  assert.equal(stale?.code, "STALE_PACK_INSTRUMENT");
  assert.match(
    String(stale?.suggestion),
    /--pack band --instrument band-bass --replace/,
  );
  // Unstamped legacy copies are compared by sample mapping: the pre-1.1.0
  // bass declared root 40 for a recording of E1 (MIDI 28).
  delete score.instrumentDefinitions[0].pack;
  score.instrumentDefinitions[0].sample.zones[0].rootMidi = 40;
  assert.equal((await packFreshnessDiagnostics(score)).length, 1);
});

test("import-pack replace swaps a stale instrument and drops orphaned samples", async () => {
  const path = bundledCollectionManifest("band"),
    pack = JSON.parse(await readFile(path, "utf8"));
  let score: any = await importInstrumentCollection(
    fixture(),
    pack,
    dirname(path),
    ["band-bass", "band-guitar"],
  );
  score.sampleAssets["band-bass-40-soft-1"] =
    score.sampleAssets["band-bass-28-soft-1"];
  score.instrumentDefinitions[0].sample.zones[0].assetId =
    "band-bass-40-soft-1";
  await assert.rejects(
    importInstrumentCollection(score, pack, dirname(path), ["band-bass"]),
    /INSTRUMENT_ALREADY_EXISTS/,
  );
  score = await importInstrumentCollection(
    score,
    pack,
    dirname(path),
    ["band-bass"],
    { replace: true },
  );
  assert.deepEqual(score.instrumentDefinitions.map((p: any) => p.id).sort(), [
    "band-bass",
    "band-guitar",
  ]);
  assert.ok(!("band-bass-40-soft-1" in score.sampleAssets));
  assert.ok("band-guitar-40-soft-1" in score.sampleAssets);
  assert.deepEqual(await packFreshnessDiagnostics(score), []);
});
