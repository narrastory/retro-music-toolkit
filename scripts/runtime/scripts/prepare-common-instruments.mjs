// Optional authoring tool. Runtime uses only the copied instrument packs.
// Usage: node scripts/prepare-common-instruments.mjs [--source PATH_TO_MATERIAL]
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { decodeWav, encodeWav } from "../dist/wav.js";
const argument = process.argv.indexOf("--source");
const source =
  argument >= 0
    ? resolve(process.argv[argument + 1])
    : fileURLToPath(new URL("../../../material/", import.meta.url));
const root = new URL("../instruments/", import.meta.url);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const bass = "Growlybass",
  guitar = "Karoryfer_Black_And_Green_Guitars_1000",
  piano = "SalamanderGrandPianoV3_44.1khz16bit",
  drums = "Gogodze_Phu_vol_II";
const packs = [
  {
    id: "band",
    name: "Common Band — bass and clean guitar",
    license: "CC0-1.0",
    url: "https://www.karoryfer.com/",
    credits:
      "Growlybass and Black And Green Guitars — Karoryfer Lecolds. Guitar recordings: Brian Wood.",
    licenses: [
      [bass + "/LICENSE", "LICENSE.txt"],
      [bass + "/readme.txt", "GROWLYBASS-README.txt"],
      [guitar + "/readme.txt", "GUITARS-README.txt"],
    ],
    instruments: [],
  },
  {
    id: "piano",
    name: "Common Keys — compact Salamander piano",
    license: "CC-BY-3.0",
    url: "https://archive.org/details/SalamanderGrandPianoV3",
    credits:
      "Salamander Grand Piano V3 — Alexander Holm. Retuned mapping: Markus Fiedler. Derived from the user-supplied V3+20161209 44.1 kHz/16-bit distribution.",
    licenses: [[piano + "/README", "UPSTREAM-README.txt"]],
    instruments: [],
  },
  {
    id: "drums",
    name: "Common Drums — compact acoustic kit",
    license: "CC-BY-4.0",
    url: "https://www.karoryfer.com/",
    credits: "Gogodze Phu Vol II — Karoryfer Lecolds, copyright 2018.",
    licenses: [
      [drums + "/LICENSE.md", "LICENSE.md"],
      [drums + "/readme.txt", "UPSTREAM-README.txt"],
    ],
    instruments: [],
  },
];
function tonal(id, name, role, roots, range, seconds, attack, release, paths) {
  const items = [];
  for (let n = 0; n < roots.length; n++)
    for (const layer of paths.layers)
      for (let rr = 1; rr <= paths.rr; rr++) {
        const path = paths.file(n, layer, rr);
        items.push({
          path,
          id: `${id}-${roots[n]}-${layer.name}-${rr}`,
          lowMidi: n ? Math.floor((roots[n - 1] + roots[n]) / 2) + 1 : range[0],
          highMidi:
            n === roots.length - 1
              ? range[1]
              : Math.floor((roots[n] + roots[n + 1]) / 2),
          rootMidi: roots[n],
          tuningCents: paths.tuning?.[n] ?? 0,
          lowVelocity: layer.low,
          highVelocity: layer.high,
          roundRobin: rr,
        });
      }
  return { id, name, role, range, seconds, attack, release, items };
}
const two = [
    { name: "soft", low: 1, high: 79 },
    { name: "hard", low: 80, high: 127 },
  ],
  one = [{ name: "all", low: 1, high: 127 }];
