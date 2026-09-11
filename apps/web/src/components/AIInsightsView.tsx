import React, { useState, useEffect } from 'react';
import type {
  AnalysisResult,
  ExplainTopic,
  ExplainResponse,
  EvidenceCitation,
  ApiError,
} from '@archlens/shared';
import ReactMarkdown from 'react-markdown';
import {
  LucideIcon,
  Sparkles,
  Layers,
  Cpu,
  Compass,
  FileCode,
  FileCheck2,
  Package,
  Activity,
  CheckCircle2,
  RefreshCw,
  Database,
  Clock,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface AIInsightsViewProps {
  analysis: AnalysisResult;
  onSelectFile?: (_path: string) => void;
}

const TOPICS: { id: ExplainTopic; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Repository Overview', icon: Sparkles },
  { id: 'architecture', label: 'Architecture & Patterns', icon: Layers },
  { id: 'tech-stack', label: 'Tech Stack Synergy', icon: Cpu },
  { id: 'entrypoints', label: 'Runtime Entrypoints', icon: Compass },
];

export const AIInsightsView: React.FC<AIInsightsViewProps> = ({ analysis, onSelectFile }) => {
  const [selectedTopic, setSelectedTopic] = useState<ExplainTopic>('overview');
  const [targetInput, setTargetInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);

  const fetchExplanation = async (topicToFetch: ExplainTopic, targetToFetch?: string) => {
    setLoading(true);
    setError(null);

    const owner = analysis.repository.owner;
    const repo = analysis.repository.name;

    try {
      const res = await fetch(`/api/repositories/${owner}/${repo}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicToFetch,
          target: targetToFetch ? targetToFetch.trim() : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data as ApiError);
      } else {
        setExplanation(data as ExplainResponse);
      }
    } catch (err) {
      setError({
        error: 'NetworkError',
        message: err instanceof Error ? err.message : 'Failed to generate explanation.',
        isRateLimit: false,
        suggestedAction: 'Ensure the ArchLens API server is running.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch initial explanation when mounted or when topic changes
  useEffect(() => {
    fetchExplanation(selectedTopic, targetInput);
  }, [selectedTopic, analysis.repository.owner, analysis.repository.name]);

  const handleTopicChange = (topic: ExplainTopic) => {
    setSelectedTopic(topic);
  };

  const handleRefresh = () => {
    fetchExplanation(selectedTopic, targetInput);
  };

  const getEvidenceBadge = (citation: EvidenceCitation) => {
    const isPath =
      citation.type === 'file' || citation.type === 'manifest' || citation.type === 'entrypoint';

    const getColors = () => {
      switch (citation.type) {
        case 'manifest':
          return 'bg-emerald-950 text-emerald-300 border-emerald-800';
        case 'entrypoint':
          return 'bg-purple-950 text-purple-300 border-purple-800';
        case 'dependency':
          return 'bg-amber-950 text-amber-300 border-amber-800';
        case 'metric':
          return 'bg-cyan-950 text-cyan-300 border-cyan-800';
        case 'pattern':
          return 'bg-rose-950 text-rose-300 border-rose-800';
        case 'file':
        default:
          return 'bg-blue-950 text-blue-300 border-blue-800';
      }
    };

    const getIcon = () => {
      switch (citation.type) {
        case 'manifest':
          return <FileCheck2 size={13} className="shrink-0" />;
        case 'entrypoint':
          return <Compass size={13} className="shrink-0" />;
        case 'dependency':
          return <Package size={13} className="shrink-0" />;
        case 'metric':
          return <Activity size={13} className="shrink-0" />;
        case 'pattern':
          return <Layers size={13} className="shrink-0" />;
        case 'file':
        default:
          return <FileCode size={13} className="shrink-0" />;
      }
    };

    return (
      <div
        key={`${citation.type}-${citation.reference}`}
        className={`p-3 rounded-lg border flex flex-col justify-between ${getColors()}`}
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 font-medium text-xs">
            {getIcon()}
            <span>{citation.label}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/30 opacity-80 font-mono">
            {citation.type}
          </span>
        </div>

        <div className="font-mono text-xs font-semibold break-all text-white/95 my-1">
          {citation.reference}
        </div>

        {citation.description && (
          <p className="text-[11px] opacity-80 mt-1 leading-relaxed">{citation.description}</p>
        )}

        {isPath && onSelectFile && (
          <button
            onClick={() => onSelectFile(citation.reference)}
            className="mt-2 text-[11px] inline-flex items-center gap-1 opacity-90 hover:opacity-100 underline cursor-pointer"
          >
            <span>View file</span>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Control Bar: Topics and Target Filter */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Topic Selector Tabs */}
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => {
            const Icon = t.icon;
            const active = selectedTopic === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleTopicChange(t.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Optional Target Input & Refresh Button */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Focus target (e.g. apps/api)..."
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRefresh()}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48 md:w-56"
          />
          <button
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh explanation"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          className={`border rounded-xl p-4 flex items-start gap-3 ${
            error.isRateLimit
              ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
              : 'bg-red-950/40 border-red-800/80 text-red-200'
          }`}
        >
          {error.isRateLimit ? (
            <Clock size={18} className="text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <div className="font-semibold text-xs">
              {error.isRateLimit ? 'AI Provider Rate Limit' : error.error || 'AI Explanation Error'}
            </div>
            <p className="text-xs opacity-90">{error.message}</p>
            {error.suggestedAction && (
              <p className="text-xs font-medium text-white/90">Tip: {error.suggestedAction}</p>
            )}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && !explanation && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center space-y-3">
          <RefreshCw size={28} className="animate-spin text-blue-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-200">
            Synthesizing deterministic repository facts...
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            ArchLens AI is reasoning over verified manifests, AST patterns, dependency graphs, and
            structural metrics.
          </p>
        </div>
      )}

      {/* Content Display */}
      {explanation && (
        <div className="space-y-6">
          {/* Metadata Banner: Cache status, Provider & Model */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-2 text-slate-300">
              {explanation.cached ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-medium">
                  <Database size={12} />
                  Cached in PostgreSQL (Zero token latency)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-950/80 text-blue-300 border border-blue-800 font-medium">
                  <Sparkles size={12} />
                  Freshly Generated by AI
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-slate-400 text-[11px] font-mono">
              <span>
                Provider: <strong className="text-slate-200">{explanation.provider}</strong>
              </span>
              <span>•</span>
              <span>
                Model: <strong className="text-slate-200">{explanation.model}</strong>
              </span>
              <span>•</span>
              <span>{new Date(explanation.generatedAt).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Executive Summary Card */}
          <div className="bg-gradient-to-r from-blue-950/40 to-indigo-950/40 border border-blue-800/40 rounded-xl p-5 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
              <Sparkles size={14} />
              Executive Summary
            </div>
            <p className="text-sm text-slate-200 leading-relaxed font-medium">
              {explanation.summary}
            </p>
          </div>

          {/* Key Takeaways Grid */}
          {explanation.keyTakeaways.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-400" />
                Key Architectural Takeaways
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {explanation.keyTakeaways.map((takeaway, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300 leading-relaxed"
                  >
                    <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{takeaway}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detailed Markdown Explanation */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Deep Architectural Analysis
            </div>
            <div className="prose prose-invert prose-sm max-w-none text-slate-300 space-y-3 prose-headings:text-slate-100 prose-headings:font-semibold prose-code:text-blue-300 prose-code:bg-slate-950 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:border prose-code:border-slate-800">
              <ReactMarkdown>{explanation.explanation}</ReactMarkdown>
            </div>
          </div>

          {/* Grounded Evidence Citations */}
          {explanation.evidence.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <FileCheck2 size={14} className="text-blue-400" />
                  Grounded Evidence ({explanation.evidence.length} Facts Cited)
                </div>
                <span className="text-[11px] text-slate-400">
                  Every claim is tied to verified repository data
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {explanation.evidence.map(getEvidenceBadge)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
