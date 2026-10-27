import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChannels } from "../src/normalization.js";
import { cycleMetrics } from "../src/analysis.js";
import { createAuditionScore, AUDITION_IDS } from "../src/audition.js";
import { compileScore } from "../src/compiler.js";
test("RMS matching reaches requested target without mutating original", () => {
  const raw = new Float32Array(1000).fill(0.01);
  const r = normalizeChannels([raw], 44100, {
    targetRmsDbfs: -24,
    maxBoostDb: 24,
  });
  assert.ok(Math.abs(r.report.after.rmsDbfs! + 24) < 0.001);
  assert.equal(r.report.limitedBy, "target");
  assert.ok(Math.abs(raw[0]! - 0.01) < 1e-8);
});
test("peak ceiling constrains transient-heavy reference", () => {
  const raw = new Float32Array(1000);
  raw[0] = 0.9;
  const r = normalizeChannels([raw], 44100, { targetRmsDbfs: -12 });
  assert.equal(r.report.limitedBy, "peak-ceiling");
  assert.ok(r.report.after.peakDbfs! <= -3 + 0.00001);
});
test("silence, boost limit and invalid samples handled explicitly", () => {
  const r = normalizeChannels([new Float32Array(1000)], 44100);
  assert.equal(r.report.limitedBy, "silence");
  assert.equal(r.report.appliedGainDb, 0);
  assert.equal(
    normalizeChannels([new Float32Array(1000).fill(0.0001)], 44100, {
      maxBoostDb: 3,
    }).report.limitedBy,
    "max-boost",
  );
  assert.throws(() => normalizeChannels([new Float32Array([NaN])], 44100));
});
test("cycle metrics validate shapes and separate absolute/relative differences", () => {
  assert.equal(
    cycleMetrics([new Float32Array([1, -1])], [new Float32Array([1, -1])])
      .relativeDifference,
    0,
  );
  assert.throws(() =>
    cycleMetrics([new Float32Array(2)], [new Float32Array(1)]),
  );
});
test("every audition reference compiles with no voice conflicts", () => {
  for (const id of AUDITION_IDS) {
    const c = compileScore(createAuditionScore(id));
    assert.ok(c.events.length >= 12);
    assert.equal(c.diagnostics.filter((d) => d.severity === "error").length, 0);
  }
});
