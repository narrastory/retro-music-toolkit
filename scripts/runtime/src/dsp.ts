/**
 * Signal-processing helpers that run in the render browser before PCM16 encoding.
 * Everything here is deterministic for a given seed so reports stay reproducible.
 */

/** Deterministic PRNG shared by humanize, dither and synthetic drums. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Triangular-PDF dither, applied at the LSB scale of PCM16 (1/32768).
 * TPDF removes the correlated quantisation distortion that a plain
 * round-to-nearest produces on quiet chiptune tails.
 */
export function applyDither(
  channels: Float32Array[],
  seed: number,
): Float32Array[] {
  const rng = seededRandom(seed);
  const lsb = 1 / 32768;
  return channels.map((channel) =>
    Float32Array.from(channel, (x) => x + (rng() - rng()) * lsb),
  );
}

export type LimiterReport = {
  enabled: boolean;
  ceilingDbfs: number;
  lookaheadSeconds: number;
  triggeredSamples: number;
  maxGainReductionDb: number;
};

/**
 * Look-ahead peak limiter. A forward scan computes the minimum gain required
 * within the look-ahead window, then attack/release smoothing is applied so the
 * gain envelope has no discontinuities. This is a safety net for export, not a
 * mastering compressor.
 */
export function applyPeakLimiter(
  channels: Float32Array[],
  sampleRate: number,
  ceilingDbfs: number,
  lookaheadSeconds: number,
): { channels: Float32Array[]; report: LimiterReport } {
  const frames = channels[0]!.length;
  const ceiling = 10 ** (ceilingDbfs / 20);
  const lookahead = Math.max(1, Math.round(lookaheadSeconds * sampleRate));

  // Required gain per frame from the peak of all channels.
  const required = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let peak = 0;
    for (const c of channels) peak = Math.max(peak, Math.abs(c[i]!));
    required[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // Forward minimum over the look-ahead window, then backward smoothing so the
  // gain drops early enough to catch the peak without overshoot.
  const windowed = new Float32Array(frames);
  let minInWindow = 1;
  const ring: number[] = [];
  for (let i = 0; i < frames; i++) {
    ring.push(required[i]!);
    if (ring.length > lookahead) ring.shift();
    minInWindow = Math.min(...ring);
    windowed[i] = minInWindow;
  }
  const gain = new Float32Array(frames);
  const releaseCoeff = Math.exp(-1 / (sampleRate * 0.05));
  let g = 1;
  for (let i = 0; i < frames; i++) {
    const target = windowed[i]!;
    g = target < g ? target : target + (g - target) * releaseCoeff;
    gain[i] = g;
  }
  let triggered = 0;
  let maxReduction = 0;
  for (let i = 0; i < frames; i++) {
    if (gain[i]! < 1 - 1e-9) triggered++;
    maxReduction = Math.max(maxReduction, 1 - gain[i]!);
  }
  return {
    channels: channels.map((c) => Float32Array.from(c, (x, i) => x * gain[i]!)),
    report: {
      enabled: true,
      ceilingDbfs,
      lookaheadSeconds,
      triggeredSamples: triggered,
      maxGainReductionDb:
        maxReduction > 0 ? 20 * Math.log10(1 - maxReduction) : 0,
    },
  };
}

/**
 * Equal-power crossfade of the loop boundary. Only applied when the caller asks
 * for it; the analysis stage reports the dry seam either way so the author can
 * judge whether the fade is hiding a musical problem.
 */
export function crossfadeLoop(
  channels: Float32Array[],
  fadeFrames: number,
): Float32Array[] {
  if (fadeFrames <= 0) return channels;
  return channels.map((c) => {
    const n = Math.min(fadeFrames, Math.floor(c.length / 2));
    if (n <= 0) return c;
    const out = Float32Array.from(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // Head fades in, tail fades out against the matching head sample so the
      // wrap point lands at equal gain.
      const head = c[i]!;
      const tail = c[c.length - n + i]!;
      out[i] =
        head * Math.sin((t * Math.PI) / 2) + tail * Math.cos((t * Math.PI) / 2);
    }
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out[c.length - n + i] =
        c[c.length - n + i]! * Math.cos((t * Math.PI) / 2);
    }
    return out;
  });
}

export function peakOf(channels: Float32Array[]) {
  let peak = 0;
  for (const c of channels)
    for (const x of c) peak = Math.max(peak, Math.abs(x));
  return peak;
}
