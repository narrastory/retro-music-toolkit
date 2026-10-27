export function analyzeChannels(channels: Float32Array[], sampleRate: number) {
  if (
    !channels.length ||
    !channels[0]?.length ||
    channels.some((c) => c.length !== channels[0]!.length)
  )
    throw new Error("Empty or unequal audio channels");
  let peak = 0,
    sum = 0,
    clipped = 0,
    nonFinite = 0,
    dc = 0;
  const count = channels.length * channels[0].length;
  for (const c of channels)
    for (const raw of c) {
      if (!Number.isFinite(raw)) {
        nonFinite++;
        continue;
      }
      const x = Math.abs(raw);
      peak = Math.max(peak, x);
      sum += raw * raw;
      dc += raw;
      if (x >= 1) clipped++;
    }
  const rms = Math.sqrt(sum / count),
    db = (x: number) => (x > 0 ? 20 * Math.log10(x) : null);
  const boundaryJump = Math.max(
    ...channels.map((c) => Math.abs(c[0]! - c[c.length - 1]!)),
  );
  // Compare the boundary step with ordinary adjacent sample steps; this is a symptom, not a musical verdict.
  let maxStep = 0;
  for (const c of channels)
    for (let i = 1; i < c.length; i++)
      maxStep = Math.max(maxStep, Math.abs(c[i]! - c[i - 1]!));
  return {
    sampleRate,
    channels: channels.length,
    frames: channels[0].length,
    durationSeconds: channels[0].length / sampleRate,
    peak,
    peakDbfs: db(peak),
    truePeakDbfs: db(truePeak(channels)),
    rms,
    rmsDbfs: db(rms),
    loudnessLufs: integratedLoudness(channels, sampleRate),
    dcMean: dc / count,
    clippedSamples: clipped,
    nonFiniteSamples: nonFinite,
    silent: rms < 1e-7,
    boundaryJump,
    maxAdjacentStep: maxStep,
    boundarySuspicious: boundaryJump > Math.max(0.03, maxStep * 2),
    limitations:
      "Sample-peak, inter-sample peak estimate and BS.1770 gated loudness. Not an aesthetic evaluation; boundary metrics alone cannot prove seamlessness.",
  };
}

/**
 * Inter-sample peak estimate per BS.1770 Annex 2: 4× oversampling with a
 * polyphase windowed-sinc interpolator. A peak sample at 0 dBFS can still
 * overshoot on reconstruction, and game engines resample on the fly, so this is
 * the number to trust when the sample peak looks safe. Cubic interpolation
 * (the obvious shortcut) underestimates badly near Nyquist, so it is not used.
 */
const TRUE_PEAK_FACTOR = 4;
const TRUE_PEAK_HALF_TAPS = 12;
let truePeakPhases: Float64Array[] | undefined;

function buildTruePeakPhases() {
  const L = TRUE_PEAK_FACTOR;
  const K = TRUE_PEAK_HALF_TAPS;
  const phases: Float64Array[] = [];
  for (let p = 0; p < L; p++) {
    const taps = new Float64Array(2 * K + 1);
    let sum = 0;
    for (let k = -K; k <= K; k++) {
      // Offset in upsampled samples between output sample and input sample k.
      const n = p / L - k;
      // Ideal low-pass at the original Nyquist, windowed by Blackman.
      const sinc = n === 0 ? Math.PI : Math.sin(Math.PI * n) / n;
      const w =
        0.42 +
        0.5 * Math.cos((Math.PI * k) / (K + 1)) +
        0.08 * Math.cos((2 * Math.PI * k) / (K + 1));
      const value = sinc * w;
      taps[k + K] = value;
      sum += value;
    }
    // Normalise each phase so a DC signal reconstructs at unity.
    for (let i = 0; i < taps.length; i++) taps[i] = taps[i]! / sum;
    phases.push(taps);
  }
  return phases;
}

export function truePeak(channels: Float32Array[]) {
  const phases = (truePeakPhases ??= buildTruePeakPhases());
  const K = TRUE_PEAK_HALF_TAPS;
  let peak = 0;
  for (const c of channels) {
    const n = c.length;
    if (!n) continue;
    for (let i = 0; i < n; i++) {
      peak = Math.max(peak, Math.abs(c[i]!));
      // Only phases 1..L-1 are new; phase 0 is the original sample.
      for (let p = 1; p < phases.length; p++) {
        const taps = phases[p]!;
        let acc = 0;
        for (let k = -K; k <= K; k++) {
          const idx = i - k;
          if (idx < 0 || idx >= n) continue;
          acc += c[idx]! * taps[k + K]!;
        }
        peak = Math.max(peak, Math.abs(acc));
      }
    }
  }
  return peak;
}

