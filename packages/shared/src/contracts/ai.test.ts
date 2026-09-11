import { describe, it, expect } from 'vitest';
import {
  ExplainTopicSchema,
  ExplainRequestSchema,
  ExplainResponseSchema,
  EvidenceCitationSchema,
} from './ai.js';

describe('Shared AI Contracts', () => {
  describe('ExplainTopicSchema', () => {
    it('accepts valid topics', () => {
      expect(ExplainTopicSchema.parse('overview')).toBe('overview');
      expect(ExplainTopicSchema.parse('architecture')).toBe('architecture');
      expect(ExplainTopicSchema.parse('tech-stack')).toBe('tech-stack');
      expect(ExplainTopicSchema.parse('entrypoints')).toBe('entrypoints');
    });

    it('rejects invalid topics', () => {
      expect(() => ExplainTopicSchema.parse('chat')).toThrow();
      expect(() => ExplainTopicSchema.parse('arbitrary')).toThrow();
    });
  });

  describe('ExplainRequestSchema', () => {
    it('defaults topic to overview', () => {
      const parsed = ExplainRequestSchema.parse({});
      expect(parsed.topic).toBe('overview');
      expect(parsed.target).toBeUndefined();
    });

    it('parses explicit topic and target', () => {
      const parsed = ExplainRequestSchema.parse({
        topic: 'architecture',
        target: 'Monorepo Architecture',
      });
      expect(parsed.topic).toBe('architecture');
      expect(parsed.target).toBe('Monorepo Architecture');
    });

    it('rejects target longer than 200 characters', () => {
      expect(() =>
        ExplainRequestSchema.parse({
          topic: 'overview',
          target: 'a'.repeat(201),
        })
      ).toThrow();
    });
  });

  describe('EvidenceCitationSchema', () => {
    it('validates structured evidence citation', () => {
      const citation = {
        type: 'manifest',
        label: 'package.json',
        reference: 'package.json',
        description: 'Declares fastify dependency',
      };
      const parsed = EvidenceCitationSchema.parse(citation);
      expect(parsed.type).toBe('manifest');
      expect(parsed.reference).toBe('package.json');
    });
  });

  describe('ExplainResponseSchema', () => {
    it('validates a full explanation response', () => {
      const payload = {
        topic: 'overview',
        target: null,
        summary: 'This is a web server application.',
        explanation: '### Architecture\nDetailed explanation.',
        keyTakeaways: ['High performance', 'Modular plugins'],
        evidence: [
          {
            type: 'file',
            label: 'src/server.ts',
            reference: 'src/server.ts',
          },
        ],
        generatedAt: new Date().toISOString(),
        provider: 'mock',
        model: 'mock-v1',
        cached: false,
      };

      const parsed = ExplainResponseSchema.parse(payload);
      expect(parsed.topic).toBe('overview');
      expect(parsed.keyTakeaways).toHaveLength(2);
      expect(parsed.evidence[0].reference).toBe('src/server.ts');
    });
  });
});
