import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.js";
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
test("CLI discovers and imports bundled instruments from another working directory", async () => {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "instrument-packs", "--compact"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const pack = JSON.parse(r.stdout);
  assert.equal(pack.id, "starter");
  assert.equal(pack.instruments.length, 4);
  const dir = await mkdtemp(join(tmpdir(), "retro-cli-pack-"));
  try {
    const source = join(dir, "song.json"),
      out = join(dir, "portable.json");
    await writeFile(source, JSON.stringify(fixture()));
    const imported = spawnSync(
      process.execPath,
      [
        "--import",
        new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href,
        fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
        "import-pack",
        source,
        "--instrument",
        "starter-recorder",
        "--out",
        out,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(imported.status, 0, imported.stdout || imported.stderr);
    const portable = JSON.parse(await readFile(out, "utf8"));
    assert.deepEqual(
      portable.instrumentDefinitions.map((p: { id: string }) => p.id),
      ["starter-recorder"],
    );
    assert.equal(Object.keys(portable.sampleAssets).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI lists all common packs and rejects conflicting pack sources", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "instrument-packs", "--all", "--compact"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const packs = JSON.parse(result.stdout);
  assert.ok(packs.some((p: { id: string }) => p.id === "band"));
  const conflict = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "instrument-packs",
      "--pack",
      "band",
      "--definition",
      "custom.json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(conflict.status, 1);
  assert.match(conflict.stdout, /CONFLICTING_PACK_OPTIONS/);
});
