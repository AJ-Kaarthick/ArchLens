import React, { useState } from 'react';
import {
  ARCHLENS_VERSION,
  type AnalysisResult,
  type LandmarkContent,
  type ApiError,
  type LandmarkInfo,
  type FileTreeItem,
} from '@archlens/shared';
import { RepoHeader } from './components/RepoHeader.tsx';
import { ArchitectureView } from './components/ArchitectureView.tsx';
import { TechStackView } from './components/TechStackView.tsx';
import { MetricsView } from './components/MetricsView.tsx';
import { FileTreeExplorer } from './components/FileTreeExplorer.tsx';
import { LandmarkViewer } from './components/LandmarkViewer.tsx';
import { AIInsightsView } from './components/AIInsightsView.tsx';
import { SemanticSearchView } from './components/SemanticSearchView.tsx';
import { ExecutionView } from './components/ExecutionView.tsx';
import {
  Layers,
  Cpu,
  BarChart3,
  FolderTree,
  Search,
  AlertCircle,
  Clock,
  Sparkles,
  Github,
  CheckCircle2,
  FileCode2,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { Button } from './components/ui/Button.tsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './components/ui/Card.tsx';

type TabId = 'overview' | 'ai' | 'search' | 'tech' | 'metrics' | 'tree' | 'execution';

interface PresetRepo {
  name: string;
  tag: string;
}

const PRESET_REPOSITORIES: PresetRepo[] = [
  { name: 'fastify/fastify', tag: 'TypeScript' },
  { name: 'facebook/react', tag: 'JavaScript' },
  { name: 'gin-gonic/gin', tag: 'Go' },
  { name: 'tokio-rs/tokio', tag: 'Rust' },
  { name: 'tiangolo/fastapi', tag: 'Python' },
];

export function App() {
  const [repoInput, setRepoInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [landmarkContent, setLandmarkContent] = useState<LandmarkContent | null>(null);
  const [loadingLandmark, setLoadingLandmark] = useState(false);

  const handleAnalyze = async (inputToAnalyze?: string) => {
    const target = (inputToAnalyze || repoInput).trim();
    if (!target) return;

    if (inputToAnalyze) {
      setRepoInput(inputToAnalyze);
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data as ApiError);
      } else {
        setAnalysis(data as AnalysisResult);
        setActiveTab('overview');
      }
    } catch (err) {
      setError({
        error: 'NetworkError',
        message: err instanceof Error ? err.message : 'Failed to connect to ArchLens API server.',
        isRateLimit: false,
        suggestedAction: 'Ensure backend server is running on port 3000.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFetchLandmark = async (path: string) => {
    if (!analysis) return;
    setLoadingLandmark(true);
    try {
      const res = await fetch(
        `/api/repositories/${analysis.repository.owner}/${analysis.repository.name}/landmark-content?path=${encodeURIComponent(
          path
        )}`
      );
      if (!res.ok) {
        throw new Error('Failed to load file content.');
      }
      const data: LandmarkContent = await res.json();
      setLandmarkContent(data);
    } catch {
      setLandmarkContent({
        path,
        name: path.split('/').pop() || 'file',
        size: 0,
        content: 'Error: Unable to fetch content for this file.',
        encoding: 'utf-8',
        isTruncated: false,
      });
    } finally {
      setLoadingLandmark(false);
    }
  };

  const handleSelectLandmarkInfo = (lm: LandmarkInfo) => {
    handleFetchLandmark(lm.path);
  };

  const handleSelectTreeItem = (item: FileTreeItem) => {
    handleFetchLandmark(item.path);
  };

  const handleResetAnalysis = () => {
    setAnalysis(null);
    setRepoInput('');
    setError(null);
  };

  const hasReadme = analysis?.tree.some((t) => t.name.toLowerCase() === 'readme.md') ?? false;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-500/30 selection:text-blue-200">
      {/* Top Header / App Shell */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleResetAnalysis}
              className="flex items-center gap-2.5 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
              title="Return to Home / New Search"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20 group-hover:bg-blue-500 transition">
                AL
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-lg tracking-tight text-white group-hover:text-blue-400 transition">
                  ArchLens
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                  v{ARCHLENS_VERSION}
                </span>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-400">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-950/60 rounded-full border border-slate-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Bounded REST Ingestion</span>
            </div>

            <a
              href="https://github.com/AJ-Kaarthick/ArchLens"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:text-white hover:bg-slate-800/80 rounded-lg border border-transparent hover:border-slate-700 transition"
              title="View ArchLens source repository on GitHub"
              aria-label="View source repository on GitHub"
            >
              <Github size={18} />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Repository Ingestion Bar */}
        <Card variant="elevated" className="space-y-4">
          <CardHeader className="pb-0 border-b-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-base sm:text-lg">
                  <Search size={18} className="text-blue-400" />
                  Analyze GitHub Repository
                </CardTitle>
                <CardDescription className="mt-1">
                  Enter a repository identifier (e.g.{' '}
                  <code className="text-slate-300 font-mono bg-slate-950 px-1 py-0.5 rounded border border-slate-800">
                    fastify/fastify
                  </code>{' '}
                  or full GitHub URL) for instant, deterministic architectural comprehension.
                </CardDescription>
              </div>

              {analysis && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetAnalysis}
                  icon={<RefreshCw size={13} />}
                  className="self-start sm:self-auto"
                >
                  Analyze Another Repo
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-2 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAnalyze();
              }}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                />
                <input
                  type="text"
                  placeholder="e.g. fastify/fastify, facebook/react, or https://github.com/..."
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  disabled={loading}
                  aria-label="GitHub repository name or URL"
                  className="w-full pl-10 pr-24 py-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 text-[11px] font-mono text-slate-600 pointer-events-none">
                  <span>↵ Enter</span>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={loading}
                disabled={loading || !repoInput.trim()}
                icon={<Sparkles size={14} />}
                className="shrink-0 px-6 py-2.5"
              >
                {loading ? 'Analyzing...' : 'Analyze'}
              </Button>
            </form>

            {/* Curated Sample Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-400">
              <span className="text-[11px] font-medium text-slate-500">Quick explore:</span>
              {PRESET_REPOSITORIES.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  disabled={loading}
                  onClick={() => handleAnalyze(preset.name)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 hover:bg-slate-800/80 active:bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-800/80 hover:border-slate-700 transition cursor-pointer text-xs"
                >
                  <span className="font-mono text-[11px] text-slate-200">{preset.name}</span>
                  <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-slate-900 text-slate-500 font-mono">
                    {preset.tag}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Loading Progress State */}
        {loading && (
          <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4 text-center">
            <div className="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">Analyzing Repository Architecture</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Ingesting recursive tree & manifests via GitHub REST API, calculating language
                breakdowns, detecting framework versions, and indexing semantic code chunks...
              </p>
            </div>
            <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500 pt-2 font-mono">
              <span>Bounded 10k Items</span>
              <span>•</span>
              <span>Zero Git Clone</span>
              <span>•</span>
              <span>Deterministic Heuristics</span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div
            role="alert"
            className={`border rounded-xl p-5 shadow-lg flex items-start gap-3.5 ${
              error.isRateLimit
                ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                : 'bg-red-950/40 border-red-800/80 text-red-200'
            }`}
          >
            {error.isRateLimit ? (
              <Clock size={20} className="text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 flex-1">
              <div className="font-semibold text-sm">
                {error.isRateLimit ? 'GitHub API Rate Limit Reached' : error.error || 'Analysis Error'}
              </div>
              <p className="text-xs opacity-90 leading-relaxed">{error.message}</p>
              {error.suggestedAction && (
                <div className="mt-2 p-2.5 rounded-lg bg-black/30 border border-white/10 text-xs font-medium text-white/95">
                  <strong>Recommended Action:</strong> {error.suggestedAction}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Onboarding / Empty State (when no repo analyzed yet) */}
        {!analysis && !loading && (
          <div className="space-y-8 py-4">
            {/* 3 Pillars of ArchLens */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Pillar 1 */}
              <Card variant="default" className="p-6 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
                  <Layers size={20} />
                </div>
                <h3 className="text-sm font-semibold text-white">1. Deterministic Explorer</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Extracts package manifests, framework versions, primary entrypoints, monorepo
                  workspaces, and structural language metrics—establishing a verified, factual
                  baseline without cloning gigabytes of history.
                </p>
                <div className="pt-1 flex items-center gap-1.5 text-[11px] text-blue-400 font-medium">
                  <CheckCircle2 size={13} />
                  <span>Authoritative Ground Truth</span>
                </div>
              </Card>

              {/* Pillar 2 */}
              <Card variant="default" className="p-6 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center">
                  <Sparkles size={20} />
                </div>
                <h3 className="text-sm font-semibold text-white">2. Grounded AI Insights</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Synthesizes high-level architectural comprehension across 4 topics (Overview,
                  Patterns, Tech Stack, Entrypoints). Every claim produces typed evidence citations
                  validated by <code className="text-slate-300 font-mono">EvidenceValidator</code>.
                </p>
                <div className="pt-1 flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
                  <ShieldCheck size={13} />
                  <span>Zero-Hallucination Citations</span>
                </div>
              </Card>

              {/* Pillar 3 */}
              <Card variant="default" className="p-6 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center">
                  <Search size={20} />
                </div>
                <h3 className="text-sm font-semibold text-white">3. Semantic Code Search</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Line-aware chunking (50 lines, 10-line overlap) with dual-mode vector search
                  (PostgreSQL <code className="text-slate-300 font-mono">pgvector</code> HNSW with
                  relational in-memory cosine fallback). Locate relevant code slices safely.
                </p>
                <div className="pt-1 flex items-center gap-1.5 text-[11px] text-cyan-400 font-medium">
                  <FileCode2 size={13} />
                  <span>Dual-Mode Vector Ranking</span>
                </div>
              </Card>
            </div>

            {/* Explanatory Banner */}
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
              <div className="space-y-1">
                <div className="font-semibold text-slate-300 flex items-center gap-2">
                  <span>How ArchLens Works Under the Hood</span>
                </div>
                <p className="text-slate-400 max-w-2xl leading-relaxed">
                  ArchLens never evaluates, clones, or executes third-party code. Ingestion uses
                  bounded GitHub REST APIs (10k items, 256 KB landmark previews). PostgreSQL persists
                  analysis runs with idempotent upserts and sub-millisecond AI explanation caching.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleAnalyze('fastify/fastify')}
                className="px-4 py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <span>Try fastify/fastify</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Results Workspace */}
        {analysis && (
          <div className="space-y-6">
            <RepoHeader
              repository={analysis.repository}
              analyzedAt={analysis.analyzedAt}
              hasReadme={hasReadme}
              onViewReadme={() => handleFetchLandmark('README.md')}
              onNewAnalysis={handleResetAnalysis}
            />

            {/* Navigation Tabs Bar */}
            <div
              role="tablist"
              aria-label="Repository Analysis Views"
              className="flex items-center gap-1.5 border-b border-slate-800/90 pb-2 overflow-x-auto scrollbar-none"
            >
              <button
                role="tab"
                id="tab-overview"
                aria-selected={activeTab === 'overview'}
                aria-controls="panel-overview"
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'overview'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Layers size={14} />
                Architecture & Patterns
              </button>

              <button
                role="tab"
                id="tab-ai"
                aria-selected={activeTab === 'ai'}
                aria-controls="panel-ai"
                onClick={() => setActiveTab('ai')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'ai'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Sparkles size={14} className="text-amber-400" />
                AI Insights
              </button>

              <button
                role="tab"
                id="tab-search"
                aria-selected={activeTab === 'search'}
                aria-controls="panel-search"
                onClick={() => setActiveTab('search')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'search'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Search size={14} className="text-cyan-400" />
                Semantic Search
              </button>

              <button
                role="tab"
                id="tab-tech"
                aria-selected={activeTab === 'tech'}
                aria-controls="panel-tech"
                onClick={() => setActiveTab('tech')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'tech'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Cpu size={14} />
                Tech Stack
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 font-mono">
                  {analysis.techStack.length}
                </span>
              </button>

              <button
                role="tab"
                id="tab-metrics"
                aria-selected={activeTab === 'metrics'}
                aria-controls="panel-metrics"
                onClick={() => setActiveTab('metrics')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'metrics'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <BarChart3 size={14} />
                Metrics & Breakdown
              </button>

              <button
                role="tab"
                id="tab-tree"
                aria-selected={activeTab === 'tree'}
                aria-controls="panel-tree"
                onClick={() => setActiveTab('tree')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'tree'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <FolderTree size={14} />
                File Tree
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 font-mono">
                  {analysis.tree.length}
                </span>
              </button>

              <button
                role="tab"
                id="tab-execution"
                aria-selected={activeTab === 'execution'}
                aria-controls="panel-execution"
                onClick={() => setActiveTab('execution')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  activeTab === 'execution'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Terminal size={14} className="text-emerald-400" />
                Run & Preview
              </button>
            </div>

            {/* View Panels */}
            <div className="pt-1">
              {activeTab === 'overview' && (
                <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" tabIndex={0}>
                  <ArchitectureView
                    architecture={analysis.architecture}
                    onSelectLandmark={handleSelectLandmarkInfo}
                  />
                </div>
              )}

              {activeTab === 'ai' && (
                <div role="tabpanel" id="panel-ai" aria-labelledby="tab-ai" tabIndex={0}>
                  <AIInsightsView
                    analysis={analysis}
                    onSelectFile={(path) => handleFetchLandmark(path)}
                  />
                </div>
              )}

              {activeTab === 'search' && (
                <div role="tabpanel" id="panel-search" aria-labelledby="tab-search" tabIndex={0}>
                  <SemanticSearchView
                    repository={analysis.repository}
                    onSelectFile={(path) => handleFetchLandmark(path)}
                  />
                </div>
              )}

              {activeTab === 'tech' && (
                <div role="tabpanel" id="panel-tech" aria-labelledby="tab-tech" tabIndex={0}>
                  <TechStackView techStack={analysis.techStack} />
                </div>
              )}

              {activeTab === 'metrics' && (
                <div role="tabpanel" id="panel-metrics" aria-labelledby="tab-metrics" tabIndex={0}>
                  <MetricsView metrics={analysis.metrics} />
                </div>
              )}

              {activeTab === 'tree' && (
                <div role="tabpanel" id="panel-tree" aria-labelledby="tab-tree" tabIndex={0}>
                  <FileTreeExplorer tree={analysis.tree} onSelectFile={handleSelectTreeItem} />
                </div>
              )}

              {activeTab === 'execution' && (
                <div role="tabpanel" id="panel-execution" aria-labelledby="tab-execution" tabIndex={0}>
                  <ExecutionView repository={analysis.repository} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Landmark Viewer Modal */}
      <LandmarkViewer
        content={landmarkContent}
        loading={loadingLandmark}
        onClose={() => setLandmarkContent(null)}
      />
    </div>
  );
}

export default App;
