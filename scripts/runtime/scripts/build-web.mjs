import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

await build({
  entryPoints: ["src/web-app.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "web/app.js",
  minify: true,
});

// Ship the same minimal example the CLI prints, so the page works offline
// without the user hunting for a score file first.
const { execFile } = await import("node:child_process");
const example = await new Promise((resolve, reject) => {
  execFile(
    process.execPath,
    ["dist/cli.js", "example"],
    { maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => (err ? reject(err) : resolve(stdout)),
  );
});
await writeFile("web/example.json", example);
