/**
 * Sustain-loop finder for tonal samples (authoring time, not render time).
 *
 * The renderer bakes a crossfade that blends the frames before loopEnd into
 * the frames before loopStart (see bakeLoopCrossfade). For that blend not to
 * cancel itself, the two regions must be in phase. So the loop length is a
 * whole number of fundamental periods, and the start is then refined within
 * ±1 period (or a wider radius) to maximise the normalised correlation of the
 * two fade regions. Correlation stays low for chorused ensembles; callers can
 * then ask for an equal-power fade instead of a linear one.
 */
export interface SustainLoop {
  start: number;
  end: number;
  crossfade: number;
  /** Normalised correlation of the two crossfade regions (1 = identical). */
  correlation: number;
}

function correlation(x: Float32Array, a: number, b: number, length: number) {
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < length; i++) {
    const p = x[a + i]!,
      q = x[b + i]!;
    ab += p * q;
    aa += p * p;
    bb += q * q;
  }
  return ab / Math.sqrt(Math.max(1e-20, aa * bb));
}

export function findSustainLoop(
  x: Float32Array,
  sampleRate: number,
  rootMidi: number,
  options: {
    /** Keep the loop clear of the file's end fade. */
    endMarginSeconds: number;
    /**
     * Search radius for the start, in seconds (default: one period). A wider
     * radius lets ensembles with vibrato find a start in the same vibrato
     * phase as the end.
     */
    searchSeconds?: number;
    loopSeconds: number;
    crossfadeSeconds: number;
  },
): SustainLoop {
  const period = sampleRate / (440 * 2 ** ((rootMidi - 69) / 12));
  const end = x.length - Math.round(options.endMarginSeconds * sampleRate);
  const length = Math.round(
    Math.max(1, Math.round((options.loopSeconds * sampleRate) / period)) *
      period,
  );
  const crossfade = Math.min(
    Math.round(options.crossfadeSeconds * sampleRate),
    Math.floor(length / 2),
  );
  if (end - length - crossfade - Math.ceil(period) < 0)
    throw new Error("Sample too short for the requested loop");
  // Compare (at most) the last 4096 frames of each fade region.
  const window = Math.min(crossfade, 4096);
  const radius = Math.max(
    Math.ceil(period),
    Math.round((options.searchSeconds ?? 0) * sampleRate),
  );
  if (end - length - crossfade - radius < 0)
    throw new Error("Sample too short for the requested loop search");
  let best = end - length,
    bestScore = -Infinity;
  for (
    let start = end - length - radius;
    start <= end - length + radius;
    start++
  ) {
    const score = correlation(x, start - window, end - window, window);
    if (score > bestScore) [best, bestScore] = [start, score];
  }
  return {
    start: best,
    end,
    crossfade: Math.min(crossfade, best),
    correlation: bestScore,
  };
}
