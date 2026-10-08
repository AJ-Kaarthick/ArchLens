import type { AnalysisResult, EvidenceCitation } from '@archlens/shared';

export interface EvidenceValidationReport {
  verified: EvidenceCitation[];
  discarded: EvidenceCitation[];
  totalProvided: number;
  validCount: number;
  invalidCount: number;
}

/**
 * Canonical string helper for resilient casing/delimiter normalization.
 * e.g. "Drizzle ORM" -> "drizzleorm", "fast-api" -> "fastapi", "drizzle_orm" -> "drizzleorm"
 */
function toCanonical(str: string): string {
  return str.toLowerCase().replace(/[-_\s.]+/g, '');
}

/**
 * Normalizes file paths: removes leading/trailing slashes, relative dots, and converts backslashes.
 */
function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+$/, '');
}

export class EvidenceValidator {
  /**
   * Deterministically validates an array of AI citations against Phase 2 analysis facts.
   * Only factual, verified citations are retained.
   * Fabricated or ungrounded citations are strictly discarded.
   * Never silently synthesizes citations to fill a list.
   */
  static validate(citations: EvidenceCitation[], analysis: AnalysisResult): EvidenceCitation[] {
    const report = EvidenceValidator.validateDetailed(citations, analysis);
    return report.verified;
  }

  /**
   * Performs a comprehensive audit of model citations with full accounting of valid vs discarded items.
   */
  static validateDetailed(
    citations: EvidenceCitation[],
    analysis: AnalysisResult
  ): EvidenceValidationReport {
    const verified: EvidenceCitation[] = [];
    const discarded: EvidenceCitation[] = [];

    // Pre-calculate lookup sets from Phase 2 facts
    const treePaths = new Set(analysis.tree.map((t) => normalizePath(t.path).toLowerCase()));
    const landmarkPaths = new Set(
      analysis.architecture.keyLandmarks.map((l) => normalizePath(l.path).toLowerCase())
    );
    const entrypointPaths = new Set(
      analysis.architecture.primaryEntrypoints.map((e) => normalizePath(e).toLowerCase())
    );
    const workspacePaths = new Set(
      analysis.architecture.workspaces.map((w) => normalizePath(w).toLowerCase())
    );

    // Pre-index tech stack names and canonical names
    const techItems = analysis.techStack.map((t) => ({
      name: t.name,
      lowerName: t.name.toLowerCase(),
      canonicalName: toCanonical(t.name),
      evidence: t.evidence.toLowerCase(),
    }));

    // Pre-index detected architecture patterns
    const patternCanonicals = new Set(
      analysis.architecture.detectedPatterns.map((p) => toCanonical(p))
    );
    if (analysis.architecture.isMonorepo) {
      patternCanonicals.add('monorepo');
      patternCanonicals.add('monorepoarchitecture');
      if (analysis.architecture.monorepoTool) {
        patternCanonicals.add(toCanonical(analysis.architecture.monorepoTool));
      }
    }

    const facts = {
      treePaths,
      landmarkPaths,
      entrypointPaths,
      workspacePaths,
      techItems,
      patternCanonicals,
      analysis,
    };

    for (const citation of citations) {
      if (EvidenceValidator.isCitationVerified(citation, facts)) {
        verified.push(citation);
      } else {
        discarded.push(citation);
      }
    }

    return {
      verified,
      discarded,
      totalProvided: citations.length,
      validCount: verified.length,
      invalidCount: discarded.length,
    };
  }

