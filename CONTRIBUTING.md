# Contributing

Thanks for taking a look. This project is small and opinionated; the fastest
way to get a change merged is to keep it focused.

## Before you start

- **Bugs**: open an issue with a minimal score that reproduces it. A 10-line
  JSON file is worth more than a paragraph of description.
- **Feature ideas**: open an issue first. This toolkit deliberately refuses
  some features (see "What it does not do" in the README), and it is better to
  disagree before you write the code.
- **Sound changes**: describe what you measured, not only what you heard.
  "The pulse channel is ~12 dB too bright above 8 kHz" is actionable;
  "it sounds thin" is a starting point for a discussion, not a patch.

## Setup

```bash
cd scripts/runtime
npm ci
npm run browser:install   # only needed for rendering
npm run build
npm run test:all
```

Requires Node.js 22+. macOS, Linux and Windows are all supported and tested in
CI.

## Making a change

1. Branch from `main`.
2. If you change a schema field, run `npm run schema -- --force` and commit the
   regenerated `schema/score.schema.json`. A test fails if it drifts.
3. Add a test. Audio behaviour needs a real render test
   (`tests/*-audio.integration.ts`); structural behaviour belongs in
   `tests/*.test.ts`.
4. Run `npm run format` and `npm run test:all`.
5. Open a PR describing **what you measured or broke**, not just what you
   changed.

## Things this project will not accept

- Claims of bit-accurate chip emulation without hardware verification.
- Automatic composition that hides musical decisions from the user.
- Objective "quality scores" presented as aesthetic judgement.
- Bundled third-party game samples or ripped audio.
- Dependencies that add a network call to the rendering path.

## Licence

By contributing you agree your changes are licensed under the repository's MIT
licence. Do not paste code or audio you do not have the rights to.
