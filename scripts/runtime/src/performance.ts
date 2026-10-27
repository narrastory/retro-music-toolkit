import type { CompiledEvent } from "./model.js";

export function interpolate(
  points: { at: number; value: number }[],
  at: number,
  initial: number,
) {
  let previous = { at: 0, value: initial };
  for (const next of points) {
    if (at < next.at) {
      const span = next.at - previous.at;
      return span <= 0
        ? next.value
        : previous.value +
            ((next.value - previous.value) * (at - previous.at)) / span;
    }
    previous = next;
  }
  return previous.value;
}
export function pitchAt(
  e: CompiledEvent,
  elapsedBeats: number,
  previousMidi?: number,
) {
  const port = e.expression?.portamentoBeats ?? 0;
  const glide =
    port > 0 && previousMidi !== undefined
      ? (previousMidi - e.midi!) * 100 * Math.max(0, 1 - elapsedBeats / port)
      : 0;
  const bend = interpolate(
    (e.expression?.pitchBendCents ?? []).map((p) => ({
      at: p.offsetBeats,
      value: p.value,
    })),
    elapsedBeats,
    0,
  );
  return e.midi! * 100 + glide + bend;
}
/** Bend/glide use beats; vibrato rateHz uses seconds. */
export function frequencyAt(
  e: CompiledEvent,
  elapsedSeconds: number,
  spb: number,
  previousMidi?: number,
) {
  const withoutVibrato = { ...e, vibrato: undefined };
  let cents = pitchAt(withoutVibrato, elapsedSeconds / spb, previousMidi);
  const v = e.vibrato;
  if (v && elapsedSeconds >= v.delayBeats * spb)
    cents +=
      v.depthCents *
      Math.sin(2 * Math.PI * v.rateHz * (elapsedSeconds - v.delayBeats * spb));
  return 440 * 2 ** ((cents / 100 - 69) / 12);
}
export function performanceGroups(events: CompiledEvent[]) {
  const byId = new Map(events.map((e) => [e.id, e]));
  return events
    .filter((e) => !e.legatoFromId)
    .map((first) => {
      const group = [first];
      let next = first.legatoToId;
      while (next) {
        const e = byId.get(next);
        if (!e) throw new Error("Broken legato chain");
        group.push(e);
        next = e.legatoToId;
        if (group.length > events.length)
          throw new Error("Cyclic legato chain");
      }
      return group;
    });
}
