#!/usr/bin/env node
import { normalizeNumericArgs } from "./cli-args.js";
import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createArrangement,
  varyMotif,
  placeAnswers,
  developMotif,
  harmonizeScore,
  arpeggiatePattern,
} from "./composition.js";
import { importInstrument } from "./instrument-pack.js";
import { INSTRUMENTS } from "./instruments.js";
import { diagnoseScore } from "./diagnostics.js";
import { exportAuditions } from "./audition-export.js";
import { instrumentGuidance } from "./audition.js";
import { compileScore } from "./compiler.js";
import { ScoreError, ScoreSchema, ToolkitError } from "./model.js";
import { patchScoreWithReport } from "./patch.js";
import { renderScore } from "./renderer.js";
import { analyzeChannels } from "./analysis.js";
import { compareRenders } from "./compare.js";
import { buildReportHtml, describeScore, renderPianoRoll } from "./report.js";
import { decodeWav } from "./wav.js";
import { beatsPerBar } from "./model.js";
import { TOOLKIT_VERSION } from "./version.js";
const sha = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

const HELP = `Retro Music Toolkit ${TOOLKIT_VERSION}

Usage: retro-music COMMAND [FILE] [options]
       retro-music COMMAND -  [options]        read the score from stdin

Commands
  instruments                       list presets with guidance
  validate SCORE.json               full compile check
  compile SCORE.json --out FILE     expanded integer-tick events
  diagnose SCORE.json               arrangement + harmony findings
  render SCORE.json --out song.wav  offline render
  patch SCORE.json --patch P.json --out NEW.json
  arrange CONFIG.json --out SCORE.json
  vary SCORE.json --config C.json --out NEW.json
  answer SCORE.json --config C.json --out NEW.json
  motif SCORE.json --config C.json --out NEW.json
  harmonize SCORE.json --config C.json --out NEW.json
  arpeggiate SCORE.json --config C.json --out NEW.json
  import-instrument SCORE.json --definition PACKAGE.json --out NEW.json
  audition --out DIR [--instrument ID] [--score SCORE.json]
  analyze AUDIO.wav
  compare A.wav B.wav [C.wav...]    level-matched A/B export
         --out ab.wav [--match-rms -24] [--gap 0.5]
  report SCORE.json --out report.html [--wav song.wav]
                                    piano-roll + structure + signal report
  describe SCORE.json               text summary of the music
  roll SCORE.json --out roll.svg    standalone piano roll
  schema [--out FILE]               print the JSON Schema
  example                           print a minimal valid score
  version

Render options
  --solo lead,bass            isolated tracks (real track IDs)
  --mode loop|one-shot        override export.mode
  --from 8 --to 16            render a beat range (one-shot only)
  --bars 9-16                 render a bar range (equivalent to --from/--to)
  --seam                      loop seam preview (last 4 beats + first 4)
  --effects mix|dry|wet
  --match-rms -24             comparison copy at a target RMS
  --loop-diagnostics          compare mixed/dry/wet loop cycles
  --loop-crossfade 0.02       equal-power crossfade at the loop boundary (beats)
  --dither / --no-dither      deterministic TPDF dither before PCM16
  --limiter CEILING           peak limiter ceiling in dBFS, e.g. -1
  --no-limiter

Global
  --force                     overwrite existing outputs
  --compact                   one-line JSON output (smaller for agents)
  --stdout                    write the primary result to stdout
  --out -                     write the primary result to stdout
  --help, --version

Every command prints JSON. exit 0 = success, 1 = failure, 2 = score invalid.
`;

const { positionals, values } = (() => {
  try {
    return parseArgs({
      args: normalizeNumericArgs(process.argv.slice(2)),
      allowPositionals: true,
      options: {
        out: { type: "string" },
        patch: { type: "string" },
        config: { type: "string" },
        score: { type: "string" },
        definition: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        bars: { type: "string" },
        solo: { type: "string" },
        mode: { type: "string" },
        seam: { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean" },
        version: { type: "boolean" },
        compact: { type: "boolean" },
        stdout: { type: "boolean" },
        rules: { type: "string" },
        instrument: { type: "string" },
        effects: { type: "string" },
        "loop-diagnostics": { type: "boolean" },
        "loop-crossfade": { type: "string" },
        "match-rms": { type: "string" },
        dither: { type: "boolean" },
        "no-dither": { type: "boolean" },
        limiter: { type: "string" },
        "no-limiter": { type: "boolean" },
        gap: { type: "string" },
        wav: { type: "string" },
        svg: { type: "boolean" },
      },
    });
  } catch (e) {
    console.log(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
    );
    process.exit(1);
  }
})();
const [command, file] = positionals;
const print = (data: unknown) =>
  console.log(
    values.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2),
  );
