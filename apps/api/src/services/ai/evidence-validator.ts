import type { AnalysisResult, EvidenceCitation } from '@archlens/shared';

export class EvidenceValidator {
  /**
   * Deterministically validates an array of AI citations against Phase 2 analysis facts.
   * Only factual, verified citations are retained.
   * If the model provided fabricated or empty citations, fallback grounded citations
   * are synthesized directly from verified Phase 2 facts.
   */
  static validate(citations: EvidenceCitation[], analysis: AnalysisResult): EvidenceCitation[] {
    const verified: EvidenceCitation[] = [];

    // Pre-calculate lookup sets from Phase 2 facts
    const treePaths = new Set(analysis.tree.map((t) => t.path.toLowerCase()));
    const treeFilenames = new Set(analysis.tree.map((t) => t.name.toLowerCase()));
    const landmarkPaths = new Set(
      analysis.architecture.keyLandmarks.map((l) => l.path.toLowerCase())
    );
    const entrypointPaths = new Set(
      analysis.architecture.primaryEntrypoints.map((e) => e.toLowerCase())
    );
    const techStackNames = new Set(analysis.techStack.map((t) => t.name.toLowerCase()));
    const languageNames = new Set(
      Object.keys(analysis.metrics.languages).map((l) => l.toLowerCase())
    );
    const patterns = new Set(analysis.architecture.detectedPatterns.map((p) => p.toLowerCase()));

    for (const citation of citations) {
      if (
        EvidenceValidator.isCitationVerified(citation, {
          treePaths,
          treeFilenames,
          landmarkPaths,
          entrypointPaths,
          techStackNames,
          languageNames,
          patterns,
          analysis,
        })
      ) {
        verified.push(citation);
      }
    }

    // If all citations were fabricated or none were provided, synthesize grounded fallback citations from real facts
    if (verified.length === 0) {
      return EvidenceValidator.synthesizeGroundedCitations(analysis);
    }

    return verified;
  }

  private static isCitationVerified(
    citation: EvidenceCitation,
    facts: {
      treePaths: Set<string>;
      treeFilenames: Set<string>;
      landmarkPaths: Set<string>;
      entrypointPaths: Set<string>;
      techStackNames: Set<string>;
      languageNames: Set<string>;
      patterns: Set<string>;
      analysis: AnalysisResult;
    }
  ): boolean {
    const ref = citation.reference.trim().replace(/^(\.\/|\/)/, '');
    const lowerRef = ref.toLowerCase();

    switch (citation.type) {
      case 'file':
      case 'manifest': {
        // Must exist in file tree, key landmarks, or workspaces
        if (
          facts.treePaths.has(lowerRef) ||
          facts.landmarkPaths.has(lowerRef) ||
          facts.treeFilenames.has(lowerRef) ||
          facts.analysis.architecture.workspaces.some((w) => w.toLowerCase() === lowerRef)
        ) {
          return true;
        }
        return false;
      }

      case 'entrypoint': {
        // Must be in primary entrypoints or exist as a file in the tree
        if (
          facts.entrypointPaths.has(lowerRef) ||
          facts.treePaths.has(lowerRef) ||
          facts.treeFilenames.has(lowerRef)
        ) {
          return true;
        }
        return false;
      }

      case 'dependency': {
        // Must match a detected framework, library, or build tool in techStack
        for (const techName of facts.techStackNames) {
          if (lowerRef === techName || lowerRef.includes(techName) || techName.includes(lowerRef)) {
            return true;
          }
        }
        return false;
      }

      case 'metric': {
        // Must mention a detected programming language or valid structural metric
        for (const lang of facts.languageNames) {
          if (lowerRef.includes(lang)) {
            return true;
          }
        }
        if (
          lowerRef.includes('file') ||
          lowerRef.includes('byte') ||
          lowerRef.includes('size') ||
          lowerRef.includes('metric')
        ) {
          return true;
        }
        return false;
      }

      case 'pattern': {
        // Must match detected architecture patterns, monorepo status, or tool
        for (const pattern of facts.patterns) {
          if (lowerRef.includes(pattern) || pattern.includes(lowerRef)) {
            return true;
          }
        }
        if (
          facts.analysis.architecture.isMonorepo &&
          (lowerRef.includes('monorepo') ||
            (facts.analysis.architecture.monorepoTool &&
              lowerRef.includes(facts.analysis.architecture.monorepoTool.toLowerCase())))
        ) {
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Generates grounded citations directly from verified Phase 2 analysis facts
   * when the model returns fabricated or empty citations.
   */
  static synthesizeGroundedCitations(analysis: AnalysisResult): EvidenceCitation[] {
    const citations: EvidenceCitation[] = [];

    // 1. Landmark or Root Manifest
    if (analysis.architecture.keyLandmarks.length > 0) {
      const lm = analysis.architecture.keyLandmarks[0];
      citations.push({
        type: lm.type === 'manifest' ? 'manifest' : 'file',
        label: lm.name,
        reference: lm.path,
        description: lm.description || 'Verified landmark file.',
      });
    }

    // 2. Primary Entrypoint
    if (analysis.architecture.primaryEntrypoints.length > 0) {
      const ep = analysis.architecture.primaryEntrypoints[0];
      citations.push({
        type: 'entrypoint',
        label: 'Primary Entrypoint',
        reference: ep,
        description: 'Verified system startup or entrypoint file.',
      });
    }

    // 3. Top Tech Stack Detection
    if (analysis.techStack.length > 0) {
      const tech = analysis.techStack[0];
      citations.push({
        type: 'dependency',
        label: tech.name,
        reference: tech.name,
        description: `Verified dependency detected in ${tech.evidence}.`,
      });
    }

    // 4. Primary Language Metric
    const topLang = Object.entries(analysis.metrics.languages).sort(
      (a, b) => b[1].percentage - a[1].percentage
    )[0];
    if (topLang) {
      citations.push({
        type: 'metric',
        label: `${topLang[0]} Dominance`,
        reference: `${topLang[0]} (${topLang[1].percentage}%)`,
        description: `Determined from structural byte analysis of the repository.`,
      });
    }

    // 5. Architectural Pattern
    if (analysis.architecture.detectedPatterns.length > 0) {
      const pattern = analysis.architecture.detectedPatterns[0];
      citations.push({
        type: 'pattern',
        label: 'Architectural Pattern',
        reference: pattern,
        description: 'Verified architectural pattern identified from file structure.',
      });
    } else if (analysis.architecture.isMonorepo) {
      citations.push({
        type: 'pattern',
        label: 'Monorepo Architecture',
        reference: analysis.architecture.monorepoTool || 'Monorepo',
        description: 'Multi-package workspace structure verified from configuration.',
      });
    }

    return citations;
  }
}
