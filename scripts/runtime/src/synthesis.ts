import * as Tone from "tone";
import { midiHz, type DrumSound } from "./model.js";
import { hitDuration, DRUM_PITCH } from "./instruments.js";
import { seededRandom } from "./dsp.js";

/** FNV-1a hash, used to derive per-track drum noise seeds. */
export function hash(s: string) {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Periodic harmonic sample used by the three procedural sample presets.
 * The period is rounded to whole frames so the loop is seamless at the
 * generated frequency, and the actual frequency is returned for rate correction.
 */
export function sampleWave(id: string, sr: number) {
  const target = midiHz(60),
    period = Math.round(sr / target),
    freq = sr / period;
  const sustained = id !== "pluck";
  const frames = sustained ? period * 16 : Math.round(sr * 2);
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const time = i / sr;
    let value = 0;
    const hs = id === "flute" ? 4 : 10;
    for (let h = 1; h <= hs; h++) {
      const decay = sustained ? 1 : Math.exp(-time * (3 + h * 1.5));
      const weight = id === "flute" ? 1 / h ** 3 : 1 / h ** 1.7;
      value += Math.sin(2 * Math.PI * freq * h * time) * weight * decay;
    }
    data[i] = value * 0.55 * (sustained ? 1 : Math.min(1, time / 0.002));
  }
  if (!sustained)
    for (let i = 0; i < Math.round(sr * 0.02); i++)
      data[data.length - 1 - i]! *= i / (sr * 0.02);
  return { buffer: Tone.ToneAudioBuffer.fromArray(data), freq, sustained };
}

/**
 * Synthetic drum piece. All eight sounds share one noise generator but keep
 * distinct envelopes so they stay recognisable at low volumes. Output is
 * deterministic for a given (sound, sampleRate, seed) triple.
 */
export function drumBuffer(sound: DrumSound, sr: number, seed: number) {
  const frames = Math.ceil(hitDuration(sound) * sr),
    data = new Float32Array(frames),
    rng = seededRandom(seed);
  let smooth = 0,
    smooth2 = 0,
    phase = 0;
  const base = DRUM_PITCH[sound];
  for (let i = 0; i < frames; i++) {
    const t = i / sr,
      noise = rng() * 2 - 1;
    smooth = 0.75 * smooth + 0.25 * noise;
    smooth2 = 0.9 * smooth2 + 0.1 * noise;
    const bright = noise - smooth;
    let x: number;
    switch (sound) {
      case "kick":
        phase += (2 * Math.PI * (base + 125 * Math.exp(-t * 55))) / sr;
        x = Math.sin(phase) * Math.exp(-t * 25);
        break;
      case "snare":
        x =
          (0.75 * bright + 0.25 * Math.sin(2 * Math.PI * base * t)) *
          Math.exp(-t * 38);
        break;
      case "hat":
        x = bright * Math.exp(-t * 110);
        break;
      case "openhat":
        x = bright * Math.exp(-t * 14) * 0.8;
        break;
      case "tom":
        phase += (2 * Math.PI * (base + base * 0.5 * Math.exp(-t * 18))) / sr;
        x =
          Math.sin(phase) * Math.exp(-t * 16) +
          0.1 * bright * Math.exp(-t * 40);
        break;
      case "crash":
        x = (0.8 * bright + 0.2 * smooth2) * Math.exp(-t * 4.2) * 0.55;
        break;
      case "rim":
        phase += (2 * Math.PI * base) / sr;
        x = (Math.sin(phase) * 0.6 + 0.4 * bright) * Math.exp(-t * 120);
        break;
      case "clap":
        // Three short noise bursts give the classic hand-clap spread.
        x =
          bright *
          Math.exp(-t * 22) *
          (0.6 + 0.4 * Math.exp(-(((t * 1000) % 11) * 0.8)));
        break;
    }
    const fade = Math.min(
      1,
      i / Math.max(1, sr * 0.001),
      (frames - 1 - i) / Math.max(1, sr * 0.003),
    );
    data[i] = x * 0.7 * Math.max(0, fade);
  }
  return Tone.ToneAudioBuffer.fromArray(data);
}

/** Wrap a decoded PCM asset in a Tone buffer at its native sample rate. */
export function toneBufferFromChannels(
  channels: Float32Array[],
  sampleRate: number,
): Tone.ToneAudioBuffer {
  const buffer = Tone.getContext().createBuffer(
    channels.length,
    channels[0]!.length,
    sampleRate,
  );
  channels.forEach((channel, i) =>
    buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i),
  );
  return new Tone.ToneAudioBuffer(buffer);
}
