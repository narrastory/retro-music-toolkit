// Three original cues for the public listening page, set in one fictional
// underground world. Each shows a different side of the toolkit:
//   mossglow-market       orchestra pack (sampled strings, winds, mallets)
//   crystal-undercurrent  subtractive synth engine with filter automation
//   molten-core-warden    NES-style hardware mode: two pulses, triangle, noise
// Every note is authored here; nothing is generated at render time.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { compileScore } from "../dist/compiler.js";
import {
  importInstrumentCollection,
  bundledCollectionManifest,
} from "../dist/instrument-collection.js";
import { pitchName, midi as midiOf } from "../dist/model.js";
import { parseChord, chordTones } from "../dist/harmony.js";

const docs = new URL("../../../docs/", import.meta.url);
await mkdir(new URL("scores/", docs), { recursive: true });
const manifest = [];
const q = (n) => Math.round(n * 960) / 960;
const toMidi = (n) => (typeof n === "number" ? n : midiOf(n));

// ---------------------------------------------------------------- events
function note(at, n, duration, velocity = 0.7, extra = {}) {
  return {
    kind: "note",
    at: q(at),
    pitch: pitchName(toMidi(n)),
    duration: q(duration),
    gate: 0.9,
    velocity: Math.max(0.05, Math.min(1, velocity)),
    ...extra,
  };
}
const hit = (at, sound, velocity) => ({
  kind: "hit",
  at: q(at),
  sound,
  velocity,
});
function track(s, id, instrument, role, gainDb, options = {}) {
  const t = {
    id,
    instrument,
    role,
    gainDb,
    pan: 0,
    send: 0,
    reverbSend: 0.15,
    maxVoices: 1,
    controls: { brightness: 0.5, pluckiness: 0.5 },
    patterns: {},
    clips: [],
    ...options,
  };
  s.tracks.push(t);
  return t;
}
/** One clip holding `events` (beats relative to `at`). */
function put(t, at, length, events) {
  if (!events.length) return;
  const id = "p" + Object.keys(t.patterns).length;
  t.patterns[id] = {
    lengthBeats: q(length),
    events: events.map((e, i) => ({ ...e, id: `${t.id}-${id}-${i}` })),
  };
  t.clips.push({ id: `${t.id}-c${id}`, pattern: id, at: q(at) });
}
/**
 * Melody from one text per bar ("C5:1 A4:0.5 -:0.5 ..."). Long notes get a
 * delayed vibrato; `shape` returns a velocity for each note from its beat.
 */
function line(t, bar, bpb, bars, options = {}) {
  const { velocity = 0.72, vibrato, extra = () => ({}), gate = 0.9 } = options;
  const events = [];
  bars.forEach((text, b) => {
    let at = 0;
    for (const token of text.trim().split(/\s+/)) {
      const [n, d] = token.split(":");
      const length = Number(d);
      if (n !== "-") {
        const accent = at === 0 ? 1.06 : at % 1 === 0 ? 1 : 0.9;
        const e = note(b * bpb + at, n, length, velocity * accent, {
          gate,
          ...(vibrato && length >= vibrato.minBeats
            ? {
                vibrato: {
                  depthCents: vibrato.depth,
                  rateHz: vibrato.rate,
                  delayBeats: Math.min(length * 0.4, vibrato.delay),
                },
              }
            : {}),
          ...extra(n, length, b, at),
        });
        events.push(e);
      }
      at = q(at + length);
    }
    if (Math.abs(at - bpb) > 1e-6)
      throw new Error(`${t.id} bar ${bar + b}: ${at} beats in "${text}"`);
  });
  put(t, bar * bpb, bars.length * bpb, events);
}
/** Drum bar from 16-step strings: X accent, x normal, o ghost, . rest. */
const LEVEL = { X: 0.92, x: 0.72, o: 0.42 };
function drumBar(spec, scale = 1) {
  const out = [];
  for (const [sound, steps] of Object.entries(spec))
    [...steps].forEach((c, i) => {
      if (LEVEL[c]) out.push(hit(i / 4, sound, LEVEL[c] * scale));
    });
  return out;
}
function drums(t, fromBar, bars, bpb, specFor) {
  const events = [];
  for (let b = 0; b < bars; b++)
    for (const e of drumBar(...[specFor(b, fromBar + b)].flat()))
      events.push({ ...e, at: q(e.at + b * bpb) });
  put(t, fromBar * bpb, bars * bpb, events);
}

// ---------------------------------------------------------------- harmony
const chord = (symbol) => {
  const c = parseChord(symbol);
  return { pcs: chordTones(c), bass: c.bass, root: c.root };
};
/** Lowest MIDI note with pitch class `pc` at or above `low`. */
const above = (pc, low) => low + ((pc - (low % 12) + 12) % 12);
/** Chord tones in [low, high]; `skip` drops intervals above the root (11 = major seventh, 2 = ninth). */
const tonesIn = (symbol, low, high, skip = []) => {
  const { pcs, root } = chord(symbol);
  const keep = pcs.filter((pc) => !skip.includes((pc - root + 12) % 12));
  const out = [];
  for (let m = low; m <= high; m++) if (keep.includes(m % 12)) out.push(m);
  return out;
};
/**
 * Voice-led chord: each previous voice moves to the nearest unused chord
 * tone, preferring pitch classes not yet covered, so pads glide instead of
 * jumping in parallel blocks.
 */
function voiceLead(symbols, low, high, count) {
  let previous;
  return symbols.map((symbol) => {
    const candidates = tonesIn(symbol, low, high);
    if (!previous) {
      const step = Math.max(1, Math.floor(candidates.length / count));
      previous = Array.from(
        { length: count },
        (_, i) => candidates[Math.min(candidates.length - 1, i * step + 1)],
      );
    }
    const used = new Set(),
      pcs = new Set(),
      next = [];
    for (const v of [...previous].sort((a, b) => a - b)) {
      const ranked = candidates
        .filter((c) => !used.has(c))
        .sort(
          (a, b) =>
            (pcs.has(a % 12) ? 6 : 0) +
            Math.abs(a - v) -
            ((pcs.has(b % 12) ? 6 : 0) + Math.abs(b - v)),
        );
      const pick = ranked[0];
      used.add(pick);
      pcs.add(pick % 12);
      next.push(pick);
    }
    previous = next.sort((a, b) => a - b);
    return previous;
  });
}
const bassOf = (symbol, low) => above(chord(symbol).bass, low);

