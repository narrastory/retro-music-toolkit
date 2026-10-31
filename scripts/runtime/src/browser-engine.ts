import * as Tone from "tone";
import { midiHz, type CompiledScore, type DrumSound } from "./model.js";
import {
  decodeSampleAsset,
  findZone,
  findDrumSlot,
} from "./instrument-model.js";
import { performanceGroups, frequencyAt, interpolate } from "./performance.js";
import { createReverbImpulse } from "./reverb.js";
import { preset, hitDuration, DRUM_PITCH } from "./instruments.js";
import { encodeWav } from "./wav.js";
import {
  hash,
  sampleWave,
  drumBuffer,
  toneBufferFromChannels,
} from "./synthesis.js";
import { analyzeChannels, compareCycles, cycleMetrics } from "./analysis.js";
import { RenderOptionsSchema, type RenderOptions } from "./render-options.js";
import { normalizeChannels } from "./normalization.js";
import {
  applyDither,
  applyPeakLimiter,
  crossfadeLoop,
  seededRandom,
  type LimiterReport,
} from "./dsp.js";
export type { RenderOptions } from "./render-options.js";

export type RenderAnalysis = ReturnType<typeof analyzeChannels> & {
  cycleDifferenceRms: number | null;
  cycleComparison: ReturnType<typeof cycleMetrics> | null;
  cycleMeasurementStage: string;
  normalization: unknown;
  limiter: LimiterReport | null;
  dither: boolean;
  loopCrossfadeBeats: number;
};

