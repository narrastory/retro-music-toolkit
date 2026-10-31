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
instruments and drums. The three current showcase cues use sampled instruments
as well as original synthesis. No commercial game samples or ripped assets are
included. Reuse renders under their applicable source licenses. All three cues
use the credited CC BY 3.0 piano; After the Rain and Copper Sky also use the
CC BY 4.0 drums. Preserve the credits and modification notices below when
redistributing their WAV/MP3 renders or embedded scores.

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

## Common sampled instruments

The new `band`, `piano`, and `drums` directories under
`scripts/runtime/instruments/` contain curated derivatives of user-supplied
sample libraries. The original `material/` and `material-library/` folders are
ignored local archives and are not project files or runtime dependencies.

- **band (CC0-1.0):** Growlybass and Black And Green Guitars, Karoryfer Lecolds.
  Guitar recordings by Brian Wood. Source: https://www.karoryfer.com/
- **piano (CC BY 3.0):** Salamander Grand Piano V3 by Alexander Holm; retuned
  mapping by Markus Fiedler. Source distribution:
  https://archive.org/details/SalamanderGrandPianoV3
  License: https://creativecommons.org/licenses/by/3.0/
- **drums (CC BY 4.0):** Gogodze Phu Vol II by Karoryfer Lecolds, copyright 2018.
  Source: https://www.karoryfer.com/
  License: https://creativecommons.org/licenses/by/4.0/

Changes: selected representative root notes, velocity layers and RR takes;
leading-silence trim, mono 32 kHz PCM16 conversion, short edits with end fades,
and one shared gain per root note/drum sound. Original SFZ behavior is not fully
reproduced. Exact source paths, original/processed hashes and mappings are in
each pack's `SOURCES.json`; full supplied licenses and attribution notices are
included alongside the manifest.

Retain applicable attribution, license links and change notices when sharing
these samples, embedded score copies or derivative material. In particular,
`after-the-rain`, `lit-window` and `copper-sky` in `docs/audio/`
use the credited piano; the first and third also use the credited drums. These recordings are
not relicensed under the code's MIT license; no endorsement is implied.

## npm dependencies

`tone`, `zod`, `playwright` and `esbuild` are used under their own licences,
listed in `scripts/runtime/package-lock.json` and in each package's license
file under `node_modules/`.
