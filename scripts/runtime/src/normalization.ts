import { analyzeChannels } from "./analysis.js";
import { NormalizationSchema } from "./render-options.js";
export function normalizeChannels(
  channels: Float32Array[],
  sampleRate: number,
  options: unknown = {},
) {
  const config = NormalizationSchema.parse(options),
    before = analyzeChannels(channels, sampleRate);
  if (before.nonFiniteSamples)
    throw new Error("Cannot normalize non-finite audio");
  const requestedGainDb =
    before.rmsDbfs === null ? 0 : config.targetRmsDbfs - before.rmsDbfs;
  const peakAllowedGainDb =
    before.peakDbfs === null ? 0 : config.peakCeilingDbfs - before.peakDbfs;
  const appliedGainDb = before.silent
    ? 0
    : Math.min(requestedGainDb, peakAllowedGainDb, config.maxBoostDb);
  const gain = 10 ** (appliedGainDb / 20),
    result = channels.map((c) => Float32Array.from(c, (x) => x * gain));
  return {
    channels: result,
    report: {
      ...config,
      requestedGainDb,
      appliedGainDb,
      limitedBy: before.silent
        ? "silence"
        : appliedGainDb < requestedGainDb
          ? peakAllowedGainDb <= config.maxBoostDb
            ? "peak-ceiling"
            : "max-boost"
          : "target",
      before,
      after: analyzeChannels(result, sampleRate),
      limitations:
        "Full-file RMS matching, including rests. Not perceptual loudness matching, LUFS normalization, compression or subjective audition.",
    },
  };
}
