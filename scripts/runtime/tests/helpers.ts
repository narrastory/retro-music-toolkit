export function fixture(
  instrument = "pulse-lead-soft",
  profile = "nes-inspired",
) {
  return {
    schemaVersion: "1.0",
    title: "Test phrase",
    profile,
    tempo: 120,
    meter: [4, 4],
    lengthBeats: 4,
    tracks: [
      {
        id: "lead",
        role: "melody",
        instrument,
        maxVoices: 1,
        voicePolicy: "cut",
        patterns: {
          a: {
            lengthBeats: 4,
            events: [
              { id: "n1", kind: "note", at: 0, pitch: "C5", duration: 0.5 },
              { id: "n2", kind: "note", at: 1, pitch: "E5", duration: 0.5 },
              { id: "n3", kind: "note", at: 2, pitch: "G5", duration: 0.5 },
            ],
          },
        },
        clips: [{ id: "clip-a", pattern: "a", at: 0 }],
      },
    ],
    export: { mode: "loop", warmupCycles: 2 },
  };
}
