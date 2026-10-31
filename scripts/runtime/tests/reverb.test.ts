import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreSchema } from "../src/model.js";
import { createReverbImpulse } from "../src/reverb.js";
import { patchScore } from "../src/patch.js";
import { fixture } from "./helpers.js";

test("reverb is opt-in, independently sent, validated and patchable", () => {
  const source = ScoreSchema.parse(fixture());
  assert.equal(source.mixer.reverb, undefined);
  assert.equal(source.tracks[0]!.reverbSend, 0);
  const updated = patchScore(source, {
    operations: [
      {
        op: "set-song",
        set: {
          mixer: {
            reverb: {
              enabled: true,
              decaySeconds: 1.2,
              preDelaySeconds: 0.025,
              damping: 0.6,
              returnDb: -8,
            },
          },
        },
      },
      { op: "set-track", trackId: "lead", set: { reverbSend: 0.3 } },
    ],
  });
  assert.equal(updated.mixer.reverb?.decaySeconds, 1.2);
  assert.equal(updated.tracks[0]!.reverbSend, 0.3);
  assert.equal(source.tracks[0]!.reverbSend, 0);
  assert.throws(() =>
    ScoreSchema.parse({ ...updated, mixer: { reverb: { decaySeconds: 20 } } }),
  );
  assert.throws(() =>
    ScoreSchema.parse({
      ...updated,
      tracks: [{ ...updated.tracks[0], reverbSend: 2 }],
    }),
  );
});
test("stereo impulse has exact pre-delay, deterministic independent channels and a decaying tail", () => {
  const config = { decaySeconds: 1, preDelaySeconds: 0.025, damping: 0.6 };
  const a = createReverbImpulse(8000, 42, config),
    b = createReverbImpulse(8000, 42, config);
  assert.equal(a[0].length, 8200);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a[0], a[1]);
  assert.notDeepEqual(a, createReverbImpulse(8000, 43, config));
  assert.ok(a[0].subarray(0, 200).every((v) => v === 0));
  const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0);
  assert.ok(Math.abs(energy(a[0]) - 1) < 0.001);
  assert.ok(
    energy(a[0].subarray(200, 2200)) > energy(a[0].subarray(6200)) * 100,
  );
  assert.ok(a.every((channel) => channel.every(Number.isFinite)));
});
