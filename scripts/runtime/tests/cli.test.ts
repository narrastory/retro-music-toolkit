import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("CLI accepts separated negative RMS arguments used in the documentation", () => {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "--match-rms", "-24", "--help"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Retro Music Toolkit \d+\.\d+\.\d+/);
});
test("CLI parse errors are structured JSON rather than unhandled stacks", () => {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "--not-a-real-option"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).error);
});
