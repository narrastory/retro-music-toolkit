import { toTick, type Score, type Diagnostic } from "./model.js";
import { INSTRUMENTS } from "./instruments.js";
import {
  decodeSampleAsset,
  referencedAssets,
  type SampleAsset,
} from "./instrument-model.js";

export type DecodedAssets = Map<
  string,
  { channels: Float32Array[]; sampleRate: number }
>;

/**
 * Structural checks that need the instrument/asset layer rather than the
 * score schema. Assets are decoded once and returned so callers can reuse them.
 */
export function validateExtensions(
  s: Score,
  decoded: DecodedAssets = new Map(),
): { diagnostics: Diagnostic[]; decoded: DecodedAssets } {
  const diagnostics: Diagnostic[] = [];
  const error = (
    code: string,
    message: string,
    path?: string,
    extra: Partial<Diagnostic> = {},
  ) => diagnostics.push({ severity: "error", code, message, path, ...extra });
  const names = new Set(INSTRUMENTS.map((p) => p.id));
  let totalFrames = 0;
  for (const [id, asset] of Object.entries(s.sampleAssets ?? {})) {
    try {
      const a = decodeSampleAsset(asset as SampleAsset);
      decoded.set(id, a);
      totalFrames += a.channels[0]!.length * a.channels.length;
    } catch (e) {
      error(
        "SAMPLE_ASSET",
        `${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (totalFrames > 4_000_000)
    error(
      "SAMPLE_BUDGET",
      "Embedded sample assets exceed 4 million channel frames",
      undefined,
      { suggestion: { frames: totalFrames } },
    );

  for (const p of s.instrumentDefinitions ?? []) {
    if (names.has(p.id))
      error("INSTRUMENT_ID", `Duplicate or reserved instrument ID: ${p.id}`);
    names.add(p.id);
    if (p.range[0] > p.range[1])
      error("INSTRUMENT_RANGE", `Invalid range: ${p.id}`);
    if (p.engine === "sample" && !p.sample)
      error("SAMPLE_DEFINITION", `Missing sample definition: ${p.id}`);
    if (p.engine !== "sample" && p.sample)
      error(
        "SAMPLE_DEFINITION",
        `Sample definition on non-sample engine: ${p.id}`,
      );
    if (p.drumKit && p.engine !== "drums")
      error(
        "DRUM_DEFINITION",
        `drumKit is only valid on the drums engine: ${p.id}`,
      );
    if (p.engine === "drums" && !p.drumKit && p.sample)
      error(
        "DRUM_DEFINITION",
        `Drums must use drumKit for samples, not sample.zones: ${p.id}`,
      );
    if (p.sample?.kind === "zones") {
      const zones = [...p.sample.zones].sort((a, b) => a.lowMidi - b.lowMidi);
      for (const [i, z] of zones.entries()) {
        const a = decoded.get(z.assetId);
        if (!a)
          error(
            "SAMPLE_REFERENCE",
            `${p.id}: missing/invalid asset ${z.assetId}`,
          );
        if (
          z.lowMidi > z.highMidi ||
          (i > 0 && zones[i - 1]!.highMidi >= z.lowMidi)
        )
          error("SAMPLE_ZONES", `${p.id}: invalid/overlapping zones`);
        if ((z.loopStartFrame === undefined) !== (z.loopEndFrame === undefined))
          error("SAMPLE_LOOP", "Both loop frame boundaries are required");
        if (
          z.loopStartFrame !== undefined &&
          z.loopEndFrame !== undefined &&
          (z.loopStartFrame >= z.loopEndFrame ||
            (a && z.loopEndFrame > a.channels[0]!.length) ||
            z.loopCrossfadeFrames * 2 > z.loopEndFrame - z.loopStartFrame)
        )
          error(
            "SAMPLE_LOOP",
            `${p.id}: loop must be [start,end) within the sample, with crossfade shorter than the loop`,
          );
      }
    }
    if (p.drumKit) {
      const seen = new Set<string>();
      for (const slot of p.drumKit.slots) {
        if (seen.has(slot.sound))
          error("DRUM_SLOTS", `${p.id}: duplicate drum slot ${slot.sound}`);
        seen.add(slot.sound);
        const a = decoded.get(slot.assetId);
        if (!a)
          error(
            "SAMPLE_REFERENCE",
            `${p.id}: missing drum asset ${slot.assetId}`,
          );
        else if (slot.startFrame >= a.channels[0]!.length)
          error(
            "DRUM_SLOTS",
            `${p.id}: ${slot.sound} startFrame is past the end of the sample`,
          );
      }
    }
    for (const assetId of referencedAssets(p))
      if (!decoded.has(assetId))
        error(
          "SAMPLE_REFERENCE",
          `${p.id}: unreferenced or missing asset ${assetId}`,
        );
  }

  const ranges = {
    gainDb: [-60, 6],
    pan: [-1, 1],
    brightness: [0, 1],
    send: [0, 1],
  } as const;
  for (const t of s.tracks) {
    const params = new Set<string>();
    for (const lane of t.automation ?? []) {
      if (params.has(lane.parameter))
        error("AUTOMATION_DUPLICATE", t.id + ": " + lane.parameter);
      params.add(lane.parameter);
      let last = -1;
      for (const p of lane.points) {
        try {
          toTick(p.at);
        } catch {
          error("TIME_GRID", "Automation point is off grid", t.id);
        }
        const [lo, hi] = ranges[lane.parameter];
        if (
          p.at <= last ||
          p.at > s.lengthBeats ||
          p.value < lo ||
          p.value > hi
        )
          error(
            "AUTOMATION_POINT",
            `${t.id}: unordered, out-of-range or out-of-song point at beat ${p.at}`,
            undefined,
            { suggestion: { min: lo, max: hi, maxBeat: s.lengthBeats } },
          );
        last = p.at;
      }
    }
    for (const pattern of Object.values(t.patterns))
      for (const e of pattern.events) {
        if (e.kind !== "note") continue;
        const port = e.expression?.portamentoBeats ?? 0;
        if (port > 0 && e.articulation !== "legato")
          error(
            "PORTAMENTO_ARTICULATION",
            `${e.id}: portamento requires legato`,
          );
        if (port > 0 && port > e.duration * e.gate)
          error(
            "PORTAMENTO_RANGE",
            `${e.id}: glide exceeds note gate`,
            undefined,
            { suggestion: { maxPortamentoBeats: e.duration * e.gate } },
          );
        let previous = -1;
        for (const point of e.expression?.pitchBendCents ?? []) {
          try {
            toTick(point.offsetBeats);
          } catch {
            error("TIME_GRID", e.id + ": bend point is off grid");
          }
          if (point.offsetBeats <= previous || point.offsetBeats > e.duration)
            error(
              "PITCH_BEND_POINTS",
              `${e.id}: bend points must be ordered and within nominal duration`,
            );
          previous = point.offsetBeats;
        }
      }
  }
  return { diagnostics, decoded };
}
