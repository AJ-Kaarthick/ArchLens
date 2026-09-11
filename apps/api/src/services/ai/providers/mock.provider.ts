import type {
  AIExplanationRequest,
  AIExplanationResult,
  IAIProvider,
} from '../provider.interface.js';
import type { AnalysisResult, EvidenceCitation } from '@archlens/shared';
import { EvidenceValidator } from '../evidence-validator.js';

export class MockAIProvider implements IAIProvider {
  readonly name = 'mock';
  readonly model = 'mock-heuristic-v1';

  async explain(request: AIExplanationRequest): Promise<AIExplanationResult> {
    const { topic, repoName, target, analysis } = request;

    // If analysis is provided, dynamically construct grounded responses from real facts
    if (analysis) {
      return this.explainFromAnalysis(repoName, topic, target, analysis);
    }

    // Fallback if analysis is omitted in minimal tests
    return this.explainFallback(repoName, topic, target);
  }

  private explainFromAnalysis(
    repoName: string,
    topic: string,
    target: string | null | undefined,
    analysis: AnalysisResult
  ): AIExplanationResult {
    const lang = analysis.repository.primaryLanguage || 'Multi-language';
    const isMonorepo = analysis.architecture.isMonorepo;
    const tool = analysis.architecture.monorepoTool;
    const workspaces = analysis.architecture.workspaces;
    const entrypoints = analysis.architecture.primaryEntrypoints;
    const patterns = analysis.architecture.detectedPatterns;
    const techStack = analysis.techStack;
    const metrics = analysis.metrics;

    const topTechNames = techStack.slice(0, 4).map((t) => t.name);
    const techSummaryStr =
      topTechNames.length > 0 ? topTechNames.join(', ') : 'standard platform libraries';
    const patternStr = patterns.length > 0 ? patterns.join(', ') : 'Modular organization';

    const baseEvidence = EvidenceValidator.synthesizeGroundedCitations(analysis);

    switch (topic) {
      case 'overview': {
        const topLanguages = Object.entries(metrics.languages)
          .sort((a, b) => b[1].percentage - a[1].percentage)
          .slice(0, 3)
          .map(([l, s]) => `${l} (${s.percentage}%)`)
          .join(', ');

        return {
          summary: `${repoName} is a ${lang}-based repository comprising ${metrics.totalFiles} files, organized as a ${isMonorepo ? 'monorepo workspace' : 'single repository'}.`,
          explanation: `### Repository Overview & Scale\n\n${repoName} is primarily developed in **${lang}** and comprises **${metrics.totalFiles} files** totaling **${Math.round(metrics.totalBytes / 1024)} KB**.\n\n### Architectural Layout\n\nThe repository is structured as a **${isMonorepo ? `monorepo managed with ${tool || 'workspaces'}` : 'standard single package'}**${workspaces.length > 0 ? ` containing ${workspaces.length} declared packages (${workspaces.slice(0, 3).join(', ')})` : ''}.\n\n### Language Breakdown\n\nDominant languages verified from file contents: ${topLanguages || lang}.\n\n*Note: Generated deterministically by ArchLens Mock Heuristics based on verified repository facts.*`,
          keyTakeaways: [
            `Primary language: ${lang} (${topLanguages || '100%'}).`,
            `Structure: ${isMonorepo ? `Monorepo with ${workspaces.length} workspaces` : 'Single repository layout'}.`,
            `Scale: ${metrics.totalFiles} total files indexed.`,
          ],
          evidence: baseEvidence,
          provider: this.name,
          model: this.model,
        };
      }

      case 'architecture': {
        return {
          summary: `${repoName} implements ${patternStr} with ${isMonorepo ? `${workspaces.length} declared workspace boundaries` : 'centralized source directories'}.`,
          explanation: `### Architectural Patterns\n\nVerified architectural patterns for this repository:\n\n${patterns.map((p) => `- **${p}:** Structural organization identified across repository directories.`).join('\n') || '- **Modular Structure:** Codebase partitioned into functional directories.'}\n\n### Workspace & Component Boundaries\n\n${isMonorepo ? `Monorepo tooling: **${tool || 'Standard workspaces'}** managing packages:\n${workspaces.map((w) => `  - \`${w}\``).join('\n')}` : `Single project structure with entrypoints rooted in \`${entrypoints[0] || 'repository root'}\`.`}${target ? `\n\n### Target Focus: ${target}\nTarget analysis shows dedicated modular boundaries with localized configuration.` : ''}\n\n*Note: Generated deterministically by ArchLens Mock Heuristics based on verified repository facts.*`,
          keyTakeaways: [
            `Architecture: ${patternStr}.`,
            `Boundaries: ${isMonorepo ? `${workspaces.length} workspace modules` : 'Single project layout'}.`,
            `Primary startup: ${entrypoints[0] || 'Standard entrypoint'}.`,
          ],
          evidence: baseEvidence.filter(
            (e) => e.type === 'pattern' || e.type === 'entrypoint' || e.type === 'manifest'
          ),
          provider: this.name,
          model: this.model,
        };
      }

      case 'tech-stack': {
        return {
          summary: `${repoName} utilizes a ${lang} ecosystem stack featuring ${techSummaryStr}.`,
          explanation: `### Core Runtimes & Frameworks\n\nVerified technologies detected from repository manifests:\n\n${techStack.map((t) => `- **${t.name}** (${t.category}${t.version ? ` v${t.version}` : ''}): Detected from \`${t.evidence}\` with ${t.confidence} confidence.`).join('\n') || `- **${lang}:** Native runtime and standard libraries.`}\n\n### Tooling Integration\n\nConfiguration manifests coordinate compilation, dependencies, and execution across verified boundaries.\n\n*Note: Generated deterministically by ArchLens Mock Heuristics based on verified repository facts.*`,
          keyTakeaways: [
            `Primary ecosystem: ${lang}.`,
            `Key technologies: ${techSummaryStr}.`,
            `Manifest count: ${analysis.architecture.keyLandmarks.filter((l) => l.type === 'manifest').length} configuration manifests.`,
          ],
          evidence: baseEvidence.filter(
            (e) => e.type === 'dependency' || e.type === 'manifest' || e.type === 'metric'
          ),
          provider: this.name,
          model: this.model,
        };
      }

      case 'entrypoints': {
        return {
          summary: `Runtime execution in ${repoName} initiates through ${entrypoints[0] || 'standard manifest entrypoints'}.`,
          explanation: `### System Entrypoints & Bootstrapping\n\nVerified startup files identified in repository structure:\n\n${entrypoints.map((ep) => `- **${ep}:** Primary execution or bootstrap entrypoint.`).join('\n') || '- **Root Manifest:** Primary package entrypoint declared in root configuration.'}\n\n### Key Landmark Configuration\n\n${analysis.architecture.keyLandmarks.map((lm) => `- \`${lm.path}\`: ${lm.description || lm.type}`).join('\n') || '- No specific landmarks detected.'}${target ? `\n\n### Target Entry: ${target}\nTarget-specific execution path verified.` : ''}\n\n*Note: Generated deterministically by ArchLens Mock Heuristics based on verified repository facts.*`,
          keyTakeaways: [
            `Primary entrypoint: ${entrypoints[0] || 'Declared in root manifest'}.`,
            `Landmarks: ${analysis.architecture.keyLandmarks.length} landmark navigation points.`,
            `Execution model: Deterministic startup verified from repository structure.`,
          ],
          evidence: baseEvidence.filter(
            (e) => e.type === 'entrypoint' || e.type === 'manifest' || e.type === 'file'
          ),
          provider: this.name,
          model: this.model,
        };
      }

      default: {
        return {
          summary: `Deterministic analysis for ${repoName}.`,
          explanation: `Grounded heuristic analysis generated for topic "${topic}".`,
          keyTakeaways: [`Verified ${lang} repository facts.`],
          evidence: baseEvidence,
          provider: this.name,
          model: this.model,
        };
      }
    }
  }

  private explainFallback(
    repoName: string,
    topic: string,
    target?: string | null
  ): AIExplanationResult {
    const citations: EvidenceCitation[] = [
      {
        type: 'file',
        label: 'Repository Root',
        reference: 'README.md',
        description: 'Verified repository documentation landmark.',
      },
      {
        type: 'manifest',
        label: 'Project Manifest',
        reference: 'package.json',
        description: 'Default project manifest landmark.',
      },
    ];

    return {
      summary: `Deterministic overview for ${repoName}.`,
      explanation: `### Repository Overview\n\nDeterministic analysis performed for ${repoName} under topic "${topic}".${target ? ` Target: ${target}` : ''}\n\n*Note: Generated deterministically by ArchLens Mock Heuristics.*`,
      keyTakeaways: [
        `Grounded analysis for ${repoName}.`,
        `Topic: ${topic}.`,
        `Deterministic heuristic mode active.`,
      ],
      evidence: citations,
      provider: this.name,
      model: this.model,
    };
  }
}
