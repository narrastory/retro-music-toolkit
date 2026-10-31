import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  bundledCollectionManifest,
  importInstrumentCollection,
} from "../dist/instrument-collection.js";
import { renderScore } from "../dist/renderer.js";
import { pitchName } from "../dist/model.js";
const docs = new URL("../../../docs/", import.meta.url),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const labels = {
  "band-bass": ["电贝斯", "两档力度、两次轮换，适合流动低音与稳定根音。"],
  "band-bass-short": [
    "短奏贝斯",
    "较短的起音与尾音，适合切分、跳跃和快节奏伴奏。",
  ],
  "band-guitar": ["干净电吉他", "轻重拨弦两档力度，适合分解和弦与城镇主题。"],
  "band-guitar-short": ["短奏电吉他", "利落的短奏与轮换录音，适合节奏型和弦。"],
  "keys-grand": ["钢琴", "精选两个力度层与四个根音，适合叙事旋律和和声。"],
  "drums-acoustic": [
    "基础原声鼓组",
    "底鼓、军鼓、闭镲、开镲和通鼓，各有两档力度与轮换。",
  ],
};
const entries = [];
const importedPacks = {};
function base(id, drums = false) {
  return {
    schemaVersion: "1.3",
    title: id,
    profile: "snes-inspired",
    tempo: 120,
    meter: [4, 4],
    lengthBeats: 12,
    seed: 427,
    tracks: [
      {
        id: "audition",
        role: drums ? "drums" : "melody",
        instrument: drums ? "chip-drums" : "sample-flute",
        gainDb: 0,
        maxVoices: 1,
        patterns: {
          phrase: {
            lengthBeats: 12,
            events: drums
              ? Array.from({ length: 12 }, (_, i) => ({
                  id: "hit-" + i,
                  kind: "hit",
                  at: i,
                  sound:
                    i < 8 ? "snare" : ["kick", "hat", "tom", "openhat"][i - 8],
                  velocity: i < 4 ? 0.4 : 0.8,
                }))
              : Array.from({ length: 12 }, (_, i) => ({
                  id: "note-" + i,
                  kind: "note",
                  at: i,
                  pitch: pitchName(
                    id.includes("bass") ? 48 : id.includes("guitar") ? 55 : 60,
                  ),
                  duration: 0.6,
                  velocity: i < 4 ? 0.4 : i < 8 ? 0.8 : 0.6,
                })),
          },
        },
        clips: [{ id: "audition-clip", pattern: "phrase", at: 0 }],
      },
    ],
    mixer: { masterDb: 0, feedback: 0 },
    export: { mode: "one-shot", tailSeconds: 1, warmupCycles: 2 },
  };
}
async function save(id, score) {
  const text = JSON.stringify(score, null, 2) + "\n";
  await writeFile(new URL(`scores/${id}.json`, docs), text);
  const result = await renderScore(score, {
    normalization: { targetRmsDbfs: -24, peakCeilingDbfs: -3, maxBoostDb: 24 },
  });
  if (
    result.report.silent ||
    result.report.clippedSamples ||
    result.report.nonFiniteSamples
  )
    throw new Error("Unsafe render: " + id);
  const path = new URL(`audio/${id}.wav`, docs);
  await writeFile(path, result.wav);
  await writeFile(
    new URL(`reports/${id}.json`, docs),
    JSON.stringify(
      {
        ...result.report,
        sourceFile: `docs/scores/${id}.json`,
        sourceHash: hash(text),
        audioHash: hash(result.wav),
      },
      null,
      2,
    ) + "\n",
  );
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      fileURLToPath(path),
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-map_metadata",
      "-1",
      fileURLToPath(new URL(`audio/${id}.mp3`, docs)),
    ],
    { stdio: "pipe" },
  );
  console.log(
    `${id}: ${result.report.durationSeconds}s, ${result.report.loudnessLufs} LUFS`,
  );
}
for (const packId of ["band", "piano", "drums"]) {
  const manifest = bundledCollectionManifest(packId),
    pack = JSON.parse(await readFile(manifest, "utf8"));
  importedPacks[packId] = pack;
  for (const item of pack.instruments) {
    const id = item.instrument.id,
      score = await importInstrumentCollection(
        base(id, item.instrument.engine === "drums"),
        pack,
        dirname(manifest),
        [id],
      );
    score.tracks[0].instrument = id;
    const file = "instrument-" + id;
    if (!process.argv.includes("--ensemble-only")) await save(file, score);
    entries.push({
      id,
      file,
      title: labels[id][0],
      description: labels[id][1],
      pack: packId,
      license: pack.license,
      credit: item.instrument.provenance,
      source: pack.source,
    });
  }
}
// A short arrangement uses the same six common instruments as a practical check.
let song = {
  schemaVersion: "1.3",
  title: "Common Ground — instrument ensemble",
  profile: "snes-inspired",
  tempo: 112,
  meter: [4, 4],
  lengthBeats: 32,
  seed: 125,
  key: { tonic: "A", mode: "minor" },
  harmony: ["Am", "F", "C", "G", "Am", "F", "C", "G"].map((chord, i) => ({
    at: i * 4,
    chord,
  })),
  tracks: [],
  mixer: {
    masterDb: 0,
    reverb: {
      enabled: true,
      decaySeconds: 0.9,
      preDelaySeconds: 0.02,
      damping: 0.65,
      returnDb: -12,
    },
  },
  export: { mode: "loop", warmupCycles: 2, tailSeconds: 1 },
};
// Import needs a structurally valid non-empty score, then remove the placeholder.
song.tracks = base("placeholder").tracks;
for (const id of ["band", "piano", "drums"])
  song = await importInstrumentCollection(
    song,
    importedPacks[id],
    dirname(bundledCollectionManifest(id)),
  );
