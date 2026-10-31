import { z } from "zod";
import { decodeWav } from "./wav.js";

/**
 * Drum piece identifiers live here, not in model.ts: the score schema imports
 * this module, so defining them here keeps the dependency one-directional.
 */
export const DrumSoundSchema = z.enum([
  "kick",
  "snare",
  "hat",
  "openhat",
  "tom",
  "crash",
  "rim",
  "clap",
]);
export type DrumSound = z.infer<typeof DrumSoundSchema>;

const midi = z.number().int().min(0).max(127);
const variantFields = {
  lowVelocity: z.number().int().min(1).max(127).default(1),
  highVelocity: z.number().int().min(1).max(127).default(127),
  roundRobin: z.number().int().min(1).max(16).default(1),
};
export const SampleZoneSchema = z.strictObject({
  ...variantFields,
  lowMidi: midi,
  highMidi: midi,
  rootMidi: midi,
  assetId: z.string().min(1).max(80),
  tuningCents: z.number().min(-100).max(100).default(0),
  gainDb: z.number().min(-36).max(6).default(0),
  loopStartFrame: z.number().int().min(0).optional(),
  loopEndFrame: z.number().int().positive().optional(),
  /** Fade length in source frames applied at the loop point to hide a click. */
  loopCrossfadeFrames: z.number().int().min(0).max(20000).default(0),
});
/** One sampled drum piece. `sound` selects which hit event triggers it. */
export const DrumKitSlotSchema = z.strictObject({
  ...variantFields,
  sound: DrumSoundSchema,
  assetId: z.string().min(1).max(80),
  gainDb: z.number().min(-36).max(6).default(0),
  tuningCents: z.number().min(-100).max(100).default(0),
  /** Trim leading silence or pick a later start; in source frames. */
  startFrame: z.number().int().min(0).default(0),
});
export const DrumKitSchema = z.strictObject({
  slots: z.array(DrumKitSlotSchema).min(1).max(64),
});
export const InstrumentDefinitionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  engine: z.enum(["pulse", "triangle", "fm", "sample", "drums"]),
  role: z.enum(["melody", "bass", "harmony", "arp", "drums", "texture"]),
  range: z.tuple([midi, midi]),
  attack: z.number().min(0).max(3),
  release: z.number().min(0).max(5),
  description: z.string().min(1).max(1000),
  synthesis: z
    .strictObject({
      pulseWidth: z.number().min(-0.95).max(0.95).default(0),
      harmonicity: z.number().min(0.1).max(16).default(2),
      modulationIndex: z.number().min(0).max(20).optional(),
      decaySeconds: z.number().min(0).max(4).optional(),
      sustain: z.number().min(0).max(1).default(0.65),
      volumeDb: z.number().min(-36).max(0).default(-7),
    })
    .optional(),
  sample: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("procedural"),
        wave: z.enum(["flute", "strings", "bass", "pluck"]),
      }),
      z.strictObject({
        kind: z.literal("zones"),
        zones: z.array(SampleZoneSchema).min(1).max(32),
      }),
    ])
    .optional(),
  /** Sampled drum kit; only valid on the drums engine. */
  drumKit: DrumKitSchema.optional(),
  velocityResponse: z
    .strictObject({
      filterOctaves: z.number().min(0).max(4).default(0),
      fmIndexScale: z.number().min(0).max(2).default(0),
    })
    .optional(),
  provenance: z.string().max(1000).optional(),
});
export const SampleAssetSchema = z.strictObject({
  format: z.literal("wav-pcm16"),
  dataBase64: z.string().min(1).max(8_000_000),
  provenance: z.string().min(1).max(1000),
});
export type InstrumentDefinition = z.infer<typeof InstrumentDefinitionSchema>;
export type SampleAsset = z.infer<typeof SampleAssetSchema>;
export type SampleZone = z.infer<typeof SampleZoneSchema>;

const MAX_SAMPLE_FRAMES = 768000;

export function decodeSampleAsset(asset: SampleAsset) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      asset.dataBase64,
    )
  )
    throw new Error("Invalid sample base64");
  const binary = atob(asset.dataBase64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const data = decodeWav(bytes);
  if (
    data.sampleRate < 8000 ||
    data.sampleRate > 96000 ||
    data.channels[0]!.length > MAX_SAMPLE_FRAMES
  )
    throw new Error(
      `Sample exceeds supported sample rate or ${MAX_SAMPLE_FRAMES}-frame limit`,
    );
  return data;
}
function matchesVelocity(
  item: { lowVelocity?: number; highVelocity?: number },
  velocity?: number,
) {
  if (velocity === undefined) return true;
  const value = Math.max(1, Math.min(127, Math.round(velocity * 127)));
  return (
    value >= (item.lowVelocity ?? 1) && value <= (item.highVelocity ?? 127)
  );
}
export function matchingZones(
  p: InstrumentDefinition,
  note: number,
  velocity?: number,
) {
  return p.sample?.kind === "zones"
    ? p.sample.zones
        .filter(
          (z) =>
            note >= z.lowMidi &&
            note <= z.highMidi &&
            matchesVelocity(z, velocity),
        )
        .sort((a, b) => a.roundRobin - b.roundRobin)
    : [];
}
export function findZone(
  p: InstrumentDefinition,
  note: number,
  velocity?: number,
) {
  return matchingZones(p, note, velocity)[0];
}
export function matchingDrumSlots(
  p: InstrumentDefinition,
  sound: DrumSound,
  velocity?: number,
) {
  return (p.drumKit?.slots ?? [])
    .filter((s) => s.sound === sound && matchesVelocity(s, velocity))
    .sort((a, b) => a.roundRobin - b.roundRobin);
}
export function findDrumSlot(
  p: InstrumentDefinition,
  sound: DrumSound,
  velocity?: number,
) {
  return matchingDrumSlots(p, sound, velocity)[0];
}
/** Asset IDs referenced by an instrument, for budget and reference checks. */
export function referencedAssets(p: InstrumentDefinition): string[] {
  const ids: string[] = [];
  if (p.sample?.kind === "zones")
    ids.push(...p.sample.zones.map((z) => z.assetId));
  if (p.drumKit) ids.push(...p.drumKit.slots.map((s) => s.assetId));
  return ids;
}
