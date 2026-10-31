import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { importInstrumentCollection } from "../src/instrument-collection.js";
import { encodeWav } from "../src/wav.js";
import { fixture } from "./helpers.js";
import { readFile, symlink, truncate } from "node:fs/promises";
import { dirname } from "node:path";
import {
  bundledStarterManifest,
  InstrumentCollectionSchema,
} from "../src/instrument-collection.js";
import { decodeWav } from "../src/wav.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "retro-pack-"));
  const bytes = Buffer.from(
    encodeWav(
      [Float32Array.from({ length: 800 }, (_, i) => Math.sin(i / 10) * 0.2)],
      8000,
    ),
  );
  await writeFile(join(dir, "tone.wav"), bytes);
  const item = (id: string) => ({
    instrument: {
      id,
      engine: "sample",
      role: "melody",
      range: [60, 84],
      attack: 0.01,
      release: 0.1,
      description: "Test sample",
      sample: {
        kind: "zones",
        zones: [
          { lowMidi: 60, highMidi: 84, rootMidi: 72, assetId: id + "-asset" },
        ],
      },
    },
    assets: [
      {
        id: id + "-asset",
        file: "tone.wav",
        provenance: "Original test tone",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  });
  return {
    dir,
    pack: {
      id: "test-pack",
      name: "Test",
      version: "1.0.0",
      license: "CC0-1.0",
      source: "https://example.com/samples",
      instruments: [item("test-a"), item("test-b")],
    },
  };
}
test("collection selection imports verified portable assets without mutating the source", async () => {
  const { dir, pack } = await setup();
  try {
    const source = fixture(),
      before = structuredClone(source);
    const result = await importInstrumentCollection(source, pack, dir, [
      "test-b",
    ]);
    assert.deepEqual(source, before);
    assert.deepEqual(
      result.instrumentDefinitions?.map((p) => p.id),
      ["test-b"],
    );
    assert.deepEqual(Object.keys(result.sampleAssets!), ["test-b-asset"]);
    assert.ok(result.sampleAssets!["test-b-asset"]!.dataBase64.length > 100);
    assert.equal(
      (await importInstrumentCollection(source, pack, dir))
        .instrumentDefinitions?.length,
      2,
    );
    await assert.rejects(
      () => importInstrumentCollection(source, pack, dir, ["missing"]),
      /PACK_INSTRUMENT_NOT_FOUND/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("collection rejects corruption, duplicate IDs, file escapes and existing instruments atomically", async () => {
  const { dir, pack } = await setup();
  try {
    const source = fixture();
    const corrupted = structuredClone(pack);
    corrupted.instruments[0]!.assets[0]!.sha256 = "0".repeat(64);
    await assert.rejects(
      () => importInstrumentCollection(source, corrupted, dir),
      /ASSET_HASH_MISMATCH/,
    );
    const escaped = structuredClone(pack);
    escaped.instruments[0]!.assets[0]!.file = "../outside.wav";
    await assert.rejects(
      () => importInstrumentCollection(source, escaped, dir),
      /PACK_PATH_ESCAPE/,
    );
    const external = await mkdtemp(join(tmpdir(), "retro-external-"));
    try {
      await writeFile(
        join(external, "tone.wav"),
        await readFile(join(dir, "tone.wav")),
      );
      await symlink(
        external,
        join(dir, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const linked = structuredClone(pack);
      linked.instruments[0]!.assets[0]!.file = "escape/tone.wav";
      await assert.rejects(
        () => importInstrumentCollection(source, linked, dir),
        /PACK_PATH_ESCAPE/,
      );
    } finally {
      await rm(external, { recursive: true, force: true });
    }
    const duplicate = structuredClone(pack);
    duplicate.instruments.push(duplicate.instruments[0]!);
    await assert.rejects(
      () => importInstrumentCollection(source, duplicate, dir),
      /DUPLICATE_INSTRUMENT/,
    );
    const existing = await importInstrumentCollection(source, pack, dir);
    await assert.rejects(
      () => importInstrumentCollection(existing, pack, dir),
      /INSTRUMENT_ALREADY_EXISTS/,
    );
    await writeFile(join(dir, "tone.wav"), "not a WAV");
    await assert.rejects(
      () => importInstrumentCollection(source, pack, dir),
      /ASSET_HASH_MISMATCH/,
    );
    assert.equal((source as any).sampleAssets, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("bundled starter pack ships four complete, calibrated, hash-verified instruments under 2 MB", async () => {
  const pack = InstrumentCollectionSchema.parse(
    JSON.parse(await readFile(bundledStarterManifest, "utf8")),
  );
  assert.equal(pack.license, "CC0-1.0");
  assert.equal(pack.instruments.length, 4);
  const score = await importInstrumentCollection(
    fixture(),
    pack,
    dirname(bundledStarterManifest),
  );
  let bytes = 0;
  for (const item of pack.instruments) {
    const zones = item.instrument.sample;
    assert.equal(zones?.kind, "zones");
    if (zones?.kind !== "zones") throw new Error("Expected sample zones");
    assert.equal(zones.zones[0]!.lowMidi, item.instrument.range[0]);
    assert.equal(zones.zones.at(-1)!.highMidi, item.instrument.range[1]);
    for (let i = 0; i < zones.zones.length; i++) {
      const zone = zones.zones[i]!;
      if (i) assert.equal(zone.lowMidi, zones.zones[i - 1]!.highMidi + 1);
      const wav = Buffer.from(
        score.sampleAssets![zone.assetId]!.dataBase64,
        "base64",
      );
      bytes += wav.length;
      const decoded = decodeWav(wav);
      assert.equal(decoded.sampleRate, 32000);
      const peak = decoded.channels[0]!.reduce(
        (max, v) => Math.max(max, Math.abs(v)),
        0,
      );
      assert.ok(peak > 0.399 && peak < 0.401);
    }
  }
  assert.ok(bytes < 2_000_000);
});
test("collection rejects oversized files and aggregate payloads before decoding", async () => {
  const { dir, pack } = await setup();
  try {
    await truncate(join(dir, "tone.wav"), 6_000_001);
    await assert.rejects(
      () => importInstrumentCollection(fixture(), pack, dir),
      /PACK_ASSET_TOO_LARGE/,
    );
    const directory = structuredClone(pack);
    directory.instruments[0]!.assets[0]!.file = ".";
    await assert.rejects(
      () => importInstrumentCollection(fixture(), directory, dir),
      /PACK_ASSET_NOT_FILE/,
    );
    // Existing embedded bytes also count, without decoding a large payload.
    const source = {
      ...fixture(),
      sampleAssets: Object.fromEntries(
        [0, 1, 2, 3, 4].map((i) => [
          "existing" + i,
          {
            format: "wav-pcm16",
            dataBase64: "A".repeat(7_000_000),
            provenance: "Budget test placeholder",
          },
        ]),
      ),
    };
    await assert.rejects(
      () => importInstrumentCollection(source, pack, dir),
      /PACK_TOTAL_TOO_LARGE/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