song.tracks = [];
function tr(id, instrument, role, gain, voices = 1) {
  const t = {
    id,
    instrument,
    role,
    gainDb: gain,
    maxVoices: voices,
    reverbSend: role === "bass" || role === "drums" ? 0 : 0.18,
    patterns: {},
    clips: [],
  };
  song.tracks.push(t);
  return t;
}
const lead = tr("piano", "keys-grand", "melody", -7),
  guitar = tr("guitar", "band-guitar", "harmony", -16, 3),
  bass = tr("bass", "band-bass", "bass", -8),
  drum = tr("drums", "drums-acoustic", "drums", -12),
  short = tr("short", "band-guitar-short", "arp", -17),
  bassShort = tr("bass-short", "band-bass-short", "bass", -10);
const harmonies = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 60, 64],
  [55, 59, 62],
];
const melodies = [
  [76, 72, 71, 69],
  [72, 69, 67, 65],
  [67, 72, 76, 74],
  [74, 71, 69, 67],
  [76, 79, 76, 72],
  [77, 76, 72, 69],
  [76, 74, 72, 67],
  [71, 74, 71, 67],
];
function put(t, b, events) {
  t.patterns["b" + b] = {
    lengthBeats: 4,
    events: events.map((e, i) => ({ id: t.id + "-" + b + "-" + i, ...e })),
  };
  t.clips.push({ id: t.id + "-clip-" + b, pattern: "b" + b, at: b * 4 });
}
function note(at, m, duration, velocity = 0.7) {
  return { kind: "note", at, pitch: pitchName(m), duration, velocity };
}
for (let b = 0; b < 8; b++) {
  put(
    lead,
    b,
    melodies[b].map((m, i) => note(i * 0.75, m, i === 3 ? 1 : 0.6, 0.65)),
  );
  put(
    guitar,
    b,
    harmonies[b % 4].map((m) => note(0.5, m, 1.2, b % 2 ? 0.72 : 0.5)),
  );
  const root = [45, 41, 48, 43][b % 4];
  put(b < 4 ? bass : bassShort, b, [
    note(0, root, 0.75, 0.65),
    note(1.5, root + 7, 0.4, 0.8),
    note(2.5, root, 0.65, 0.6),
  ]);
  if (b >= 2)
    put(short, b, [
      note(2.5, harmonies[b % 4][1], 0.3, 0.6),
      note(3, harmonies[b % 4][2], 0.3, 0.8),
    ]);
  if (b >= 2)
    put(drum, b, [
      { kind: "hit", at: 0, sound: "kick", velocity: 0.8 },
      { kind: "hit", at: 1, sound: "snare", velocity: 0.65 },
      { kind: "hit", at: 2.5, sound: "kick", velocity: 0.55 },
      { kind: "hit", at: 3, sound: "snare", velocity: 0.85 },
      ...Array.from({ length: 8 }, (_, i) => ({
        kind: "hit",
        at: i / 2,
        sound: "hat",
        velocity: i % 2 ? 0.35 : 0.65,
      })),
    ]);
}
await save("instrument-ensemble", song);
await writeFile(
  new URL("instrument-catalog.json", docs),
  JSON.stringify(
    {
      entries,
      ensemble: "instrument-ensemble",
      normalization:
        "RMS -24 dBFS target with peak cap; not perceptual loudness matching.",
      credits: [
        "Growlybass / Black And Green Guitars — Karoryfer Lecolds; guitar recordings Brian Wood (CC0).",
        "Salamander Grand Piano V3 — Alexander Holm; retuned mapping Markus Fiedler (CC BY 3.0).",
        "Gogodze Phu Vol II — Karoryfer Lecolds (CC BY 4.0).",
      ],
      changes:
        "Compact mono 32 kHz edits, trimmed/faded, common instrument gain, selected velocity/RR maps. These are curated derivatives, not full original-library playback.",
    },
    null,
    2,
  ) + "\n",
);
