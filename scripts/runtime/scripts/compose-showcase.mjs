// Three new original game cues. Authored phrases, not renamed legacy examples.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { compileScore } from "../dist/compiler.js";
import {
  importInstrumentCollection,
  bundledCollectionManifest,
} from "../dist/instrument-collection.js";
import { pitchName } from "../dist/model.js";
const docs = new URL("../../../docs/", import.meta.url);
await mkdir(new URL("scores/", docs), { recursive: true });
const manifest = [];
const q = (n) => Math.round(n * 960) / 960;
function note(at, n, duration, velocity = 0.66, extra = {}) {
  return {
    kind: "note",
    at: q(at),
    pitch: typeof n === "number" ? pitchName(n) : n,
    duration: q(duration),
    gate: 0.88,
    velocity,
    ...extra,
  };
}
function phrase(text, velocity = 0.68) {
  let at = 0;
  const events = [];
  for (const token of text.split(" ")) {
    const [n, d] = token.split(":");
    if (n !== "-")
      events.push(note(at, n, +d, velocity * (at % 1 === 0 ? 1 : 0.92)));
    at += +d;
  }
  return { events, length: q(at) };
}
function track(s, id, instrument, role, gainDb, options = {}) {
  const t = {
    id,
    instrument,
    role,
    gainDb,
    pan: 0,
    send: 0,
    reverbSend: 0.16,
    maxVoices: 1,
    controls: { brightness: 0.4, pluckiness: 0.4 },
    patterns: {},
    clips: [],
    ...options,
  };
  s.tracks.push(t);
  return t;
}
function put(t, at, length, events) {
  if (!events.length) return;
  const id = "p" + Object.keys(t.patterns).length;
  t.patterns[id] = {
    lengthBeats: length,
    events: events.map((e, i) => ({ ...e, id: t.id + "-" + id + "-" + i })),
  };
  t.clips.push({ id: t.id + "-clip-" + id, pattern: id, at });
}
function melody(t, bar, beats, text, velocity = 0.68) {
  const p = phrase(text, velocity);
  if (p.length !== beats)
    throw new Error(`Bad phrase length ${p.length}: ${text}`);
  put(t, bar * beats, beats, p.events);
}
function custom(id, role, index, volume = -6, attack = 0.02, release = 0.1) {
  return {
    id,
    engine: "fm",
    role,
    range: [36, 90],
    attack,
    release,
    description: "Original rounded two-operator game-music patch",
    synthesis: {
      harmonicity: 2,
      modulationIndex: index,
      decaySeconds: 0.18,
      sustain: 0.45,
      volumeDb: volume,
    },
    provenance: "Original procedural synthesis, no game samples.",
  };
}
function base(title, tempo, meter, key, chords, sectionBars, labels) {
  const bp = (meter[0] * 4) / meter[1];
  let pos = 0;
  return {
    schemaVersion: "1.3",
    title,
    profile: "snes-inspired",
    seed: 20261101 + tempo,
    tempo,
    meter,
    key,
    lengthBeats: chords.length * bp,
    harmony: chords.map((chord, b) => ({ at: b * bp, chord, lengthBeats: bp })),
    sections: sectionBars.map((bars, i) => {
      const section = {
        id: "section-" + i,
        label: labels[i],
        at: pos,
        lengthBeats: bars * bp,
        energy: [0.42, 0.56, 0.34, 0.5][i],
      };
      pos += bars * bp;
      return section;
    }),
    tracks: [],
    mixer: {
      masterDb: -2,
      delayBeats: 0.75,
      feedback: 0.12,
      returnDb: -20,
      reverb: {
        enabled: true,
        decaySeconds: 0.85,
        preDelaySeconds: 0.025,
        damping: 0.66,
        returnDb: -9,
      },
    },
    export: {
      mode: "loop",
      sampleRate: 44100,
      format: "pcm16-wav",
      warmupCycles: 2,
      tailSeconds: 0,
      dither: true,
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
async function save(id, s, meta) {
  compileScore(s);
  await writeFile(
    new URL("scores/" + id + ".json", docs),
    JSON.stringify(s, null, 2) + "\n",
  );
  manifest.push({
    id,
    title: meta.title,
    english: s.title,
    style: meta.style,
    setting: meta.setting,
    duration: (s.lengthBeats * 60) / s.tempo,
    tempo: s.tempo,
    bars: s.lengthBeats / ((s.meter[0] * 4) / s.meter[1]),
    meter: s.meter.join("/"),
    key: s.key.tonic + " " + s.key.mode,
    sectionBeats: s.sections.map((x) => x.at),
    sections: meta.sections,
    features: meta.features,
    description: meta.description,
    prompt: meta.prompt,
    credits: meta.credits,
  });
  console.log(
    `${id}: ${(s.lengthBeats * 60) / s.tempo}s; ${compileScore(s).events.length} events`,
  );
}
const A = ["Gmaj7", "D/F#", "Em7", "Cmaj7", "Am7", "D7", "Gmaj7", "D7"];
const gBass = {
  Gmaj7: 43,
  "D/F#": 42,
  Em7: 40,
  Cmaj7: 48,
  Am7: 45,
  D7: 38,
  Bm7: 47,
  "G/B": 47,
};
const gDyads = {
  Gmaj7: [59, 62],
  "D/F#": [57, 62],
  Em7: [55, 62],
  Cmaj7: [59, 64],
  Am7: [55, 60],
  D7: [60, 66],
  Bm7: [57, 62],
  "G/B": [55, 62],
};
const gTheme = [
  "B4:1.5 D5:0.5 E5:1 D5:1",
  "F#4:1 A4:1.5 -:1.5",
  "G4:1 B4:1 D5:1.5 B4:0.5",
  "E5:1 D5:0.5 C5:0.5 B4:1 -:1",
  "C5:1 E5:0.5 D5:0.5 C5:1 A4:1",
  "F#4:1 A4:0.5 C5:0.5 A4:1 -:1",
  "B4:1.5 A4:0.5 G4:1 D5:1",
  "C5:1 A4:1 F#4:1 -:1",
];
// Rain-washed paths: recorder phrases breathe over fingered guitar, with a
// separate piano conversation and a short relative-minor middle passage.
{
  const chords = [
    ...A,
    ...A,
    "Cmaj7",
    "Am7",
    "Bm7",
    "D7",
    "Em7",
    "Bm7",
    "Cmaj7",
    "G/B",
    "Am7",
    "Em7",
    "Cmaj7",
    "D7",
    ...A,
    "Cmaj7",
    "Am7",
    "D7",
    "D7",
  ];
  let s = base(
    "After the Rain",
    96,
    [4, 4],
    { tonic: "G", mode: "major" },
    chords,
    [8, 12, 8, 12],
    ["Dew", "Footsteps", "Distant hills", "Homeward"],
  );
  s = await importPacks(s, [
    ["starter", ["starter-recorder", "starter-kalimba"]],
    ["band", ["band-guitar", "band-bass"]],
    ["piano", ["keys-grand"]],
    ["drums", ["drums-acoustic"]],
  ]);
  const lead = track(s, "rain-recorder", "starter-recorder", "melody", -7, {
    reverbSend: 0.26,
  });
  const guitar = track(s, "rain-guitar", "band-guitar", "harmony", 0, {
    maxVoices: 2,
    pan: -0.2,
    reverbSend: 0.16,
    humanize: { timingBeats: 0.003125, velocity: 0.025 },
  });
  const bass = track(s, "rain-bass", "band-bass", "bass", -2, {
    reverbSend: 0,
  });
  const piano = track(s, "rain-piano", "keys-grand", "harmony", 1, {
    pan: 0.17,
    reverbSend: 0.22,
  });
  const bells = track(s, "rain-kalimba", "starter-kalimba", "arp", -3, {
    pan: 0.28,
    reverbSend: 0.2,
  });
  const drums = track(s, "rain-drums", "drums-acoustic", "drums", -10, {
    reverbSend: 0.02,
  });
  const middle = [
    "G4:1 B4:1 -:2",
    "F#4:1 A4:1 D5:1 -:1",
    "E5:1 D5:0.5 C5:0.5 B4:1 -:1",
    "D5:1 B4:1 G4:1 -:1",
    "C5:1 B4:0.5 A4:0.5 G4:1 -:1",
    "G4:1 B4:1 D5:1 -:1",
    "E5:1 D5:1 B4:1 -:1",
    "A4:1 C5:1 F#4:1 -:1",
  ];
  const turns = [
    "E5:1 D5:0.5 C5:0.5 B4:1 -:1",
    "C5:1 A4:1 G4:1 -:1",
    "D5:1 B4:1 F#4:1 -:1",
    "A4:1 C5:0.5 A4:0.5 F#4:1 -:1",
  ];
  chords.forEach((chord, b) => {
    const inMiddle = b >= 20 && b < 28,
      inTurn = b >= 16 && b < 20;
    if (!inTurn) {
      let text = inMiddle
        ? middle[b - 20]
        : b >= 36
          ? turns[b - 36]
          : gTheme[(b >= 28 ? b - 28 : b) % 8];
      if (b === 15) text = "A4:0.5 C5:0.5 E5:1 F#5:0.5 E5:0.5 D5:0.5 -:0.5";
      melody(lead, b, 4, text, inMiddle ? 0.59 : b >= 28 ? 0.65 : 0.63);
    } else melody(piano, b, 4, turns[b - 16], 0.62);
    const root = gBass[chord],
      low = [note(0, root, 1.2, 0.62)];
    if (b % 4 !== 3) low.push(note(b % 2 ? 2 : 2.5, root + 7, 0.7, 0.49));
    put(bass, b * 4, 4, low);
    const dyad = gDyads[chord],
      strums = [];
    if (!(inMiddle && b % 2))
      for (const at of b % 4 === 3 ? [1] : [0.5, 2.5])
        for (const n of dyad)
          strums.push(note(at, n, 0.72, at < 1 ? 0.48 : 0.4));
    put(guitar, b * 4, 4, strums);
    if (!inTurn && b % 4 === 1)
      put(piano, b * 4, 4, [
        note(2.75, dyad[0] + 12, 0.45, 0.5),
        note(3.3, dyad[1] + 12, 0.45, 0.46),
      ]);
    if (b % 8 === 3 || b % 8 === 7)
      put(bells, b * 4, 4, [
        note(3.25, dyad[1] + 12, 0.25, 0.45),
        note(3.625, dyad[0] + 12, 0.25, 0.4),
      ]);
    if (b >= 4 && !inMiddle && b % 2 === 0)
      put(drums, b * 4, 4, [
        { kind: "hit", at: 0, sound: "kick", velocity: 0.3 },
        { kind: "hit", at: 1.5, sound: "hat", velocity: 0.23 },
        { kind: "hit", at: 3, sound: "hat", velocity: 0.2 },
      ]);
  });
  s.mixer.masterDb = 0;
  for (const t of s.tracks) t.gainDb += 5;
  for (const d of s.instrumentDefinitions) {
    for (const z of d.sample?.zones ?? []) z.gainDb = 3;
    for (const z of d.drumKit?.slots ?? []) z.gainDb = 3;
  }
  await save("after-the-rain", s, {
    title: "雨后小径",
    style: "Pastoral exploration",
    setting: "田园 / 自由探索",
    sections: ["晨露", "脚步", "远山", "归途"],
    features: ["有留白的笛声主题", "吉他与钢琴交接", "100 秒循环"],
    description:
      "雨停以后，小路还映着天光。竖笛唱出一段轻轻上扬的旋律，吉他与钢琴在句间回应，适合不赶时间的探索。",
    prompt:
      "为原创生活冒险游戏写一首雨后原野的长循环配乐。G 大调，96 BPM，4/4，40 小节。以两小节为单位写有呼吸的竖笛主题，保留清晰节奏身份；用干净吉他双音、克制的电贝斯与零星卡林巴支持旋律。钢琴只在空隙和过渡段接话。以大七、小七和弦与级进低音连接段落，中段转向关系小调色彩，回归时减少装饰。打击乐轻且不连续，尾句从属和声自然接回开头；避免持续高音、满拍琶音和强烈的大鼓。所有旋律原创。",
    credits: [
      "Salamander Grand Piano V3 — Alexander Holm; retuned mapping Markus Fiedler (CC BY 3.0).",
      "Gogodze Phu Vol II — Karoryfer Lecolds (CC BY 4.0).",
      "Growlybass / Black And Green Guitars (CC0); VCSL / Versilian Studios (CC0).",
    ],
  });
}
// The Lit Window: a quiet 3/4 piano miniature. No percussion; space and bass
// inversions do the pacing. Twelve-bar sentences avoid a four-bar reset feel.
{
  const cycle = [
    "Dmaj7",
    "A/C#",
    "Bm7",
    "F#m7",
    "Gmaj7",
    "D/F#",
    "Em7",
    "A7",
    "Dmaj7",
    "Bm7",
    "Em7",
    "A7",
  ];
  const bridge = [
    "Bm7",
    "F#m7",
    "Gmaj7",
    "D/F#",
    "Em7",
    "Bm7",
    "Gmaj7",
    "A7",
    "Gmaj7",
    "D/F#",
    "Em7",
    "A7",
  ];
  const chords = [...cycle, ...cycle, ...bridge, ...cycle];
  let s = base(
    "The Lit Window",
    108,
    [3, 4],
    { tonic: "D", mode: "major" },
    chords,
    [12, 12, 12, 12],
    ["Windowlight", "A letter", "Quiet night", "Still awake"],
  );
  s = await importPacks(s, [
    ["piano", ["keys-grand"]],
    ["starter", ["starter-kalimba"]],
  ]);
  s.instrumentDefinitions.push({
    ...custom("window-soft-pad", "harmony", 0.2, -12, 0.18, 0.32),
    synthesis: {
      harmonicity: 1,
      modulationIndex: 0.2,
      decaySeconds: 0.3,
      sustain: 0.55,
      volumeDb: -12,
    },
  });
  s.mixer.masterDb = 0;
  s.mixer.reverb = {
    enabled: true,
    decaySeconds: 1.1,
    preDelaySeconds: 0.028,
    damping: 0.7,
    returnDb: -9,
  };
  const piano = track(s, "window-piano", "keys-grand", "melody", 3, {
    reverbSend: 0.24,
  });
  const pad = track(s, "window-pad", "window-soft-pad", "harmony", -9, {
    maxVoices: 3,
    reverbSend: 0.15,
    pan: -0.08,
    controls: { brightness: 0.22, pluckiness: 0.2 },
  });
  const bass = track(s, "window-bass", "triangle-bass", "bass", -8, {
    reverbSend: 0,
    controls: { brightness: 0.3, pluckiness: 0.55 },
  });
  const answer = track(s, "window-answer", "starter-kalimba", "arp", 0, {
    pan: 0.2,
    reverbSend: 0.18,
  });
  const theme = [
    "F#4:1 A4:0.5 B4:0.5 A4:1",
    "E4:0.5 A4:0.5 C#5:1 B4:0.5 A4:0.5",
    "F#4:1 A4:0.5 D5:0.5 B4:1",
    "A4:1 F#4:1 E4:0.5 -:0.5",
    "B4:1 A4:0.5 G4:0.5 F#4:1",
    "A4:1 F#4:0.5 E4:0.5 D4:1",
    "G4:1 B4:1 D5:0.5 B4:0.5",
    "C#5:1 B4:0.5 A4:0.5 G4:0.5 -:0.5",
    "F#4:1 A4:1 C#5:0.5 A4:0.5",
    "D5:1 C#5:0.5 B4:0.5 A4:1",
    "G4:1 F#4:0.5 E4:0.5 B4:0.5 -:0.5",
    "A4:1 G4:0.5 E4:0.5 C#4:0.5 -:0.5",
  ];
  const slow = [
    "D5:1.5 B4:1 -:0.5",
    "C#5:1 A4:1 F#4:0.5 -:0.5",
    "B4:1 D5:1 F#5:0.5 -:0.5",
    "E5:0.5 D5:0.5 A4:1 -:1",
    "G4:1 B4:1 E5:0.5 -:0.5",
    "F#5:1 D5:1 B4:0.5 -:0.5",
    "D5:1 B4:1 G4:0.5 -:0.5",
    "C#5:1 E5:1 G4:0.5 -:0.5",
    "B4:1 A4:0.5 G4:0.5 F#4:1",
    "A4:1 F#4:1 D4:0.5 -:0.5",
    "G4:1 B4:1 E5:0.5 -:0.5",
    "E5:0.5 C#5:0.5 A4:1 -:1",
  ];
  const roots = {
    Dmaj7: 38,
    "A/C#": 37,
    Bm7: 47,
    "F#m7": 42,
    Gmaj7: 43,
    "D/F#": 42,
    Em7: 40,
    A7: 45,
  };
  const voicings = {
    Dmaj7: [45, 54, 61],
    "A/C#": [45, 52, 61],
    Bm7: [47, 54, 62],
    "F#m7": [45, 52, 57],
    Gmaj7: [43, 54, 59],
    "D/F#": [45, 54, 62],
    Em7: [43, 50, 59],
    A7: [45, 55, 61],
  };
  chords.forEach((chord, b) => {
    const middle = b >= 24 && b < 36;
    let text = middle ? slow[b - 24] : theme[b % 12];
    if (b === 19) text = "C#5:1 E5:0.5 C#5:0.5 A4:0.5 -:0.5";
    if (b === 23 || b === 47) text = "E4:1 C#4:0.5 -:1.5";
    melody(piano, b, 3, text, middle ? 0.61 : b >= 36 ? 0.66 : 0.64);
    if (b >= 4 && !(middle && b % 3 === 1))
      put(
        pad,
        b * 3,
        3,
        voicings[chord].map((n) => note(0.125, n, 2.5, 0.42, { gate: 0.9 })),
      );
    if (!(middle && b % 3 === 1)) {
      const low = [note(0, roots[chord], 1.1, 0.5)];
      if (b % 2 === 0) low.push(note(2, roots[chord] + 7, 0.55, 0.38));
      put(bass, b * 3, 3, low);
    }
    if ([3, 7, 11].includes(b % 12) && b !== 47)
      put(answer, b * 3, 3, [
        note(2.25, voicings[chord][1] + 12, 0.25, 0.4),
        note(2.625, voicings[chord][2] + 12, 0.25, 0.34),
      ]);
  });
  for (const t of s.tracks) t.gainDb += 3;
  await save("lit-window", s, {
    title: "窗灯未眠",
    style: "Intimate piano",
    setting: "室内 / 对话与休息",
    sections: ["窗影", "回信", "夜色", "灯暖"],
    features: ["无鼓的三拍叙事", "钢琴长短句交织", "轻柔的和声留白"],
    description:
      "屋外渐渐安静，桌上的信还没有读完。钢琴沿着三拍的呼吸慢慢展开，偶尔有几颗拨弦音落在句尾。",
    prompt:
      "为原创 RPG 的安静室内与夜间对话写一首可久听的原创钢琴配乐。D 大调，四分音符 108 BPM，3/4，48 小节，以十二小节长句组织主题、变化、夜色与回归。使用柔和的双力度钢琴、很轻的低音和缓起音合成和声，不使用鼓组。让旋律有重复的节奏身份和真正的停顿，中段转向 B 小调色彩，再回到熟悉的句子。卡林巴仅在少数句尾回答；空间尾音柔和，避免八音盒式持续高音、机械分解和弦和每四小节重新开场。",
    credits: [
      "Salamander Grand Piano V3 — Alexander Holm; retuned mapping Markus Fiedler (CC BY 3.0).",
      "VCSL / Versilian Studios — kalimba (CC0); remaining synthesis original.",
    ],
  });
}
// Copper Sky: a rounded FM theme, acoustic pulse underneath, one open middle
// passage and a shorter last sentence that leads back without a hard restart.
{
  const cycle = [
    "Dm7",
    "Bbmaj7",
    "Fmaj7",
    "Cadd9",
    "Gm7",
    "Dm/F",
    "Em7b5",
    "A7",
  ];
  const chords = [
    ...cycle,
    ...cycle,
    "Bbmaj7",
    "F/A",
    "Gm7",
    "A7",
    "Bbmaj7",
    "F/A",
    "Gm7",
    "Dm/F",
    "Bbmaj7",
    "Cadd9",
    "Gm7",
    "A7",
    ...cycle,
    "Gm7",
    "Dm/F",
    "Em7b5",
    "A7",
  ];
  let s = base(
    "Copper Sky",
    120,
    [4, 4],
    { tonic: "D", mode: "minor" },
    chords,
    [8, 12, 8, 12],
    ["Departure", "Open road", "Far horizon", "Another mile"],
  );
  s = await importPacks(s, [
    ["band", ["band-guitar-short", "band-bass-short"]],
    ["piano", ["keys-grand"]],
    ["drums", ["drums-acoustic"]],
  ]);
  s.profile = "genesis-inspired";
  s.instrumentDefinitions.push(
    custom("copper-rounded-lead", "melody", 1.1, -3, 0.012, 0.07),
  );
  const lead = track(s, "copper-lead", "copper-rounded-lead", "melody", -2, {
    reverbSend: 0.14,
    send: 0.035,
    controls: { brightness: 0.38, pluckiness: 0.5 },
  });
  const guitar = track(s, "copper-guitar", "band-guitar-short", "arp", 2, {
    pan: -0.2,
    reverbSend: 0.1,
  });
  const piano = track(s, "copper-piano", "keys-grand", "harmony", 0, {
    maxVoices: 2,
    pan: 0.2,
    reverbSend: 0.16,
  });
  const bass = track(s, "copper-bass", "band-bass-short", "bass", 2, {
    reverbSend: 0,
  });
  const drums = track(s, "copper-drums", "drums-acoustic", "drums", -9, {
    reverbSend: 0.02,
    humanize: { timingBeats: 0, velocity: 0.025 },
  });
  const theme = [
    "A4:0.5 D5:1 F5:0.5 E5:0.5 D5:0.5 A4:0.5 -:0.5",
    "A4:0.5 D5:0.5 F5:1 D5:0.5 A#4:0.5 A4:0.5 -:0.5",
    "C5:0.5 F5:1 E5:0.5 C5:0.5 A4:0.5 G4:0.5 -:0.5",
    "G4:0.5 C5:0.5 E5:1 D5:0.5 C5:0.5 G4:0.5 -:0.5",
    "A#4:0.5 D5:0.5 F5:1 D5:0.5 A4:0.5 G4:0.5 -:0.5",
    "A4:0.5 D5:1 C5:0.5 A4:0.5 F4:0.5 E4:0.5 -:0.5",
    "G4:0.5 A#4:0.5 E5:1 D5:0.5 A#4:0.5 G4:0.5 -:0.5",
    "C#5:0.5 E5:0.5 G5:0.75 E5:0.25 C#5:0.5 B4:0.5 A4:0.5 -:0.5",
  ];
  const open = [
    "F5:1 D5:1 A4:1 -:1",
    "C5:1 A4:0.5 G4:0.5 F4:1 -:1",
    "D5:1 F5:1 G5:1 -:1",
    "F5:1 E5:0.5 D5:0.5 A4:1 -:1",
    "A5:0.75 F5:0.25 D5:1 A4:1 -:1",
    "G5:1 E5:0.5 D5:0.5 C5:1 -:1",
    "D5:1 A#4:1 G4:1 -:1",
    "E5:1 C#5:0.5 B4:0.5 A4:1 -:1",
  ];
  const turn = [
    "D5:1 F5:0.5 D5:0.5 A#4:1 -:1",
    "C5:1 A4:1 F4:1 -:1",
    "G4:1 A#4:0.5 D5:0.5 G5:1 -:1",
    "E5:1 C#5:1 A4:1 -:1",
  ];
  const roots = {
    Dm7: 38,
    Bbmaj7: 46,
    Fmaj7: 41,
    Cadd9: 48,
    Gm7: 43,
    "Dm/F": 41,
    Em7b5: 40,
    A7: 45,
    "F/A": 45,
  };
  const dyads = {
    Dm7: [60, 65],
    Bbmaj7: [57, 62],
    Fmaj7: [57, 64],
    Cadd9: [60, 64],
    Gm7: [58, 65],
    "Dm/F": [57, 62],
    Em7b5: [58, 62],
    A7: [55, 61],
    "F/A": [57, 60],
  };
  chords.forEach((chord, b) => {
    const bridge = b >= 16 && b < 20,
      openSection = b >= 20 && b < 28;
    if (!bridge) {
      let text = openSection
        ? open[b - 20]
        : b >= 36
          ? turn[b - 36]
          : theme[(b >= 28 ? b - 28 : b) % 8];
      if (b === 15) text = "C#5:0.5 E5:0.5 G5:1 E5:0.5 C#5:0.5 A4:0.5 -:0.5";
      melody(lead, b, 4, text, openSection ? 0.64 : 0.68);
    } else melody(piano, b, 4, turn[b - 16], 0.63);
    const low = [
      note(0, roots[chord], 0.65, 0.7),
      note(1.5, roots[chord] + (chord === "Em7b5" ? 6 : 7), 0.35, 0.54),
      note(2.5, roots[chord], 0.65, 0.64),
    ];
    put(bass, b * 4, 4, bridge ? low.slice(0, 1) : low);
    if (!bridge) {
      const arp = [];
      for (const [i, at] of [0.5, 1.25, 2.5, 3.25].entries())
        arp.push(note(at, dyads[chord][i % 2], 0.3, i % 2 ? 0.45 : 0.6));
      put(guitar, b * 4, 4, arp);
    }
    if (!bridge && b % 2 === 1)
      put(
        piano,
        b * 4,
        4,
        dyads[chord].map((n) => note(3, n, 0.6, 0.45)),
      );
    const d = [];
    if (!bridge) {
      d.push(
        { kind: "hit", at: 0, sound: "kick", velocity: 0.65 },
        { kind: "hit", at: 2.5, sound: "kick", velocity: 0.5 },
      );
      for (const at of [1, 3])
        d.push({
          kind: "hit",
          at,
          sound: "snare",
          velocity: openSection ? 0.4 : 0.52,
        });
      for (const at of b === 39 ? [0.5, 1.5, 2] : [0.5, 1.5, 2, 3.5])
        d.push({ kind: "hit", at, sound: "hat", velocity: 0.25 });
    } else if (b % 2 === 0)
      d.push({ kind: "hit", at: 0, sound: "kick", velocity: 0.4 });
    put(drums, b * 4, 4, d);
  });
  s.mixer.masterDb = 0;
  for (const t of s.tracks) t.gainDb += 3;
  await save("copper-sky", s, {
    title: "铜色天际",
    style: "Gentle adventure",
    setting: "野外 / 轻快冒险",
    sections: ["启程", "长路", "远望", "再一程"],
    features: ["圆润的 FM 主题", "克制的真实节奏组", "减法形成的段落对比"],
    description:
      "天色亮起来，旅程还很长。温暖的合成旋律与轻巧的吉他节奏交替前行，中段放慢呼吸，再带着熟悉的主题出发。",
    prompt:
      "为原创探索 RPG 写一首轻快而不催促的野外冒险循环曲。D 小调，120 BPM，4/4，40 小节。用圆润的 FM 主奏写可记忆的两小节动机，结合真实短奏贝斯、干净吉他和柔和鼓组。以小七、大七、半减七和属七和弦连接主题，钢琴只作空隙里的支撑；避免持续十六分音符、高频噪声铺满和强烈压缩。过渡段撤掉主要节奏层，中段扩大旋律呼吸，最后用较短的句子经属和弦接回开头。每个段落要有具体的配器变化，所有旋律原创。",
    credits: [
      "Salamander Grand Piano V3 — Alexander Holm; retuned mapping Markus Fiedler (CC BY 3.0).",
      "Gogodze Phu Vol II — Karoryfer Lecolds (CC BY 4.0).",
      "Growlybass / Black And Green Guitars — Karoryfer Lecolds; guitar recordings Brian Wood (CC0).",
    ],
  });
}
await writeFile(
  new URL("music.json", docs),
  JSON.stringify(manifest, null, 2) + "\n",
);
