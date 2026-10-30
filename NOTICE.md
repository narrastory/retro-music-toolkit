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
scores authored for this repository. The instruments and drum sounds are
procedurally generated; no commercial game samples, no ripped assets and no
third-party recordings are included. You may reuse these renders freely.

## npm dependencies

`tone`, `zod`, `playwright` and `esbuild` are used under their own licences,
listed in `scripts/runtime/package-lock.json` and in each package's license
file under `node_modules/`.
