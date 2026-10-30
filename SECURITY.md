# Security Policy

## Reporting a vulnerability

This project runs entirely locally: it reads JSON scores, writes WAV files and
launches a headless Chromium for rendering. It makes no network calls.

If you find a vulnerability — a path traversal in file handling, a way to make
the renderer execute arbitrary code from a score, a denial of service in the
compiler — please report it privately via
[GitHub Security Advisories](https://github.com/narrastory/retro-music-toolkit/security/advisories/new)
rather than in a public issue.

Please include: the score or input that triggers it, the command you ran, and
the Node/OS versions. A minimal reproduction is far more useful than a
description.

## Scope

In scope:

- Crashes or hangs reachable from a crafted score or WAV file
- Memory exhaustion beyond the documented limits (100k events, 16M frames)
- Anything that causes writes outside the requested output path
- Escaping the `Tone.Offline` sandbox in the browser engine

Out of scope:

- Scores that produce bad music
- Resource limits being reached by legitimately large projects (documented)
- Issues that require modifying the source before running it

## Supported versions

Only the latest release on `main` receives fixes.
