import { z } from "zod";
import { open, realpath, stat, readdir, readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { InstrumentPackageSchema } from "./instrument-pack.js";
import { ScoreSchema, ToolkitError } from "./model.js";
import { compileScore } from "./compiler.js";
import { decodeSampleAsset } from "./instrument-model.js";

const AssetSchema = z.strictObject({
  id: z.string().min(1).max(80),
  file: z.string().min(1),
  provenance: z.string().min(1).max(1000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const InstrumentCollectionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  license: z.string().min(1).max(100),
  source: z.string().url(),
  instruments: z
    .array(
      InstrumentPackageSchema.extend({ assets: z.array(AssetSchema).max(32) }),
    )
    .min(1)
    .max(64),
});
export const bundledStarterManifest = fileURLToPath(
  new URL("../instruments/starter/pack.json", import.meta.url),
);
export function bundledCollectionManifest(id = "starter") {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
    throw new ToolkitError("UNKNOWN_PACK", id);
  return fileURLToPath(
    new URL(`../instruments/${id}/pack.json`, import.meta.url),
  );
}
export async function listBundledCollections() {
  const root = new URL("../instruments/", import.meta.url);
  const directories = await readdir(root, { withFileTypes: true });
  const packs = [];
  for (const dir of directories
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const manifest = bundledCollectionManifest(dir.name);
    const pack = InstrumentCollectionSchema.parse(
      JSON.parse(await readFile(manifest, "utf8")),
    );
    packs.push({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      license: pack.license,
      source: pack.source,
      manifest,
      instruments: pack.instruments.map((p) => ({
        ...p.instrument,
        sampleCount: p.assets.length,
      })),
    });
  }
  return packs;
}
const MAX_ASSET_BYTES = 6_000_000; // Matches the 8 MB base64 asset schema cap.
const MAX_IMPORT_BYTES = 24_000_000; // Container/PCM overhead; frame caps still apply.

export async function importInstrumentCollection(
  input: unknown,
  manifest: unknown,
  baseDirectory: string,
  selection?: string[],
) {
  const pack = InstrumentCollectionSchema.parse(manifest);
  const score = ScoreSchema.parse(input);
  const fail = (code: string, message: string): never => {
    throw new ToolkitError(code, message);
  };
  const ids = pack.instruments.map((p) => p.instrument.id);
  if (new Set(ids).size !== ids.length) fail("DUPLICATE_INSTRUMENT", pack.id);
  const requested = new Set(selection ?? ids);
  if (!requested.size) fail("PACK_INSTRUMENT_NOT_FOUND", "Empty selection");
  for (const id of requested)
    if (!ids.includes(id)) fail("PACK_INSTRUMENT_NOT_FOUND", id);
  score.instrumentDefinitions ??= [];
  score.sampleAssets ??= {};
  let totalBytes = Object.values(score.sampleAssets).reduce(
    (sum, a) => sum + Math.ceil((a.dataBase64.length * 3) / 4),
    0,
  );
  if (totalBytes > MAX_IMPORT_BYTES)
    fail("PACK_TOTAL_TOO_LARGE", "24 MB import budget exceeded");
  const base = await realpath(baseDirectory);
  const contained = (path: string) => {
    const rel = relative(base, path);
    return (
      rel !== ".." &&
      !rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
      !isAbsolute(rel)
    );
  };
  for (const item of pack.instruments.filter((p) =>
    requested.has(p.instrument.id),
  )) {
    if (score.instrumentDefinitions.some((p) => p.id === item.instrument.id))
      fail("INSTRUMENT_ALREADY_EXISTS", item.instrument.id);
    for (const asset of item.assets) {
      if (Object.hasOwn(score.sampleAssets, asset.id))
        fail("ASSET_ALREADY_EXISTS", asset.id);
      const path = resolve(base, asset.file);
      if (isAbsolute(asset.file) || !contained(path))
        fail("PACK_PATH_ESCAPE", asset.file);
      const canonical = await realpath(path);
      if (!contained(canonical)) fail("PACK_PATH_ESCAPE", asset.file);
      if (!(await stat(canonical)).isFile())
        fail("PACK_ASSET_NOT_FILE", asset.file);
      const handle = await open(canonical, "r");
      let bytes: Buffer;
      try {
        const info = await handle.stat();
        if (!info.isFile()) fail("PACK_ASSET_NOT_FILE", asset.file);
        if (info.size > MAX_ASSET_BYTES)
          fail("PACK_ASSET_TOO_LARGE", `${asset.file}: maximum 6 MB`);
        totalBytes += info.size;
        if (totalBytes > MAX_IMPORT_BYTES)
          fail("PACK_TOTAL_TOO_LARGE", "24 MB import budget exceeded");
        // Bounded reads also prevent a file growing after stat from allocating
        // an unbounded buffer. Always close the handle on any validation error.
        bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            offset,
          );
          if (!bytesRead) fail("PACK_ASSET_CHANGED", asset.file);
          offset += bytesRead;
        }
        if ((await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead)
          fail("PACK_ASSET_CHANGED", asset.file);
      } finally {
        await handle.close();
      }
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
        fail("ASSET_HASH_MISMATCH", asset.id);
      const embedded = {
        format: "wav-pcm16" as const,
        dataBase64: bytes.toString("base64"),
        provenance: asset.provenance,
      };
      decodeSampleAsset(embedded);
      score.sampleAssets[asset.id] = embedded;
    }
    score.instrumentDefinitions.push(item.instrument);
  }
  score.schemaVersion = "1.3";
  return compileScore(score).score;
}
