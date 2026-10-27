import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fixture } from "./helpers.js";
test("web file import, compilation, playback URL and WAV download", async () => {
  const browser = await chromium.launch({
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    ...(process.env.RETRO_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.RETRO_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const html = (await readFile("web/index.html", "utf8")).replace(
      /<script type="module" src="app.js"><\/script>/,
      "",
    );
    await page.setContent(html);
    await page.addScriptTag({ content: await readFile("web/app.js", "utf8") });
    await page.locator("#file").setInputFiles({
      name: "phrase.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture())),
    });
    await page.waitForFunction(() =>
      document
        .querySelector<HTMLTextAreaElement>("#score")!
        .value.includes("Test phrase"),
    );
    await page.locator("#diagnose").click();
    await page.waitForFunction(() =>
      document.querySelector("#status")!.textContent!.includes('"findings"'),
    );
    const findings = JSON.parse(await page.locator("#status").innerText());
    assert.ok(Array.isArray(findings.findings));
    await page.locator("#match").check();
    await page.locator("#render").click();
    await page.waitForFunction(() =>
      document.querySelector("#status")!.textContent!.includes('"frames"'),
    );
    const status = JSON.parse(await page.locator("#status").innerText());
    assert.equal(status.silent, false);
    assert.equal(status.frames, 88200);
    assert.ok(status.normalization);
    assert.ok(status.peakDbfs <= -3 + 0.0001);
    assert.match(
      (await page.locator("#audio").getAttribute("src")) ?? "",
      /^blob:/,
    );
    const download = page.waitForEvent("download");
    await page.locator("#download").click();
    assert.equal((await download).suggestedFilename(), "retro-music.wav");
  } finally {
    await browser.close();
  }
});
test("web renders embedded multi-zone samples without filesystem asset access", async () => {
  const browser = await chromium.launch({
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    ...(process.env.RETRO_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.RETRO_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage();
    const html = (await readFile("web/index.html", "utf8")).replace(
      /<script type="module" src="app.js"><\/script>/,
      "",
    );
    await page.setContent(html);
    await page.addScriptTag({ content: await readFile("web/app.js", "utf8") });
    const score = JSON.parse(
      await readFile("examples/v3-starfall-sample.json", "utf8"),
    );
    score.title = "Portable web sample";
    score.lengthBeats = 4;
    score.sections = [];
    score.harmony = [];
    score.tracks = [score.tracks[0]];
    delete score.tracks[0].automation;
    score.tracks[0].patterns = {
      a: {
        lengthBeats: 4,
        events: [
          { id: "portable", kind: "note", at: 0, pitch: "E5", duration: 2 },
        ],
      },
    };
    score.tracks[0].clips = [{ id: "portable-clip", pattern: "a", at: 0 }];
    await page.locator("#file").setInputFiles({
      name: "portable.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(score)),
    });
    await page.waitForFunction(() =>
      document
        .querySelector<HTMLTextAreaElement>("#score")!
        .value.includes("Portable web sample"),
    );
    await page.locator("#render").click();
    await page.waitForFunction(() =>
      document.querySelector("#status")!.textContent!.includes('"frames"'),
    );
    const report = JSON.parse(await page.locator("#status").innerText());
    assert.equal(report.silent, false);
    assert.equal(report.frames, 98000);
    assert.equal(report.nonFiniteSamples, 0);
  } finally {
    await browser.close();
  }
});
