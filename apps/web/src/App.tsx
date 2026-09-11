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
import {
  Layers,
  Cpu,
  BarChart3,
  FolderTree,
  Search,
  AlertCircle,
  Clock,
  Sparkles,
  BookOpen,
} from 'lucide-react';

export function App() {
  const [repoInput, setRepoInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'tech' | 'metrics' | 'tree'>(
    'overview'
  );

  const [landmarkContent, setLandmarkContent] = useState<LandmarkContent | null>(null);
  const [loadingLandmark, setLoadingLandmark] = useState(false);

  const handleAnalyze = async (inputToAnalyze?: string) => {
    const target = (inputToAnalyze || repoInput).trim();
    if (!target) return;

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
        message: err instanceof Error ? err.message : 'Failed to connect to ArchLens API.',
        isRateLimit: false,
        suggestedAction: 'Ensure the backend server is running on port 3000.',
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

  const sampleRepos = ['facebook/react', 'fastify/fastify', 'expressjs/express'];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20">
              AL
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">ArchLens</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                v{ARCHLENS_VERSION}
              </span>
            </div>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Bounded GitHub REST Ingestion</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Search / Ingestion Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">Analyze GitHub Repository</h2>
            <p className="text-xs text-slate-400">
              Enter any public repository identifier (e.g.,{' '}
              <code className="text-slate-300">owner/repo</code> or full URL) for deterministic
              architecture and tech-stack analysis.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAnalyze();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="e.g. facebook/react or https://github.com/owner/repo"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !repoInput.trim()}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-600/20 transition flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Analyze</span>
                </>
              )}
            </button>
          </form>

          {/* Preset Buttons */}
          <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
            <span>Try sample:</span>
            <div className="flex flex-wrap gap-2">
              {sampleRepos.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  onClick={() => {
                    setRepoInput(repo);
                    handleAnalyze(repo);
                  }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700/60 transition cursor-pointer"
                >
                  {repo}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div
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
            <div className="space-y-1">
              <div className="font-semibold text-sm">
                {error.isRateLimit ? 'GitHub Rate Limit Exceeded' : error.error || 'Analysis Error'}
              </div>
              <p className="text-xs opacity-90">{error.message}</p>
              {error.suggestedAction && (
                <p className="text-xs font-medium mt-1 text-white/90">
                  Tip: {error.suggestedAction}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Results Section */}
        {analysis && (
          <div className="space-y-6">
            <RepoHeader repository={analysis.repository} analyzedAt={analysis.analyzedAt} />

            {/* Quick Readme Action */}
            {analysis.tree.some((t) => t.name.toLowerCase() === 'readme.md') && (
              <div className="flex justify-end">
                <button
                  onClick={() => handleFetchLandmark('README.md')}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition cursor-pointer"
                >
                  <BookOpen size={14} className="text-blue-400" />
                  View README.md
                </button>
              </div>
            )}

            {/* Tabs Navigation */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
              <button
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'overview'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Layers size={14} />
                Architecture & Patterns
              </button>

              <button
                onClick={() => setActiveTab('ai')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'ai'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Sparkles size={14} className="text-amber-400" />
                AI Insights
              </button>

              <button
                onClick={() => setActiveTab('tech')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'tech'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Cpu size={14} />
                Tech Stack ({analysis.techStack.length})
              </button>

              <button
                onClick={() => setActiveTab('metrics')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'metrics'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <BarChart3 size={14} />
                Metrics & Breakdown
              </button>

              <button
                onClick={() => setActiveTab('tree')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'tree'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <FolderTree size={14} />
                File Tree ({analysis.tree.length})
              </button>
            </div>

            {/* Tab Views */}
            {activeTab === 'overview' && (
              <ArchitectureView
                architecture={analysis.architecture}
                onSelectLandmark={handleSelectLandmarkInfo}
              />
            )}

            {activeTab === 'ai' && (
              <AIInsightsView
                analysis={analysis}
                onSelectFile={(path) => handleFetchLandmark(path)}
              />
            )}

            {activeTab === 'tech' && <TechStackView techStack={analysis.techStack} />}

            {activeTab === 'metrics' && <MetricsView metrics={analysis.metrics} />}

            {activeTab === 'tree' && (
              <FileTreeExplorer tree={analysis.tree} onSelectFile={handleSelectTreeItem} />
            )}
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
