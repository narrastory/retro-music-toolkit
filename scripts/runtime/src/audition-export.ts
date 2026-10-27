import { ScoreSchema } from "./model.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  AUDITION_IDS,
  createAuditionScore,
  instrumentGuidance,
} from "./audition.js";
import { renderScore } from "./renderer.js";
import { NormalizationSchema } from "./render-options.js";
import { TOOLKIT_VERSION } from "./version.js";
const escape = (s: unknown) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function exportAuditions(
  directory: string,
  options: {
    instrumentIds?: string[];
    sourceScore?: unknown;
    force?: boolean;
    normalization?: unknown;
  } = {},
) {
  const source =
    options.sourceScore === undefined
      ? undefined
      : ScoreSchema.parse(options.sourceScore);
  const available = [
    ...AUDITION_IDS,
    ...(source?.instrumentDefinitions ?? []).map((p) => p.id),
  ];
  const ids = (options.instrumentIds ?? available)
    .map((id) => id.trim())
    .filter(Boolean);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !available.includes(id))
  )
    throw new Error(
      `Unknown, empty or duplicate audition instrument list. Available: ${available.join(", ")}`,
    );
  const requested = options.normalization ?? {};
  const normalization = NormalizationSchema.parse(
    typeof requested === "object" &&
      requested !== null &&
      !Array.isArray(requested)
      ? { maxBoostDb: 24, ...requested }
      : requested,
  );
  const filenames = [
    ...ids.flatMap((id) => [
      `${id}.wav`,
      `${id}.score.json`,
      `${id}.report.json`,
    ]),
    "index.html",
    "manifest.json",
    "listening-review.json",
  ];
  await mkdir(directory, { recursive: true });
  if (!options.force)
    for (const file of filenames) {
      try {
        await access(join(directory, file));
      } catch {
        continue;
      }
      throw new Error(
        `Output already exists: ${file}; choose a new directory or pass force`,
      );
    }
  const save = (name: string, data: string | Uint8Array) =>
    writeFile(join(directory, name), data, {
      flag: options.force ? "w" : "wx",
    });
  const rows = [];
  for (const id of ids) {
    const score = createAuditionScore(id, source),
      result = await renderScore(score, { normalization });
    await save(`${id}.wav`, result.wav);
    await save(`${id}.score.json`, JSON.stringify(score, null, 2) + "\n");
    const report = {
      ...result.report,
      audioHash: createHash("sha256").update(result.wav).digest("hex"),
      guidance: instrumentGuidance(id, source),
    };
    await save(`${id}.report.json`, JSON.stringify(report, null, 2) + "\n");
    rows.push({
      id,
      wav: `${id}.wav`,
      score: `${id}.score.json`,
      report: `${id}.report.json`,
      peakDbfs: result.report.peakDbfs,
      truePeakDbfs: result.report.truePeakDbfs,
      rmsDbfs: result.report.rmsDbfs,
      loudnessLufs: result.report.loudnessLufs,
      appliedGainDb: result.report.normalization?.appliedGainDb ?? null,
      limitedBy: result.report.normalization?.limitedBy ?? null,
      audioHash: report.audioHash,
    });
  }
  const manifest = {
    toolkitVersion: TOOLKIT_VERSION,
    normalization,
    instruments: rows,
    limitations:
      "Reference-signal RMS matching with peak ceiling; no perceptual loudness or subjective listening approval. Files include intentional rests.",
  };
  await save("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  await save(
    "listening-review.json",
    JSON.stringify(
      {
        status: "unreviewed",
        instruments: ids.map((id) => ({
          id,
          listener: null,
          registerBalance: null,
          shortNoteClarity: null,
          longNoteFatigue: null,
          velocityResponse: null,
          notes: "",
        })),
      },
      null,
      2,
    ) + "\n",
  );
  await save(
    "index.html",
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>音色试听台 · ${TOOLKIT_VERSION}</title><style>body{max-width:1000px;margin:40px auto;padding:0 20px;background:#111725;color:#e4edf8;font:16px/1.7 system-ui}article{background:#192336;padding:20px;margin:16px 0;border-radius:12px}audio{width:100%}h1{color:#8ef0cb}code{color:#8ef0cb}p{overflow-wrap:anywhere}</style><h1>Retro Music · 音色试听台</h1><p>每个音色包含低、中、高音区（鼓为八种鼓声），依次比较短/长音及弱/强力度。目标 ${normalization.targetRmsDbfs} dBFS RMS，样本峰值上限 ${normalization.peakCeilingDbfs} dBFS。RMS 匹配不等于感知响度相等；当前尚未完成主观听音。</p>${rows
      .map(
        (r) =>
          `<article><h2>${escape(r.id)}</h2><audio controls preload="none" src="${escape(r.wav)}"></audio><p>RMS ${r.rmsDbfs?.toFixed(2) ?? "—"} dBFS · peak ${r.peakDbfs?.toFixed(2) ?? "—"} dBFS · LUFS ${r.loudnessLufs ?? "—"} · gain ${r.appliedGainDb?.toFixed(2) ?? "—"} dB · ${escape(r.limitedBy ?? "")}</p><p>${escape(instrumentGuidance(r.id, source).watchFor)}</p></article>`,
      )
      .join(
        "",
      )}<p>试听后填写 listening-review.json。建议在普通扬声器、小音量及耳机上分别检查；详细测量在各音色 report.json。</p></html>`,
  );
  return { directory: resolve(directory), ...manifest };
}
