/**
 * Root-pitch verification for sampled instruments.
 *
 * The question asked here is narrow on purpose: "does this recording sound at
 * the root the manifest declares, and how many cents off is it?". Knowing the
 * expected note lets us avoid the octave ambiguity that makes free-running
 * pitch trackers (YIN, autocorrelation) unreliable on bass and bell tones.
 *
 * Method: magnitude spectrum by single-bin DFT on a Hann window taken after
 * the attack, a harmonic-sum search within ±100 cents of the declared root,
 * then two octave tests on the tuned fundamental:
 *  - lower: strong energy at half-integer multiples of f means the real
 *    fundamental is an octave below (e.g. a bass sample mapped one octave up).
 *  - higher: almost no energy at odd multiples of f means the real
 *    fundamental is an octave above.
 */

export interface RootPitchCheck {
  /** -1: sounds an octave below the declared root; +1: an octave above. */
  octaveError: -1 | 0 | 1;
  /** Measured deviation of the fundamental from the declared root, in cents. */
  centsOffset: number;
  /** Odd sub-harmonic energy / harmonic energy; > LOWER_RATIO flags -1. */
  lowerRatio: number;
  /** Odd harmonic energy / even harmonic energy; < HIGHER_RATIO flags +1. */
  higherRatio: number;
}

const LOWER_RATIO = 0.3;
const HIGHER_RATIO = 0.12;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function magnitudeAt(
  window: Float32Array,
  sampleRate: number,
  frequency: number,
) {
  if (frequency <= 0 || frequency >= sampleRate / 2) return 0;
  const step = (2 * Math.PI * frequency) / sampleRate;
  // Goertzel recurrence: one DFT bin at an arbitrary (non-integer) frequency.
  const coefficient = 2 * Math.cos(step);
  let s1 = 0,
    s2 = 0;
  for (let i = 0; i < window.length; i++) {
    const s0 = window[i]! + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / window.length;
}

/** Best magnitude within ±spread cents, to tolerate string inharmonicity. */
function peakNear(
  window: Float32Array,
  sampleRate: number,
  frequency: number,
  spreadCents = 30,
) {
  let best = 0;
  for (let c = -spreadCents; c <= spreadCents; c += spreadCents / 3)
    best = Math.max(
      best,
      magnitudeAt(window, sampleRate, frequency * 2 ** (c / 1200)),
    );
  return best;
}

function analysisWindow(samples: Float32Array, sampleRate: number) {
  const size = 8192;
  // Skip the attack transient where it fits; short one-shots start earlier.
  let start = Math.round(sampleRate * 0.08);
  if (start + size > samples.length) start = Math.max(0, samples.length - size);
  const length = Math.min(size, samples.length - start);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++)
    out[i] =
      samples[start + i]! *
      (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1)));
  return out;
}

export function checkRootPitch(
  samples: Float32Array,
  sampleRate: number,
  rootMidi: number,
): RootPitchCheck {
  const window = analysisWindow(samples, sampleRate);
  const base = hz(rootMidi);
  const harmonicSum = (f: number) => {
    let sum = 0;
    for (let k = 1; k <= 6; k++)
      sum += magnitudeAt(window, sampleRate, f * k) / k;
    return sum;
  };
  let best = 0,
    bestScore = -1;
  for (let c = -100; c <= 100; c += 2) {
    const score = harmonicSum(base * 2 ** (c / 1200));
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  for (let c = best - 2; c <= best + 2; c += 0.25) {
    const score = harmonicSum(base * 2 ** (c / 1200));
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  const f = base * 2 ** (best / 1200);
  const sum = (ks: number[], scale: number) =>
    ks.reduce((s, k) => s + peakNear(window, sampleRate, k * scale), 0);
  // Equal counts over the same span, so broadband noise (fret clicks, short
  // staccato attacks) weighs on both sides alike instead of biasing a ratio.
  const lowerRatio =
    sum([1, 3, 5, 7, 9, 11, 13, 15], f / 2) /
    Math.max(1e-12, sum([1, 2, 3, 4, 5, 6, 7, 8], f));
  const higherRatio =
    sum([1, 3, 5, 7], f) / Math.max(1e-12, sum([2, 4, 6, 8], f));
  return {
    octaveError:
      lowerRatio > LOWER_RATIO ? -1 : higherRatio < HIGHER_RATIO ? 1 : 0,
    centsOffset: Math.round(best * 4) / 4,
    lowerRatio,
    higherRatio,
  };
}
