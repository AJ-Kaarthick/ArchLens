import { z } from 'zod';

export const ServerCapabilitiesSchema = z.object({
  ai: z.boolean(),
  execution: z.boolean(),
  semanticIndex: z.boolean(),
});

export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;
