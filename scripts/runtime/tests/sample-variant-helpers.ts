import { encodeWav } from "../src/wav.js";
import { fixture } from "./helpers.js";
export function layeredFixture(drums = false): any {
  const s: any = fixture();
  s.schemaVersion = "1.3";
  s.tracks[0].instrument = "layered";
  const slots = [1, 2].flatMap((layer) =>
    [1, 2].map((rr) => ({
      assetId: `layer-${layer}-${rr}`,
      lowVelocity: layer === 1 ? 1 : 65,
      highVelocity: layer === 1 ? 64 : 127,
      roundRobin: rr,
    })),
  );
  s.instrumentDefinitions = [
    {
      id: "layered",
      engine: drums ? "drums" : "sample",
      role: drums ? "drums" : "melody",
      range: [48, 84],
      attack: 0.01,
      release: 0.02,
      description: "Layer test",
      ...(drums
        ? { drumKit: { slots: slots.map((z) => ({ ...z, sound: "snare" })) } }
        : {
            sample: {
              kind: "zones",
              zones: slots.map((z) => ({
                ...z,
                lowMidi: 48,
                highMidi: 84,
                rootMidi: 60,
              })),
            },
          }),
    },
  ];
  s.sampleAssets = Object.fromEntries(
    slots.map((z, i) => [
      z.assetId,
      {
        format: "wav-pcm16",
        provenance: "Original test tones",
        dataBase64: Buffer.from(
          encodeWav(
            [
              Float32Array.from(
                { length: 8000 },
                (_, j) =>
                  Math.sin((2 * Math.PI * (220 + i * 110) * j) / 8000) * 0.2,
              ),
            ],
            8000,
          ),
        ).toString("base64"),
      },
    ]),
  );
  s.tracks[0].patterns.a.events = Array.from({ length: 8 }, (_, i) => ({
    id: "repeat-" + i,
    at: i * 0.5,
    kind: drums ? "hit" : "note",
    ...(drums ? { sound: "snare" } : { pitch: "C4", duration: 0.25 }),
    velocity: i < 4 ? 0.4 : 0.8,
  }));
  return s;
}
