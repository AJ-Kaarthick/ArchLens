import { z } from 'zod';

export const ExecutionProfileSchema = z.enum(['node-script', 'static-web']);
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;

export const ExecutionStatusSchema = z.enum([
  'success',
  'failed',
  'timeout',
  'refused',
  'error',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const RefusalReasonSchema = z.enum([
  'unsupported_runtime',
  'missing_entrypoint',
  'unsafe_project',
  'exceeded_bounds',
  'timeout',
  'disabled',
]);
export type RefusalReason = z.infer<typeof RefusalReasonSchema>;

export const ExecutionRequestSchema = z.object({
  entrypoint: z.string().min(1).max(300).optional(),
  profile: ExecutionProfileSchema.optional(),
  args: z.array(z.string().max(100)).max(10).optional(),
  timeoutMs: z.number().int().min(500).max(10000).optional(),
  inlineCode: z.string().max(65536).optional(),
});
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

export const PreviewInfoSchema = z.object({
  type: z.enum(['static-html', 'console']),
  entrypoint: z.string(),
  previewUrl: z.string().optional(),
});
export type PreviewInfo = z.infer<typeof PreviewInfoSchema>;

export const ExecutionResultSchema = z.object({
  executionId: z.string(),
  status: ExecutionStatusSchema,
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  profile: ExecutionProfileSchema,
  refusalReason: RefusalReasonSchema.optional(),
  refusalMessage: z.string().optional(),
  preview: PreviewInfoSchema.optional(),
  timestamp: z.string(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const ExecutionEligibilitySchema = z.object({
  eligible: z.boolean(),
  recommendedProfile: ExecutionProfileSchema.nullable(),
  detectedEntrypoints: z.array(z.string()),
  supportedProfiles: z.array(ExecutionProfileSchema),
  refusalReason: RefusalReasonSchema.optional(),
  reasonMessage: z.string().optional(),
  warnings: z.array(z.string()).default([]),
});
export type ExecutionEligibility = z.infer<typeof ExecutionEligibilitySchema>;
