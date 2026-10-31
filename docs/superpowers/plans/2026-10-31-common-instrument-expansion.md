# Common Instrument Expansion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; implement inline with TDD and one independent final review.

**Goal:** Ship common bass, clean/short guitar, piano and drum sounds selected from local material, with velocity layers and seed-controlled round robin.
**Architecture:** Add optional MIDI-velocity bounds and roundRobin indices to sample zones/drum slots; compile selections into event indices before rendering. Keep legacy defaults identical. Curate three self-contained packs separated by license. Existing four-instrument starter remains default.
**Tech Stack:** TypeScript, Zod, Tone.js, Node.js, ffmpeg. No new runtime dependencies.
**Spec:** User authorized expansion, requested common broadly usable instruments, and explicitly excluded material/ from the project.

## Constraints
- material/ and material-library/ ignored; never stage or delete their originals.
- Copy only curated derivative WAVs, licenses and source hashes into runtime/instruments/.
- Runtime never references material directories; regenerate scripts are optional authoring tools.
- Keep old sample maps, procedural presets, dry/wet/solo/crop/loop behavior compatible.
- Keep existing 4M-channel-frame score budget and import byte caps; import only instruments needed.

## Review Focus
- Actual velocity after clip scaling/humanization chooses layers; velocity zero does not advance RR.
- RR is compiled per track/sample group, repeats each loop, stable for solo/crops; do not use Math.random.
- Legato retains the preceding sample if still valid, otherwise rejects cross-layer/zone transition.
- Ambiguous overlapping layers/RR indices fail before rendering; missing drum sounds keep existing synthesized fallback.
- Preserve attribution for CC BY sources separately from CC0 and MIT; sources remain reproducible after deleting material.

## Tasks
- [x] Write failing tests for velocity selection, round-robin cycling, ambiguity, effective clip velocity, legato and drum variants.
- [x] Implement schemas, validation, compile-time indices, renderer selection and portable defaults.
- [x] Curate CC0 band pack, CC BY piano and CC BY drums using SFZ root metadata, retain relative paths/hashes/full licenses.
- [x] Add named bundled-pack CLI discovery/import while retaining starter default and local --definition.
- [x] Render standalone auditions and an arrangement with the new pack; expose online previews and source/report downloads.
- [x] Update schema, guide, licensing and skill entry. Run full unit/audio/web/schema/format/package checks.
- [x] Independent review, fixes, commit/push and verify deployment under standing authorization.

## Ledger
- Clean tracked baseline at ec43097; only user-provided source material was untracked. Both source directories now ignored.
- Work in existing checkout under standing instruction to proceed without questions.

- Verification: 107 unit tests, 28 real-audio tests, 2 web tests plus main/lab/gallery checks; 7 gallery MP3s played and source/master hashes verified. Runtime tarball contains 76 sample WAVs and zero material files.
- Review fix: export published JSON Schema in input mode, preserving optional defaulted fields for legacy scores. Added a RED→GREEN regression and re-review confirmed strict structural requirements remain.
- Material originals remain untouched and ignored. Added assets are self-contained, attributed derivative packs only.