// ---------------------------------------------------------------- score shell
function base({
  title,
  tempo,
  meter = [4, 4],
  key,
  chords,
  sections,
  profile,
}) {
  const bpb = (meter[0] * 4) / meter[1];
  let pos = 0;
  return {
    schemaVersion: "1.3",
    title,
    profile,
    seed: 20261102 + tempo,
    tempo,
    meter,
    key,
    lengthBeats: chords.length * bpb,
    harmony: chords.map((c, b) => ({
      at: b * bpb,
      chord: c,
      lengthBeats: bpb,
    })),
    sections: sections.map(([label, bars, energy], i) => {
      const section = {
        id: "section-" + i,
        label,
        at: pos,
        lengthBeats: bars * bpb,
        energy,
      };
      pos += bars * bpb;
      return section;
    }),
    tracks: [],
    mixer: { masterDb: -6, delayBeats: 0.75, feedback: 0.2, returnDb: -18 },
    export: {
      mode: "loop",
      sampleRate: 44100,
      format: "pcm16-wav",
      warmupCycles: 2,
      tailSeconds: 0,
      dither: true,
      limiter: { enabled: true, ceilingDbfs: -1.5, lookaheadSeconds: 0.005 },
    },
  };
}
async function importPacks(s, packs) {
  s.tracks = [
    {
      id: "placeholder",
      role: "melody",
      instrument: "sample-flute",
      patterns: {},
      clips: [],
    },
  ];
  for (const [id, selection] of packs) {
    const path = bundledCollectionManifest(id);
    s = await importInstrumentCollection(
      s,
      JSON.parse(await readFile(path, "utf8")),
      dirname(path),
      selection,
    );
  }
  s.tracks = [];
  return s;
}
/**
 * Raise a cue by `db`: master gain first (up to 0 dB), then every track
 * (up to +6 dB). The master limiter catches the few peaks that result.
 */
function louder(s, db) {
  const master = Math.min(0, s.mixer.masterDb + db);
  const rest = db - (master - s.mixer.masterDb);
  s.mixer.masterDb = master;
  for (const t of s.tracks) {
    if (t.gainDb + rest > 6)
      throw new Error(`${t.id}: no headroom for +${rest} dB`);
    t.gainDb = Math.round((t.gainDb + rest) * 10) / 10;
  }
}
async function save(id, s, meta) {
  const compiled = compileScore(s);
  const errors = compiled.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2));
  await writeFile(
    new URL("scores/" + id + ".json", docs),
    JSON.stringify(s, null, 2) + "\n",
  );
  manifest.push({
    id,
    ...meta,
    english: s.title,
    duration: (s.lengthBeats * 60) / s.tempo,
    tempo: s.tempo,
    bars: s.lengthBeats / ((s.meter[0] * 4) / s.meter[1]),
    meter: s.meter.join("/"),
    key: s.key.tonic + " " + s.key.mode,
    sectionBeats: s.sections.map((x) => x.at),
  });
  console.log(
    `${id}: ${((s.lengthBeats * 60) / s.tempo).toFixed(1)}s, ${compiled.events.length} events, ${s.tracks.length} tracks`,
  );
}

