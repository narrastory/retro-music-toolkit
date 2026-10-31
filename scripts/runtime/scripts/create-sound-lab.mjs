import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  importInstrumentCollection,
  bundledStarterManifest,
} from "../dist/instrument-collection.js";
import { compileScore } from "../dist/compiler.js";
import { renderScore } from "../dist/renderer.js";
const docs = new URL("../../../docs/", import.meta.url);
const source = JSON.parse(
  await readFile(new URL("scores/redleaf-post.json", docs), "utf8"),
);
// Exactly the same second eight-bar phrase in every version.
source.title = "Redleaf Post — sound laboratory";
source.lengthBeats = 24;
source.harmony = source.harmony
  .filter((h) => h.at >= 24 && h.at < 48)
  .map((h) => ({ ...h, at: h.at - 24 }));
source.sections = [
  { id: "lab-phrase", at: 0, lengthBeats: 24, label: "Same phrase" },
];
for (const track of source.tracks) {
  track.clips = track.clips
    .filter((c) => c.at >= 24 && c.at < 48)
    .map((c) => ({ ...c, at: c.at - 24 }));
  const used = new Set(track.clips.map((c) => c.pattern));
  track.patterns = Object.fromEntries(
    Object.entries(track.patterns).filter(([id]) => used.has(id)),
  );
  track.send = 0;
  track.reverbSend = 0;
}
source.mixer = { masterDb: 0, delayBeats: 0.75, feedback: 0, returnDb: -60 };
source.export = { ...source.export, mode: "one-shot", tailSeconds: 2.4 };
const pack = JSON.parse(await readFile(bundledStarterManifest, "utf8"));
const sampled = await importInstrumentCollection(
  source,
  pack,
  dirname(bundledStarterManifest),
  ["starter-recorder", "starter-kalimba", "starter-piano"],
);
for (const track of sampled.tracks) {
  if (track.instrument === "sample-flute")
    track.instrument = "starter-recorder";
  if (track.instrument === "sample-pluck") track.instrument = "starter-kalimba";
  if (track.instrument === "sample-strings") track.instrument = "starter-piano";
}
const wet = structuredClone(sampled);
wet.mixer.reverb = {
  enabled: true,
  decaySeconds: 1.15,
  preDelaySeconds: 0.025,
  damping: 0.6,
  returnDb: -9,
};
for (const t of wet.tracks)
  t.reverbSend =
    t.role === "melody"
      ? 0.3
      : t.role === "arp"
        ? 0.16
        : t.role === "harmony"
          ? 0.22
          : 0;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const rows = [];
for (const [id, score] of [
  ["legacy", source],
  ["sampled", sampled],
  ["reverb", wet],
]) {
  compileScore(score);
  const text = JSON.stringify(score, null, 2) + "\n";
  await writeFile(new URL(`scores/sound-lab-${id}.json`, docs), text);
  if (process.argv.includes("--scores-only")) continue;
  console.log("Rendering " + id);
  const result = await renderScore(score, {
    normalization: { targetRmsDbfs: -24, peakCeilingDbfs: -3 },
  });
  if (
    result.report.silent ||
    result.report.clippedSamples ||
    result.report.nonFiniteSamples
  )
    throw new Error("Invalid render: " + id);
  const wav = new URL(`audio/sound-lab-${id}.wav`, docs);
  await writeFile(wav, result.wav);
  const report = {
    ...result.report,
    sourceFile: `docs/scores/sound-lab-${id}.json`,
    sourceHash: hash(text),
    audioHash: hash(result.wav),
  };
  await mkdir(new URL("reports/", docs), { recursive: true });
  await writeFile(
    new URL(`reports/sound-lab-${id}.json`, docs),
    JSON.stringify(report, null, 2) + "\n",
  );
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      fileURLToPath(wav),
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-map_metadata",
      "-1",
      fileURLToPath(new URL(`audio/sound-lab-${id}.mp3`, docs)),
    ],
    { stdio: "pipe" },
  );
  rows.push({
    id,
    rmsDbfs: report.rmsDbfs,
    loudnessLufs: report.loudnessLufs,
    truePeakDbfs: report.truePeakDbfs,
    appliedGainDb: report.normalization?.appliedGainDb,
  });
  console.log(id + ": " + report.loudnessLufs + " LUFS");
}
if (rows.length)
  await writeFile(
    new URL("reports/sound-lab-comparison.json", docs),
    JSON.stringify(
      {
        phrase: "Redleaf Post bars 9–16",
        notes:
          "Same notes, timing, velocity and track gains. Only instruments and reverb change. Full-file RMS matched to -24 dBFS, peak constrained; this is not LUFS matching or subjective audition.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
