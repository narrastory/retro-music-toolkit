import { chromium } from "playwright";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { ScoreSchema } from "./model.js";
import { RenderOptionsSchema } from "./render-options.js";
import { compileScore } from "./compiler.js";
import type { RenderOptions, renderInBrowser } from "./browser-engine.js";
import type { Score } from "./model.js";
import { ENGINE_STRING, TOOLKIT_VERSION } from "./version.js";
export type RenderResult = Awaited<ReturnType<typeof renderInBrowser>>;
let bundle: Uint8Array | undefined;

/** Allow reusing a warm browser across sequential renders in one process. */
export type RendererSession = {
  close(): Promise<void>;
};

export async function renderScore(input: unknown, options: RenderOptions = {}) {
  options = RenderOptionsSchema.parse(options);
  const parsed = ScoreSchema.parse(input);
  // Render options describe the export, not the score: the compiled object is
  // re-used so `.score.json` reflects what was rendered without mutating input.
  const effective = structuredClone(parsed);
  if (options.mode) effective.export.mode = options.mode;
  if (options.loopDiagnostics && effective.export.mode !== "loop")
    throw new Error("Loop diagnostics require loop mode");
  const compiled = compileScore(effective);
  if (!bundle) {
    const result = await build({
      entryPoints: [
        fileURLToPath(new URL("../src/browser-engine.ts", import.meta.url)),
      ],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
    });
    bundle = result.outputFiles[0]!.contents;
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.RETRO_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.RETRO_CHROMIUM_EXECUTABLE }
        : {}),
      args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.goto("about:blank");
    await page.addScriptTag({ content: new TextDecoder().decode(bundle) });
    const evaluate = async (renderOptions: RenderOptions) => {
      try {
        return await Promise.race([
          page.evaluate(
            async ({ compiled, options }) =>
              (globalThis as any).retroRender(compiled, options),
            { compiled, options: renderOptions },
          ) as Promise<RenderResult>,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Render timed out after 120 seconds")),
              120000,
            );
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        timer = undefined;
      }
    };
    const data = await evaluate(options);
    let loopDiagnostics: null | {
      mix: RenderResult["analysis"];
      dry: RenderResult["analysis"];
      wet: RenderResult["analysis"];
      limitations: string;
    } = null;
    if (options.loopDiagnostics) {
      const base = {
        ...options,
        seam: false,
        normalization: undefined,
        loopDiagnostics: false,
      };
      const diagnosticRender = (effects: "mix" | "dry" | "wet") =>
        evaluate({ ...base, effects });
      const mixed =
        (options.effects && options.effects !== "mix") ||
        options.seam ||
        options.normalization
          ? await diagnosticRender("mix")
          : data;
      const dry = await diagnosticRender("dry"),
        wet = await diagnosticRender("wet");
      loopDiagnostics = {
        mix: mixed.analysis,
        dry: dry.analysis,
        wet: wet.analysis,
        limitations:
          "Dry/wet separation helps locate a difference; phase, envelope and effect state can contribute. These measurements do not prove an audible defect or seamless musical return.",
      };
    }
    return {
      wav: Buffer.from(data.wavBase64, "base64"),
      report: {
        ...data.analysis,
        render: data.render,
        diagnostics: compiled.diagnostics,
        title: compiled.score.title,
        engine: ENGINE_STRING,
        seed: compiled.score.seed,
        toolkitVersion: TOOLKIT_VERSION,
        schemaVersion: compiled.score.schemaVersion,
        loopDiagnostics,
      },
      score: compiled.score as Score,
    };
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close();
  }
}
