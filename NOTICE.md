# Third-party and non-MIT material

The MIT licence in [LICENSE](LICENSE) covers the toolkit's own code and its
documentation. It does **not** cover the following.

## Reference guides

The three guides under `references/source-guides/` were supplied by the
toolkit's user as background reading:

- `8bit_music_composition_guide_zh.md`
- `16bit_music_composition_guide_zh.md`
- `tonejs-8bit-16bit-guide.md`

Copyright remains with their original authors. Each file carries a header
stating this. Redistribution, excerpting or commercial use requires the
author's permission. They are included here as reading material and are not
relicensed by this repository.

## Generated audio

Everything in `assets/` and `docs/audio/` was produced by this toolkit from
scores authored for this repository. The original eleven presets use procedural
instruments and drums. Sound-lab recordings also use the CC0 samples below.
No commercial game samples or ripped assets are included. You may reuse these
renders freely.

## Starter sampled instruments (CC0)

`scripts/runtime/instruments/starter/` contains a compact curated selection of
recordings from the Versilian Community Sample Library (VCSL), by Versilian
Studios and contributors: https://github.com/sgossner/VCSL

Upstream commit: `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`.
These sample recordings are under CC0 1.0 Universal, not the toolkit's MIT
license. The full upstream license is preserved in that directory as
`LICENSE.txt`. `SOURCES.json` records upstream paths, original and processed
SHA-256 values, calibrated root notes and tuning offsets. The preparation script
trims/resamples the recordings into short mono PCM16 WAVs and calibrates peaks;
the pack is about 1.9 MB. Imported portable scores retain sample provenance.

## npm dependencies

`tone`, `zod`, `playwright` and `esbuild` are used under their own licences,
listed in `scripts/runtime/package-lock.json` and in each package's license
file under `node_modules/`.
