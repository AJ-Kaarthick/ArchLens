import { z } from 'zod';
import { FileCategorySchema } from './repository.js';

export const SearchQuerySchema = z.object({
  query: z
    .string()
    .min(2, 'Search query must be at least 2 characters')
    .max(300, 'Search query cannot exceed 300 characters')
    .transform((q) => q.trim()),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  pathPrefix: z.string().max(200).optional(),
  category: FileCategorySchema.optional(),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultItemSchema = z.object({
  filePath: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
  score: z.number().min(0).max(1),
  language: z.string().nullable(),
  category: FileCategorySchema,
});

export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(SearchResultItemSchema),
  totalMatches: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  fallback: z.boolean().default(false),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
