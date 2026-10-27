import { analyzeChannels } from "./analysis.js";
import { encodeWav, decodeWav } from "./wav.js";
import { normalizeChannels } from "./normalization.js";

export type CompareRow = {
  file: string;
  durationSeconds: number;
  peakDbfs: number | null;
  truePeakDbfs: number | null;
  rmsDbfs: number | null;
  loudnessLufs: number | null;
  clippedSamples: number;
  appliedGainDb: number;
};

/**
 * Build an A/B listening pair: both renders are level-matched to the same
 * target so the comparison tests musical decisions rather than loudness.
 * Each file is decoded from PCM16 and re-encoded, so a comparison copy is not
 * bit-identical to its source.
 */
export function compareRenders(
  files: { path: string; bytes: Uint8Array }[],
  options: {
    targetRmsDbfs?: number;
    peakCeilingDbfs?: number;
    fadeSeconds?: number;
    gapSeconds?: number;
    sampleRate?: number;
  } = {},
): {
  rows: CompareRow[];
  concatenated: Uint8Array;
  sampleRate: number;
  report: Record<string, unknown>;
} {
  if (files.length < 2) throw new Error("compare needs at least two files");
  const targetRmsDbfs = options.targetRmsDbfs ?? -24;
  const peakCeilingDbfs = options.peakCeilingDbfs ?? -3;
  const fadeSeconds = options.fadeSeconds ?? 0.01;
  const gapSeconds = options.gapSeconds ?? 0.5;
  const rated = files.map((f) => {
    const decoded = decodeWav(f.bytes);
    return { ...f, ...decoded };
  });
  const sampleRate = options.sampleRate ?? rated[0]!.sampleRate;
  const rows: CompareRow[] = [];
  const prepared = rated.map((r) => {
    let channels = r.channels;
    // Resample by simple linear interpolation only when rates differ; keep this
    // rare path explicit rather than silently shifting pitch and tempo.
    if (r.sampleRate !== sampleRate) {
      const ratio = sampleRate / r.sampleRate;
      channels = channels.map((c) => {
        const out = new Float32Array(Math.floor(c.length * ratio));
        for (let i = 0; i < out.length; i++) {
          const src = i / ratio;
          const i0 = Math.floor(src);
          const i1 = Math.min(c.length - 1, i0 + 1);
          const t = src - i0;
          out[i] = c[i0]! * (1 - t) + c[i1]! * t;
        }
        return out;
      });
    }
    const normalized = normalizeChannels(channels, sampleRate, {
      targetRmsDbfs,
      peakCeilingDbfs,
    });
    const analysis = analyzeChannels(normalized.channels, sampleRate);
    rows.push({
      file: r.path,
      durationSeconds: Number(analysis.durationSeconds.toFixed(3)),
      peakDbfs: analysis.peakDbfs,
      truePeakDbfs: analysis.truePeakDbfs,
      rmsDbfs: analysis.rmsDbfs,
      loudnessLufs: analysis.loudnessLufs,
      clippedSamples: analysis.clippedSamples,
      appliedGainDb: normalized.report.appliedGainDb,
    });
    return normalized.channels;
  });

  // Concatenate with short fades and a silent gap so a single file can be
  // auditioned A/B without touching a player between takes.
  const gap = Math.round(gapSeconds * sampleRate);
  const total = prepared.reduce((n, c) => n + c[0]!.length + gap, -gap);
  const out = prepared.map(() => new Float32Array(total));
  const fade = Math.round(fadeSeconds * sampleRate);
  let offset = 0;
  prepared.forEach((channels, idx) => {
    for (let c = 0; c < channels.length; c++) {
      const dst = out[Math.min(c, out.length - 1)]!;
      const src = channels[c]!;
      for (let i = 0; i < src.length; i++) {
        let v = src[i]!;
        if (i < fade) v *= i / fade;
        if (i > src.length - fade) v *= (src.length - i) / fade;
        dst[offset + i] = v;
      }
    }
    offset += channels[0]!.length + gap;
  });
  return {
    rows,
    concatenated: encodeWav(out, sampleRate),
    sampleRate,
    report: {
      targetRmsDbfs,
      peakCeilingDbfs,
      gapSeconds,
      fadeSeconds,
      order: files.map((f) => f.path),
      limitations:
        "Each file is re-encoded from PCM16 and level-matched by RMS, not perceptual loudness. Level matching removes loudness from the comparison but can also hide mix-balance problems.",
    },
  };
}
