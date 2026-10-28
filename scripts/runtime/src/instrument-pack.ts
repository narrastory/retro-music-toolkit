import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ScoreSchema } from "./model.js";
import {
  InstrumentDefinitionSchema,
  decodeSampleAsset,
} from "./instrument-model.js";
import { compileScore } from "./compiler.js";
export const InstrumentPackageSchema = z.strictObject({
  instrument: InstrumentDefinitionSchema,
  assets: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(80),
        file: z.string().min(1),
        provenance: z.string().min(1).max(1000),
      }),
    )
    .max(32)
    .default([]),
});
export async function importInstrument(
  input: unknown,
  definition: unknown,
  baseDirectory: string,
) {
  const score = ScoreSchema.parse(input),
    pack = InstrumentPackageSchema.parse(definition);
  score.schemaVersion = "1.3";
  score.instrumentDefinitions ??= [];
  score.sampleAssets ??= {};
  if (score.instrumentDefinitions.some((p) => p.id === pack.instrument.id))
    throw new Error("INSTRUMENT_ALREADY_EXISTS");
  for (const asset of pack.assets) {
    if (Object.hasOwn(score.sampleAssets, asset.id))
      throw new Error(`ASSET_ALREADY_EXISTS: ${asset.id}`);
    const bytes = await readFile(resolve(baseDirectory, asset.file));
    const embedded = {
      format: "wav-pcm16" as const,
      dataBase64: bytes.toString("base64"),
      provenance: asset.provenance,
    };
    decodeSampleAsset(embedded);
    score.sampleAssets[asset.id] = embedded;
  }
  score.instrumentDefinitions.push(pack.instrument);
  return compileScore(score).score;
}
