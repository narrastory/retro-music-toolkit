# Sampled Instruments and Reverb Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task, with TDD and a final independent review.

**Goal:** Improve game-music timbre with a compact reusable CC0 starter pack and deterministic stereo reverb, retaining offline portable scores.
**Architecture:** Reuse embedded WAV zone playback. Add a manifest importer with file hashes and stable instrument IDs; ship a small curated WAV pack. Add opt-in seeded convolution reverb with independent per-track sends. Existing scores retain their current sound when new fields are absent.
**Tech Stack:** TypeScript, Zod, Tone.js/Web Audio, Node.js, Playwright, ffmpeg for offline asset preparation.
**Spec:** User approved the preceding recommendation and delegated implementation choices; work in the current project without further questions.

## Global Constraints
- Keep Node 22+, existing Schema 1.0–1.3 support, offline rendering, and PCM16 export.
- Avoid new runtime dependencies; samples must allow redistribution and include provenance.
- Do not download complete multi-GB libraries. Ship a curated small pack, not a high-end orchestral library.
- Keep base procedural presets; imported instruments use distinct IDs.

## Review Focus
- Invalid/missing/corrupt sample files fail atomically with useful errors.
- No file escape through pack-relative paths; reject duplicate IDs and hash mismatches.
- Dry/wet/solo/range/loop rendering remains meaningful with reverb.
- Old scores acquire no reverb by default; seeded impulse response is reproducible.
- Source samples retain root-note metadata, true asset provenance and complete redistribution license.

## Task 1: Local instrument collections
- [x] Add failing unit tests for a collection manifest, selection, corruption, path traversal, duplicates and input immutability.
- [x] Add `instrument-collection.ts`: schema, safe manifest reads and `importInstrumentCollection(input, manifest, baseDirectory, selection?)`, returning a compiled portable score.
- [x] Add CLI `instrument-packs` and `import-pack SCORE --definition MANIFEST --instrument ID --out NEW` plus public exports.
- [x] Curate four VCSL instruments with several root samples, retain upstream commit/license/hashes, and add reproducible fetch/preparation tooling.
- [x] Verify packaged assets and CLI import work from another working directory.

## Task 2: Opt-in deterministic reverb
- [x] Add failing schema, impulse response and actual-audio tests: audible tail, pre-delay, wet-only, dry unchanged, zero send silent, seeded repeatability and safe levels.
- [x] Add `ReverbSchema` under mixer and `reverbSend` under tracks (default zero).
- [x] Add seeded stereo damped impulse generation and a convolution return in `browser-engine.ts`; preserve all old routes.
- [x] Update patch support, JSON Schema and tests without broad engine refactoring.

## Task 3: Audible demonstration and delivery
- [x] Create an identical 8-bar phrase in three versions: legacy sounds/dry, sampled/dry, sampled/reverb. Render matched comparison copies, WAVs, sources and reports.
- [x] Update API/CLI/skill documentation, asset provenance claims and licensing notices.
- [x] Run type check, build, all unit tests, audio/web regression checks, schema drift and formatting checks.
- [x] Request fresh independent review, resolve substantive issues, then commit and publish per established user authorization.

## Execution ledger
- Baseline: 90 unit tests pass. Dependencies and local Chrome already present. Official VCSL tree available; selective downloads supported.
- Ruling: work in the existing clean checkout, respecting the user's standing instruction to proceed without further questions; no new worktree created.

- Review: resource-bound gap fixed with file-type/6 MB per-file/24 MB aggregate preflight and bounded reads. Added RED→GREEN regression tests.
- Evidence: full audio/web regression passed; final unit total 98, real-audio 26, web 2, plus main showcase/lab media and master checks. No subjective listening claim.
