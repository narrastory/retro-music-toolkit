import { test } from "node:test";
import assert from "node:assert/strict";
import { layeredFixture } from "./sample-variant-helpers.js";
import { compileScore } from "../src/compiler.js";
import { renderScore } from "../src/renderer.js";
import { decodeWav, encodeWav } from "../src/wav.js";
function frequency(x: Float32Array, start: number, end: number) {
  let n = 0;
  for (let i = Math.round(start * 44100) + 1; i < end * 44100; i++)
    if (x[i - 1]! <= 0 && x[i]! > 0) n++;
  return n / (end - start);
}
for (const drums of [false, true])
  test(`real audio uses the compiled ${drums ? "drum" : "tonal"} layer and RR sample`, async () => {
    const s = layeredFixture(drums);
    if (drums)
      for (const [i, key] of Object.keys(s.sampleAssets).entries())
        s.sampleAssets[key].dataBase64 = Buffer.from(
          encodeWav(
            [
              Float32Array.from(
                { length: 800 },
                (_, j) =>
                  Math.sin((2 * Math.PI * (220 + i * 110) * j) / 8000) * 0.2,
              ),
            ],
            8000,
          ),
        ).toString("base64");
    const compiled = compileScore(s),
      result = await renderScore(s, { mode: "one-shot" }),
      audio = decodeWav(result.wav);
    for (const e of compiled.events) {
      const index = (drums ? e.sampleDrumSlotIndex : e.sampleZoneIndex)!;
      const start = (e.tick / 960) * 0.5;
      assert.ok(
        Math.abs(
          frequency(audio.channels[0]!, start + 0.025, start + 0.085) -
            (220 + index * 110),
        ) < 25,
        `wrong sample for ${e.id}`,
      );
    }
    assert.equal(result.report.clippedSamples, 0);
    assert.equal(result.report.nonFiniteSamples, 0);
    const cropped = decodeWav(
      (await renderScore(s, { mode: "one-shot", fromBeat: 0.5, toBeat: 1.5 }))
        .wav,
    );
    let error = 0;
    for (let i = 0; i < 8000; i++)
      error += (cropped.channels[0]![i]! - audio.channels[0]![i + 11025]!) ** 2;
    assert.ok(
      Math.sqrt(error / 8000) < 0.00001,
      "crop must retain full-score sample choices",
    );
  });
