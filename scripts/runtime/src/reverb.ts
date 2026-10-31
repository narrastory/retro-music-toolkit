import { seededRandom } from "./dsp.js";

/** Unit-energy, seeded stereo IR. No runtime random or external IR download. */
export function createReverbImpulse(
  sampleRate: number,
  seed: number,
  config: {
    decaySeconds: number;
    preDelaySeconds: number;
    damping: number;
  },
): [Float32Array, Float32Array] {
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    !Number.isFinite(config.decaySeconds) ||
    config.decaySeconds < 0.1 ||
    config.decaySeconds > 4 ||
    !Number.isFinite(config.preDelaySeconds) ||
    config.preDelaySeconds < 0 ||
    config.preDelaySeconds > 0.2 ||
    !Number.isFinite(config.damping) ||
    config.damping < 0 ||
    config.damping > 1
  )
    throw new Error("INVALID_REVERB_CONFIG");
  const pre = Math.round(sampleRate * config.preDelaySeconds);
  const frames = Math.round(sampleRate * config.decaySeconds);
  const channel = (offset: number) => {
    const out = new Float32Array(pre + frames),
      random = seededRandom((seed + offset) >>> 0);
    let previous = 0,
      energy = 0;
    const cutoff = 16000 * Math.pow(0.04, config.damping);
    const coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    for (let i = 0; i < frames; i++) {
      previous += coefficient * (random() * 2 - 1 - previous);
      const value = previous * Math.exp((-6.907755 * i) / frames);
      out[pre + i] = value;
      energy += value * value;
    }
    const scale = 1 / Math.sqrt(energy || 1);
    for (let i = pre; i < out.length; i++) out[i] = out[i]! * scale;
    return out;
  };
  return [channel(0x1a39), channel(0x9bd1)];
}
