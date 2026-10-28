<div align="center">

[简体中文](README.md) · **English**

<img src="assets/logo.svg" width="96" alt="Retro Music Toolkit">

# Retro Music Toolkit

### An 8-bit / 16-bit game music workstation built for AI agents

You write the score, not a prompt. Every note is yours, and every export is reproducible.

[![version 1.1.0](https://img.shields.io/badge/version-1.1.0-d6293a?style=flat-square)](#quick-start) [![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#quick-start) [![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](scripts/runtime) [![MIT](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE) [![100% offline](https://img.shields.io/badge/100%25-offline-2f855a?style=flat-square)](#built-for-agents-not-retrofitted-for-them) [![44.1 / 48 kHz WAV](https://img.shields.io/badge/output-44.1%20%2F%2048%20kHz%20WAV-6b7280?style=flat-square)](#deliver)

[Quick start](#quick-start) · [Capabilities](#capabilities) · [Listen](#what-real-output-looks-like) · [Technical details](#technical-details) · [Roadmap](#roadmap)

<code>git clone https://github.com/narrastory/retro-music-toolkit.git</code><br>
<code>cd retro-music-toolkit/scripts/runtime &amp;&amp; npm ci &amp;&amp; npm run build</code>

</div>

<p align="center">
  <img src="assets/hero.svg" width="1040" alt="Diagram: a score.json score on the left passes through the deterministic compiler and offline renderer, producing the starfall-fm.wav piano roll, waveform and render report on the right (-21.59 LUFS, -6.18 dBFS true peak, 1,411,200 frames, zero clipped samples).">
</p>

---

## The short version

Turn "write a NES-style exploration theme" into an **editable, verifiable, reproducible JSON score**, then render it locally to a 44.1 kHz WAV.

It does not guess what you meant. It plays exactly what you wrote, the way an 8/16-bit sound chip would.

## Why not just prompt a music model

The difference, stated plainly:

| | Music generation model | Retro Music Toolkit |
| --- | --- | --- |
| **Control** | Text in, audio out; changing one note means resampling | Every note, velocity and gate is a field you edit |
| **Reproducibility** | Same prompt, different result each time | Same JSON + same seed = same audio |
| **Revision** | Regenerate and lose the good parts | `patch` fixes bar 3, beat 2; everything else is untouched |
| **Auditability** | You get a WAV and no explanation | You get a score and diagnostics that name the problem |
| **Licensing** | Training data is not traceable | All instruments are procedurally generated; zero third-party samples |
| **Deployment** | GPU, API key, account | One laptop, Node.js, offline |
| **Cost** | Per generation | Zero, run it as often as you like |

Generation models are good at **giving you a first idea**. This toolkit is good at **turning that idea into something shippable, editable and reviewable**. The two are complementary — but only one of them survives a revision request.

## Built for agents, not retrofitted for them

- **Local and keyless.** No model service, no API key, no account. The whole toolchain is Zod + Tone.js + Playwright, running on your machine.
- **JSON in, JSON out.** Every command returns structured data. Errors carry a machine-readable `code` so an agent can branch on it instead of regex-matching a stack trace.
- **Meaningful exit codes.** `0` success, `1` tool or IO error, `2` invalid score.
- **Token-aware.** Read from stdin, write to stdout, `--compact` for one-line JSON, `--bars 9-16` to render a section without resending the whole project.
- **Self-checking.** Validation errors include the repair value (for example, "set `hold: true`, maximum duration 1 beat"). `patch` returns a per-operation diff so the agent can prove what changed.
- **Honest about listening.** Diagnostics report verifiable structure and signal facts. The tool never claims the music sounds good.

```bash
cat song.json | node dist/cli.js validate - --compact
```

## Capabilities

Four jobs, one local toolchain, from first note to final export.

### Compose
- **Cross-bar sustain** (`hold`) and **clip cropping** — no more stretching a pattern just to hold one note.
- **Motif development**: transposition (chromatic or diatonic), inversion, retrograde, duration scaling, velocity shaping, ornaments — applied to a beat range, leaving the source pattern intact.
- **Harmony-driven arrangement**: declare `key` and chord markers, then generate accompaniment with `harmonize` or arpeggios with `arpeggiate`.
- **Swing and humanize**, both derived from the seed, so feel is reproducible rather than random drift.

### Hear what is wrong
- **Harmony analysis**: non-chord tones on strong beats, bass clashes, parallel fifths and octaves, unresolved leaps, out-of-key notes, semitone collisions.
- **Loop closure**: does the last bar actually lead back to the first, or does the loop restart?
- **Arrangement analysis**: melodic breathing room, register crowding, hi-hat density, section contrast.
- **Two layers of feedback**: `describe` emits a reasoning-friendly text structure; `roll` and `report` emit a piano roll and an HTML report. An agent can read the structure without hearing it.

### Sound
- **NES-, Genesis- and SNES-inspired profiles**, eleven built-in instruments, custom instrument definitions and embedded multi-zone WAV samples.
- **`authenticity: "hardware"`** removes the safety low-pass, snaps pulse width to the real 12.5 / 25 / 50 % duty cycles and quantises volume to 16 steps.
- **Single-voice chord arpeggio**: a three-note chord costs **one** voice — this is how chip music fakes a chord.
- **SNES eight-tap FIR echo**, the platform's signature tail.
- **Eight drum pieces**, replaceable with a sampled kit.

### Deliver
- 44.1k / 48k PCM16 WAV, loop and one-shot modes.
- True peak (4x polyphase sinc oversampling) and BS.1770-4 loudness.
- Optional TPDF dither, look-ahead peak limiter and equal-power loop crossfade.
- `compare` concatenates two takes at matched loudness into a single A/B file.

## What real output looks like

Start with the `describe` structure, then the measured render report.

```text
$ node dist/cli.js describe examples/v3-starfall-fm.json

# Starfall Causeway
genesis-inspired, modern voice, 120 BPM, 4/4, 16 bars (64 beats), loop export
- lead (fm-celestial-lead, melody): 60 notes, 3.8/bar, range B4–C6,
  peak C6 at beat 38.00, 37% stepwise motion
- bass (fm-bass-round, bass): 64 notes, 4.0/bar, range F2–D3, peak D3 at beat 40.00
- drums (drums): 128 hits, 8.0/bar — hat×64, kick×32, snare×32
Sections:
  A-1: bar 1, 5.13 events/beat, median E4 — opening
  B-9: bar 9, 4.75 events/beat, median D4 — similar to previous
```

Measured numbers from the shipped FM demo:

| Metric | Value |
| --- | --- |
| Duration / frames | 32.000 s / 1,411,200 |
| Integrated loudness | −21.59 LUFS |
| True peak | −6.18 dBFS |
| Clipped / non-finite samples | 0 / 0 |

> [!TIP]
> Listen: [FM version](assets/demos/starfall-fm.wav) / [same theme, sampled](assets/demos/starfall-sample.wav)

## Quick start

> [!NOTE]
> Node.js 22 or newer. The first install needs network access for dependencies and Chromium; after that everything runs **offline**.

```bash
git clone https://github.com/narrastory/retro-music-toolkit.git
cd retro-music-toolkit/scripts/runtime
npm ci
npm run browser:install     # rendering only; compile and diagnose work without Chromium
npm run build
```

Write your first piece:

```bash
node dist/cli.js example --out minimal.json     # a ~40-line, fully valid score
node dist/cli.js validate minimal.json
node dist/cli.js render minimal.json --out minimal.wav
```

Change something, then export:

```bash
node dist/cli.js diagnose minimal.json          # arrangement and harmony findings
node dist/cli.js patch minimal.json --patch changes.json --out v2.json
node dist/cli.js render v2.json --out v2.wav --dither
node dist/cli.js compare minimal.wav v2.wav --out ab.wav
```

Full walkthrough: [quick start](references/quickstart.zh-CN.md) · [1.1 guide](references/v1.1-guide.zh-CN.md) · [score format](references/score-format.zh-CN.md).

## What it does not do

Stating the boundaries is more useful than overstating the features:

> [!IMPORTANT]
> **It does not compose for you, and it is not a chip emulator.** You supply the melody; `hardware` mode is an audible approximation, not bit-accurate 2A03 / YM2612 / BRR reproduction.

- **It does not judge taste.** Diagnostics say "this may clash with the chord", never "this is not good".
- **No shorthand notation, MIDI, tempo map or MCP server yet** (see [Roadmap](#roadmap)).
- **No subjective listening review.** The shipped examples are verified at the signal level — not by "we think it sounds great".

## Technical details

Implementation notes are collapsed by default; open them for architecture, commands and library usage.

<details>
<summary>Architecture</summary>

**Pipeline**: JSON → strict Zod validation → semantic, sample and harmony checks → pattern/clip expansion (swing, humanize, hold, cropping, single-voice chord arpeggio) → integer-tick events → voice allocation → Tone.js offline synthesis → limiting, dither and analysis → PCM16 WAV.

**Key modules**

| File | Responsibility |
| --- | --- |
| `model.ts` | Zod schemas, PPQ = 960, pitch conversion, structured errors |
| `compiler.ts` | Expansion, time transforms, chord rotation, voice allocation, loop boundaries |
| `harmony.ts` | Chord parsing, key, harmony and loop diagnostics |
| `motif.ts` / `voicing.ts` | Motif operators, chord voicing and arpeggios |
| `browser-engine.ts` | Tone.js graph and scheduling, warm-up, cropping, seam |
| `renderer.ts` | Node → Chromium bridge |
| `analysis.ts` | True peak, LUFS, clipping, boundary symptoms |
| `report.ts` | Piano-roll SVG, text description, HTML report |

**Design decisions**

- **Integer ticks, not floating-point seconds.** Every time transform happens at compile time, so loop length, voice conflicts and diagnostic windows all refer to what actually sounds.
- **Drums and melodic parts have different voice semantics.** Melodic tracks allocate against `maxVoices` and can steal; drums are independent one-shots that consume no voices.
- **Release tails are reported separately from held-note conflicts.** The former is routine and harmless; only the latter needs a fix.
- **Reproducibility.** Drum noise, humanize jitter and randomised arpeggios are all derived from the seed; runtime `Math.random` is banned. Cross-browser DSP differences can still shift individual samples, so bit-exact output is not claimed.

**Size**: roughly 7,500 lines of TypeScript, four runtime dependencies (`tone`, `zod`, `playwright`, `esbuild`), 115 automated tests (90 unit, 23 real-audio, 2 web).

</details>

<details>
<summary>Command reference</summary>

```text
instruments                    list presets and recommended ranges
validate SCORE.json            full compile check
compile SCORE.json --out F     expanded integer-tick events
diagnose SCORE.json            arrangement, harmony and loop findings
render SCORE.json --out S.wav  offline render
patch SCORE.json --patch P     targeted edits with a change log
arrange CONFIG.json            empty arrangement scaffold
motif / harmonize / arpeggiate development, accompaniment, arpeggios
vary / answer                  constrained variation and answering phrases
import-instrument              pack local WAVs into the project
report / describe / roll       visualisation and text structure
audition                       generate the instrument audition set
compare A.wav B.wav            level-matched A/B export
analyze AUDIO.wav              measure any WAV
schema / example / version
```

Render options: `--solo` `--mode` `--bars` `--from/--to` `--seam` `--effects` `--match-rms` `--loop-diagnostics` `--loop-crossfade` `--dither` `--limiter`

Global: `--force` `--compact` `--stdout` `--help`

</details>

<details>
<summary>Library usage</summary>

```ts
import { readFile } from "node:fs/promises";
import {
  compileScore,
  renderScore,
  patchScoreWithReport,
} from "./scripts/runtime/dist/index.js";

const input = JSON.parse(await readFile("song.json", "utf8"));
const compiled = compileScore(input);
console.log(compiled.events.length, compiled.diagnostics);

const { score, report } = patchScoreWithReport(input, {
  operations: [{ op: "set-track", trackId: "arp", set: { gainDb: -18 } }],
});
console.log(report.changes); // per-field before / after

const { wav } = await renderScore(score, { solo: ["lead", "bass"] });
```

</details>

<details>
<summary>Agent integration</summary>

`SKILL.md` is the agent-facing entry point: full workflow, constraints and delivery standards. A host only needs shell access.

| Intent | Implementation |
| --- | --- |
| List instruments | `INSTRUMENTS` / `cli instruments` |
| Validate a score | `compileScore` / `cli validate` |
| Render | `renderScore` / `cli render` |
| Revise | `patchScoreWithReport` / `cli patch` |
| Analyse audio | `decodeWav` + `analyzeChannels` / `cli analyze` |

No MCP server ships with the package; the CLI and function calls already form a complete loop.

</details>

## Roadmap

- tempo map / accelerando and ritardando
- MIDI import and export
- MML / shorthand notation front end
- voice-leading optimisation across chord changes
- MCP server
- lower-memory sample scheduling

Open an issue with the scenario you actually need.

---

## Credits and licence

- Code and schema documentation: [MIT](LICENSE)
- The three background guides under `references/source-guides/` were supplied by the toolkit's user; copyright remains with their authors and the MIT licence does not apply to them.
- Dependencies: Tone.js, Zod, Playwright and esbuild, each under its own licence.
- All built-in instruments and drum material are **procedurally generated**. No commercial game samples and no ripped assets.

<div align="center">
<br>
<sub>An 8-bit limit is not a drawback — it is the style. Using the limit well is arranging.</sub>
</div>