packs[0].instruments.push(
  tonal(
    "band-bass",
    "Fingered electric bass",
    "bass",
    [40, 48, 60],
    [36, 67],
    1.5,
    0.004,
    0.08,
    {
      layers: two,
      rr: 2,
      file: (n, l, r) =>
        `${bass}/sustain/${["e2", "c3", "c4"][n]}_${l.name === "soft" ? "p" : "f"}_rr${r}.wav`,
    },
  ),
  tonal(
    "band-bass-short",
    "Short electric bass",
    "bass",
    [40, 48, 60],
    [36, 67],
    0.45,
    0.003,
    0.045,
    {
      layers: one,
      rr: 2,
      file: (n, l, r) =>
        `${bass}/staccato/${["e2", "c3", "c4"][n]}_staccato_rr${r}.wav`,
    },
  ),
  tonal(
    "band-guitar",
    "Clean electric guitar",
    "harmony",
    [40, 52, 64],
    [40, 76],
    1.6,
    0.003,
    0.12,
    {
      layers: two,
      rr: 2,
      file: (n, l, r) =>
        `${guitar}/Samples/green/ord/twang_${["e3", "e4", "e5"][n]}_${l.name === "soft" ? "p" : "mf"}_rr${r}.wav`,
    },
  ),
  tonal(
    "band-guitar-short",
    "Short clean electric guitar",
    "arp",
    [40, 52, 64],
    [40, 76],
    0.5,
    0.002,
    0.045,
    {
      layers: one,
      rr: 2,
      file: (n, l, r) =>
        `${guitar}/Samples/green/stac/staccato_${["e3", "e4", "e5"][n]}_rr${r}.wav`,
    },
  ),
);
packs[1].instruments.push(
  tonal(
    "keys-grand",
    "Grand piano",
    "harmony",
    [36, 48, 60, 72],
    [36, 84],
    2,
    0.003,
    0.18,
    {
      layers: two,
      rr: 1,
      tuning: [9, 0, 6, 8],
      file: (n, l) =>
        `${piano}/44.1khz16bit/C${n + 2}v${l.name === "soft" ? 6 : 12}.wav`,
    },
  ),
);
const kit = {
  id: "drums-acoustic",
  name: "Acoustic drum kit",
  role: "drums",
  range: [0, 127],
  attack: 0,
  release: 0,
  items: [],
};
for (const [sound, prefix, mic, seconds, hard] of [
  ["kick", "ks", "kick_mic", 0.4, 4],
  ["snare", "sc", "snare_mic", 0.5, 4],
  ["hat", "hc", "oh_mic", 0.2, 4],
  ["openhat", "ho", "oh_mic", 0.85, 3],
  ["tom", "tm", "oh_mic", 0.6, 4],
])
  for (const l of two)
    for (let rr = 1; rr <= 2; rr++)
      kit.items.push({
        id: `drums-acoustic-${sound}-${l.name}-${rr}`,
        path: `${drums}/Samples/${mic}/${prefix}_vl${l.name === "soft" ? 2 : hard}_rr${rr}.wav`,
        sound,
        seconds,
        lowVelocity: l.low,
        highVelocity: l.high,
        roundRobin: rr,
      });
