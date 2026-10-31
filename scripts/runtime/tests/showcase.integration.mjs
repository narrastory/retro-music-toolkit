import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

test("showcase: media, exclusive playback, seeking, loop, prompts, CRT and responsive layout", async () => {
  const root = new URL("../../../docs/", import.meta.url);
  const mime = {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    css: "text/css",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
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
    assert.equal(await page.locator(".track").count(), 4);
    assert.equal(await page.locator(".prompt p").count(), 4);
    // Below-fold covers load lazily; bring each into view before checking it.
    for (const image of await page.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((image) => image.decode());
    }
    // Verify every published score, WAV and report link targets a real repository file.
    for (const href of await page
      .locator(".downloads a")
      .evaluateAll((links) => links.map((link) => link.href))) {
      const path = href.split("/main/")[1];
      assert.ok(path);
      await readFile(new URL(`../../../${path}`, import.meta.url));
    }
    for (let index = 0; index < 4; index++) {
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
    assert.equal(
      await page.locator("#crt-toggle").getAttribute("aria-pressed"),
      "false",
    );
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
      await page.locator('#crt-toggle').click();
      for (const image of await page.locator('img').all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(image => image.decode());
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: process.env.SHOWCASE_SCREENSHOT, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: process.env.SHOWCASE_SCREENSHOT.replace('.png', '-mobile.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(
      "All four MP3s played; downloads resolved; desktop/mobile layouts checked.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
