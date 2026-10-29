/**
 * `tsc` emits dist/cli.js without the executable bit, so the `bin` entry in
 * package.json would be unusable on macOS and Linux (`permission denied`).
 * Windows has no executable bit — npm writes a .cmd shim that calls node — so
 * this is a no-op there.
 */
import { chmod, access } from "node:fs/promises";

if (process.platform !== "win32") {
  try {
    await access("dist/cli.js");
    await chmod("dist/cli.js", 0o755);
  } catch (e) {
    console.error(`postbuild: could not mark dist/cli.js executable: ${e}`);
    process.exitCode = 1;
  }
}