export async function renderInBrowser(
  compiled: CompiledScore,
  options: RenderOptions = {},
) {
  options = RenderOptionsSchema.parse(options);
  const { score: s, events } = compiled;
  const sr = s.export.sampleRate,
    spb = 60 / s.tempo;
  const mode = options.mode ?? s.export.mode;
  const from = options.fromBeat ?? 0,
    to = options.toBeat ?? s.lengthBeats;
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to <= from ||
    to > s.lengthBeats
  )
    throw new Error("Invalid render beat range");
  if (options.solo?.some((id) => !s.tracks.some((t) => t.id === id)))
    throw new Error(
      `Unknown solo track: ${options.solo.filter((id) => !s.tracks.some((t) => t.id === id)).join(", ")}`,
    );
  const partial = from !== 0 || to !== s.lengthBeats;
  if (partial && mode === "loop")
    throw new Error(
      "Partial ranges require one-shot mode; use full loop or seam preview",
    );
  const crossfadeBeats = options.loopCrossfadeBeats ?? 0;
  if (crossfadeBeats > 0 && mode !== "loop")
    throw new Error("loopCrossfadeBeats requires loop mode");

  const loopFrames = Math.round(s.lengthBeats * spb * sr),
    cycleSeconds = loopFrames / sr;
  const cycles = mode === "loop" ? s.export.warmupCycles + 1 : 1;
  const duration =
    mode === "loop" ? cycleSeconds * cycles : to * spb + s.export.tailSeconds;
  if (duration * sr > 16_000_000)
    throw new Error(
      "Render exceeds 16 million frames; reduce song length, warmup cycles or render a range",
    );
  if (events.length * cycles > 500000)
    throw new Error("Render event budget exceeded");

  const owned: { dispose(): unknown }[] = [];
  const own = <T extends { dispose(): unknown }>(node: T): T => {
    owned.push(node);
    return node;
  };
  let result: Tone.ToneAudioBuffer | undefined;
  let echoBus: Tone.Gain | undefined;
  let reverbBus: Tone.Convolver | undefined;
  try {
    result = await Tone.Offline(
      () => {
        const hardware = s.authenticity === "hardware";
        const master = own(
          new Tone.Gain(Tone.dbToGain(s.mixer.masterDb)),
        ).toDestination();
        const reverb = s.mixer.reverb;
        if (
          reverb?.enabled &&
          options.effects !== "dry" &&
          s.tracks.some(
            (t) =>
              t.reverbSend > 0 &&
              (!options.solo || options.solo.includes(t.id)),
          )
        ) {
          const impulse = own(
            Tone.ToneAudioBuffer.fromArray(
              createReverbImpulse(sr, s.seed, reverb),
            ),
          );
          reverbBus = own(
            new Tone.Convolver({ url: impulse, normalize: false }),
          );
          reverbBus.connect(
            own(new Tone.Gain(Tone.dbToGain(reverb.returnDb))).connect(master),
          );
        }
        const delay = own(
          new Tone.FeedbackDelay({
            delayTime: s.mixer.delayBeats * spb,
            feedback: s.mixer.feedback,
            wet: 1,
          }),
        );
        const ret = own(
          new Tone.Gain(
            options.effects === "dry" ? 0 : Tone.dbToGain(s.mixer.returnDb),
          ),
        ).connect(master);
        delay.connect(ret);
        // SNES-style eight-tap FIR echo: a multi-tap delay whose summed taps
        // feed back, which is what gives the platform its signature tail.
        const echoCfg = s.mixer.echo;
        const echoOn =
          !!echoCfg?.enabled &&
          options.effects !== "dry" &&
          (hardware || echoCfg !== undefined);
        if (echoOn && echoCfg) {
          const echoIn = own(new Tone.Gain(1));
          // Feedback must be taken from the summed taps *before* the return
          // gain; otherwise returnDb silently scales the feedback amount.
          const echoSum = own(new Tone.Gain(1));
          const echoOut = own(
            new Tone.Gain(
              options.effects === "wet" ? 0 : Tone.dbToGain(echoCfg.returnDb),
            ),
          ).connect(master);
          echoSum.connect(echoOut);
          const taps = Array.from(
            { length: 8 },
            (_, i) => echoCfg.taps[i] ?? 0,
          );
          const echoDelay = echoCfg.delayBeats * spb;
          for (let i = 0; i < taps.length; i++) {
            if (taps[i] === 0) continue;
            const tap = own(
              new Tone.Delay({ delayTime: echoDelay * (i + 1), maxDelay: 8 }),
            ).connect(own(new Tone.Gain(taps[i]!)).connect(echoSum));
            echoIn.connect(tap);
          }
          const fb = own(new Tone.Gain(echoCfg.feedback));
          echoSum.connect(fb);
          fb.connect(echoIn);
          echoBus = echoIn;
        }
        for (const t of s.tracks) {
          if (options.solo && !options.solo.includes(t.id)) continue;
          const p = preset(t.instrument, s);
          const drums = p.engine === "drums";
          const dry = own(
            new Tone.Gain(options.effects === "wet" ? 0 : 1),
          ).connect(master);
          const bus = own(new Tone.Panner(t.pan)).connect(dry);
          // Hardware mode removes the safety low-pass: a real 2A03 pulse channel
          // has no filter, and the softening is what made the voices feel modern.
          const filter = hardware
            ? undefined
            : own(
                new Tone.Filter({
                  frequency: 1200 + t.controls.brightness * 12000,
                  type: "lowpass",
                  Q: 0.3,
                }),
              ).connect(bus);
          const gain = own(new Tone.Gain(Tone.dbToGain(t.gainDb))).connect(
            filter ?? bus,
          );
          // Post-filter/pre-pan send: independent stereo room, dry source keeps
          // its authored pan. Existing delay and FIR echo routes are unchanged.
          if (reverbBus && t.reverbSend > 0) {
            const reverbSend = own(new Tone.Gain(t.reverbSend)).connect(
              reverbBus,
            );
            (filter ?? gain).connect(reverbSend);
          }
          const automate = (
            param: {
              setValueAtTime(v: number, t: number): unknown;
              linearRampToValueAtTime(v: number, t: number): unknown;
            },
            parameter: "gainDb" | "pan" | "brightness" | "send",
            base: number,
            map: (v: number) => number,
          ) => {
            const lane = t.automation?.find((l) => l.parameter === parameter);
            if (!lane) return;
            for (let cycle = 0; cycle < cycles; cycle++) {
              const offset = cycle * cycleSeconds;
              param.setValueAtTime(
                map(interpolate(lane.points, 0, base)),
                offset,
              );
              for (const point of lane.points)
                if (point.at > 0)
                  param.linearRampToValueAtTime(
                    map(point.value),
                    offset + point.at * spb,
                  );
            }
          };
          automate(gain.gain, "gainDb", t.gainDb, Tone.dbToGain);
          automate(bus.pan, "pan", t.pan, (v) => v);
          if (filter)
            automate(
              filter.frequency,
              "brightness",
              t.controls.brightness,
              (v) => 1200 + v * 12000,
            );
          if (
            t.send > 0 ||
            t.automation?.some(
              (l) =>
                l.parameter === "send" && l.points.some((p) => p.value > 0),
            )
          ) {
            const send = own(new Tone.Gain(t.send)).connect(delay);
            gain.connect(send);
            if (echoBus)
              gain.connect(own(new Tone.Gain(t.send))).connect(echoBus);
            automate(send.gain, "send", t.send, (v) => v);
          }
          const trackEvents = events.filter(
            (e) => e.trackId === t.id && e.velocity > 0,
          );
          if (drums) {
            // Sampled kit slots take priority; anything else falls back to the
            // synthetic piece so a partial kit still renders audibly.
            const buffers = new Map<DrumSound, Tone.ToneAudioBuffer>();
            for (const sound of new Set(trackEvents.map((e) => e.sound!))) {
              const slot = findDrumSlot(p, sound);
              if (slot && s.sampleAssets?.[slot.assetId]) {
                const asset = decodeSampleAsset(s.sampleAssets[slot.assetId]!);
                buffers.set(
                  sound,
                  own(toneBufferFromChannels(asset.channels, asset.sampleRate)),
                );
              } else {
                buffers.set(
                  sound,
                  own(drumBuffer(sound, sr, s.seed ^ hash(t.id + sound))),
                );
              }
            }
            for (let cycle = 0; cycle < cycles; cycle++)
              for (const e of trackEvents) {
                if (mode === "one-shot" && e.tick / compiled.ppq >= to)
                  continue;
                const at = cycle * cycleSeconds + (e.tick / compiled.ppq) * spb,
                  buffer = buffers.get(e.sound!)!,
                  slot = findDrumSlot(p, e.sound!);
                const source = own(
                  new Tone.ToneBufferSource({
                    url: buffer,
                    fadeIn: 0,
                    fadeOut: 0.002,
                  }),
                ).connect(gain);
                const natural = slot ? buffer.duration : hitDuration(e.sound!);
                const length =
                  e.cutTick === undefined
                    ? natural
                    : Math.min(
                        natural,
                        ((e.cutTick - e.tick) / compiled.ppq) * spb,
                      );
                if (length <= 0) continue;
                const rate = slot
                  ? 2 ** ((slot.tuningCents + (e.detuneCents ?? 0)) / 1200)
                  : 2 ** ((e.detuneCents ?? 0) / 1200);
                const offset = slot ? slot.startFrame / buffer.sampleRate : 0;
                if (rate !== 1) source.playbackRate.value = rate;
                const level = slot
                  ? Tone.dbToGain(slot.gainDb) * e.velocity
                  : e.velocity;
                source.start(at, offset, length, level);
              }
            continue;
          }
          const procedural =
            p.engine === "sample" && p.sample?.kind === "procedural"
              ? sampleWave(p.sample.wave, sr)
              : undefined;
          if (procedural) own(procedural.buffer);
          const external = new Map<string, Tone.ToneAudioBuffer>();
          if (p.sample?.kind === "zones")
            for (const zone of p.sample.zones) {
              if (external.has(zone.assetId)) continue;
              const asset = decodeSampleAsset(s.sampleAssets![zone.assetId]!);
              external.set(
                zone.assetId,
                own(toneBufferFromChannels(asset.channels, asset.sampleRate)),
              );
            }
          // Physical-layer constraints. A 2A03 pulse channel has exactly three
          // duty cycles (12.5 / 25 / 50 %) and 16 discrete volume levels, so
          // hardware mode snaps to those steps; modern mode keeps them smooth.
          const dutyCycle = (() => {
            const w = p.synthesis?.pulseWidth ?? 0;
            if (!hardware) return w;
            const options = [0.5, 0.25, 0.125];
            return options.reduce(
              (best, o) => (Math.abs(o - w) < Math.abs(best - w) ? o : best),
              options[0]!,
            );
          })();
          const volumeStep = (db: number) => {
            if (!hardware) return db;
            // 16 linear steps over the full range; quantise in dB space with a
            // floor so quiet tracks stay audible.
            const lin = Tone.dbToGain(db);
            const steps = 15;
            const quantised = Math.round(lin * steps) / steps;
            return quantised <= 0 ? -60 : Tone.gainToDb(quantised);
          };
          const env = {
            attack: p.attack,
            decay:
              p.synthesis?.decaySeconds ??
              0.04 + 0.22 * (1 - t.controls.pluckiness),
            sustain: p.synthesis?.sustain ?? 0.65,
            release: p.release,
          };
          const voices = Array.from({ length: t.maxVoices }, () => {
            const guard = own(new Tone.Gain(1)).connect(gain);
            const velocityFilter = p.velocityResponse?.filterOctaves
              ? own(
                  new Tone.Filter({
                    frequency: 20000,
                    type: "lowpass",
                    Q: 0.3,
                  }),
                ).connect(guard)
              : undefined;
            const expressionGain = own(new Tone.Gain(1)).connect(
              velocityFilter ?? guard,
            );
            if (p.engine === "sample")
              return {
                guard,
                velocityFilter,
                expressionGain,
                envelope: own(new Tone.AmplitudeEnvelope(env)).connect(
                  expressionGain,
                ),
                synth: undefined,
              };
            const synth =
              p.engine === "fm"
                ? own(
                    new Tone.FMSynth({
                      harmonicity: p.synthesis?.harmonicity ?? 2,
                      modulationIndex:
                        p.synthesis?.modulationIndex ??
                        1 + t.controls.brightness * 5,
                      envelope: env,
                      modulationEnvelope: {
                        attack: 0.002,
                        decay: 0.06 + t.controls.pluckiness * 0.2,
                        sustain: 0.08,
                        release: 0.04,
                      },
                      volume: volumeStep(p.synthesis?.volumeDb ?? -7),
                    }),
                  ).connect(expressionGain)
                : own(
                    new Tone.Synth({
                      oscillator:
                        p.engine === "triangle"
                          ? { type: "triangle" }
                          : { type: "pulse", width: dutyCycle },
                      envelope: env,
                      volume: volumeStep(p.synthesis?.volumeDb ?? -7),
                    }),
                  ).connect(expressionGain);
            return {
              guard,
              velocityFilter,
              expressionGain,
              synth,
              envelope: undefined,
            };
          });
          const groups = performanceGroups(trackEvents);
          for (let cycle = 0; cycle < cycles; cycle++)
            for (const originalGroup of groups) {
              const group =
                mode === "one-shot"
                  ? originalGroup.filter((e) => e.tick / compiled.ppq < to)
                  : originalGroup;
              if (!group.length) continue;
              const first = group[0]!;
              let last = group.at(-1)!;
              if (group.length < originalGroup.length)
                last = {
                  ...last,
                  endTick:
                    last.tick +
                    last.durationTicks +
                    Math.ceil((p.release / spb) * compiled.ppq),
                };
              if (mode === "one-shot" && first.tick / compiled.ppq >= to)
                continue;
              const at =
                cycle * cycleSeconds + (first.tick / compiled.ppq) * spb;
              const end =
                cycle * cycleSeconds + (last.endTick / compiled.ppq) * spb;
              if (end <= at) continue;
              const voice = voices[first.voice]!,
                fade = Math.min(0.002, (end - at) / 2);
              const noteLen = Math.min(
                ((last.tick + last.durationTicks - first.tick) / compiled.ppq) *
                  spb,
                Math.max(0.00001, end - at - fade),
              );
              voice.guard.gain.setValueAtTime(0, at);
              voice.guard.gain.linearRampToValueAtTime(1, at + fade);
              if (last.cutTick !== undefined) {
                voice.guard.gain.setValueAtTime(1, Math.max(at, end - fade));
                voice.guard.gain.linearRampToValueAtTime(0, end);
              }
              const zone = findZone(p, first.midi!);
              const buffer = zone
                ? external.get(zone.assetId)
                : procedural?.buffer;
              const rootFreq = zone
                ? midiHz(zone.rootMidi) * 2 ** (zone.tuningCents / 1200)
                : procedural?.freq;
              let source: Tone.ToneBufferSource | undefined;
              if (buffer) {
                const assetRate = buffer.sampleRate;
                const zoneGain = own(
                  new Tone.Gain(zone ? Tone.dbToGain(zone.gainDb) : 1),
                ).connect(voice.envelope!);
                source = own(
                  new Tone.ToneBufferSource({
                    url: buffer,
                    loop: zone
                      ? zone.loopStartFrame !== undefined
                      : procedural!.sustained,
                    loopStart: zone
                      ? (zone.loopStartFrame ?? 0) / assetRate
                      : 0,
                    loopEnd: zone
                      ? (zone.loopEndFrame ??
                          Math.round(buffer.duration * assetRate)) / assetRate
                      : buffer.duration,
                    playbackRate: frequencyAt(first, 0, spb) / rootFreq!,
                    fadeOut: 0.002,
                  }),
                ).connect(zoneGain);
                source.start(at);
                voice.envelope!.triggerAttackRelease(
                  noteLen,
                  at,
                  first.velocity,
                );
                source.stop(end);
              } else
                voice.synth!.triggerAttackRelease(
                  frequencyAt(first, 0, spb),
                  noteLen,
                  at,
                  first.velocity,
                );
              for (const [index, event] of group.entries()) {
                const start =
                  cycle * cycleSeconds + (event.tick / compiled.ppq) * spb;
                const segmentEnd =
                  index + 1 < group.length
                    ? cycle * cycleSeconds +
                      (group[index + 1]!.tick / compiled.ppq) * spb
                    : end;
                voice.expressionGain.gain.setValueAtTime(
                  event.velocity / (first.velocity || 1),
                  start,
                );
                if (voice.velocityFilter)
                  voice.velocityFilter.frequency.setValueAtTime(
                    Math.min(
                      20000,
                      Math.max(
                        80,
                        4000 *
                          2 **
                            ((event.velocity - 0.5) *
                              (p.velocityResponse?.filterOctaves ?? 0)),
                      ),
                    ),
                    start,
                  );
                if (voice.synth instanceof Tone.FMSynth)
                  voice.synth.modulationIndex.setValueAtTime(
                    (p.synthesis?.modulationIndex ??
                      1 + t.controls.brightness * 5) *
                      (1 +
                        (event.velocity - 0.5) *
                          (p.velocityResponse?.fmIndexScale ?? 0)),
                    start,
                  );
                const param = source?.playbackRate ?? voice.synth!.frequency;
                const factor = source ? 1 / rootFreq! : 1;
                voice.synth?.detune.setValueAtTime(0, start);
                const previous = group[index - 1]?.midi;
                param.setValueAtTime(
                  frequencyAt(event, 0, spb, previous) * factor,
                  start,
                );
                if (event.vibrato || event.expression) {
                  for (let time = start + 0.01; time < segmentEnd; time += 0.01)
                    param.linearRampToValueAtTime(
                      frequencyAt(event, time - start, spb, previous) * factor,
                      time,
                    );
                  if (segmentEnd - start > 0.0001)
                    param.linearRampToValueAtTime(
                      frequencyAt(
                        event,
                        segmentEnd - start - 0.00001,
                        spb,
                        previous,
                      ) * factor,
                      segmentEnd - 0.00001,
                    );
                }
              }
            }
        }
      },
      duration,
      2,
      sr,
    );
    const native = result.get();
    if (!native) throw new Error("Offline rendering returned no audio");
    let channels: Float32Array[] = Array.from(
      { length: native.numberOfChannels },
      (_, i) => native.getChannelData(i) as Float32Array,
    );
    let cycleDifferenceRms: number | null = null;
    let cycleComparison: ReturnType<typeof cycleMetrics> | null = null;
    if (mode === "loop") {
      const start = s.export.warmupCycles * loopFrames;
      const previous = channels.map((c) => c.slice(start - loopFrames, start));
      channels = channels.map((c) => c.slice(start, start + loopFrames));
      cycleComparison = cycleMetrics(channels, previous);
      cycleDifferenceRms = cycleComparison.differenceRms;
    } else {
      channels = channels.map((c) =>
        c.slice(
          Math.round(from * spb * sr),
          Math.round((to * spb + s.export.tailSeconds) * sr),
        ),
      );
    }
    if (options.seam) {
      if (mode !== "loop") throw new Error("Seam preview requires loop mode");
      const n = Math.min(Math.round(4 * spb * sr), loopFrames);
      channels = channels.map((c) => {
        const out = new Float32Array(n * 2);
        out.set(c.subarray(c.length - n));
        out.set(c.subarray(0, n), n);
        return out;
      });
    }
    if (crossfadeBeats > 0)
      channels = crossfadeLoop(
        channels,
        Math.min(Math.round(crossfadeBeats * spb * sr), loopFrames / 2),
      );

    let limiterCeiling: number | undefined;
    let limiterLookahead: number | undefined;
    if (options.limiter === false) {
      limiterCeiling = undefined;
    } else if (options.limiter !== undefined) {
      limiterCeiling = options.limiter.ceilingDbfs;
      limiterLookahead = options.limiter.lookaheadSeconds;
    } else if (s.export.limiter.enabled) {
      limiterCeiling = s.export.limiter.ceilingDbfs;
      limiterLookahead = s.export.limiter.lookaheadSeconds;
    }
    let limiterReport: LimiterReport | null = null;
    if (limiterCeiling !== undefined)
      ({ channels, report: limiterReport } = applyPeakLimiter(
        channels,
        sr,
        limiterCeiling,
        limiterLookahead ?? 0.005,
      ));

    const normalized = options.normalization
      ? normalizeChannels(channels, sr, options.normalization)
      : undefined;
    if (normalized) channels = normalized.channels;

    const dither = options.dither ?? s.export.dither;
    const analysis = {
      ...analyzeChannels(channels, sr),
      cycleDifferenceRms,
      cycleComparison,
      cycleMeasurementStage: "before-normalization",
      normalization: normalized?.report ?? null,
      limiter: limiterReport,
      dither,
      loopCrossfadeBeats: crossfadeBeats,
    } satisfies RenderAnalysis;
    const encoded = dither ? applyDither(channels, s.seed) : channels;
    const bytes = encodeWav(encoded, sr);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return {
      wavBase64: btoa(binary),
      analysis,
      render: {
        mode,
        fromBeat: from,
        toBeat: to,
        warmupCycles: mode === "loop" ? s.export.warmupCycles : 0,
        loopFrames: mode === "loop" && !options.seam ? loopFrames : null,
        seamPreview: !!options.seam,
        effects: options.effects ?? "mix",
        loopCrossfadeBeats: crossfadeBeats,
        dither,
        limiter: limiterReport,
      },
    };
  } finally {
    result?.dispose();
    for (const node of owned.reverse()) node.dispose();
  }
}
Object.assign(globalThis, { retroRender: renderInBrowser });
