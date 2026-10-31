// Reproduce the public music release with the toolkit, then encode MP3 previews.
// Requires npm run build, Chromium (or RETRO_CHROMIUM_EXECUTABLE), and ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const docs = new URL("../../../docs/", import.meta.url);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL("music.json", docs), "utf8"),
);
await mkdir(new URL("reports/", docs), { recursive: true });
for (const track of manifest) {
  const selected = process.argv
    .find((arg) => arg.startsWith("--track="))
    ?.slice(8);
  if (selected && track.id !== selected) continue;
  const score = fileURLToPath(new URL(`scores/${track.id}.json`, docs));
  const wav = fileURLToPath(new URL(`audio/${track.id}.wav`, docs));
  if (!process.argv.includes("--package-only")) {
    execFileSync(process.execPath, [cli, "validate", score], { stdio: "pipe" });
    execFileSync(
      process.execPath,
      [cli, "render", score, "--out", wav, "--force"],
      { stdio: "pipe", timeout: 180000 },
    );
  }
  const report = JSON.parse(await readFile(wav + ".report.json", "utf8"));
  if (
    report.silent ||
    report.nonFiniteSamples ||
    report.clippedSamples ||
    report.truePeakDbfs > -1
  )
    throw new Error(`Unsafe or silent audio: ${track.id}`);
  report.sourceFile = `docs/scores/${track.id}.json`;
  await writeFile(
    new URL(`reports/${track.id}.json`, docs),
    JSON.stringify(report, null, 2) + "\n",
  );
  const diagnostics = execFileSync(process.execPath, [cli, "diagnose", score], {
    encoding: "utf8",
  });
  await writeFile(
    new URL(`reports/${track.id}.diagnostics.json`, docs),
    diagnostics,
  );
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      wav,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-map_metadata",
      "-1",
      fileURLToPath(new URL(`audio/${track.id}.mp3`, docs)),
    ],
    { stdio: "pipe" },
  );
  await unlink(wav + ".report.json");
  await unlink(wav + ".score.json");
  console.log(
    `${track.id}: ${report.durationSeconds.toFixed(2)}s, ${report.loudnessLufs} LUFS, ${report.truePeakDbfs.toFixed(2)} dBTP`,
  );
}