/** Split a comma list and trim, so `--solo lead, bass` works. */
const splitList = (s?: string) =>
  s
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const wantsStdout = values.stdout || values.out === "-";
const writeStdout = (data: string | Uint8Array) =>
  new Promise<void>((res, rej) => {
    process.stdout.write(data, (e) => (e ? rej(e) : res()));
  });

async function load(path: string | undefined) {
  if (!path)
    throw new ToolkitError(
      "MISSING_INPUT",
      "Expected input file (or - for stdin)",
    );
  const text = path === "-" ? await readStdin() : await readFile(path, "utf8");
  try {
    return { text, data: JSON.parse(text) };
  } catch (e) {
    throw new ToolkitError(
      "INVALID_JSON",
      `${path === "-" ? "stdin" : path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
async function output(path: string, data: string | Uint8Array) {
  if (path === "-" || (wantsStdout && path === values.out)) {
    await writeStdout(data);
    return;
  }
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, data, { flag: values.force ? "w" : "wx" });
}
async function preflight(paths: string[]) {
  if (values.force || wantsStdout) return;
  for (const p of paths) {
    if (p === "-") continue;
    try {
      await access(p);
    } catch {
      continue;
    }
    throw new ToolkitError(
      "OUTPUT_EXISTS",
      `Output already exists: ${p}; choose a new filename or pass --force`,
    );
  }
}
/** --bars 9-16 → beat range, using the score's own meter. */
function resolveRange(data: unknown) {
  let from = values.from !== undefined ? Number(values.from) : undefined;
  let to = values.to !== undefined ? Number(values.to) : undefined;
  if (values.bars) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(values.bars.trim());
    if (!m)
      throw new ToolkitError(
        "INVALID_BARS",
        `--bars expects START or START-END, got ${values.bars}`,
      );
    const meter = (data as { meter?: [number, number] }).meter ?? [4, 4];
    const barBeats = beatsPerBar(meter as [number, number]);
    const startBar = Number(m[1]);
    const endBar = m[2] !== undefined ? Number(m[2]) : startBar;
    if (startBar < 1 || endBar < startBar)
      throw new ToolkitError(
        "INVALID_BARS",
        "Bars are 1-based and must ascend",
      );
    from = (startBar - 1) * barBeats;
    to = endBar * barBeats;
  }
  return { from, to };
}

function minimalExample() {
  return {
    schemaVersion: "1.3",
    title: "Minimal phrase",
    profile: "nes-inspired",
    tempo: 120,
    meter: [4, 4],
    lengthBeats: 4,
    seed: 1,
    key: { tonic: "C", mode: "major" },
    harmony: [
      { at: 0, chord: "C" },
      { at: 2, chord: "G" },
    ],
    sections: [{ id: "A1", label: "A", at: 0, lengthBeats: 4 }],
    tracks: [
      {
        id: "lead",
        role: "melody",
        instrument: "pulse-lead-soft",
        maxVoices: 1,
        voicePolicy: "cut",
        patterns: {
          A: {
            lengthBeats: 4,
            events: [
              {
                id: "n1",
                kind: "note",
                at: 0,
                pitch: "E5",
                duration: 0.5,
                velocity: 0.85,
              },
              { id: "n2", kind: "note", at: 0.5, pitch: "G5", duration: 0.5 },
              {
                id: "n3",
                kind: "note",
                at: 1,
                pitch: "C6",
                duration: 1,
                velocity: 0.9,
              },
              { id: "n4", kind: "note", at: 2, pitch: "B5", duration: 0.5 },
              { id: "n5", kind: "note", at: 2.5, pitch: "G5", duration: 0.5 },
              { id: "n6", kind: "note", at: 3, pitch: "D5", duration: 0.5 },
            ],
          },
        },
        clips: [{ id: "lead-a1", pattern: "A", at: 0 }],
      },
      {
        id: "bass",
        role: "bass",
        instrument: "triangle-bass",
        maxVoices: 1,
        voicePolicy: "cut",
        patterns: {
          A: {
            lengthBeats: 4,
            events: [
              {
                id: "b1",
                kind: "note",
                at: 0,
                pitch: "C3",
                duration: 1,
                gate: 0.9,
              },
              {
                id: "b2",
                kind: "note",
                at: 1,
                pitch: "C3",
                duration: 1,
                gate: 0.9,
              },
              {
                id: "b3",
                kind: "note",
                at: 2,
                pitch: "G2",
                duration: 1,
                gate: 0.9,
              },
              {
                id: "b4",
                kind: "note",
                at: 3,
                pitch: "G2",
                duration: 1,
                gate: 0.9,
              },
            ],
          },
        },
        clips: [{ id: "bass-a1", pattern: "A", at: 0 }],
      },
    ],
    mixer: { masterDb: -6, delayBeats: 0.75, feedback: 0.2, returnDb: -14 },
    export: {
      mode: "loop",
      sampleRate: 44100,
      tailSeconds: 1,
      warmupCycles: 3,
    },
  };
}

async function main() {
  if (values.version || command === "version") {
    print({ version: TOOLKIT_VERSION });
    return;
  }
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  if (command === "example") {
    const text = JSON.stringify(minimalExample(), null, 2) + "\n";
    if (values.out) await output(values.out, text);
    else console.log(text);
    return;
  }
  if (command === "instruments") {
    print(
      INSTRUMENTS.map((p) => ({
        ...p,
        guidance: instrumentGuidance(p.id),
      })),
    );
    return;
  }
  if (command === "schema") {
    const text = JSON.stringify(z.toJSONSchema(ScoreSchema), null, 2) + "\n";
    if (values.out) await output(values.out, text);
    else console.log(text);
    return;
  }
  if (command === "audition") {
    if (!values.out)
      throw new ToolkitError("MISSING_OUT", "--out directory is required");
    const ids = splitList(values.instrument);
    print(
      await exportAuditions(values.out, {
        instrumentIds: ids,
        sourceScore: values.score ? (await load(values.score)).data : undefined,
        force: values.force,
        normalization:
          values["match-rms"] !== undefined
            ? { targetRmsDbfs: Number(values["match-rms"]) }
            : undefined,
      }),
    );
    return;
  }
  if (command === "analyze") {
    if (!file) throw new ToolkitError("MISSING_INPUT", "Expected WAV file");
    const a = decodeWav(await readFile(file));
    print({
      ...analyzeChannels(a.channels, a.sampleRate),
      declaredLoop: a.loop ?? null,
    });
    return;
  }
  if (command === "compare") {
    const files = positionals.slice(1);
    if (files.length < 2)
      throw new ToolkitError(
        "MISSING_INPUT",
        "compare needs at least two WAV files: compare a.wav b.wav",
      );
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await preflight([values.out]);
    const loaded = await Promise.all(
      files.map(async (path) => ({ path, bytes: await readFile(path) })),
    );
    const result = compareRenders(loaded, {
      ...(values["match-rms"] !== undefined
        ? { targetRmsDbfs: Number(values["match-rms"]) }
        : {}),
      ...(values.gap !== undefined ? { gapSeconds: Number(values.gap) } : {}),
    });
    await output(values.out, result.concatenated);
    print({ wav: resolve(values.out), ...result.report, rows: result.rows });
    return;
  }

  const { text, data } = await load(file);

  if (command === "arrange") {
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await preflight([values.out, values.out + ".plan.json"]);
    const result = createArrangement(data);
    await output(values.out, JSON.stringify(result.score, null, 2) + "\n");
    await output(
      values.out + ".plan.json",
      JSON.stringify(result.plan, null, 2) + "\n",
    );
    print({
      score: resolve(values.out),
      plan: resolve(values.out + ".plan.json"),
      limitations: result.plan.limitations,
    });
    return;
  }
  if (command === "vary" || command === "answer") {
    const config = await load(values.config);
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await preflight([values.out, values.out + ".changes.json"]);
    const result =
      command === "vary"
        ? varyMotif(data, config.data)
        : placeAnswers(data, config.data);
    await output(values.out, JSON.stringify(result.score, null, 2) + "\n");
    await output(
      values.out + ".changes.json",
      JSON.stringify(result.report, null, 2) + "\n",
    );
    print({ score: resolve(values.out), ...result.report });
    return;
  }
  if (
    command === "motif" ||
    command === "harmonize" ||
    command === "arpeggiate"
  ) {
    const config = await load(values.config);
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await preflight([values.out, values.out + ".changes.json"]);
    const result =
      command === "motif"
        ? developMotif(data, config.data)
        : command === "harmonize"
          ? harmonizeScore(data, config.data)
          : arpeggiatePattern(data, config.data);
    await output(values.out, JSON.stringify(result.score, null, 2) + "\n");
    await output(
      values.out + ".changes.json",
      JSON.stringify(result.report, null, 2) + "\n",
    );
    print({ score: resolve(values.out), ...result.report });
    return;
  }
  if (command === "import-instrument") {
    const definition = await load(values.definition);
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    const score = await importInstrument(
      data,
      definition.data,
      dirname(resolve(values.definition!)),
    );
    await output(values.out, JSON.stringify(score, null, 2) + "\n");
    print({
      score: resolve(values.out),
      embeddedAssets: Object.keys(score.sampleAssets ?? {}),
    });
    return;
  }
  if (command === "diagnose") {
    const rules = values.rules ? (await load(values.rules)).data : {};
    const result = diagnoseScore(data, rules);
    if (values.out && !wantsStdout)
      await output(values.out, JSON.stringify(result, null, 2) + "\n");
    print(result);
    return;
  }
  if (command === "validate") {
    try {
      const c = compileScore(data);
      print({
        valid: true,
        sourceHash: sha(text),
        schemaVersion: c.score.schemaVersion,
        eventCount: c.events.length,
        diagnostics: c.diagnostics,
      });
    } catch (e) {
      if (e instanceof ScoreError) {
        print({ valid: false, diagnostics: e.diagnostics });
        process.exitCode = 2;
      } else throw e;
    }
    return;
  }
  if (command === "compile") {
    const c = compileScore(data);
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await output(values.out, JSON.stringify(c, null, 2) + "\n");
    if (!wantsStdout)
      print({ file: resolve(values.out), events: c.events.length });
    return;
  }
  if (command === "patch") {
    const p = await load(values.patch);
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    const result = patchScoreWithReport(data, p.data, sha(text));
    await output(values.out, JSON.stringify(result.score, null, 2) + "\n");
    print({
      file: resolve(values.out),
      parentHash: sha(text),
      ...result.report,
    });
    return;
  }
  if (command === "describe") {
    print({ text: describeScore(compileScore(data)) });
    return;
  }
  if (command === "roll") {
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await preflight([values.out]);
    const svg = renderPianoRoll(compileScore(data));
    await output(values.out, svg);
    print({ svg: resolve(values.out), bytes: svg.length });
    return;
  }
  if (command === "report") {
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    await preflight([values.out]);
    const compiled = compileScore(data);
    const audio = values.wav ? await readFile(values.wav) : undefined;
    const html = buildReportHtml(compiled, audio);
    await output(values.out, html);
    print({
      html: resolve(values.out),
      bytes: html.length,
      wav: values.wav ? resolve(values.wav) : null,
    });
    return;
  }
  if (command === "render") {
    if (!values.out) throw new ToolkitError("MISSING_OUT", "--out is required");
    if (!wantsStdout && !values.out.endsWith(".wav"))
      throw new ToolkitError("INVALID_OUT", "--out must end in .wav");
    if (values.mode && !["loop", "one-shot"].includes(values.mode))
      throw new ToolkitError("INVALID_MODE", "--mode must be loop or one-shot");
    const range = resolveRange(data);
    await preflight([
      values.out,
      values.out + ".report.json",
      values.out + ".score.json",
    ]);
    const limiter = values["no-limiter"]
      ? (false as const)
      : values.limiter !== undefined
        ? { ceilingDbfs: Number(values.limiter) }
        : undefined;
    const result = await renderScore(data, {
      ...(range.from !== undefined ? { fromBeat: range.from } : {}),
      ...(range.to !== undefined ? { toBeat: range.to } : {}),
      ...(values.solo ? { solo: splitList(values.solo)! } : {}),
      ...(values.mode ? { mode: values.mode as "loop" | "one-shot" } : {}),
      seam: values.seam,
      effects: values.effects as "mix" | "dry" | "wet" | undefined,
      loopDiagnostics: values["loop-diagnostics"],
      ...(values["loop-crossfade"] !== undefined
        ? { loopCrossfadeBeats: Number(values["loop-crossfade"]) }
        : {}),
      ...(values.dither ? { dither: true } : {}),
      ...(values["no-dither"] ? { dither: false } : {}),
      ...(limiter !== undefined ? { limiter } : {}),
      normalization:
        values["match-rms"] !== undefined
          ? { targetRmsDbfs: Number(values["match-rms"]) }
          : undefined,
    });
    const report = {
      ...result.report,
      sourceHash: sha(text),
      audioHash: sha(result.wav),
      sourceFile: file === "-" ? "(stdin)" : resolve(file!),
    };
    await output(values.out, result.wav);
    if (!wantsStdout) {
      await output(
        values.out + ".report.json",
        JSON.stringify(report, null, 2) + "\n",
      );
      // Save the score exactly as supplied. Render overrides (--mode, --bars)
      // live in the report so re-rendering the saved file reproduces itself.
      await output(
        values.out + ".score.json",
        JSON.stringify(ScoreSchema.parse(data), null, 2) + "\n",
      );
      print({
        wav: resolve(values.out),
        report: resolve(values.out + ".report.json"),
        ...report,
      });
    }
    return;
  }
  throw new ToolkitError(
    "UNKNOWN_COMMAND",
    `Unknown command: ${command}. Run with --help for the command list.`,
  );
}
main().catch((e) => {
  if (e instanceof ToolkitError) {
    print({
      error: e.message,
      code: e.code,
      ...(e.details ? { details: e.details } : {}),
    });
  } else if (e instanceof ScoreError) {
    print({ error: e.message, diagnostics: e.diagnostics });
  } else {
    print({
      error: e instanceof Error ? e.message : String(e),
      code: "INTERNAL",
    });
  }
  process.exitCode = 1;
});