// ============================================================ 1. Mossglow Market
// A lantern-lit market in a mossy cavern. F major, 100 BPM, 40 bars.
// Intro (harp) → A flute theme → A' with clarinet counterline → B strings in
// D minor → A'' full ensemble with a tag that turns back to the intro.
{
  const A = ["F", "Am7", "Bbmaj7", "C7", "Dm7", "Bbmaj7", "Gm7", "C7"];
  const A2 = ["F", "Am7", "Bbmaj7", "C7", "Dm7", "Gm7", "Csus4", "A7"];
  const B = ["Dm", "Bbmaj7", "Gm7", "A7", "Dm", "Bbmaj7", "Gm7", "C7"];
  const chords = [
    "Fmaj7",
    "Bbmaj7",
    "Fmaj7",
    "C7",
    ...A,
    ...A2,
    ...B,
    ...A,
    "Fmaj7",
    "Bbmaj7",
    "Gm7",
    "C7",
  ];
  let s = base({
    title: "Mossglow Market",
    tempo: 100,
    key: { tonic: "F", mode: "major" },
    chords,
    profile: "snes-inspired",
    sections: [
      ["Lanterns", 12, 0.45],
      ["Stalls", 8, 0.6],
      ["Old well", 8, 0.4],
      ["Closing bell", 12, 0.7],
    ],
  });
  s = await importPacks(s, [
    [
      "orchestra",
      [
        "orch-flute",
        "orch-clarinet",
        "orch-strings",
        "orch-pizzicato",
        "orch-harp",
        "orch-marimba",
      ],
    ],
    ["drums", ["drums-acoustic"]],
  ]);
  s.mixer.reverb = {
    enabled: true,
    decaySeconds: 1.7,
    preDelaySeconds: 0.03,
    damping: 0.5,
    returnDb: -8,
  };
  const flute = track(s, "flute", "orch-flute", "melody", -2, {
    reverbSend: 0.3,
    pan: 0.08,
  });
  const clarinet = track(s, "clarinet", "orch-clarinet", "melody", -6, {
    reverbSend: 0.28,
    pan: -0.22,
  });
  const strings = track(s, "strings", "orch-strings", "harmony", -9, {
    maxVoices: 4,
    reverbSend: 0.38,
    pan: -0.05,
  });
  const cantabile = track(s, "cantabile", "orch-strings", "melody", -4, {
    reverbSend: 0.36,
    pan: 0.12,
  });
  const pizz = track(s, "pizzicato", "orch-pizzicato", "bass", -3, {
    maxVoices: 2,
    reverbSend: 0.18,
    humanize: { timingBeats: 0.006, velocity: 0.05 },
  });
  const harp = track(s, "harp", "orch-harp", "arp", -7, {
    maxVoices: 4,
    reverbSend: 0.32,
    pan: 0.3,
    humanize: { timingBeats: 0.004, velocity: 0.06 },
  });
  const marimba = track(s, "marimba", "orch-marimba", "arp", -10, {
    maxVoices: 4,
    reverbSend: 0.22,
    pan: -0.3,
    humanize: { timingBeats: 0.005, velocity: 0.08 },
  });
  const kit = track(s, "drums", "drums-acoustic", "drums", -9, {
    reverbSend: 0.12,
    humanize: { timingBeats: 0.004, velocity: 0.06 },
  });
  const theme = [
    "C5:1 A4:0.5 C5:0.5 F5:1.5 E5:0.5",
    "E5:1 C5:1 A4:1.5 -:0.5",
    "D5:1 Bb4:0.5 D5:0.5 F5:1 E5:0.5 D5:0.5",
    "C5:1.5 Bb4:0.5 G4:1 -:1",
    "A4:0.5 C5:0.5 F5:1 E5:0.5 D5:0.5 C5:1",
    "D5:1.5 C5:0.5 Bb4:1 A4:1",
    "Bb4:1 A4:0.5 G4:0.5 D5:1 C5:1",
    "E5:1 D5:0.5 C5:0.5 Bb4:1 G4:1",
  ];
  const themeAnswer = [
    "C5:1 A4:0.5 C5:0.5 F5:1.5 G5:0.5",
    "A5:1 G5:0.5 E5:0.5 C5:1.5 -:0.5",
    "D5:1 Bb4:0.5 D5:0.5 F5:1 A5:0.5 G5:0.5",
    "G5:1.5 E5:0.5 C5:1 -:1",
    "F5:1 E5:0.5 D5:0.5 C5:1 A4:1",
    "Bb4:1 D5:1 F5:1 E5:0.5 D5:0.5",
    "F5:3 E5:1",
    "C#5:1 E5:1 A5:1.5 -:0.5",
  ];
  const fluteVibrato = { minBeats: 1.5, depth: 14, rate: 5.2, delay: 0.5 };
  line(flute, 4, 4, theme, { vibrato: fluteVibrato });
  line(flute, 12, 4, themeAnswer, { vibrato: fluteVibrato });
  line(flute, 27, 4, ["-:2 G4:0.5 A4:0.5 Bb4:0.5 B4:0.5"], { velocity: 0.6 });
  line(flute, 28, 4, theme, { vibrato: fluteVibrato, velocity: 0.78 });
  line(flute, 36, 4, ["A5:1.5 G5:0.5 F5:1 C5:1", "D5:3 -:1", "-:4", "-:4"], {
    vibrato: fluteVibrato,
    velocity: 0.66,
  });
  // Clarinet: guide-tone counterline in A', parallel sixths below in A''.
  line(
    clarinet,
    12,
    4,
    [
      "A4:2 C5:2",
      "G4:3 E4:1",
      "F4:2 A4:2",
      "Bb4:2 G4:2",
      "A4:2 F4:2",
      "D4:2 Bb4:2",
      "C5:4",
      "C#5:2 E5:2",
    ],
    {
      velocity: 0.6,
      vibrato: { minBeats: 2, depth: 8, rate: 4.8, delay: 0.6 },
    },
  );
  line(
    clarinet,
    20,
    4,
    [
      "-:4",
      "-:2 D5:1 C5:1",
      "Bb4:4",
      "-:2 E5:1 C#5:1",
      "D5:4",
      "-:2 F5:1 E5:1",
      "D5:2 Bb4:2",
      "-:4",
    ],
    {
      velocity: 0.58,
    },
  );
  const FMAJ = [5, 7, 9, 10, 0, 2, 4];
  const sixthBelow = (m) => {
    // Five diatonic steps down within F major.
    let x = m;
    for (let steps = 0; steps < 5; ) {
      x--;
      if (FMAJ.includes(x % 12)) steps++;
    }
    return x;
  };
  // Sixths below the theme; on a beat, a non-chord sixth moves to the
  // nearest chord tone so the harmony line never rubs against the pad.
  line(
    clarinet,
    28,
    4,
    theme.map((bar, b) => {
      const symbol = A[b];
      let at = 0;
      return bar
        .split(" ")
        .map((tok) => {
          const [n, d] = tok.split(":");
          const onBeat = at % 1 === 0;
          at += Number(d);
          if (n === "-") return tok;
          let h = sixthBelow(midiOf(n));
          if (onBeat && !chord(symbol).pcs.includes(h % 12))
            h = tonesIn(symbol, h - 4, h + 4).sort(
              (x, y) => Math.abs(x - h) - Math.abs(y - h),
            )[0];
          return `${pitchName(h)}:${d}`;
        })
        .join(" ");
    }),
    { velocity: 0.56 },
  );
  // Strings: soft pad under A' and A'', cantabile melody in B.
  const padBars = (from, symbols, velocity) => {
    const voiced = voiceLead(symbols, 48, 67, 3);
    put(
      strings,
      from * 4,
      symbols.length * 4,
      voiced.flatMap((v, b) =>
        v.map((m) => note(b * 4, m, 4, velocity, { gate: 0.98 })),
      ),
    );
  };
  padBars(2, ["Fmaj7", "C7"], 0.38);
  padBars(12, A2, 0.42);
  padBars(20, B, 0.4);
  padBars(28, A, 0.5);
  padBars(36, ["Fmaj7", "Bbmaj7", "Gm7", "C7"], 0.42);
  line(
    cantabile,
    20,
    4,
    [
      "A4:2 D5:1 E5:1",
      "F5:3 E5:0.5 D5:0.5",
      "D5:2 Bb4:1 C5:1",
      "C#5:3 -:1",
      "A4:1 D5:1 F5:1 A5:1",
      "A5:2 G5:1 F5:1",
      "G5:2 F5:1 E5:0.5 D5:0.5",
      "E5:2 -:2",
    ],
    {
      velocity: 0.7,
      vibrato: { minBeats: 1.5, depth: 10, rate: 5, delay: 0.4 },
    },
  );
  // Pizzicato bass: root, fifth, and a passing note into the next bar.
  const pizzEvents = [];
  chords.forEach((c, b) => {
    const root = bassOf(c, 41);
    const fifth = above((chord(c).root + 7) % 12, root);
    const next = bassOf(chords[(b + 1) % chords.length], 41);
    // Walk toward the next root on a tone of the current chord.
    const approach = tonesIn(c, root - 5, root + 12)
      .filter((m) => m !== next)
      .sort((a, b) => Math.abs(a - next) - Math.abs(b - next))[0];
    const quiet = b >= 20 && b < 28;
    pizzEvents.push(note(b * 4, root, 1, quiet ? 0.6 : 0.78));
    pizzEvents.push(
      note(b * 4 + 2, fifth > root + 9 ? fifth - 12 : fifth, 1, 0.6),
    );
    if (!quiet || b % 2 === 1) {
      pizzEvents.push(note(b * 4 + 3, root + 12, 0.5, 0.5));
      pizzEvents.push(note(b * 4 + 3.5, approach, 0.5, 0.55));
    }
  });
  put(pizz, 0, chords.length * 4, pizzEvents);
  // Harp: flowing eighths in intro, B and tag; rolled chords elsewhere.
  const harpEvents = [];
  chords.forEach((c, b) => {
    const tones = tonesIn(c, 53, 79, [11]);
    const flowing = b < 4 || (b >= 20 && b < 28) || b >= 36;
    if (flowing) {
      const order = [0, 1, 2, 3, 4, 3, 2, 1];
      order.forEach((i, k) =>
        harpEvents.push(
          note(
            b * 4 + k * 0.5,
            tones[Math.min(i, tones.length - 1)],
            // Let notes ring into the next eighth, but not past the loop end.
            Math.min(1, chords.length * 4 - (b * 4 + k * 0.5)),
            k === 0 ? 0.62 : 0.48,
          ),
        ),
      );
    } else if (b % 2 === 0) {
      tones
        .slice(1, 4)
        .forEach((m, k) => harpEvents.push(note(b * 4 + k * 0.06, m, 2, 0.42)));
    }
  });
  put(harp, 0, chords.length * 4, harpEvents);
  // Marimba: off-beat dyads, the bounce of the market stalls.
  const marimbaEvents = [];
  chords.forEach((c, b) => {
    if (b < 4 || (b >= 20 && b < 28)) return;
    // Between the pizzicato bass and the flute, out of the melody's way.
    const [a, bb] = voiceLead([c], 57, 69, 2)[0];
    const pattern = b >= 28 ? [0.5, 1.5, 2.5, 3, 3.5] : [0.5, 1.5, 2.5, 3.5];
    for (const at of pattern) {
      const v = at === 3 ? 0.42 : 0.52;
      marimbaEvents.push(
        note(b * 4 + at, a, 0.5, v),
        note(b * 4 + at, bb, 0.5, v * 0.9),
      );
    }
  });
  put(marimba, 0, chords.length * 4, marimbaEvents);
  drums(kit, 4, 16, 4, (b) => ({
    kick: "x.......x.......",
    snare: "....o.......o...",
    hat: b % 4 === 3 ? "o.o.o.o.o.o.o..." : "o.o.o.o.o.o.o.o.",
    openhat: b % 4 === 3 ? "..............o." : "................",
  }));
  drums(kit, 20, 8, 4, (b) => ({
    kick: b % 2 === 0 ? "x..............." : "........",
    hat: "....o.......o...",
  }));
  drums(kit, 28, 12, 4, (b, bar) => ({
    kick: "x.....x.x.......",
    snare: "....x.......x...",
    hat: "o.o.o.o.o.o.o.o.",
    ...(bar === 35 || bar === 39
      ? { tom: "........x.x.x.x.", hat: "o.o.o.o........." }
      : {}),
  }));
  s.mixer.masterDb = -3;
  louder(s, 7.5); // measured -23.5 LUFS before; release target -16 LUFS
  await save("mossglow-market", s, {
    title: "苔光集市",
    style: "Cozy settlement",
    setting: "聚落 / 白天的集市",
    sections: ["掌灯", "摊位", "老井", "收摊钟声"],
    features: [
      "长笛主题与单簧管对位",
      "D 小调弦乐中段",
      "拨弦、竖琴、马林巴的节奏层",
    ],
    description:
      "苔藓发着微光的洞穴里，集市刚刚开张。长笛唱主题，单簧管在下面应答，拨弦和马林巴撑起轻快的步子；中段弦乐转到 D 小调，像是有人在老井边停下脚步。",
    prompt:
      "为原创地下生存游戏的聚落白天写一首温暖的循环配乐。F 大调，100 BPM，4/4，40 小节。使用 orchestra 包：长笛唱两小节一句、有节奏辨识度的主题；第二遍加单簧管的引导音对位，再现时单簧管在主题下方平行六度。拨弦低音走根音、五音和经过音，竖琴在前奏与中段流动八分音，马林巴打反拍双音。中段转 D 小调，由弦乐唱长线，鼓组退到只剩底鼓和稀疏镲。结尾四小节回到前奏的和声，经 C7 接回开头。所有旋律原创。",
    credits: [
      "VSCO 2 Community Edition and VCSL — Versilian Studios (CC0).",
      "Gogodze Phu Vol II — Karoryfer Lecolds (CC BY 4.0).",
    ],
  });
}

