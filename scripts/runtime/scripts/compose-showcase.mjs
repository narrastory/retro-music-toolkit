// Original showcase compositions. Musical phrases are authored here, not taken
// from the old examples. Run from any directory; no network or generation API.
import { mkdir, writeFile } from "node:fs/promises";
import { compileScore } from "../dist/compiler.js";
const target = new URL("../../../docs/scores/", import.meta.url);
await mkdir(target, { recursive: true });
const pcs = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midi = (pitch) => {
  const [, n, o] = /^([A-G]#?)(\d)$/.exec(pitch);
  return pcs.indexOf(n) + (Number(o) + 1) * 12;
};
const pitch = (n) => pcs[(n + 120) % 12] + (Math.floor(n / 12) - 1);
const chords = {
  Dm: ["D", "F", "A"],
  Bb: ["A#", "D", "F"],
  F: ["F", "A", "C"],
  C: ["C", "E", "G"],
  Gm: ["G", "A#", "D"],
  A: ["A", "C#", "E"],
  Am: ["A", "C", "E"],
  Em: ["E", "G", "B"],
  G: ["G", "B", "D"],
  D: ["D", "F#", "A"],
  E: ["E", "G#", "B"],
  Dm7: ["D", "F", "A", "C"],
};
const tones = (chord, octave = 3) => chords[chord].map((n) => midi(n + octave));
const middle = (n) => {
  while (n < 55) n += 12;
  while (n > 67) n -= 12;
  return n;
};
const fm = (id, role, harmonicity, index, attack, release, sustain) => ({
  id,
  role,
  engine: "fm",
  range: [36, 96],
  attack,
  release,
  description: `Original ${id} two-operator patch`,
  synthesis: { harmonicity, modulationIndex: index, sustain, volumeDb: 0 },
  velocityResponse: { filterOctaves: 0.5, fmIndexScale: 0.3 },
  provenance: "Original procedural patch; no game samples or quotations.",
});
function base(id, title, profile, tempo, meter, key, progression, labels) {
  const beats = meter[0] * (4 / meter[1]);
  return {
    schemaVersion: "1.3",
    title,
    profile,
    tempo,
    meter,
    seed: 20261031 + tempo,
    key,
    lengthBeats: progression.length * beats,
    harmony: progression.map((chord, b) => ({
      at: b * beats,
      chord,
      lengthBeats: beats,
    })),
    sections: labels.map((label, i) => ({
      id: `${id}-section-${i}`,
      at: i * 8 * beats,
      lengthBeats: 8 * beats,
      label,
      energy: [0.6, 0.85, 0.3, 0.95][i],
    })),
    tracks: [],
    mixer: { masterDb: -3, delayBeats: 0.75, feedback: 0.25, returnDb: -13 },
    export: {
      sampleRate: 44100,
      format: "pcm16-wav",
      mode: "loop",
      warmupCycles: 2,
      tailSeconds: 0,
      dither: true,
    },
  };
}
function track(score, id, instrument, role, gainDb, options = {}) {
  const t = {
    id,
    instrument,
    role,
    gainDb,
    pan: 0,
    send: 0.12,
    maxVoices: 1,
    controls: { brightness: 0.45, pluckiness: 0.5 },
    patterns: {},
    clips: [],
    ...options,
  };
  score.tracks.push(t);
  return t;
}
function bar(t, b, length, events) {
  if (!events.length) return;
  const name = `bar${b}`;
  t.patterns[name] = {
    lengthBeats: length,
    events: events.map((e, i) => ({ id: `${t.id}-${b}-${i}`, ...e })),
  };
  t.clips.push({ id: `${t.id}-clip-${b}`, pattern: name, at: b * length });
}
const note = (at, n, duration, velocity = 0.72, extra = {}) => ({
  kind: "note",
  at: Math.round(at * 960) / 960,
  pitch: typeof n === "number" ? pitch(n) : n,
  duration: Math.round(duration * 960) / 960,
  gate: 0.86,
  velocity,
  ...extra,
});
const hit = (at, sound, velocity) => ({ kind: "hit", at, sound, velocity });
function phrase(text, transpose = 0, velocity = 0.76) {
  let at = 0;
  const events = [];
  for (const token of text.split(" ")) {
    const [n, d] = token.split(":");
    const duration = Number(d);
    if (n !== "-")
      events.push(
        note(at, transpose ? midi(n) + transpose : n, duration, velocity),
      );
    at += duration;
  }
  return events;
}

// 1. Ember Resolve: small persistent motif, syncopated bass, tonal bridge,
// pulse chord cycling constrained to one voice, and an answering pulse.
{
  const progression = [
    "Dm",
    "Dm",
    "Bb",
    "C",
    "Dm",
    "F",
    "Gm",
    "A",
    "Dm",
    "Dm",
    "Bb",
    "C",
    "F",
    "C",
    "Gm",
    "A",
    "Gm",
    "Gm",
    "Dm",
    "Dm",
    "Bb",
    "C",
    "A",
    "A",
    "Dm",
    "Dm",
    "Bb",
    "C",
    "F",
    "Gm",
    "A",
    "A",
  ];
  const s = base(
    "ember-resolve",
    "Ember Resolve",
    "nes-inspired",
    160,
    [4, 4],
    { tonic: "D", mode: "minor" },
    progression,
    ["Spark", "Resolve", "Suspension", "Return"],
  );
  const lead = track(s, "ember-lead", "pulse-lead-soft", "melody", -5, {
    send: 0.08,
    controls: { brightness: 0.48, pluckiness: 0.62 },
  });
  const pulse = track(s, "ember-pulse", "pulse-pluck", "arp", -15, {
    pan: -0.18,
    send: 0.04,
    arpeggio: { enabled: true, rate: 12, gate: 0.85, order: "up" },
  });
  const bass = track(s, "ember-bass", "triangle-bass", "bass", -3, {
    send: 0,
    controls: { brightness: 0.4, pluckiness: 0.65 },
  });
  const drums = track(s, "ember-drums", "chip-drums", "drums", -10, {
    send: 0,
  });
  const a = [
    "D5:0.5 A4:0.25 D5:0.25 F5:0.75 E5:0.25 D5:0.5 A4:0.5 -:1",
    "D5:0.5 A4:0.25 D5:0.25 E5:0.5 F5:0.5 A5:0.75 G5:0.25 F5:0.5 -:0.5",
    "F5:0.75 D5:0.25 F5:0.5 A5:0.5 A#5:0.75 A5:0.25 F5:0.5 -:0.5",
    "G5:0.5 E5:0.5 D5:0.25 E5:0.25 G5:0.5 E5:1 -:1",
    "D5:0.5 A4:0.25 D5:0.25 F5:0.75 E5:0.25 D5:0.5 F5:0.5 A5:0.5 -:0.5",
    "A5:0.75 G5:0.25 F5:0.5 C5:0.5 F5:0.5 G5:0.5 A5:0.5 -:0.5",
    "G5:0.5 D5:0.5 A#4:0.5 D5:0.5 G5:0.75 F5:0.25 D5:0.5 -:0.5",
    "E5:0.5 C#5:0.5 A4:0.5 E5:0.5 C#5:1 -:1",
  ];
  const bridge = [
    "A#4:1 D5:1 G5:1 -:1",
    "F5:0.5 D5:0.5 A#4:1 D5:1 -:1",
    "A4:1 D5:1 F5:1 -:1",
    "E5:0.5 D5:0.5 A4:1 F4:1 -:1",
    "F5:1 D5:0.5 A#4:0.5 D5:1 -:1",
    "G5:1 E5:0.5 C5:0.5 E5:1 -:1",
    "E5:0.5 A5:0.5 G5:0.5 E5:0.5 C#5:1 -:1",
    "C#5:0.5 E5:0.5 A5:0.5 G5:0.5 E5:0.5 C#5:0.5 A4:0.5 -:0.5",
  ];
  progression.forEach((chord, b) => {
    let melody = phrase(b >= 16 && b < 24 ? bridge[b - 16] : a[b % 8]);
    if (b >= 24)
      melody = melody.map((e, i) => ({
        ...e,
        velocity: 0.84,
        ...(i === 0
          ? { vibrato: { depthCents: 9, rateHz: 5.5, delayBeats: 0.2 } }
          : {}),
      }));
    if (b >= 28) melody = phrase(a[[5, 6, 7, 7][b - 28]]);
    if (b === 15)
      melody = phrase(
        "E5:0.5 C#5:0.5 E5:0.5 G5:0.5 A5:0.5 E5:0.5 C#5:0.5 -:0.5",
      );
    bar(lead, b, 4, melody);
    const triad = tones(chord, 3),
      root = triad[0] - 12,
      fifth = root + 7;
    bar(
      bass,
      b,
      4,
      (b >= 16 && b < 20 ? [0, 2] : [0, 0.75, 1.5, 2, 2.75, 3.5]).map((at, i) =>
        note(
          at,
          i % 3 === 2 ? fifth : root,
          b >= 16 && b < 20 ? 1.3 : 0.38,
          0.78,
        ),
      ),
    );
    if (!(b >= 16 && b < 24) && b >= 4)
      bar(
        pulse,
        b,
        4,
        [0, 2].flatMap((at) => triad.map((n) => note(at, n + 12, 0.7, 0.48))),
      );
    const d = [];
    if (b < 16 || b >= 22) {
      for (const at of [0, 2, ...(b % 4 === 2 ? [2.75] : [])])
        d.push(hit(at, "kick", 0.8));
      for (const at of [1, 3]) d.push(hit(at, "snare", 0.63));
      for (let j = 0; j < 8; j++) d.push(hit(j / 2, "hat", j % 2 ? 0.2 : 0.32));
    } else if (b % 2 === 0) d.push(hit(0, "kick", 0.6), hit(3, "rim", 0.35));
    if (b % 8 === 7 && b !== 31)
      for (const at of [3.25, 3.5, 3.75]) d.push(hit(at, "tom", 0.4));
    bar(drums, b, 4, d);
  });
  await save("ember-resolve", s);
}

// 2. Redleaf Post: lilting compound meter, independent flute and pluck
// questions, restrained sampled strings, and an eight-tap FIR echo.
{
  const progression = [
    "F",
    "C",
    "Dm",
    "Am",
    "Bb",
    "F",
    "Gm",
    "C",
    "F",
    "C",
    "Dm",
    "Am",
    "Bb",
    "Gm",
    "C",
    "F",
    "Dm",
    "Am",
    "Bb",
    "F",
    "Gm",
    "Dm",
    "C",
    "C",
    "F",
    "C",
    "Dm",
    "Am",
    "Bb",
    "Gm",
    "C",
    "F",
  ];
  const s = base(
    "redleaf-post",
    "Redleaf Post",
    "snes-inspired",
    90,
    [6, 8],
    { tonic: "F", mode: "major" },
    progression,
    ["Morning", "Letters", "Autumn", "Homeward"],
  );
  s.mixer.masterDb = 0;
  s.mixer.echo = {
    enabled: true,
    delayBeats: 0.375,
    feedback: 0.24,
    taps: [0.55, 0.26, 0.13, -0.06, 0.035, 0.02, 0.01, 0],
    returnDb: -12,
  };
  const flute = track(s, "redleaf-flute", "sample-flute", "melody", -5, {
    send: 0.28,
    controls: { brightness: 0.4, pluckiness: 0.25 },
  });
  const pluck = track(s, "redleaf-pluck", "sample-pluck", "arp", -12, {
    send: 0.18,
    pan: -0.3,
    humanize: { timingBeats: 0.003125, velocity: 0.035 },
  });
  const bass = track(s, "redleaf-bass", "sample-bass", "bass", -7, {
    send: 0,
    controls: { brightness: 0.3, pluckiness: 0.6 },
  });
  const strings = track(
    s,
    "redleaf-strings",
    "sample-strings",
    "harmony",
    -20,
    { maxVoices: 2, send: 0.25, pan: 0.23 },
  );
  const drums = track(s, "redleaf-percussion", "chip-drums", "drums", -19, {
    send: 0.05,
    humanize: { timingBeats: 0, velocity: 0.035 },
  });
  const a = [
    "A4:0.5 C5:0.5 F5:1 E5:0.5 -:0.5",
    "E5:0.5 D5:0.5 C5:1 G4:0.5 -:0.5",
    "F5:0.75 E5:0.25 D5:0.5 A4:0.5 F4:0.5 -:0.5",
    "E5:0.5 C5:0.5 A4:1 -:1",
    "D5:0.5 F5:0.5 A5:0.5 F5:0.5 D5:0.5 -:0.5",
    "C5:0.5 A4:0.5 F4:1 A4:0.5 -:0.5",
    "A#4:0.5 D5:0.5 G5:0.75 F5:0.25 D5:0.5 -:0.5",
    "E5:0.5 D5:0.5 C5:1 -:1",
  ];
  const b = [
    "F5:1 A5:0.5 F5:0.5 D5:0.5 -:0.5",
    "E5:0.5 C5:0.5 A4:1 -:1",
    "D5:0.5 F5:0.5 A#5:1 A5:0.5 -:0.5",
    "A5:0.5 G5:0.5 F5:1 -:1",
    "G5:0.5 F5:0.5 D5:0.5 A#4:0.5 D5:0.5 -:0.5",
    "F5:0.5 E5:0.5 D5:1 -:1",
    "G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:0.5 -:0.5",
    "E5:1 D5:0.5 C5:0.5 -:1",
  ];
  progression.forEach((chord, bn) => {
    let mel = phrase(bn >= 16 && bn < 24 ? b[bn - 16] : a[bn % 8], 0, 0.65);
    if (bn === 13 || bn === 29) mel = phrase(a[6], 0, 0.65);
    if (bn === 14 || bn === 30) mel = phrase(a[7], 0, 0.65);
    if (bn === 15 || bn === 31) mel = phrase("A4:0.5 C5:0.5 F5:1 -:1", 0, 0.63);
    if (bn >= 8 && bn < 16 && bn % 2 === 0)
      mel = mel.map((e, i) => ({
        ...e,
        velocity: i === 0 ? 0.73 : e.velocity,
      }));
    if (!(bn >= 16 && bn < 20))
      bar(
        flute,
        bn,
        3,
        mel.map((e) => ({
          ...e,
          vibrato: { depthCents: 10, rateHz: 4.8, delayBeats: 0.35 },
        })),
      );
    const triad = tones(chord, 3),
      root = triad[0] - 12;
    let arp = [0, 0.5, 1, 1.5, 2, 2.5].map((at, i) =>
      note(
        at,
        middle(triad[[0, 2, 1, 2, 1, 2][i]]),
        0.38,
        i === 0 ? 0.62 : 0.46,
      ),
    );
    if (bn >= 16 && bn < 20) arp = phrase(b[bn - 16], 0, 0.68);
    bar(pluck, bn, 3, arp);
    bar(bass, bn, 3, [note(0, root, 1.2, 0.65), note(1.5, root + 7, 0.9, 0.5)]);
    if (bn >= 8 && !(bn >= 16 && bn < 20))
      bar(strings, bn, 3, [
        note(0, triad[1], 2.75, 0.48),
        note(0, triad[2], 2.75, 0.42),
      ]);
    if (bn >= 4 && !(bn >= 16 && bn < 20))
      bar(drums, bn, 3, [
        hit(0, "kick", 0.35),
        hit(1.5, "rim", 0.32),
        hit(0.5, "hat", 0.14),
        hit(2, "hat", 0.14),
      ]);
  });
  await save("redleaf-post", s);
}

// 3. Zero Gravity Line: a slow harmonic rhythm and a recognisable fragment
// become a propulsive electronic arrangement; the middle section subtracts.
{
  const progression = [
    "Am",
    "Am",
    "F",
    "F",
    "C",
    "C",
    "G",
    "G",
    "Am",
    "Am",
    "F",
    "F",
    "C",
    "C",
    "G",
    "G",
    "Dm",
    "Dm",
    "Am",
    "Am",
    "F",
    "F",
    "E",
    "E",
    "Am",
    "Am",
    "F",
    "F",
    "C",
    "G",
    "E",
    "E",
  ];
  const s = base(
    "zero-gravity",
    "Zero Gravity Line",
    "genesis-inspired",
    112,
    [4, 4],
    { tonic: "A", mode: "minor" },
    progression,
    ["Drift", "Ascent", "Weightless", "Beyond"],
  );
  s.instrumentDefinitions = [
    fm("gravity-glass", "arp", 3, 0.8, 0.003, 0.16, 0.12),
    fm("gravity-lead", "melody", 1.5, 1.3, 0.025, 0.18, 0.55),
    fm("gravity-pad", "harmony", 1, 0.35, 0.24, 0.5, 0.65),
  ];
  s.mixer = { masterDb: 0, delayBeats: 0.75, feedback: 0.38, returnDb: -10 };
  const lead = track(s, "gravity-lead", "gravity-lead", "melody", -7, {
    send: 0.35,
    controls: { brightness: 0.45, pluckiness: 0.25 },
    automation: [
      {
        parameter: "brightness",
        points: [
          { at: 0, value: 0.25 },
          { at: 32, value: 0.45 },
          { at: 64, value: 0.2 },
          { at: 96, value: 0.62 },
          { at: 128, value: 0.25 },
        ],
      },
    ],
  });
  const arp = track(s, "gravity-glass", "gravity-glass", "arp", -13, {
    send: 0.35,
    pan: -0.22,
    automation: [
      {
        parameter: "pan",
        points: [
          { at: 0, value: -0.35 },
          { at: 32, value: 0.3 },
          { at: 64, value: -0.25 },
          { at: 96, value: 0.3 },
          { at: 128, value: -0.35 },
        ],
      },
    ],
  });
  const pad = track(s, "gravity-pad", "gravity-pad", "harmony", -18, {
    maxVoices: 3,
    send: 0.32,
    pan: 0.2,
  });
  const bass = track(s, "gravity-bass", "fm-bass-round", "bass", 3, {
    send: 0,
    controls: { brightness: 0.3, pluckiness: 0.7 },
  });
  const answer = track(s, "gravity-answer", "fm-epiano", "harmony", -10, {
    send: 0.28,
    pan: 0.3,
    maxVoices: 1,
  });
  const drums = track(s, "gravity-drums", "chip-drums", "drums", -9, {
    send: 0.03,
  });
  const a = [
    "E5:1 A5:0.5 G5:0.5 E5:1 -:1",
    "C5:0.5 E5:0.5 A5:1 G5:0.5 E5:0.5 -:1",
    "C5:1 F5:0.5 E5:0.5 C5:1 -:1",
    "A4:0.5 C5:0.5 F5:1 E5:0.5 C5:0.5 -:1",
    "E5:1 G5:0.5 E5:0.5 D5:0.5 C5:0.5 -:1",
    "G4:1 C5:0.5 D5:0.5 E5:1 -:1",
    "D5:1 G5:0.5 A5:0.5 B5:1 -:1",
    "A5:0.5 G5:0.5 D5:1 B4:1 -:1",
  ];
  const bridge = [
    "F5:2 E5:0.5 D5:0.5 -:1",
    "A4:1 D5:2 -:1",
    "E5:2 C5:1 -:1",
    "A4:1 C5:1 E5:1 -:1",
    "C5:1 F5:2 -:1",
    "E5:0.5 F5:0.5 A5:1 G5:1 -:1",
    "G#5:1 E5:1 B4:1 -:1",
    "E5:1 G#5:1 B5:1 -:1",
  ];
  progression.forEach((chord, b) => {
    let mel = phrase(
      b >= 16 && b < 24 ? bridge[b - 16] : a[b % 8],
      0,
      b >= 24 ? 0.8 : 0.68,
    );
    if (b < 4 && b % 2 === 1) mel = [];
    if (b === 29) mel = phrase("D5:0.5 G5:0.5 B5:1 A5:0.5 G5:0.5 -:1");
    if (b >= 30)
      mel = phrase(
        b === 30
          ? "G#5:1 E5:0.5 B4:0.5 E5:1 -:1"
          : "B4:0.5 E5:0.5 G#5:1 E5:1 -:1",
      );
    mel = mel.map((e, i) => ({
      ...e,
      ...(e.duration >= 1
        ? { vibrato: { depthCents: 13, rateHz: 5.2, delayBeats: 0.4 } }
        : {}),
      ...(b >= 24 && i === 0
        ? {
            expression: {
              pitchBendCents: [
                { offsetBeats: 0, value: -55 },
                { offsetBeats: 0.125, value: 0 },
              ],
            },
          }
        : {}),
    }));
    bar(lead, b, 4, mel);
    const ns = tones(chord, 3),
      root = ns[0] - 12;
    const broken = [];
    const count = b >= 16 && b < 24 ? 4 : b < 8 ? 8 : 16;
    for (let j = 0; j < count; j++)
      broken.push(
        note(
          (j * 4) / count,
          middle(ns[[0, 2, 1, 2, 0, 1, 2, 1][j % 8]]),
          (4 / count) * 0.7,
          j % 4 === 0 ? 0.63 : 0.44,
        ),
      );
    bar(arp, b, 4, broken);
    bar(
      pad,
      b,
      4,
      ns.map((n) => note(0, n, 3.8, 0.44, { gate: 0.95 })),
    );
    const low =
      b >= 16 && b < 24
        ? [0, 2]
        : b < 8
          ? [0, 2]
          : [0, 0.75, 1.5, 2, 2.75, 3.5];
    bar(
      bass,
      b,
      4,
      low.map((at, i) =>
        note(
          at,
          i % 3 === 2 ? root + 7 : root,
          b >= 16 && b < 24 ? 1.5 : 0.4,
          0.7,
        ),
      ),
    );
    if (b >= 8 && b % 2 === 1 && !(b >= 16 && b < 24))
      bar(answer, b, 4, [
        note(3, ns[1] + 12, 0.45, 0.52),
        note(3.5, ns[2] + 12, 0.45, 0.46),
      ]);
    const d = [];
    if (b >= 8 && !(b >= 16 && b < 24)) {
      for (const at of [0, 1.5, 2.75]) d.push(hit(at, "kick", 0.7));
      for (const at of [1, 3]) d.push(hit(at, "snare", 0.5));
      for (let j = 0; j < 8; j++)
        d.push(hit(j / 2, "hat", j % 2 ? 0.16 : 0.24));
      if (b % 8 === 0) d.push(hit(0, "crash", 0.22));
    } else if (b >= 20) d.push(hit(0, "kick", 0.4));
    bar(drums, b, 4, d);
  });
  // Keep the quieter opening while bringing the complete piece near the other
  // masters. This is score-level gain, not post-render loudness normalization.
  for (const t of s.tracks) t.gainDb = Math.min(6, t.gainDb + 4);
  await save("zero-gravity", s);
}
async function save(id, score) {
  const compiled = compileScore(score);
  await writeFile(
    new URL(id + ".json", target),
    JSON.stringify(score, null, 2) + "\n",
  );
  console.log(
    `${id}: ${compiled.events.length} events, ${((score.lengthBeats * 60) / score.tempo).toFixed(2)} seconds`,
  );
}
