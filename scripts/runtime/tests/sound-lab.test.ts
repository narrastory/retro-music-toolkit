import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compileScore } from "../src/compiler.js";
import { decodeWav } from "../src/wav.js";

test("published sound-lab versions preserve the same phrase and verified RMS-matched audio", async () => {
  const root = new URL("../../../docs/", import.meta.url);
  const musicalEvents: unknown[] = [];
  for (const id of ["legacy", "sampled", "reverb"]) {
    const text = await readFile(new URL(`scores/sound-lab-${id}.json`, root));
    const score = compileScore(JSON.parse(text.toString("utf8")));
    musicalEvents.push(
      score.events.map((e) => ({
        id: e.id,
        trackId: e.trackId,
        tick: e.tick,
        duration: e.durationTicks,
        midi: e.midi,
        velocity: e.velocity,
        sound: e.sound,
      })),
    );
    const report = JSON.parse(
      await readFile(new URL(`reports/sound-lab-${id}.json`, root), "utf8"),
    );
    const bytes = await readFile(new URL(`audio/sound-lab-${id}.wav`, root));
    const audio = decodeWav(bytes);
    assert.equal(
      report.sourceHash,
      createHash("sha256").update(text).digest("hex"),
    );
    assert.equal(
      report.audioHash,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(audio.channels[0]!.length, report.frames);
    assert.equal(report.clippedSamples, 0);
    assert.equal(report.nonFiniteSamples, 0);
    assert.equal(report.silent, false);
    assert.ok(Math.abs(report.rmsDbfs + 24) < 0.01);
    assert.equal(report.normalization.targetRmsDbfs, -24);
    assert.equal(
      score.score.tracks.some((t) => t.reverbSend > 0),
      id === "reverb",
    );
  }
  assert.deepEqual(musicalEvents[0], musicalEvents[1]);
  assert.deepEqual(musicalEvents[1], musicalEvents[2]);
});
