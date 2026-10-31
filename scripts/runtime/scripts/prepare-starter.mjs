// Optional asset-authoring tool. Rendering/importing the shipped pack is offline.
// Requires ffmpeg. Download only the 12 pinned source WAVs, never the whole VCSL.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeWav, encodeWav } from "../dist/wav.js";
const commit = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e";
const upstream = `https://raw.githubusercontent.com/sgossner/VCSL/${commit}/`;
const cache = new URL("../../../.cache/vcsl/", import.meta.url);
const destination = new URL("../instruments/starter/", import.meta.url);
await mkdir(cache, { recursive: true });
await mkdir(new URL("samples/", destination), { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const recorder =
  "Aerophones/Edge-blown Aerophones/Baroque Alto Recorder/Sustain/";
const piano = "Chordophones/Zithers/Grand Piano, Kawai - Legacy/Sustains/";
const kalimba = "Idiophones/Plucked Idiophones/Kalimba, Kenya/";
const glock = "Idiophones/Struck Idiophones/Glockenspiel/";
const specs = [
  {
    id: "starter-recorder",
    name: "Alto recorder",
    role: "melody",
    attack: 0.015,
    release: 0.12,
    seconds: 2,
    midiOffset: 12,
    tunings: [6, 4],
    range: [60, 96],
    samples: [
      [60, recorder + "AltRecorder_Sus_C4_rr1_Main.wav"],
      [72, recorder + "AltRecorder_Sus_C5_rr1_Main.wav"],
    ],
  },
  {
    id: "starter-piano",
    name: "Compact piano",
    role: "harmony",
    attack: 0.003,
    release: 0.18,
    seconds: 3,
    midiOffset: 12,
    tunings: [-2, -6, -2, -4, 4],
    range: [48, 96],
    samples: [
      [48, piano + "GrandPno_Main_Sus_C3_v2_rr1.wav"],
      [55, piano + "GrandPno_Main_Sus_G3_v2_rr1.wav"],
      [62, piano + "GrandPno_Main_Sus_D4_v2_rr1.wav"],
      [69, piano + "GrandPno_Main_Sus_A4_v2_rr1.wav"],
      [72, piano + "GrandPno_Main_Sus_C5_v2_rr1.wav"],
    ],
  },
  {
    id: "starter-kalimba",
    name: "Kalimba",
    role: "arp",
    attack: 0.002,
    release: 0.09,
    seconds: 2,
    midiOffset: 12,
    tunings: [-8, 18, 26],
    range: [48, 88],
    samples: [
      [47, kalimba + "Mbira6_Normal_MainSpirit_B2_k8_vl3_rr2.wav"],
      [59, kalimba + "Mbira6_Normal_MainSpirit_B3_k12_vl3_rr2.wav"],
      [63, kalimba + "Mbira6_Normal_MainSpirit_D#4_k13_vl3_rr2.wav"],
    ],
  },
  {
    id: "starter-glock",
    name: "Glockenspiel",
    role: "melody",
    attack: 0.002,
    release: 0.12,
    seconds: 2.5,
    midiOffset: 12,
    tunings: [12, 16],
    range: [72, 108],
    samples: [
      [72, glock + "glock_medium_C5_01.wav"],
      [84, glock + "glock_medium_C6_01.wav"],
    ],
  },
];
const manifest = {
  id: "starter",
  name: "Retro Starter — VCSL selection",
  version: "1.0.0",
  license: "CC0-1.0",
  source: "https://github.com/sgossner/VCSL",
  instruments: [],
};
const receipts = {
  upstreamCommit: commit,
  source: "https://github.com/sgossner/VCSL",
  license: "CC0-1.0",
  processing:
    "ffmpeg: leading-silence trim (-55 dB), mono PCM16 at 32000 Hz, bounded length and 60 ms end fade. Peak normalized to 0.4 (-7.96 dBFS). Root notes calibrated for the library octave convention; measured small tuning offsets applied. Sustained recorder loop crossfades at playback.",
  files: [],
};
if (process.argv.includes("--list")) {
  console.log(
    JSON.stringify([
      ...specs.flatMap((spec) =>
        spec.samples.map(([root, path]) => ({
          path,
          url: upstream + path.split("/").map(encodeURIComponent).join("/"),
          cache: fileURLToPath(new URL(spec.id + "-" + root + ".wav", cache)),
        })),
      ),
      {
        path: "LICENSE",
        url: upstream + "LICENSE",
        cache: fileURLToPath(new URL("LICENSE.txt", cache)),
      },
    ]),
  );
  process.exit(0);
}
async function download(path, local) {
  try {
    return await readFile(local);
  } catch {}
  const url = upstream + path.split("/").map(encodeURIComponent).join("/");
  console.log("Downloading " + path);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(local, bytes);
    return bytes;
  } catch (cause) {
    throw new Error(
      `Download unavailable: ${url}\nSave the original file at ${fileURLToPath(local)} and run again.`,
      { cause },
    );
  }
}
for (const spec of specs) {
  const assets = [],
    zones = [];
  const roots = spec.samples.map(([n]) => n + (spec.midiOffset ?? 0));
  for (let i = 0; i < spec.samples.length; i++) {
    const [root, path] = spec.samples[i];
    const sourceFile = new URL(spec.id + "-" + root + ".wav", cache);
    const original = await download(path, sourceFile);
    const file = `samples/${spec.id}-${root}.wav`,
      target = new URL(file, destination);
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        fileURLToPath(sourceFile),
        "-ac",
        "1",
        "-ar",
        "32000",
        "-af",
        `silenceremove=start_periods=1:start_duration=0:start_threshold=-55dB,atrim=duration=${spec.seconds},afade=t=out:st=${spec.seconds - 0.06}:d=0.06`,
        "-c:a",
        "pcm_s16le",
        "-map_metadata",
        "-1",
        fileURLToPath(target),
      ],
      { stdio: "pipe" },
    );
    const decoded = decodeWav(await readFile(target));
    const peak = decoded.channels[0].reduce(
      (p, v) => Math.max(p, Math.abs(v)),
      0,
    );
    if (peak < 0.0001) throw new Error("Silent sample: " + path);
    const normalized = decoded.channels[0].map((v) => v * (0.4 / peak));
    await writeFile(
      target,
      Buffer.from(encodeWav([normalized], decoded.sampleRate)),
    );
    const bytes = await readFile(target),
      id = `${spec.id}-${root}`;
    const provenance = `VCSL / Versilian Studios, CC0-1.0; ${commit}; ${path}`;
    assets.push({ id, file, sha256: hash(bytes), provenance });
    const zone = {
      lowMidi: i
        ? Math.floor((roots[i - 1] + roots[i]) / 2) + 1
        : spec.range[0],
      highMidi:
        i === spec.samples.length - 1
          ? spec.range[1]
          : Math.floor((roots[i] + roots[i + 1]) / 2),
      rootMidi: roots[i],
      tuningCents: spec.tunings[i],
      assetId: id,
      gainDb: 0,
    };
    if (spec.id === "starter-recorder")
      Object.assign(zone, {
        loopStartFrame: 19200,
        loopEndFrame: 51200,
        loopCrossfadeFrames: 128,
      });
    zones.push(zone);
    receipts.files.push({
      file,
      upstreamPath: path,
      upstreamUrl: upstream + path.split("/").map(encodeURIComponent).join("/"),
      originalSha256: hash(original),
      rootMidi: roots[i],
      tuningCents: spec.tunings[i],
      sha256: hash(bytes),
      bytes: bytes.length,
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
      description: `${spec.name}: compact multi-root VCSL sample instrument for retro game music.`,
      sample: { kind: "zones", zones },
      provenance:
        "VCSL / Versilian Studios, CC0-1.0; compact curated derivatives.",
    },
    assets,
  });
}
const license = await download("LICENSE", new URL("LICENSE.txt", cache));
await writeFile(new URL("LICENSE.txt", destination), license);
await writeFile(
  new URL("pack.json", destination),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  new URL("SOURCES.json", destination),
  JSON.stringify(receipts, null, 2) + "\n",
);
console.log(
  `Prepared ${receipts.files.length} samples, ${receipts.files.reduce((n, f) => n + f.bytes, 0)} bytes. Manifest: ${fileURLToPath(new URL("pack.json", destination))}`,
);