  private static isCitationVerified(
    citation: EvidenceCitation,
    facts: {
      treePaths: Set<string>;
      landmarkPaths: Set<string>;
      entrypointPaths: Set<string>;
      workspacePaths: Set<string>;
      techItems: Array<{
        name: string;
        lowerName: string;
        canonicalName: string;
        evidence: string;
      }>;
      patternCanonicals: Set<string>;
      analysis: AnalysisResult;
    }
  ): boolean {
    const ref = citation.reference.trim();
    if (!ref) return false;

    // Disallow directory traversal
    if (ref.includes('..')) return false;

    switch (citation.type) {
      case 'file': {
        const norm = normalizePath(ref).toLowerCase();
        if (!norm) return false;
        // Must exist in file tree, key landmarks, or explicit workspaces
        return (
          facts.treePaths.has(norm) ||
          facts.landmarkPaths.has(norm) ||
          facts.workspacePaths.has(norm)
        );
      }

      case 'manifest': {
        const norm = normalizePath(ref).toLowerCase();
        if (!norm) return false;
        // Must exist in tree or landmarks
        const exists = facts.treePaths.has(norm) || facts.landmarkPaths.has(norm);
        if (!exists) return false;

        // Must actually be a manifest file or landmark manifest
        const isRecognizedManifest =
          /(^|\/)(package\.json|pnpm-workspace\.yaml|turbo\.json|cargo\.toml|go\.mod|go\.work|pyproject\.toml|requirements[a-z0-9_-]*\.txt|pom\.xml|build\.gradle(\.kts)?|composer\.json|gemfile|dockerfile|docker-compose(\.[a-z0-9]+)?\.ya?ml)$/i.test(
            norm
          );
        const isLandmarkManifest = facts.analysis.architecture.keyLandmarks.some(
          (l) => normalizePath(l.path).toLowerCase() === norm && l.type === 'manifest'
        );
        return isRecognizedManifest || isLandmarkManifest;
      }

      case 'entrypoint': {
        const norm = normalizePath(ref).toLowerCase();
        if (!norm) return false;
        // Must be in verified primary entrypoints
        return (
          facts.entrypointPaths.has(norm) ||
          facts.analysis.architecture.keyLandmarks.some(
            (l) => normalizePath(l.path).toLowerCase() === norm && l.type === 'entry'
          )
        );
      }

      case 'dependency': {
        // Strip versions, brackets, and version constraints: e.g. "Flask 3.0.0", "fastify@^4.26", "react (18.2)"
        const baseCandidate = ref.split(/[@\s(:~><=^]/)[0].trim();
        if (!baseCandidate) return false;
        const candidateCanonical = toCanonical(baseCandidate);

        // Strict exact canonical matching: no substring inclusions!
        for (const tech of facts.techItems) {
          if (candidateCanonical === tech.canonicalName) {
            return true;
          }
          // Also check if candidate matches exact package declared in evidence e.g. "fastify" in "... -> fastify (^4.26)"
          const arrowIdx = tech.evidence.indexOf('->');
          if (arrowIdx !== -1) {
            const depPart = tech.evidence.substring(arrowIdx + 2).trim();
            const depName = depPart.split(/[\s(]/)[0].trim();
            if (candidateCanonical === toCanonical(depName)) {
              return true;
            }
          }
        }
        return false;
      }

      case 'metric': {
        // Must strictly correlate with analysis.metrics
        const lowerRef = ref.toLowerCase();
        const metrics = facts.analysis.metrics;

        // 1. Check against detected programming languages
        for (const [langName, langMetric] of Object.entries(metrics.languages)) {
          const langLower = langName.toLowerCase();
          if (lowerRef.includes(langLower)) {
            // If reference claims a percentage (e.g. "Python (95.8%)" or "Python 95.8%"), verify percentage within ±2.5%
            const pctMatch = lowerRef.match(/(\d+(?:\.\d+)?)\s*%/);
            if (pctMatch) {
              const claimedPct = parseFloat(pctMatch[1]);
              return Math.abs(claimedPct - langMetric.percentage) <= 2.5;
            }

            // If reference claims a file count (e.g. "40 files"), verify count within ±2
            const countMatch = lowerRef.match(/(\d+)\s*files?/);
            if (countMatch) {
              const claimedCount = parseInt(countMatch[1], 10);
              return Math.abs(claimedCount - langMetric.fileCount) <= 2;
            }

            // Reference mentions language dominance without invalid numbers
            return true;
          }
        }

        // 2. Check total files metric: e.g. "45 files", "total files: 45", "45 total files"
        const totalFilesMatch = lowerRef.match(/(\d[\d,]*)\s*(?:total\s*)?files?/);
        if (totalFilesMatch) {
          const claimedTotal = parseInt(totalFilesMatch[1].replace(/,/g, ''), 10);
          return Math.abs(claimedTotal - metrics.totalFiles) <= Math.max(2, metrics.totalFiles * 0.05);
        }

        // 3. Check total bytes metric: e.g. "120,000 bytes", "120000 bytes"
        const totalBytesMatch = lowerRef.match(/(\d[\d,]*)\s*bytes?/);
        if (totalBytesMatch) {
          const claimedBytes = parseInt(totalBytesMatch[1].replace(/,/g, ''), 10);
          return Math.abs(claimedBytes - metrics.totalBytes) <= Math.max(100, metrics.totalBytes * 0.05);
        }

        return false;
      }

      case 'pattern': {
        // Must exactly match detected architecture pattern or monorepo tool
        const candidateCanonical = toCanonical(ref);
        return facts.patternCanonicals.has(candidateCanonical);
      }

      default:
        return false;
    }
  }

  /**
   * Generates grounded citations directly from verified Phase 2 analysis facts.
   * Intended for explicit ground-truth synthesis (e.g. mock provider or offline fallback).
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
