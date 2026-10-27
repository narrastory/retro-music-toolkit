import { z } from "zod";
export const NormalizationSchema = z.strictObject({
  targetRmsDbfs: z.number().min(-48).max(-6).default(-24),
  peakCeilingDbfs: z.number().min(-12).max(-0.1).default(-3),
  maxBoostDb: z.number().min(0).max(24).default(18),
});
export const RenderOptionsSchema = z.strictObject({
  fromBeat: z.number().min(0).optional(),
  toBeat: z.number().positive().optional(),
  solo: z.array(z.string().min(1)).min(1).optional(),
  mode: z.enum(["one-shot", "loop"]).optional(),
  seam: z.boolean().optional(),
  effects: z.enum(["mix", "dry", "wet"]).optional(),
  normalization: NormalizationSchema.optional(),
  loopDiagnostics: z.boolean().optional(),
  /** Equal-power crossfade over the loop boundary, in beats. 0 disables. */
  loopCrossfadeBeats: z.number().min(0).max(2).optional(),
  /** Override the score's export.dither flag. */
  dither: z.boolean().optional(),
  /** Override the score's limiter settings; false disables. */
  limiter: z
    .union([
      z.literal(false),
      z.strictObject({
        ceilingDbfs: z.number().min(-12).max(-0.1).default(-1),
        lookaheadSeconds: z.number().min(0.001).max(0.02).default(0.005),
      }),
    ])
    .optional(),
});
export type RenderOptions = z.input<typeof RenderOptionsSchema>;