// ====================================================== 2. Crystal Undercurrent
// Descending through glowing crystal veins. E minor, 120 BPM, 48 bars.
// Intro builds with a filter sweep → theme → higher variation → piano
// breakdown → riser → full return. All voices except piano and drums are
// the subtractive engine.
{
  const P1 = ["Em9", "Cmaj9", "G", "D/F#", "Em9", "Cmaj9", "Am7", "B7"];
  const P2 = ["Cmaj7", "D", "Bm7", "Em7", "Am7", "D", "Gmaj7", "B7"];
  const chords = [...P1, ...P1, ...P1, ...P2, ...P1, ...P1];
  let s = base({
    title: "Crystal Undercurrent",
    tempo: 120,
    key: { tonic: "E", mode: "minor" },
    chords,
    profile: "genesis-inspired",
    sections: [
      ["Descent", 16, 0.55],
      ["Veins", 8, 0.7],
      ["Still water", 16, 0.4],
      ["Surge", 8, 0.9],
    ],
  });
  s = await importPacks(s, [
    ["piano", ["keys-grand"]],
    ["drums", ["drums-acoustic"]],
  ]);
  s.mixer = {
    masterDb: -6,
    delayBeats: 0.75,
    feedback: 0.32,
    returnDb: -14,
    reverb: {
      enabled: true,
      decaySeconds: 2.4,
      preDelaySeconds: 0.04,
      damping: 0.45,
      returnDb: -7,
    },
  };
  const pad = track(s, "pad", "analog-pad", "harmony", -6, {
    maxVoices: 4,
    reverbSend: 0.45,
    controls: { brightness: 0.45, pluckiness: 0.3 },
    automation: [
      {
        parameter: "brightness",
        points: [
          { at: 0, value: 0.05 },
          { at: 32, value: 0.5 },
          { at: 96, value: 0.6 },
          { at: 100, value: 0.2 },
          { at: 128, value: 0.3 },
          { at: 160, value: 0.85 },
          { at: 184, value: 0.7 },
          { at: 192, value: 0.05 },
        ],
      },
    ],
  });
  const pluck = track(s, "pluck", "analog-pluck", "arp", -11, {
    maxVoices: 3,
    send: 0.35,
    reverbSend: 0.3,
    pan: 0.25,
    automation: [
      {
        parameter: "brightness",
        points: [
          { at: 0, value: 0.1 },
          { at: 32, value: 0.55 },
          { at: 96, value: 0.6 },
          { at: 128, value: 0.15 },
          { at: 160, value: 0.95 },
          { at: 192, value: 0.1 },
        ],
      },
      {
        parameter: "pan",
        points: [
          { at: 0, value: 0.25 },
          { at: 64, value: -0.25 },
          { at: 128, value: 0.25 },
          { at: 192, value: 0.25 },
        ],
      },
    ],
  });
  const bass = track(s, "bass", "analog-bass", "bass", -4, {
    reverbSend: 0,
    controls: { brightness: 0.5, pluckiness: 0.6 },
  });
  const lead = track(s, "lead", "analog-lead", "melody", -5, {
    send: 0.22,
    reverbSend: 0.3,
    controls: { brightness: 0.55, pluckiness: 0.5 },
  });
  s.instrumentDefinitions.push({
    id: "chip-tenor",
    engine: "pulse",
    role: "melody",
    range: [48, 84],
    attack: 0.004,
    release: 0.05,
    description: "25 % pulse in the tenor register for counterlines",
    synthesis: { pulseWidth: -0.5, sustain: 0.6, volumeDb: -10 },
    provenance: "Original procedural synthesis.",
  });
  const chip = track(s, "chip", "chip-tenor", "melody", -14, {
    send: 0.3,
    reverbSend: 0.2,
    pan: -0.3,
  });
  const piano = track(s, "piano", "keys-grand", "melody", -5, {
    maxVoices: 4,
    reverbSend: 0.42,
    pan: 0.05,
  });
  const kit = track(s, "drums", "drums-acoustic", "drums", -6, {
    reverbSend: 0.1,
    humanize: { timingBeats: 0.002, velocity: 0.05 },
  });
  // Pad everywhere; the brightness lane does the storytelling.
  const voiced = voiceLead(chords, 52, 76, 4);
  put(
    pad,
    0,
    chords.length * 4,
    voiced.flatMap((v, b) =>
      v.map((m) =>
        note(b * 4, m, 4, b >= 24 && b < 32 ? 0.5 : 0.62, { gate: 1 }),
      ),
    ),
  );
  // Pluck: sixteenth arpeggio climbing through the chord, rests in breakdown.
  const pluckEvents = [];
  chords.forEach((c, b) => {
    if (b >= 24 && b < 32) return;
    // Above the lead and without ninths: a clear, glassy sparkle.
    const tones = tonesIn(c, 76, 98, [2, 14]);
    const shape = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 3, 2, 1];
    shape.forEach((i, k) =>
      pluckEvents.push(
        note(
          b * 4 + k * 0.25,
          tones[Math.min(i, tones.length - 1)],
          0.25,
          k % 4 === 0 ? 0.7 : 0.5,
          { gate: 0.6 },
        ),
      ),
    );
  });
  put(pluck, 0, chords.length * 4, pluckEvents);
  // Bass: syncopated eighths with octave pops; half notes in the breakdown.
  const bassEvents = [];
  chords.forEach((c, b) => {
    if (b < 8) return;
    const r = bassOf(c, 28);
    if (b >= 24 && b < 32) {
      bassEvents.push(note(b * 4, r, 2, 0.6), note(b * 4 + 2.5, r, 1.5, 0.5));
      return;
    }
    for (const [at, n, d, v] of [
      [0, r, 0.75, 0.85],
      [0.75, r, 0.25, 0.55],
      [1.5, r + 12, 0.5, 0.65],
      [2, r, 0.5, 0.75],
      [2.75, r, 0.25, 0.55],
      [3, r + 12, 0.5, 0.6],
      [3.5, r + 7 > 52 ? r - 5 : r + 7, 0.5, 0.6],
    ])
      bassEvents.push(note(b * 4 + at, n, d, v, { gate: 0.8 }));
  });
  put(bass, 0, chords.length * 4, bassEvents);
  const leadVibrato = { minBeats: 1.5, depth: 18, rate: 5.5, delay: 0.6 };
  // Long notes scoop up from 150 cents below, a synth-lead gesture that
  // needs no legato.
  const slide = (n, length) =>
    length >= 1.5
      ? {
          expression: {
            pitchBendCents: [
              { offsetBeats: 0, value: -150 },
              { offsetBeats: 0.15, value: 0 },
            ],
          },
        }
      : {};
  const themeA = [
    "B4:1.5 G4:0.5 A4:1 B4:1",
    "D5:1.5 B4:0.5 G4:1 E4:1",
    "D5:1 E5:0.5 D5:0.5 B4:1 G4:1",
    "A4:3 -:1",
    "B4:1.5 G4:0.5 A4:1 B4:1",
    "E5:1.5 D5:0.5 B4:1 G4:1",
    "A4:1 C5:1 E5:1 G5:1",
    "F#5:2.5 D#5:0.5 B4:1",
  ];
  const themeB = [
    "E5:1.5 B4:0.5 D5:1 E5:1",
    "G5:1.5 E5:0.5 D5:1 B4:1",
    "D5:0.5 E5:0.5 G5:1 A5:1 G5:1",
    "F#5:3 -:1",
    "E5:1 G5:0.5 F#5:0.5 E5:1 D5:1",
    "E5:2 B4:1 G4:1",
    "C5:1 E5:1 A5:1 G5:0.5 E5:0.5",
    "F#5:2 D#5:1 B4:1",
  ];
  line(lead, 8, 4, themeA, { vibrato: leadVibrato, extra: slide });
  line(lead, 16, 4, themeB, {
    vibrato: leadVibrato,
    extra: slide,
    velocity: 0.78,
  });
  // Riser: one held legato line gliding up E–G–A–B.
  line(lead, 36, 4, ["E5:4", "G5:4", "A5:4", "B5:4"], {
    velocity: 0.62,
    vibrato: { minBeats: 2, depth: 24, rate: 6, delay: 1.5 },
    extra: (n, length, b) =>
      b === 0
        ? { hold: true }
        : {
            hold: b < 3,
            articulation: "legato",
            expression: { portamentoBeats: 0.25 },
          },
  });
  line(lead, 40, 4, themeB, {
    vibrato: leadVibrato,
    extra: slide,
    velocity: 0.82,
  });
  // Chip counterline: an octave-down echo of the theme in the final surge.
  line(
    chip,
    40,
    4,
    themeB.map((bar) =>
      bar
        .split(" ")
        .map((t) => {
          const [n, d] = t.split(":");
          return n === "-" ? t : `${pitchName(midiOf(n) - 12)}:${d}`;
        })
        .join(" "),
    ),
    { velocity: 0.6, gate: 0.7 },
  );
  // Piano breakdown: melody over open fifths in the left hand.
  line(
    piano,
    24,
    4,
    [
      "G4:1 B4:1 E5:2",
      "F#5:1.5 E5:0.5 D5:2",
      "D5:1 B4:1 F#4:2",
      "G4:1 B4:1 E5:1 D5:1",
      "C5:1.5 B4:0.5 A4:2",
      "F#4:1 A4:1 D5:2",
      "B4:1 D5:1 F#5:2",
      "D#5:2 F#5:1 A5:1",
    ],
    { velocity: 0.62 },
  );
  put(
    piano,
    96,
    32,
    P2.flatMap((c, b) => {
      const r = bassOf(c, 40);
      return [note(b * 4, r, 4, 0.45), note(b * 4, r + 7, 4, 0.38)];
    }),
  );
  // Drums.
  drums(kit, 4, 4, 4, (b) => ({
    hat: b === 3 ? "o.o.o.o.o.o.x.x." : "o.o.o.o.o.o.o.o.",
  }));
  const groove = (b, bar) => ({
    kick: "x.....x.x.....x.",
    snare: "....X.......X...",
    hat: "x.o.x.o.x.o.x.oo",
    ...(bar % 8 === 7
      ? { tom: "............x.x.", snare: "....X.......X.xx" }
      : {}),
  });
  drums(kit, 8, 16, 4, groove);
  drums(kit, 32, 8, 4, (b) => [
    {
      kick: "x...x...x...x...",
      snare:
        b < 4
          ? "....x.......x..."
          : b < 6
            ? "x.x.x.x.x.x.x.x."
            : "xxxxxxxxxxxxxxxx",
      hat: b < 6 ? "o.o.o.o.o.o.o.o." : "",
      ...(b === 7 ? { tom: "........x.x.x.x." } : {}),
    },
    0.55 + b * 0.06,
  ]);
  drums(kit, 40, 8, 4, (b, bar) => ({
    ...groove(b, bar),
    hat: "x.o.....x.o.....",
    openhat: "....x.......x...".replace(/./g, (c, i) =>
      i % 8 === 6 ? "x" : ".",
    ),
  }));
  s.mixer.masterDb = -4;
  louder(s, 11.2); // measured -27.2 LUFS before
  await save("crystal-undercurrent", s, {
    title: "晶脉潜流",
    style: "Synth exploration",
    setting: "深层 / 晶体矿脉",
    sections: ["下潜", "矿脉", "静水", "涌流"],
    features: [
      "减法合成 pad、贝斯、拨弦与主奏",
      "滤波器自动化推动段落起伏",
      "钢琴间奏后的集结与爆发",
    ],
    description:
      "往下走，岩壁里的晶体一层层亮起来。前奏的滤波器慢慢打开，拨弦琶音和切分贝斯推着旅程向前；中段只剩钢琴和水声般的铺底，随后一路蓄力，回到更亮的主题。",
    prompt:
      "为原创地下探索游戏的晶体矿脉区域写一首现代复古的合成器循环曲。E 小调，120 BPM，4/4，48 小节。除钢琴和鼓外全部使用 subtractive 引擎：analog-pad 铺满全曲，用 brightness 自动化讲述段落（前奏从暗到亮，中段收暗，蓄力段推到最亮，结尾回暗以便循环）；analog-pluck 走十六分琶音，analog-bass 写带八度跳跃的切分八分音，analog-lead 唱两小节动机并在长音上加滑音和延迟颤音。第 25–32 小节是钢琴间奏，接着八小节小军鼓渐密的蓄力，最后一段加入一条低八度的脉冲波对位。所有旋律原创。",
    credits: [
      "Salamander Grand Piano V3 — Alexander Holm; retuned mapping Markus Fiedler (CC BY 3.0).",
      "Gogodze Phu Vol II — Karoryfer Lecolds (CC BY 4.0).",
      "Synthesizers: original subtractive and pulse patches.",
    ],
  });
}

