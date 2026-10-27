---
name: retro-music
description: Compose, arrange, revise, validate and render original 8bit and 16bit game music using a TypeScript and Tone.js music compiler. Use for chiptune, NES-inspired pulse music, Genesis-inspired FM, SNES-inspired sample music, looping game soundtracks, symbolic JSON scores, harmony checking, motif development, WAV exports and targeted musical revisions.
---

# Retro Music Composer

Create an original, editable musical work, not just a WAV. Use the deterministic score compiler and renderer in `scripts/runtime`. Read only the references needed for the selected sound family.

## Resolve tools and references

- Resolve this skill's directory first. Run commands with `scripts/runtime` as the working directory; do not assume the user's current directory is the runtime.
- Read `references/quickstart.zh-CN.md` for installation, CLI and TypeScript usage.
- Read `references/score-format.zh-CN.md` before authoring scores or patches. Inspect `scripts/runtime/schema/score.schema.json` for exact field contracts.
- Read `references/composition-playbook.zh-CN.md` to plan and revise music.
- Read `references/v1.0-guide.zh-CN.md` for hold/tie, swing, humanize, key and harmony, motif operators, sampled drum kits, true-peak and loudness measurement, and the A/B export.
- Read `references/architecture.zh-CN.md` when changing the engine.
- Read `references/v0.2-guide.zh-CN.md` / `references/v0.3-guide.zh-CN.md` only for historical context on audition calibration, diagnostics, instrument packages and expression.
- Inspect `scripts/runtime/examples/` for valid full scores. Do not present a renamed example as a new composition.
- For deeper craft, read the corresponding guide in `references/source-guides/`. Search headings first; do not load all guides into every task.

## Bootstrap once

Use Node.js 22 or newer. In the runtime directory run `npm ci`, `npm run browser:install`, then `npm run build`. Do not reinstall if dependencies and the browser are already available. Use `RETRO_CHROMIUM_EXECUTABLE` only if a compatible local Chromium executable is known. Commands use the local browser; no music generation API or account is required.

The runtime version is 1.0.0. Write `schemaVersion: "1.2"` for new work; `"1.0"` and `"1.1"` scores remain accepted. Call `node dist/cli.js instruments` to inspect preset IDs, recommended ranges and sound descriptions. `node dist/cli.js example` prints a ~40-line minimal score — prefer it over a full example as a starting point. Commands return JSON, except help. Write compositions and exports into a task directory outside this installed skill; use absolute input/output paths when convenient.

If a browser cannot be installed (offline sandbox), `validate`, `compile`, `diagnose`, `patch`, `arrange`, `motif`, `harmonize` and `arpeggiate` still work; only `render` and `audition` need Chromium. Say so instead of silently skipping audio.

## Plan before entering notes

1. Infer scene, emotional intent, sound family, approximate duration and loop requirement from the user. Ask only for essential missing constraints; otherwise state reasonable defaults.
2. Choose `nes-inspired`, `genesis-inspired` or `snes-inspired`. These are stylistic profiles, not validated hardware emulators.
3. Decide the key and the chord progression **before** the melody. Write them into `key` and `harmony`; diagnostics and `harmonize` both read them.
4. Plan sections, a recurring motif, phrase breathing, harmony changes and voice roles. Choose one primary focus at a time.
5. Start with a 2–4 bar melody and bass sketch. All beat positions count quarter notes, starting at zero.

## Construct the work

- Author new JSON with `schemaVersion: "1.2"`. Include `key`, `harmony`, track roles, preset IDs, patterns and clips, plus section annotations.
- Give every track, section, clip and source event a globally unique stable ID. Pattern names are scoped to their track. Repeat clips to reuse a pattern without copying event IDs.
- Use note events for tonal instruments and hit events for drums. Use absent events for rests.
- **Cross-bar notes use `hold: true`.** A held note sustains to the next event on its track (or the pattern end). Without it, a note past the pattern boundary is an error; the diagnostic suggests the fix.
- **Crop a shared pattern instead of cloning it** with `clip.lengthBeats`.
- Distinguish nominal duration, gate and release. With `voicePolicy: "cut"` (the default) an overlapping release is reported as `RELEASE_CUT`/`RELEASE_OVERLAP`, not as a musical error.
- Drum hits are independent one-shots and do not consume voices; `maxVoices` is ignored on drum tracks.
- Use `swing` for shuffle feel and a small `humanize` for timing/velocity variation. Both are deterministic from `seed`.
- Render melody and bass first. Add drums and accompaniment only when they serve the scene and phrasing.
- Use sparse answer phrases, register separation, short percussion tails and shared space. Increase contrast through subtraction before adding layers.
- For sample strings, choose note lengths that allow their slower attack. FM here is a two-operator approximation. Do not claim exact YM2612, BRR or native ROM compatibility.

## Generate accompaniment from harmony