/** One-pole high-pass used as the K-weighting pre-filter stand-in. */
function kWeight(channels: Float32Array[], sampleRate: number) {
  // Two-stage approximation of the BS.1770 K-weighting filter: a high shelf
  // around 1.5 kHz (+4 dB) and a high-pass around 38 Hz.
  const shelfFreq = 1500,
    hpFreq = 38;
  const coeffs = (f: number, gainDb: number, sr: number, hp: boolean) => {
    const A = 10 ** (gainDb / 40);
    const w0 = (2 * Math.PI * f) / sr;
    const alpha = Math.sin(w0) / (2 * 0.7);
    const cosw = Math.cos(w0);
    if (hp) {
      const b0 = (1 + cosw) / 2,
        b1 = -(1 + cosw),
        b2 = (1 + cosw) / 2;
      const a0 = 1 + alpha,
        a1 = -2 * cosw,
        a2 = 1 - alpha;
      return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
      };
    }
    const b0 = A * (A + 1 + (A - 1) * cosw + 2 * Math.sqrt(A) * alpha),
      b1 = -2 * A * (A - 1 + (A + 1) * cosw),
      b2 = A * (A + 1 + (A - 1) * cosw - 2 * Math.sqrt(A) * alpha),
      a0 = A + 1 - (A - 1) * cosw + 2 * Math.sqrt(A) * alpha,
      a1 = 2 * (A - 1 - (A + 1) * cosw),
      a2 = A + 1 - (A - 1) * cosw - 2 * Math.sqrt(A) * alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  };
  const shelf = coeffs(shelfFreq, 4, sampleRate, false);
  const hp = coeffs(hpFreq, 0, sampleRate, true);
  const apply = (
    input: Float32Array,
    c: { b0: number; b1: number; b2: number; a1: number; a2: number },
  ) => {
    const out = new Float32Array(input.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i]!;
      const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    return out;
  };
  return channels.map((c) => apply(apply(c, shelf), hp));
}

/**
 * Gated integrated loudness per BS.1770-4: 400 ms blocks with 75 % overlap,
 * absolute gate at -70 LUFS, relative gate at -10 LU.
 * Returns null for silence.
 */
export function integratedLoudness(
  channels: Float32Array[],
  sampleRate: number,
): number | null {
  if (!channels.length || !channels[0]?.length) return null;
  const weighted = kWeight(channels, sampleRate);
  const blockFrames = Math.round(sampleRate * 0.4);
  if (blockFrames <= 0 || weighted[0]!.length < blockFrames) return null;
  const hop = Math.round(blockFrames / 4);
  const blocks: number[] = [];
  for (
    let start = 0;
    start + blockFrames <= weighted[0]!.length;
    start += hop
  ) {
    let sum = 0;
    for (const c of weighted)
      for (let i = start; i < start + blockFrames; i++) sum += c[i]! * c[i]!;
    // BS.1770 sums the weighted mean-square across channels (weights 1.0 for
    // L/R); averaging would read a stereo pair 3 dB quieter than it is.
    const meanSquare = sum / blockFrames;
    const lufs = -0.691 + 10 * Math.log10(Math.max(meanSquare, 1e-20));
    blocks.push(lufs);
  }
  const aboveAbsolute = blocks.filter((b) => b > -70);
  if (!aboveAbsolute.length) return null;
  const meanOf = (list: number[]) =>
    list.reduce((a, b) => a + b, 0) / list.length;
  const relativeGate = meanOf(aboveAbsolute) - 10;
  const gated = aboveAbsolute.filter((b) => b > relativeGate);
  if (!gated.length) return null;
  return Number(meanOf(gated).toFixed(2));
}

export function compareCycles(a: Float32Array[], b: Float32Array[]) {
  let sum = 0,
    n = 0;
  for (let c = 0; c < a.length; c++)
    for (let i = 0; i < a[c]!.length; i++) {
      const delta = a[c]![i]! - b[c]![i]!;
      sum += delta * delta;
      n++;
    }
  return Math.sqrt(sum / Math.max(1, n));
}

/** Same-size cycles only; a relative error is not an estimate of perceived difference. */
export function cycleMetrics(
  current: Float32Array[],
  previous: Float32Array[],
) {
  if (
    !current.length ||
    current.length !== previous.length ||
    !current[0]?.length ||
    current.some(
      (c, i) =>
        c.length !== current[0]!.length || c.length !== previous[i]?.length,
    )
  )
    throw new Error("Cycle channel dimensions must match");
  const differenceRms = compareCycles(current, previous);
  let power = 0,
    count = 0;
  for (const channel of current)
    for (const x of channel) {
      power += x * x;
      count++;
    }
  const rms = Math.sqrt(power / count);
  return {
    differenceRms,
    signalRms: rms,
    relativeDifference: rms > 1e-8 ? differenceRms / rms : null,
  };
}