packs[2].instruments.push(kit);
for (const pack of packs) {
  const licenseUrl =
    pack.license === "CC0-1.0"
      ? "https://creativecommons.org/publicdomain/zero/1.0/"
      : `https://creativecommons.org/licenses/by/${pack.license === "CC-BY-3.0" ? "3.0" : "4.0"}/`;
  const dest = new URL(pack.id + "/", root);
  await mkdir(new URL("samples/", dest), { recursive: true });
  const manifest = {
    id: pack.id,
    name: pack.name,
    version: "1.0.0",
    license: pack.license,
    source: pack.url,
    instruments: [],
  };
  const receipts = {
    source:
      "User-supplied local archives; original input directories are excluded from Git and are not runtime dependencies.",
    credits: pack.credits,
    license: pack.license,
    processing:
      "Trim leading silence at -55 dB, mono 32 kHz PCM16, short non-looped edits with 40 ms end fade. One shared peak gain per root note or drum sound preserves relative layer and RR dynamics while balancing registers. Curated subsets expand selected layers to cover velocities 1–127; not a complete SFZ emulation.",
    files: [],
  };
  for (const spec of pack.instruments) {
    const prepared = [];
    let peak = 0;
    const peaks = new Map();
    for (const item of spec.items) {
      const input = resolve(source, item.path),
        file = `samples/${item.id}.wav`,
        output = new URL(file, dest),
        seconds = item.seconds ?? spec.seconds;
      const original = await readFile(input);
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
          "32000",
          "-af",
          `silenceremove=start_periods=1:start_duration=0:start_threshold=-55dB,atrim=duration=${seconds},afade=t=out:st=${seconds - 0.04}:d=0.04`,
          "-c:a",
          "pcm_s16le",
          "-map_metadata",
          "-1",
          fileURLToPath(output),
        ],
        { stdio: "pipe" },
      );
      const decoded = decodeWav(await readFile(output));
      let filePeak = 0;
      for (const v of decoded.channels[0])
        filePeak = Math.max(filePeak, Math.abs(v));
      peak = Math.max(peak, filePeak);
      const group = item.sound ?? item.rootMidi;
      peaks.set(group, Math.max(peaks.get(group) ?? 0, filePeak));
      prepared.push({
        item,
        file,
        output,
        decoded,
        originalHash: hash(original),
      });
    }
    if (peak < 0.0001) throw new Error("Silent instrument: " + spec.id);
    const assets = [],
      zones = [],
      slots = [];
    for (const { item, file, output, decoded, originalHash } of prepared) {
      const groupPeak = peaks.get(item.sound ?? item.rootMidi);
      const data = decoded.channels[0].map((v) => v * (0.5 / groupPeak));
      await writeFile(
        output,
        Buffer.from(encodeWav([data], decoded.sampleRate)),
      );
      const bytes = await readFile(output),
        provenance = `${pack.credits} License: ${pack.license} ${licenseUrl}; Source: ${pack.url}; Changes: mono 32 kHz PCM16, trimmed, faded, shared instrument gain; original ${item.path}`;
      assets.push({ id: item.id, file, sha256: hash(bytes), provenance });
      const mapping = {
        assetId: item.id,
        lowVelocity: item.lowVelocity,
        highVelocity: item.highVelocity,
        roundRobin: item.roundRobin,
      };
      if (item.sound) slots.push({ ...mapping, sound: item.sound });
      else
        zones.push({
          ...mapping,
          lowMidi: item.lowMidi,
          highMidi: item.highMidi,
          rootMidi: item.rootMidi,
          tuningCents: item.tuningCents,
        });
      receipts.files.push({
        file,
        originalPath: item.path,
        originalSha256: originalHash,
        sha256: hash(bytes),
        bytes: bytes.length,
        sharedGainDb: 20 * Math.log10(0.5 / groupPeak),
        ...mapping,
        ...(!item.sound
          ? { rootMidi: item.rootMidi, tuningCents: item.tuningCents }
          : { sound: item.sound }),
      });
    }
    manifest.instruments.push({
      instrument: {
        id: spec.id,
        engine: spec.role === "drums" ? "drums" : "sample",
        role: spec.role,
        range: spec.range,
        attack: spec.attack,
        release: spec.release,
        description: `${spec.name}; compact non-looped WAV edits with native velocity/RR selection.`,
        provenance: `${pack.credits} ${pack.license}`,
        ...(spec.role === "drums"
          ? { drumKit: { slots } }
          : { sample: { kind: "zones", zones } }),
      },
      assets,
    });
  }
  for (const [input, name] of pack.licenses)
    await copyFile(resolve(source, input), new URL(name, dest));
  await writeFile(
    new URL("pack.json", dest),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    new URL("SOURCES.json", dest),
    JSON.stringify(receipts, null, 2) + "\n",
  );

  await writeFile(
    new URL("ATTRIBUTION.md", dest),
    `# ${pack.name}\n\n${pack.credits}\n\nSource: ${pack.url}\n\nLicense: ${pack.license} — ${licenseUrl}\n\nChanges: ${receipts.processing}\n\nRetain this notice, the license reference and the change notice when redistributing these samples, including copies embedded in scores. No endorsement is implied. See SOURCES.json for exact source files and hashes.\n`,
  );
  console.log(
    `${pack.id}: ${manifest.instruments.length} instruments, ${receipts.files.length} samples, ${receipts.files.reduce((n, f) => n + f.bytes, 0)} bytes`,
  );
}
