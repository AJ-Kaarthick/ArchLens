import type { IEmbeddingProvider } from './embedding.interface.js';

export class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'mock-embedding';
  readonly dimension = 768;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.generateVector(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.generateVector(text);
  }

  /**
   * Generates a deterministic, L2-normalized 768-dimensional vector from input text.
   * Uses token hashing into dimensional buckets so that texts with overlapping terms
   * have mathematically meaningful, positive cosine similarities.
   */
  private generateVector(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      // Return a fixed sparse non-zero vector for empty input to avoid zero-division
      vector[0] = 1.0;
      return vector;
    }

    // Accumulate weighted token frequency into hashed buckets
    for (const token of tokens) {
      const bucket = this.hashToken(token) % this.dimension;
      const weight = 1 + Math.log(token.length);
      vector[bucket] += weight;

      // Also hash character bigrams for subword similarity
      for (let i = 0; i < token.length - 1; i++) {
        const bigram = token.slice(i, i + 2);
        const subBucket = this.hashToken(bigram) % this.dimension;
        vector[subBucket] += 0.3;
      }
    }

    // L2 normalization (unit length)
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vector[i] * vector[i];
    }

    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] = Number((vector[i] / norm).toFixed(6));
      }
    } else {
      vector[0] = 1.0;
    }

    return vector;
  }

  /**
   * 32-bit FNV-1a hash function
   */
  private hashToken(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }
}
