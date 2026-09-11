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

export const ExplainRequestSchema = z.object({
  topic: ExplainTopicSchema.default('overview'),
  target: z.string().max(200).optional().nullable(),
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

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
