import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compileScore } from "../dist/compiler.js";
import { chromium } from "playwright";

test("showcase: media, exclusive playback, seeking, loop, prompts, CRT and responsive layout", async () => {
  const root = new URL("../../../docs/", import.meta.url);
  const mime = {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    css: "text/css",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    json: "application/json",
    wav: "audio/wav",
  };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      if (path.includes("..")) throw new Error("Invalid path");
      const body = await readFile(
        new URL(`.${path === "/" ? "/index.html" : path}`, root),
      );
      const headers = {
        "Content-Type":
          mime[path.split(".").pop()] ||
          (path === "/" ? mime.html : "application/octet-stream"),
        "Accept-Ranges": "bytes",
      };
      if (request.headers.range) {
        const [, from, to] = /bytes=(\d+)-(\d*)/.exec(request.headers.range);
        const start = Number(from),
          end = to ? Number(to) : body.length - 1;
        response.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${body.length}`,
          "Content-Length": end - start + 1,
        });
        response.end(body.subarray(start, end + 1));
      } else {
        response.writeHead(200, { ...headers, "Content-Length": body.length });
        response.end(body);
      }
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch(
      process.env.RETRO_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.RETRO_CHROMIUM_EXECUTABLE }
        : process.platform === "win32"
          ? { channel: "chrome" }
          : {},
    );
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().endsWith("favicon.ico"))
        errors.push(response.url());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".track").last().waitFor();
    assert.equal(await page.locator(".track").count(), 3);
    assert.equal(await page.locator(".track img").count(), 0);
    assert.equal(await page.locator(".prompt p").count(), 3);
    // Below-fold covers load lazily; bring each into view before checking it.
    for (const image of await page.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((image) => image.decode());
    }
    // Verify every published score, WAV and report link targets a real repository file.
    for (const href of await page
      .locator(".downloads a")
      .evaluateAll((links) => links.map((link) => link.href))) {
      const path = new URL(href).pathname;
      await readFile(new URL(`.${path}`, root));
    }
    for (let index = 0; index < 3; index++) {
      await page.locator(".play").nth(index).click();
      await page.waitForFunction((i) => {
        const media = [...document.querySelectorAll("audio")];
        return (
          media[i].currentTime > 0 &&
          media.filter((audio) => !audio.paused).length === 1
        );
      }, index);
    }
    await page.locator(".loop").last().click();
    assert.equal(
      await page
        .locator("audio")
        .last()
        .evaluate((audio) => audio.loop),
      true,
    );
    await page
      .locator(".seek")
      .last()
      .evaluate((input) => {
        input.value = 50;
        input.dispatchEvent(new Event("input"));
      });
    assert.ok(
      await page
        .locator("audio")
        .last()
        .evaluate((audio) => audio.currentTime > audio.duration * 0.45),
    );
    await page.locator(".play").last().click();
    assert.equal(
      await page
        .locator("audio")
        .last()
        .evaluate((audio) => audio.paused),
      true,
    );
    await page.locator(".copy").first().click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      await page.locator(".prompt p").first().textContent(),
    );
    await page.locator("#crt-toggle").click();
    await page.reload();
    await page.locator(".track").last().waitFor();
    assert.equal(
      await page.locator("#crt-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await page.locator(".track").last().waitFor();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow at ${width}px`,
      );
    }
    if (process.env.SHOWCASE_SCREENSHOT) {
      await page.locator("#crt-toggle").click();
      for (const image of await page.locator("img").all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((image) => image.decode());
      }
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: process.env.SHOWCASE_SCREENSHOT,
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: process.env.SHOWCASE_SCREENSHOT.replace(".png", "-mobile.png"),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    await page.goto(
      `http://127.0.0.1:${server.address().port}/instruments.html`,
    );
    await page.locator("#catalog .track").last().waitFor();
    assert.equal(await page.locator("audio").count(), 7);
    for (let index = 0; index < 7; index++) {
      await page
        .locator("audio")
        .nth(index)
        .evaluate((audio) => audio.play());
      await page.waitForFunction((i) => {
        const media = [...document.querySelectorAll("audio")];
        return (
          media[i].currentTime > 0 &&
          media.filter((a) => !a.paused).length === 1
        );
      }, index);
    }
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `instrument gallery overflow at ${width}px`,
      );
    }
    for (const href of await page
      .locator(".downloads a")
      .evaluateAll((links) => links.map((a) => a.href)))
      await readFile(new URL(`.${new URL(href).pathname}`, root));
    if (process.env.SHOWCASE_SCREENSHOT)
      await page.screenshot({
        path: process.env.SHOWCASE_SCREENSHOT.replace(
          ".png",
          "-instruments.png",
        ),
        fullPage: true,
      });
    assert.deepEqual(errors, []);
    await page.goto(`http://127.0.0.1:${server.address().port}/sound-lab.html`);
    assert.equal(await page.locator("audio").count(), 3);
    for (let index = 0; index < 3; index++) {
      await page
        .locator("audio")
        .nth(index)
        .evaluate((audio) => audio.play());
      await page.waitForFunction((i) => {
        const media = [...document.querySelectorAll("audio")];
        return (
          media[i].currentTime > 0 &&
          media.filter((a) => !a.paused).length === 1
        );
      }, index);
    }
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `sound lab overflow at ${width}px`,
      );
    }
    for (const href of await page
      .locator(".downloads a")
      .evaluateAll((links) => links.map((link) => link.href)))
      await readFile(new URL(`.${new URL(href).pathname}`, root));
    assert.deepEqual(errors, []);
    console.log(
      "All three new MP3s played; downloads resolved; desktop/mobile layouts checked.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("showcase: original scores and masters agree with render reports", async () => {
  const root = new URL("../../../docs/", import.meta.url);
  const tracks = JSON.parse(
    await readFile(new URL("music.json", root), "utf8"),
  );
  assert.equal(tracks.length, 3);
  const hashes = new Set();
  for (const track of tracks) {
    const source = await readFile(new URL(`scores/${track.id}.json`, root));
    const score = JSON.parse(source);
    const report = JSON.parse(
      await readFile(new URL(`reports/${track.id}.json`, root), "utf8"),
    );
    const wav = await readFile(new URL(`audio/${track.id}.wav`, root));
    const compiled = compileScore(score);
    assert.ok(compiled.events.length > 400);
    assert.equal(score.schemaVersion, "1.3");
    assert.equal(score.sections.length, 4);
    assert.equal(
      report.sourceHash,
      createHash("sha256").update(source).digest("hex"),
    );
    assert.equal(
      report.audioHash,
      createHash("sha256").update(wav).digest("hex"),
    );
    assert.equal(wav.byteLength, 44 + report.frames * 4);
    assert.equal(report.silent, false);
    assert.equal(report.nonFiniteSamples, 0);
    assert.equal(report.clippedSamples, 0);
    assert.ok(report.truePeakDbfs < -1);
    assert.equal(report.boundarySuspicious, false);
    assert.ok(Math.abs(report.durationSeconds - track.duration) < 0.001);
    assert.equal(report.frames, Math.round(track.duration * report.sampleRate));
    hashes.add(report.audioHash);
  }
  assert.equal(hashes.size, 3);
});
