// Optional asset-authoring tool. Rendering/importing the shipped pack is offline.
// Requires ffmpeg and `npm run build`. Downloads only the pinned source WAVs
// listed below (cached in .cache/orchestra), never the whole libraries.
//
// Every sample is verified against its declared root with src/pitch.ts: an
// octave mismatch aborts the build, and each root's tuningCents is the mean
// measured offset. Sustained instruments get a loop from src/loop.ts.
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decodeWav, encodeWav } from "../dist/wav.js";
import { checkRootPitch } from "../dist/pitch.js";
import { findSustainLoop } from "../dist/loop.js";
import { InstrumentCollectionSchema } from "../dist/instrument-collection.js";

const SOURCES = {
  vsco: {
    commit: "440300901dfe9275fd84e0b7763af1f8443ae62e",
    repo: "https://github.com/sgossner/VSCO-2-CE",
    raw: "https://raw.githubusercontent.com/sgossner/VSCO-2-CE/",
    credits: "VSCO 2 Community Edition / Versilian Studios, CC0-1.0",
  },
  vcsl: {
    commit: "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e",
    repo: "https://github.com/sgossner/VCSL",
    raw: "https://raw.githubusercontent.com/sgossner/VCSL/",
    credits: "VCSL / Versilian Studios, CC0-1.0",
  },
};
const SR = 32000;
const cache = new URL("../../../.cache/orchestra/", import.meta.url);
const destination = new URL("../instruments/orchestra/", import.meta.url);
await mkdir(cache, { recursive: true });
await mkdir(new URL("samples/", destination), { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const url = (source, path) =>
  SOURCES[source].raw +
  SOURCES[source].commit +
  "/" +
  path.split("/").map(encodeURIComponent).join("/");

async function download(source, path) {
  const local = new URL(
    // "#" would start a URL fragment and silently truncate the name.
    `${source}/${path.replaceAll("/", "__").replaceAll(" ", "_").replaceAll("#", "sharp")}`,
    cache,
  );
  try {
    return { bytes: await readFile(local), local };
  } catch {}
  await mkdir(new URL(`${source}/`, cache), { recursive: true });
  console.log("Downloading " + path);
  const response = await fetch(url(source, path), {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${url(source, path)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(local, bytes);
  return { bytes, local };
}
function convert(input, output, seconds) {
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-ac",
      "1",
      "-ar",
      String(SR),
      "-af",
      `silenceremove=start_periods=1:start_duration=0:start_threshold=-55dB,atrim=duration=${seconds},afade=t=out:st=${seconds - 0.06}:d=0.06`,
      "-c:a",
      "pcm_s16le",
      "-map_metadata",
      "-1",
      output,
    ],
    { stdio: "pipe" },
  );
}
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Scientific note name (C4 = 60) to MIDI. */
const midiOf = (name) => {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) throw new Error("Bad note " + name);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0);
};
const one = [{ name: "all", low: 1, high: 127 }];
const two = [
  { name: "soft", low: 1, high: 79 },
  { name: "hard", low: 80, high: 127 },
];

// `notes` are file-name notes. VSCO 2 CE and VCSL name these samples one
// octave below their sounding pitch (offset 12; measured, see the pitch
// check); the VSCO harp is named at sounding pitch.
const specs = [
  {
    id: "orch-strings",
    name: "String ensemble",
    description:
      "Legato string section with vibrato: cello section below G3, violas to F4, violins above. Looped sustain for pads and long lines.",
    role: "harmony",
    range: [36, 88],
    attack: 0.12,
    release: 0.4,
    seconds: 2.5,
    loop: true,
    source: "vsco",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: [
      "C1",
      "E1",
      "G1",
      "B1",
      "D2",
      "F2",
      "A2",
      "D3",
      "F3",
      "A3",
      "C4",
      "E4",
      "G4",
      "B4",
      "D5",
    ],
    file: (note) => {
      const m = midiOf(note) + 12;
      if (m <= 57)
        return `Strings/Cello Section/susvib/susvib_${note}_v1_1.wav`;
      if (m <= 65)
        return `Strings/Viola Section/susvib/ViolaEns_susvib_${note}_v1_1.wav`;
      return `Strings/Violin Section/susVib/VlnEns_susVib_${note}_v1.wav`;
    },
  },
  {
    id: "orch-pizzicato",
    name: "String pizzicato",
    description:
      "Plucked string section, cello below G3 and violins above, two round robins for ostinatos.",
    role: "arp",
    range: [36, 88],
    attack: 0.001,
    release: 0.15,
    seconds: 0.8,
    source: "vsco",
    offset: 12,
    layers: one,
    roundRobins: 2,
    notes: [
      "C1",
      "E1",
      "G1",
      "B1",
      "D2",
      "F2",
      "G2",
      "B2",
      "D3",
      "F#3",
      "A3",
      "C4",
      "E4",
      "G4",
      "B4",
      "D5",
    ],
    file: (note, layer, rr) =>
      midiOf(note) + 12 <= 53
        ? `Strings/Cello Section/pizzT/pizzT_${note}_v2_RR${rr}.wav`
        : `Strings/Violin Section/Pizz/VlnEns_Pizz_${note}_v2_rr${rr}.wav`,
  },
  {
    id: "orch-flute",
    name: "Flute",
    description: "Concert flute without vibrato; looped sustain, C4–C7.",
    role: "melody",
    range: [60, 96],
    attack: 0.04,
    release: 0.2,
    seconds: 2.5,
    loop: true,
    source: "vsco",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: ["C3", "E3", "A3", "C4", "E4", "A4", "C5", "E5", "A5", "C6"],
    file: (note) => {
      const dynamic = { C5: "v2", E5: "v2", C6: "v1" }[note] ?? "v3";
      return `Woodwinds/Flute/susNV/LDFlute_susNV_${note}_${dynamic}_1.wav`;
    },
  },
  {
    id: "orch-clarinet",
    name: "Clarinet",
    description: "Clarinet in B♭ (sounding pitch), looped sustain, D3–G6.",
    role: "melody",
    range: [50, 91],
    attack: 0.03,
    release: 0.18,
    seconds: 2.5,
    loop: true,
    source: "vsco",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: [
      "D2",
      "F2",
      "A#2",
      "D3",
      "F3",
      "A#3",
      "D4",
      "F4",
      "A#4",
      "D5",
      "F5",
    ],
    // VSCO's "F#5" clarinet file sounds F (measured -100 cents throughout),
    // so it is registered at its real pitch.
    file: (note) =>
      `Woodwinds/Clarinet/susLong/DCClar_susLong_${note === "F5" ? "F#5" : note}_v2_rr1_sum.wav`,
  },
  {
    id: "orch-horn",
    name: "French horn",
    description:
      "Warm French horn, looped sustain. Range stops at E♭4 because the source has no sustained samples between C4 and D5.",
    role: "harmony",
    range: [36, 63],
    attack: 0.06,
    release: 0.3,
    seconds: 2.5,
    loop: true,
    source: "vsco",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: ["C1", "D#1", "G1", "A#1", "D2", "F2", "A2", "C3"],
    file: (note) => `Brass/F Horn/sus/MOHorn_sus_${note}_v2_1.wav`,
  },
  {
    id: "orch-harp",
    name: "Concert harp",
    description:
      "Concert harp, natural decay; for arpeggios and glissando-like runs.",
    role: "arp",
    range: [36, 96],
    attack: 0.001,
    release: 0.5,
    seconds: 2,
    source: "vsco",
    offset: 0,
    layers: one,
    roundRobins: 1,
    notes: [
      "B1",
      "D2",
      "F2",
      "A2",
      "C3",
      "E3",
      "G3",
      "B3",
      "D4",
      "F4",
      "A4",
      "C5",
      "E5",
      "G5",
      "B5",
      "D6",
      "F6",
      "A6",
      "B6",
    ],
    file: (note) => `Strings/Harp/KSHarp_${note}_mf.wav`,
  },
  {
    id: "orch-marimba",
    name: "Marimba",
    description: "Marimba with soft (medium) and hard (loud) velocity layers.",
    role: "arp",
    range: [41, 96],
    attack: 0.001,
    release: 0.2,
    seconds: 1.2,
    source: "vcsl",
    offset: 12,
    layers: two,
    roundRobins: 1,
    notes: ["F1", "C2", "G2", "B2", "F3", "C4", "G4", "B4", "F5", "C6"],
    file: (note, layer) =>
      `Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_${note}_${layer.name === "soft" ? "med" : "loud"}_01.wav`,
  },
  {
    id: "orch-vibraphone",
    name: "Vibraphone",
    description: "Vibraphone with soft mallets and a long natural ring.",
    role: "harmony",
    range: [53, 89],
    attack: 0.001,
    release: 0.6,
    seconds: 2.5,
    source: "vcsl",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: ["F2", "A2", "C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5"],
    file: (note) =>
      `Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/Vibes_soft_${note}_v2_rr1_Main.wav`,
  },
  {
    id: "orch-ocarina",
    name: "Ocarina",
    description:
      "Typical alto ocarina, looped sustain without vibrato, G4–D♯6.",
    role: "melody",
    range: [67, 87],
    attack: 0.03,
    release: 0.15,
    seconds: 2.5,
    loop: true,
    source: "vcsl",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: ["A3", "C#4", "E4", "G#4", "C5"],
    file: (note) =>
      `Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus/StdOcarina_Sus_${note}.wav`,
  },
  {
    id: "orch-harpsichord",
    name: "Harpsichord",
    description:
      "Flemish harpsichord, 8′ register; plucked with natural decay.",
    role: "harmony",
    range: [36, 83],
    attack: 0.001,
    release: 0.25,
    seconds: 1.8,
    source: "vcsl",
    offset: 12,
    layers: one,
    roundRobins: 1,
    notes: [
      "C1",
      "E1",
      "G#1",
      "C2",
      "E2",
      "G#2",
      "C3",
      "E3",
      "G#3",
      "C4",
      "E4",
      "G#4",
    ],
    file: (note) =>
      `Chordophones/Zithers/Harpsichord, Flemish/Sustains/Low/HarpsiRH_Low_Far_${note}_rr1.wav`,
  },
];

const LAYER_CROSSFADE = 24;
/** Below this fade-region correlation, loops use an equal-power crossfade. */
const LINEAR_FADE_CORRELATION = 0.7;
const manifest = {
  id: "orchestra",
  name: "Orchestra & Mallets — VSCO 2 CE and VCSL selection",
  version: "1.0.0",
  license: "CC0-1.0",
  source: SOURCES.vsco.repo,
  instruments: [],
};
const receipts = {
  sources: Object.fromEntries(
    Object.entries(SOURCES).map(([k, v]) => [
      k,
      { repository: v.repo, commit: v.commit, credits: v.credits },
    ]),
  ),
  license: "CC0-1.0",
  processing:
    "ffmpeg: leading-silence trim (-55 dB), mono PCM16 at 32000 Hz, bounded length with 60 ms end fade. One shared peak gain (0.5) per root note. Roots verified by spectral pitch check; tuningCents is the measured mean per root (in the loop region for sustained instruments). Sustained instruments loop over whole fundamental periods with a 250 ms crossfade baked at playback.",
  files: [],
};
const scratch = await mkdtemp(join(tmpdir(), "rmt-orchestra-"));
try {
  for (const spec of specs) {
    const roots = spec.notes.map((n) => midiOf(n) + spec.offset);
    for (let i = 1; i < roots.length; i++)
      if (roots[i] <= roots[i - 1])
        throw new Error(`${spec.id}: roots out of order`);
    const items = [];
    roots.forEach((root, n) => {
      for (const layer of spec.layers)
        for (let rr = 1; rr <= spec.roundRobins; rr++)
          items.push({
            root,
            layer,
            rr,
            path: spec.file(spec.notes[n], layer, rr),
            id: `${spec.id}-${root}-${layer.name}-${rr}`,
            lowMidi: n
              ? Math.floor((roots[n - 1] + root) / 2) + 1
              : spec.range[0],
            highMidi:
              n === roots.length - 1
                ? spec.range[1]
                : Math.floor((root + roots[n + 1]) / 2),
          });
    });
    const prepared = [],
      peaks = new Map(),
      cents = new Map();
    for (const item of items) {
      const { bytes, local } = await download(spec.source, item.path);
      const temp = join(scratch, item.id + ".wav");
      convert(fileURLToPath(local), temp, spec.seconds);
      const decoded = decodeWav(await readFile(temp));
      const data = decoded.channels[0];
      if (spec.loop && data.length < spec.seconds * SR * 0.95)
        throw new Error(`${item.path}: source shorter than ${spec.seconds}s`);
      const check = checkRootPitch(data, SR, item.root);
      if (check.octaveError)
        throw new Error(
          `${item.path} sounds ${check.octaveError > 0 ? "above" : "below"} root ${item.root}`,
        );
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      if (peak < 0.0001) throw new Error("Silent sample: " + item.path);
      peaks.set(item.root, Math.max(peaks.get(item.root) ?? 0, peak));
      const loop = spec.loop
        ? findSustainLoop(data, SR, item.root, {
            endMarginSeconds: 0.12,
            loopSeconds: 1,
            crossfadeSeconds: 0.25,
            searchSeconds: 0.1,
          })
        : undefined;
      // Wind and bowed notes drift after the attack, and held notes spend
      // most of their time in the loop, so tune looped samples there.
      const tuning = loop
        ? checkRootPitch(data.subarray(loop.start), SR, item.root)
        : check;
      if (tuning.octaveError)
        throw new Error(`${item.path}: loop region octave mismatch`);
      cents.set(item.root, [
        ...(cents.get(item.root) ?? []),
        tuning.centsOffset,
      ]);
      prepared.push({ item, data, loop, originalSha256: hash(bytes) });
    }
    const zones = [],
      assets = [];
    for (const { item, data, loop, originalSha256 } of prepared) {
      const gain = 0.5 / peaks.get(item.root);
      const file = `samples/${item.id}.wav`;
      const bytes = Buffer.from(encodeWav([data.map((v) => v * gain)], SR));
      await writeFile(new URL(file, destination), bytes);
      const measured = cents.get(item.root);
      const tuningCents = Math.round(
        measured.reduce((a, b) => a + b, 0) / measured.length,
      );
      const source = SOURCES[spec.source];
      assets.push({
        id: item.id,
        file,
        sha256: hash(bytes),
        provenance: `${source.credits}; ${source.commit}; ${item.path}`,
      });
      zones.push({
        assetId: item.id,
        lowVelocity: item.layer.low,
        highVelocity: item.layer.high,
        roundRobin: item.rr,
        lowMidi: item.lowMidi,
        highMidi: item.highMidi,
        rootMidi: item.root,
        tuningCents,
        ...(loop
          ? {
              loopStartFrame: loop.start,
              loopEndFrame: loop.end,
              loopCrossfadeFrames: loop.crossfade,
              // Uncorrelated fade regions would dip ~3 dB with a linear fade.
              ...(loop.correlation < LINEAR_FADE_CORRELATION
                ? { loopCrossfadeShape: "equal-power" }
                : {}),
            }
          : {}),
      });
      receipts.files.push({
        file,
        source: spec.source,
        upstreamPath: item.path,
        upstreamUrl: url(spec.source, item.path),
        originalSha256,
        sha256: hash(bytes),
        bytes: bytes.length,
        rootMidi: item.root,
        tuningCents,
        sharedGainDb: 20 * Math.log10(gain),
        ...(loop
          ? { loopCorrelation: Number(loop.correlation.toFixed(4)) }
          : {}),
      });
    }
    manifest.instruments.push({
      instrument: {
        id: spec.id,
        engine: "sample",
        role: spec.role,
        range: spec.range,
        attack: spec.attack,
        release: spec.release,
        description: `${spec.name}: ${spec.description}`,
        ...(spec.layers.length > 1
          ? { velocityCrossfade: LAYER_CROSSFADE }
          : {}),
        sample: { kind: "zones", zones },
        provenance: `${SOURCES[spec.source].credits}; compact curated derivatives.`,
      },
      assets,
    });
    const worst = prepared
      .filter((p) => p.loop)
      .reduce((m, p) => Math.min(m, p.loop.correlation), 1);
    console.log(
      `${spec.id}: ${assets.length} samples${spec.loop ? `, worst loop correlation ${worst.toFixed(3)}` : ""}`,
    );
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
for (const [key, name] of [
  ["vsco", "LICENSE-VSCO-2-CE.txt"],
  ["vcsl", "LICENSE-VCSL.txt"],
]) {
  const { bytes } = await download(key, "LICENSE");
  await writeFile(new URL(name, destination), bytes);
}
// Fail here, not at import time, if anything is out of schema range.
InstrumentCollectionSchema.parse(manifest);
await writeFile(
  new URL("pack.json", destination),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  new URL("SOURCES.json", destination),
  JSON.stringify(receipts, null, 2) + "\n",
);
const total = receipts.files.reduce((n, f) => n + f.bytes, 0);
console.log(
  `orchestra: ${manifest.instruments.length} instruments, ${receipts.files.length} samples, ${total} bytes`,
);