// ====================================================== 3. Molten Core Warden
// Boss fight beside the planet's molten core. NES-style hardware mode: two
// pulse channels (12.5 % lead, 25 % harmony with chip arpeggios), triangle
// bass and a noise kit. D minor, 160 BPM, 44 bars.
{
  const A = ["Dm", "C", "Bb", "A", "Dm", "F", "Gm", "A7"];
  const B = ["Bb", "C", "Am", "Dm", "Bb", "C7", "E7", "A7"];
  const C = ["Gm", "Dm", "Gm", "A", "Gm", "Dm", "Bb", "A7"];
  const chords = ["Dm", "Dm", "Bb", "A", ...A, ...A, ...B, ...C, ...A];
  let s = base({
    title: "Molten Core Warden",
    tempo: 160,
    key: { tonic: "D", mode: "minor" },
    chords,
    profile: "nes-inspired",
    sections: [
      ["Awakening", 12, 0.8],
      ["Clash", 8, 0.9],
      ["Second phase", 16, 0.75],
      ["Final blow", 8, 1],
    ],
  });
  s.authenticity = "hardware";
  s.instrumentDefinitions = [
    {
      id: "nes-lead",
      engine: "pulse",
      role: "melody",
      range: [55, 96],
      attack: 0.002,
      release: 0.03,
      description: "12.5 % duty pulse lead",
      synthesis: {
        pulseWidth: -0.75,
        sustain: 0.8,
        decaySeconds: 0.12,
        volumeDb: -9,
      },
      provenance: "Original procedural synthesis.",
    },
    {
      id: "nes-harmony",
      engine: "pulse",
      role: "arp",
      range: [50, 90],
      attack: 0.002,
      release: 0.02,
      description: "25 % duty pulse for chords and counterlines",
      synthesis: {
        pulseWidth: -0.5,
        sustain: 0.55,
        decaySeconds: 0.1,
        volumeDb: -12,
      },
      provenance: "Original procedural synthesis.",
    },
  ];
  s.mixer = { masterDb: -6, delayBeats: 0.375, feedback: 0.18, returnDb: -16 };
  const lead = track(s, "pulse-1", "nes-lead", "melody", -3, {
    send: 0.25,
    reverbSend: 0,
  });
  const harmony = track(s, "pulse-2", "nes-harmony", "arp", -6, {
    reverbSend: 0,
    pan: 0.15,
    arpeggio: { rate: 12, gate: 1, order: "up" },
  });
  const tri = track(s, "triangle", "triangle-bass", "bass", -2, {
    reverbSend: 0,
  });
  const noise = track(s, "noise", "chip-drums", "drums", -7, { reverbSend: 0 });
  const leadVibrato = { minBeats: 1.5, depth: 22, rate: 6.5, delay: 0.5 };
  // Falls at phrase ends: a quick downward bend, a classic chip gesture.
  const fall = (bend) => (n, length, b, at) =>
    bend.includes(`${b}:${at}`)
      ? {
          expression: {
            pitchBendCents: [
              { offsetBeats: q(length * 0.6), value: 0 },
              { offsetBeats: q(length), value: -500 },
            ],
          },
        }
      : {};
  const melodyA = [
    "D5:0.5 D5:0.5 A5:1 F5:0.5 E5:0.5 D5:1",
    "E5:0.5 E5:0.5 G5:1 E5:0.5 D5:0.5 C5:1",
    "D5:0.5 D5:0.5 F5:1 D5:0.5 C5:0.5 Bb4:1",
    "C#5:1.5 E5:0.5 A5:2",
    "D5:0.5 F5:0.5 A5:0.5 D6:0.5 C6:1 A5:1",
    "C6:0.5 A5:0.5 F5:1 G5:0.5 A5:0.5 C6:1",
    "Bb5:1 A5:0.5 G5:0.5 F5:1 D5:1",
    "E5:1.5 F5:0.5 E5:1 C#5:1",
  ];
  const melodyA2 = [
    ...melodyA.slice(0, 3),
    "C#5:0.5 E5:0.5 A5:0.5 C#6:0.5 E6:2",
    ...melodyA.slice(4, 7),
    "A5:2 G5:1 E5:1",
  ];
  line(lead, 0, 4, ["-:4", "-:4", "-:4", "A4:0.5 C#5:0.5 E5:0.5 G5:0.5 A5:2"], {
    velocity: 0.7,
    extra: fall(["3:2"]),
  });
  line(lead, 4, 4, melodyA, { vibrato: leadVibrato, extra: fall(["3:2"]) });
  line(lead, 12, 4, melodyA2, { vibrato: leadVibrato, velocity: 0.78 });
  line(
    lead,
    20,
    4,
    [
      "F5:2 D5:1 F5:1",
      "G5:2 E5:1 C5:1",
      "A5:1.5 G5:0.5 E5:1 C5:1",
      "D5:3 -:1",
      "Bb5:2 A5:1 F5:1",
      "G5:2 A5:1 Bb5:1",
      "G#5:2 B5:1 D6:1",
      "C#6:2 A5:1 E5:1",
    ],
    { vibrato: leadVibrato, velocity: 0.8, extra: fall(["3:0"]) },
  );
  line(
    lead,
    28,
    4,
    [
      "D5:4",
      "F5:4",
      "G5:2 Bb5:2",
      "A5:4",
      "D6:4",
      "C6:2 A5:2",
      "Bb5:2 F5:2",
      "E5:2 C#5:1 A4:1",
    ],
    {
      velocity: 0.62,
      vibrato: { minBeats: 2, depth: 30, rate: 6, delay: 0.75 },
    },
  );
  line(lead, 36, 4, melodyA, {
    vibrato: leadVibrato,
    velocity: 0.84,
    extra: fall(["3:2"]),
  });
  // Pulse 2: arpeggiated chord stabs in A, counter-melody in B, shimmering
  // whole-bar arpeggios in the second phase.
  // Chords sit under the lead.
  const triad = (c) => voiceLead([c], 55, 70, 3)[0];
  const stab = (from, list) =>
    put(
      harmony,
      from * 4,
      list.length * 4,
      list.flatMap((c, b) =>
        [
          [0, 0.75],
          [1.5, 0.5],
          [2.5, 0.5],
          [3, 1],
        ].flatMap(([at, d]) =>
          triad(c).map((m) => note(b * 4 + at, m, d, 0.62, { gate: 0.85 })),
        ),
      ),
    );
  put(
    harmony,
    0,
    16,
    ["Dm", "Dm", "Bb", "A"].flatMap((c, b) =>
      triad(c).map((m) => note(b * 4, m, 4, 0.5)),
    ),
  );
  stab(4, A);
  stab(12, A);
  line(
    harmony,
    20,
    4,
    [
      "D5:0.5 F5:0.5 Bb5:0.5 F5:0.5 D5:1 F5:1",
      "E5:0.5 G5:0.5 C6:0.5 G5:0.5 E5:1 G5:1",
      "C5:0.5 E5:0.5 A5:0.5 E5:0.5 C5:1 E5:1",
      "A4:0.5 D5:0.5 F5:0.5 A5:0.5 F5:1 D5:1",
      "D5:0.5 F5:0.5 Bb5:0.5 F5:0.5 D5:1 F5:1",
      "E5:0.5 G5:0.5 C6:0.5 G5:0.5 E5:1 G5:1",
      "E5:0.5 G#5:0.5 B5:0.5 G#5:0.5 E5:1 D5:1",
      "C#5:0.5 E5:0.5 A5:0.5 E5:0.5 C#5:1 A4:1",
    ],
    { velocity: 0.5, gate: 0.7 },
  );
  put(
    harmony,
    112,
    32,
    C.flatMap((c, b) => triad(c).map((m) => note(b * 4, m, 4, 0.55))),
  );
  stab(36, A);
  // Triangle: driving octave eighths; half notes in the second phase.
  const triEvents = [];
  chords.forEach((c, b) => {
    const r = bassOf(c, 38);
    if (b < 2) {
      triEvents.push(note(b * 4, r, 4, 0.8));
      return;
    }
    if (b >= 28 && b < 36) {
      triEvents.push(note(b * 4, r, 2, 0.8), note(b * 4 + 2, r + 12, 2, 0.75));
      return;
    }
    for (let k = 0; k < 8; k++)
      triEvents.push(
        note(b * 4 + k * 0.5, k % 2 ? r + 12 : r, 0.5, 0.8, { gate: 0.75 }),
      );
  });
  put(tri, 0, chords.length * 4, triEvents);
  // Noise kit.
  drums(noise, 0, 4, 4, (b) => ({
    tom: b === 3 ? "x.x.x.x.x.x.x.x." : "................",
    snare: b === 3 ? "............xxxx" : "x...............",
  }));
  const battle = (b, bar) => ({
    kick: "x.....x.x.......",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    ...(bar % 8 === 3 ? { snare: "....x.......x.xx" } : {}),
    ...(bar === 19 || bar === 43
      ? { tom: "........x.x.x.x.", hat: "x.x.x.x........." }
      : {}),
  });
  drums(noise, 4, 24, 4, battle);
  drums(noise, 28, 8, 4, (b) => ({
    kick: "x.......x.......",
    snare: "........x.......",
    hat: "x...x...x...x...",
    ...(b === 7 ? { snare: "........x.xxxxxx" } : {}),
  }));
  drums(noise, 36, 8, 4, battle);
  s.mixer.masterDb = -4;
  louder(s, 4.1); // measured -20.1 LUFS before
  await save("molten-core-warden", s, {
    title: "熔芯守卫",
    style: "Chiptune boss battle",
    setting: "核心 / 首领战",
    sections: ["苏醒", "交锋", "第二阶段", "最后一击"],
    features: [
      "硬件模式：12.5% 与 25% 占空比脉冲",
      "单声部和弦琶音与音高下滑",
      "三角波八度低音与噪声鼓",
    ],
    description:
      "守卫在熔芯旁醒来。两路脉冲波、一路三角波和噪声鼓——全部按 NES 的四通道限制来写：主旋律用 12.5% 占空比，和声用快速琶音假装和弦，第二阶段放慢鼓点，让长音的颤音把紧张感拉满。",
    prompt:
      "为原创地下生存游戏写一首首领战芯片音乐。D 小调，160 BPM，4/4，44 小节，profile 用 nes-inspired，authenticity 设为 hardware。严格只用四个通道：12.5% 占空比的脉冲主旋律，25% 占空比的脉冲和声（开启 arpeggio，把同时开始的三和弦变成快速琶音），三角波八度低音，噪声鼓组。主题用重复音和跳进写出攻击性，句尾用向下的弯音；B 段转到降 B 与 C 的大调色彩，经 E7 回到 A7；第二阶段放慢鼓点，主旋律改成长音和宽颤音，和声铺整小节琶音。结尾经 A7 接回开头。所有旋律原创。",
    credits: [
      "All sounds: original pulse, triangle and noise synthesis in hardware mode.",
    ],
  });
}

await writeFile(
  new URL("music.json", docs),
  JSON.stringify(manifest, null, 2) + "\n",
);
