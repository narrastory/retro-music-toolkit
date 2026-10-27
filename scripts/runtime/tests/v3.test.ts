import { patchScore } from "../src/patch.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./helpers.js";
import { compileScore } from "../src/compiler.js";
import { INSTRUMENTS } from "../src/instruments.js";
import { performanceGroups, frequencyAt } from "../src/performance.js";
import {
  createArrangement,
  varyMotif,
  placeAnswers,
} from "../src/composition.js";
import { importInstrument } from "../src/instrument-pack.js";
import { encodeWav } from "../src/wav.js";
const custom = (engine = "pulse") => ({
  id: "custom-lead",
  engine,
  role: "melody",
  range: [48, 96],
  attack: 0.005,
  release: 0.04,
  description: "Custom original preset",
  synthesis: { pulseWidth: -0.3, sustain: 0.6 },
  velocityResponse: { filterOctaves: 2, fmIndexScale: 1 },
});
function legato() {
  const s: any = fixture();
  s.schemaVersion = "1.1";
  s.export.mode = "one-shot";
  s.tracks[0].patterns.a.events = [
    { id: "held", kind: "note", at: 0, pitch: "C5", duration: 1, gate: 1 },
    {
      id: "slide",
      kind: "note",
      at: 1,
      pitch: "G5",
      duration: 1,
      gate: 1,
      articulation: "legato",
      expression: { portamentoBeats: 0.25 },
    },
  ];
  return s;
}
test("built-in instrument JSON catalog preserves eleven IDs and explicit parameters", () => {
  assert.equal(INSTRUMENTS.length, 11);
  assert.equal(
    INSTRUMENTS.find((p) => p.id === "pulse-pluck")!.synthesis!.pulseWidth,
    -0.5,
  );
  assert.equal(
    INSTRUMENTS.find((p) => p.id === "sample-pluck")!.synthesis!.sustain,
    0.12,
  );
});
test("embedded custom synthesis definitions compile; reserved IDs are rejected", () => {
  const s: any = fixture();
  s.instrumentDefinitions = [custom()];
  s.tracks[0].instrument = "custom-lead";
  assert.equal(compileScore(s).events.length, 3);
  s.instrumentDefinitions[0].id = "pulse-lead-soft";
  assert.throws(() => compileScore(s));
});
test("custom sample definitions need assets and nonoverlapping zones", () => {
  const s: any = fixture();
  s.instrumentDefinitions = [
    {
      ...custom("sample"),
      sample: {
        kind: "zones",
        zones: [
          { lowMidi: 48, highMidi: 90, rootMidi: 60, assetId: "missing" },
        ],
      },
    },
  ];
  s.tracks[0].instrument = "custom-lead";
  assert.throws(() => compileScore(s));
  s.sampleAssets = {
    missing: {
      format: "wav-pcm16",
      provenance: "test",
      dataBase64: Buffer.from(
        encodeWav([new Float32Array(100)], 44100),
      ).toString("base64"),
    },
  };
  assert.equal(compileScore(s).events.length, 3);
  s.instrumentDefinitions[0].sample.zones.push({
    lowMidi: 70,
    highMidi: 95,
    rootMidi: 72,
    assetId: "missing",
  });
  assert.throws(() => compileScore(s));
});
test("legato links held notes without voice-steal and keeps one performance group", () => {
  const s = legato();
  s.tracks[0].voicePolicy = "error";
  const c = compileScore(s);
  assert.equal(c.events[0]!.legatoToId, c.events[1]!.id);
  assert.equal(performanceGroups(c.events).length, 1);
  assert.ok(!c.diagnostics.some((d) => d.code === "VOICE_STEAL"));
});
test("legato rejects missing predecessors, released notes and polyphony", () => {
  for (const change of [
    (s: any) => s.tracks[0].patterns.a.events.shift(),
    (s: any) => (s.tracks[0].patterns.a.events[0].gate = 0.5),
    (s: any) => (s.tracks[0].maxVoices = 2),
  ]) {
    const s = legato();
    change(s);
    assert.throws(() => compileScore(s));
  }
});
test("portamento uses a log-frequency glide and bends interpolate then reset", () => {
  const c = compileScore(legato()),
    e = c.events[1]!;
  const start = frequencyAt(e, 0, 0.5, 72),
    end = frequencyAt(e, 0.125, 0.5, 72);
  assert.ok(Math.abs(start - 523.251) < 0.1);
  assert.ok(Math.abs(end - 783.991) < 0.1);
  const bent = {
    ...e,
    expression: {
      pitchBendCents: [
        { offsetBeats: 0, value: 0 },
        { offsetBeats: 1, value: 1200 },
      ],
    },
    vibrato: undefined,
  };
  assert.ok(
    Math.abs(frequencyAt(bent, 0.5, 0.5) / frequencyAt(bent, 0, 0.5) - 2) <
      0.0001,
  );
  assert.equal(
    frequencyAt({ ...e, expression: undefined }, 0, 0.5),
    frequencyAt({ ...e, expression: undefined }, 0, 0.5, 60),
  );
});
test("invalid glide and bend curve positions fail before rendering", () => {
  const s = legato();
  s.tracks[0].patterns.a.events[1].expression.portamentoBeats = 2;
  assert.throws(() => compileScore(s));
  s.tracks[0].patterns.a.events[1].expression = {
    pitchBendCents: [
      { offsetBeats: 1, value: 0 },
      { offsetBeats: 0.5, value: 100 },
    ],
  };
  assert.throws(() => compileScore(s));
});
test("track automation requires unique lanes, ordered points and valid ranges", () => {
  const s: any = fixture();
  s.tracks[0].automation = [
    {
      parameter: "pan",
      points: [
        { at: 0, value: -1 },
        { at: 4, value: 1 },
      ],
    },
  ];
  assert.equal(compileScore(s).events.length, 3);
  s.tracks[0].automation[0].points[1].value = 2;
  assert.throws(() => compileScore(s));
  s.tracks[0].automation[0].points[1].value = 1;
  s.tracks[0].automation.push(s.tracks[0].automation[0]);
  assert.throws(() => compileScore(s));
});
test("arrangement produces a valid empty scaffold with shared theme patterns", () => {
  const r = createArrangement({
    form: "AABA",
    barsPerSection: 2,
    scene: "exploration",
  });
  assert.equal(r.score.lengthBeats, 32);
  assert.equal(
    r.score.tracks[0]!.clips[0]!.pattern,
    r.score.tracks[0]!.clips[1]!.pattern,
  );
  assert.equal(r.plan.kind, "empty-composition-scaffold");
  assert.equal(compileScore(r.score).events.length, 0);
  assert.equal(r.plan.sections[2]!.activeRoles.includes("arp"), false);
});
test("arrangement respects compound meter and rejects invalid forms", () => {
  assert.equal(
    createArrangement({ meter: [6, 8], barsPerSection: 2 }).score.lengthBeats,
    24,
  );
  assert.throws(() => createArrangement({ form: "XYZ" }));
});
test("ending variation changes one clip and preserves original opening and source", () => {
  const s: any = fixture();
  s.lengthBeats = 8;
  s.tracks[0].clips.push({ id: "second", pattern: "a", at: 4 });
  const r = varyMotif(s, {
    trackId: "lead",
    clipId: "second",
    newPattern: "answer",
    mode: "ending",
    fromBeat: 2,
    replacementEvents: [
      { id: "end", kind: "note", at: 2, pitch: "D5", duration: 0.5 },
    ],
  });
  assert.equal(r.score.tracks[0]!.clips[0]!.pattern, "a");
  assert.equal(r.score.tracks[0]!.clips[1]!.pattern, "answer");
  const notes = r.score.tracks[0]!.patterns.answer!.events;
  assert.equal(notes[0]!.at, 0);
  assert.equal((notes[0] as any).pitch, "C5");
  assert.equal((notes[2] as any).pitch, "D5");
  assert.equal(s.tracks[0].clips[1].pattern, "a");
});
test("variation enforces preserved regions and deletion selectors", () => {
  assert.throws(() =>
    varyMotif(fixture(), {
      trackId: "lead",
      clipId: "clip-a",
      newPattern: "v",
      mode: "ending",
      fromBeat: 2,
      replacementEvents: [
        { id: "bad", kind: "note", at: 0, pitch: "D5", duration: 0.5 },
      ],
    }),
  );
  assert.throws(() =>
    varyMotif(fixture(), {
      trackId: "lead",
      clipId: "clip-a",
      newPattern: "v",
      mode: "simplify",
      fromBeat: 1,
      removeEventIds: ["n1"],
    }),
  );
  const r = varyMotif(fixture(), {
    trackId: "lead",
    clipId: "clip-a",
    newPattern: "v",
    mode: "simplify",
    fromBeat: 1,
    removeEventIds: ["n2"],
  });
  assert.equal(r.score.tracks[0]!.patterns.v!.events.length, 2);
});
test("answer placement rejects crowded candidates and reports filtering", () => {
  const s: any = fixture();
  const answer = structuredClone(s.tracks[0]);
  answer.id = "answer";
  answer.role = "arp";
  answer.patterns = {};
  answer.clips = [];
  s.tracks.push(answer);
  const r = placeAnswers(s, {
    leadTrackId: "lead",
    leadClipId: "clip-a",
    answerTrackId: "answer",
    newPattern: "response",
    candidates: [
      { id: "busy", kind: "note", at: 0, pitch: "E4", duration: 0.125 },
      { id: "rest", kind: "note", at: 3, pitch: "E4", duration: 0.25 },
    ],
  });
  assert.deepEqual(r.report.acceptedCandidateIds, ["rest"]);
  assert.deepEqual(r.report.rejectedCandidateIds, ["busy"]);
  assert.equal(r.score.tracks[1]!.clips.length, 1);
});
test("answer placement checks other lead clips as well as the source pattern", () => {
  const s: any = fixture();
  s.tracks[0].patterns.overlay = {
    lengthBeats: 4,
    events: [
      { id: "cover-rest", kind: "note", at: 3, pitch: "C5", duration: 0.5 },
    ],
  };
  s.tracks[0].clips.push({ id: "overlay", pattern: "overlay", at: 0 });
  const answer = structuredClone(s.tracks[0]);
  answer.id = "answer";
  answer.role = "arp";
  answer.patterns = {};
  answer.clips = [];
  s.tracks.push(answer);
  assert.throws(
    () =>
      placeAnswers(s, {
        leadTrackId: "lead",
        leadClipId: "clip-a",
        answerTrackId: "answer",
        newPattern: "response",
        candidates: [
          {
            id: "not-a-rest",
            kind: "note",
            at: 3,
            pitch: "E4",
            duration: 0.25,
          },
        ],
      }),
    /NO_ANSWER_FITS/,
  );
});
test("local WAV packaging embeds portable PCM and records provenance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "retro-v3-"));
  try {
    await writeFile(
      join(dir, "sample.wav"),
      encodeWav([new Float32Array(256).fill(0.1)], 22050),
    );
    const result = await importInstrument(
      fixture(),
      {
        instrument: {
          ...custom("sample"),
          sample: {
            kind: "zones",
            zones: [
              {
                lowMidi: 48,
                highMidi: 96,
                rootMidi: 60,
                assetId: "asset",
                loopStartFrame: 0,
                loopEndFrame: 256,
              },
            ],
          },
        },
        assets: [
          {
            id: "asset",
            file: "sample.wav",
            provenance: "Original test sample",
          },
        ],
      },
      dir,
    );
    assert.equal(
      result.sampleAssets!.asset!.provenance,
      "Original test sample",
    );
    assert.equal(result.schemaVersion, "1.2");
    assert.ok(result.sampleAssets!.asset!.dataBase64.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rhythm scaling keeps bend and glide timing aligned with notes", () => {
  const s = legato();
  s.lengthBeats = 8;
  s.tracks[0].patterns.a.events[1].expression.pitchBendCents = [
    { offsetBeats: 0, value: 0 },
    { offsetBeats: 0.5, value: 50 },
  ];
  const r = patchScore(s, {
    operations: [
      { op: "scale-rhythm", trackId: "lead", pattern: "a", factor: 2 },
    ],
  });
  const e: any = r.tracks[0]!.patterns.a!.events[1];
  assert.equal(e.at, 2);
  assert.equal(e.expression.portamentoBeats, 0.5);
  assert.equal(e.expression.pitchBendCents[1].offsetBeats, 1);
});
