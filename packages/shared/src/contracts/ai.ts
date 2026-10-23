import { z } from 'zod';

export const EvidenceTypeSchema = z.enum([
  'file',
  'manifest',
  'entrypoint',
  'dependency',
  'metric',
  'pattern',
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceCitationSchema = z.object({
  type: EvidenceTypeSchema,
  label: z.string(),
  reference: z.string(),
  description: z.string().optional(),
});
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;

export const ExplainTopicSchema = z.enum(['overview', 'architecture', 'tech-stack', 'entrypoints']);
export type ExplainTopic = z.infer<typeof ExplainTopicSchema>;

export const SafeTargetSchema = z
  .string()
  .trim()
  .max(200, 'Target parameter cannot exceed 200 characters')
  .refine(
    (val) => {
      for (let i = 0; i < val.length; i++) {
        const code = val.charCodeAt(i);
        if ((code >= 0 && code <= 31) || code === 127) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Target contains invalid control characters',
    }
  )
  .optional()
  .nullable();

export const PromptVersionSchema = z.number().int().min(1).max(5).default(1);

export const ExplainRequestSchema = z.object({
  topic: ExplainTopicSchema.default('overview'),
  target: SafeTargetSchema,
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export const InsightQuerySchema = z.object({
  target: SafeTargetSchema,
  promptVersion: z.coerce.number().int().min(1).max(5).default(1),
  forceRetry: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});
export type InsightQuery = z.infer<typeof InsightQuerySchema>;

export const InsightRetryBodySchema = z.object({
  target: SafeTargetSchema,
  promptVersion: z.number().int().min(1).max(5).default(1),
});
export type InsightRetryBody = z.infer<typeof InsightRetryBodySchema>;

export const ExplainResponseSchema = z.object({
  topic: ExplainTopicSchema,
  target: z.string().nullable(),
  summary: z.string(),
  explanation: z.string(),
  keyTakeaways: z.array(z.string()),
  evidence: z.array(EvidenceCitationSchema),
  generatedAt: z.string(),
  provider: z.string(),
  model: z.string(),
  cached: z.boolean().default(false),
});
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

export const AIExplanationResultSchema = z.object({
  summary: z.string().min(1),
  explanation: z.string().min(1),
  keyTakeaways: z.array(z.string()).min(1),
  evidence: z.array(EvidenceCitationSchema).default([]),
});
export type AIExplanationResultData = z.infer<typeof AIExplanationResultSchema>;

export const InsightStatusSchema = z.enum(['ready', 'pending', 'failed', 'disabled']);
export type InsightStatus = z.infer<typeof InsightStatusSchema>;

export const InsightResponseSchema = z.object({
  status: InsightStatusSchema,
  topic: ExplainTopicSchema,
  target: z.string().nullable().optional(),
  result: ExplainResponseSchema.nullable().optional(),
  retryAt: z.string().nullable().optional(),
  isStale: z.boolean().default(false),
  error: z
    .object({
      error: z.string(),
      message: z.string(),
      isRateLimit: z.boolean().default(false),
      suggestedAction: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  promptVersion: z.number().default(1),
});
export type InsightResponse = z.infer<typeof InsightResponseSchema>;