```bash
node dist/cli.js harmonize SCORE.json --config HARM.json --out WITH_HARMONY.json
node dist/cli.js arpeggiate SCORE.json --config ARP.json --out WITH_ARP.json
```

- `harmonize` reads `harmony` markers and writes a new track (or a clip). Styles: `close`, `open`, `drop2`, `root-position`. It refuses to run without chord markers.
- `arpeggiate` expands the notes already present in a pattern; it cannot invent extensions that are not there.
- Both output a report with counts and diagnostics. Neither is an aesthetic judgement.

## Develop the motif

```bash
node dist/cli.js motif SCORE.json --config MOTIF.json --out DEVELOPED.json
```

Operators: `transpose` (chromatic or diatonic in the declared key), `invert`, `retrograde`, `scaleDuration`, `scaleGate`, `velocityShape`, `ornament`. They apply only inside `[fromBeat, toBeat)` of one clip's pattern and never mutate the source pattern.

- Use `vary` for "keep the opening, replace the ending".
- Use `motif` for mechanical transformations: sequence, inversion, rhythmic augmentation.
- Check the report's `resultPitches`. Inversion and retrograde are not automatically idiomatic; audition them.

## Validate, render, review, revise

1. Run `node dist/cli.js validate SCORE.json`. Correct errors using their codes, event IDs and beat positions; `suggestion` often contains the exact repair value.
2. Run `node dist/cli.js diagnose SCORE.json`. With `harmony` present it also reports non-chord tones on strong beats, bass clashes, parallel fifths/octaves and unresolved leaps; with `key` present it reports out-of-key notes. Use `--rules RULES.json` to disable rules or change thresholds. Findings are prompts to audition, not correctness requirements.
3. Run `node dist/cli.js render SCORE.json --out preview.wav`. Use `--solo lead,bass` for focused inspection; use `--bars 9-16 --mode one-shot` for a section.
4. Inspect the returned report: `silent`, `nonFiniteSamples`, `clippedSamples`, `truePeakDbfs`, `loudnessLufs`, boundary metrics. Judge headroom by `truePeakDbfs`, not the sample peak.
5. If audio listening is supported, evaluate phrase identity, bass direction, focus, fatigue and return to the first phrase. If it is not, state that verification was structural and signal-level; do not claim to have listened.
6. Fix the most consequential problem first. Use `patch` for targeted changes; it returns a per-operation change log with paths and before/after values. Save to a new version; retain the original.
   - Use `clone-pattern-for-clip` before modifying one appearance of a shared motif.
   - Use `insert-events`, `delete-events`, `transpose-phrase`, `scale-rhythm`, `quantize`, `rename-pattern`, `delete-pattern`.
   - Use `duplicate-section` only when source clips fit within the source section and the destination interval is empty. Set `expandSong: true` to extend the song.
   - Operations are applied in order and compiled atomically; the original data survives any failure.
7. Re-render only the relevant range for iteration, then render the final whole work.

## Loop and export

- Use `export.mode: "loop"` for a full-song periodic buffer. The renderer warms up multiple cycles and crops an exact frame-length cycle.
- Use `--seam` to export the last four beats followed by the first four. Listen to the boundary, then test repeats in the target player.
- `--loop-crossfade BEATS` applies an equal-power crossfade at the boundary. It hides a click; it does not fix a phrase that does not close.
- `--dither` adds deterministic TPDF dither before PCM16 quantisation. Use it for quiet, long-tailed tracks.
- `--limiter -1` applies a look-ahead peak limiter. It is an export safety net, not mastering; keep it off unless a ceiling is required.
- Leave level normalisation off for final masters. Use `--match-rms -24` only for comparison copies, and report the applied gain.
- Render separate stems with `--solo TRACK_ID`.
- Deliver WAV, source score and `.report.json`. A render also saves the parsed score as `.score.json`. Keep version history and the source hash.
- To audition two versions at matched loudness, use `node dist/cli.js compare v1.wav v2.wav --out ab.wav`.

## Completion standard

Complete the user-requested musical scope, validate the source, render the final audio and report exactly what was checked. Include the source for future revisions. Never present an objective diagnostic score as proof of excellent music or describe an unheard render as auditioned. Preserve third-party material provenance; built-in procedural samples require no original-game assets.

## Audition before choosing presets

Run `node dist/cli.js audition --out AUDITION_DIR` to generate all 11 reference WAVs, a listening page, measured normalisation reports and an unreviewed listening form. Use `--instrument ID` for one preset. RMS matching is signal-level calibration, not human listening approval.

## Revise without inventing

- Use `articulation: "legato"` only on a monophonic track with a preceding held note. Gate must bridge the transition.
- Use per-note `pitchBendCents` for intentional bends and track automation for gainDb/pan/brightness/send.
- Use `answer SCORE --config OPTIONS` to filter candidate notes into real lead gaps; read both accepted and rejected IDs.
- Report honestly: `validate` passing means the score compiles, not that the music is good.
