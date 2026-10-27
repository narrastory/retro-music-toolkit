import {
  InstrumentDefinitionSchema,
  type InstrumentDefinition,
} from "./instrument-model.js";
import { catalog } from "./instrument-data/catalog.js";
import type { DrumSound } from "./model.js";

export type Preset = InstrumentDefinition;
export const INSTRUMENTS: Preset[] = catalog.map((p) =>
  InstrumentDefinitionSchema.parse(p),
);
export function preset(
  id: string,
  source?: { instrumentDefinitions?: InstrumentDefinition[] },
): Preset {
  const p =
    source?.instrumentDefinitions?.find((p) => p.id === id) ??
    INSTRUMENTS.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown instrument ${id}`);
  return p;
}
export const isDrumEngine = (p: InstrumentDefinition) => p.engine === "drums";

/** Natural decay of each synthetic drum piece, in seconds. */
export const DRUM_SECONDS: Record<DrumSound, number> = {
  kick: 0.18,
  snare: 0.13,
  hat: 0.045,
  openhat: 0.32,
  tom: 0.24,
  crash: 0.9,
  rim: 0.05,
  clap: 0.16,
};

export const hitDuration = (s: DrumSound) => DRUM_SECONDS[s] ?? 0.1;

/** Base tuning of the synthetic drum pieces, in Hz, before per-hit detune. */
export const DRUM_PITCH: Record<DrumSound, number> = {
  kick: 48,
  snare: 180,
  hat: 0,
  openhat: 0,
  tom: 110,
  crash: 0,
  rim: 800,
  clap: 0,
};

export const DRUM_SOUNDS = Object.keys(DRUM_SECONDS) as DrumSound[];
