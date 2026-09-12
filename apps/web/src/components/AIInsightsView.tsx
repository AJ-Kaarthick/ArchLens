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
  type LucideIcon,
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
  ShieldCheck,
  Info,
} from 'lucide-react';
import { Button } from './ui/Button.tsx';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';
import { Skeleton, CardSkeleton } from './ui/Skeleton.tsx';

interface AIInsightsViewProps {
  analysis: AnalysisResult;
  onSelectFile?: (_path: string) => void;
}

const TOPICS: { id: ExplainTopic; label: string; icon: LucideIcon; desc: string }[] = [
  {
    id: 'overview',
    label: 'Repository Overview',
    icon: Sparkles,
    desc: 'High-level purpose, scale, structural layout, and core ecosystem.',
  },
  {
    id: 'architecture',
    label: 'Architecture & Patterns',
    icon: Layers,
    desc: 'Layered patterns, monorepo packages, and cross-boundary responsibilities.',
  },
  {
    id: 'tech-stack',
    label: 'Tech Stack Synergy',
    icon: Cpu,
    desc: 'How detected runtimes, frameworks, and databases interact.',
  },
  {
    id: 'entrypoints',
    label: 'Runtime Entrypoints',
    icon: Compass,
    desc: 'System boot sequences, listeners, and execution flow.',
  },
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
        suggestedAction: 'Ensure the ArchLens API server is running on port 3000.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExplanation(selectedTopic, targetInput);
  }, [selectedTopic, analysis.repository.owner, analysis.repository.name]);

  const handleTopicChange = (topic: ExplainTopic) => {
    if (topic === selectedTopic) return;
    setSelectedTopic(topic);
  };

  const handleRefresh = () => {
    fetchExplanation(selectedTopic, targetInput);
  };

  const getEvidenceCitationCard = (citation: EvidenceCitation, idx: number) => {
    const isPath =
      citation.type === 'file' || citation.type === 'manifest' || citation.type === 'entrypoint';

    const getCitationBadgeVariant = (): 'success' | 'purple' | 'warning' | 'cyan' | 'danger' | 'primary' => {
      switch (citation.type) {
        case 'manifest':
          return 'success';
        case 'entrypoint':
          return 'purple';
        case 'dependency':
          return 'warning';
        case 'metric':
          return 'cyan';
        case 'pattern':
          return 'danger';
        case 'file':
        default:
          return 'primary';
      }
    };

    const getCitationIcon = () => {
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
        key={`${citation.type}-${citation.reference}-${idx}`}
        className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 transition flex flex-col justify-between space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <Badge variant={getCitationBadgeVariant()} size="xs" icon={getCitationIcon()}>
            {citation.label}
          </Badge>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
            {citation.type}
          </span>
        </div>

        <div className="font-mono text-xs font-semibold text-slate-200 break-all bg-slate-900/60 p-1.5 rounded border border-slate-800/60">
          {citation.reference}
        </div>

        {citation.description && (
          <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
            {citation.description}
          </p>
        )}

        {isPath && onSelectFile && (
          <button
            type="button"
            onClick={() => onSelectFile(citation.reference)}
            className="pt-1 text-[11px] text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 font-medium transition cursor-pointer self-start"
          >
            <span>Inspect Landmark Content</span>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Fact Supremacy & AI Boundary Banner */}
      <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-start gap-3 text-xs text-slate-400">
        <ShieldCheck size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <span className="font-semibold text-slate-300">
            Factual Baseline Supremacy:
          </span>{' '}
          Deterministic Phase 2 repository analysis (manifests, trees, metrics) remains the sole
          authoritative source of truth. AI Insights synthesize narrative interpretations grounded
          in verifiable citations audited by <code className="text-slate-300 font-mono">EvidenceValidator</code>.
        </div>
      </div>

      {/* Controls: Topics Tabs & Focus Target Input */}
      <Card variant="default">
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Topic Selector Tabs */}
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t) => {
              const Icon = t.icon;
              const active = selectedTopic === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTopicChange(t.id)}
                  disabled={loading && !explanation}
                  aria-pressed={active}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                      : 'bg-slate-950/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                  }`}
                  title={t.desc}
                >
                  <Icon size={14} className={active ? 'text-white' : 'text-slate-400'} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Target Focus Input & Refresh */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Target path (e.g. apps/api)..."
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRefresh()}
                aria-label="Focus explanation on specific repository path"
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48 sm:w-56"
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              loading={loading}
              onClick={handleRefresh}
              icon={<RefreshCw size={13} />}
              title="Regenerate or refresh explanation"
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <div
          role="alert"
          className={`border rounded-xl p-4 flex items-start gap-3 text-xs ${
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
            <div className="font-semibold">
              {error.isRateLimit ? 'AI Provider Quota / Rate Limit' : error.error || 'Generation Error'}
            </div>
            <p className="opacity-90">{error.message}</p>
            {error.suggestedAction && (
              <p className="font-medium text-white/95 mt-1">Tip: {error.suggestedAction}</p>
            )}
          </div>
        </div>
      )}

      {/* Loading Skeleton State */}
      {loading && (
        <div className="space-y-5 animate-pulse">
          {/* Metadata Banner Skeleton */}
          <div className="h-10 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center px-4 justify-between">
            <Skeleton variant="text" className="w-48 h-4" />
            <Skeleton variant="text" className="w-32 h-4" />
          </div>

          {/* Executive Summary Skeleton */}
          <CardSkeleton lines={3} />

          {/* Takeaways Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>

          {/* Deep Analysis Skeleton */}
          <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <Skeleton variant="text" className="w-1/4 h-4 mb-4" />
            <Skeleton variant="text" className="w-full h-3" />
            <Skeleton variant="text" className="w-5/6 h-3" />
            <Skeleton variant="text" className="w-4/5 h-3" />
            <Skeleton variant="text" className="w-2/3 h-3" />
          </div>
        </div>
      )}

      {/* Active Explanation Display */}
      {!loading && explanation && (
        <div className="space-y-6">
          {/* Metadata & Cache Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-2">
              {explanation.cached ? (
                <Badge variant="success" size="sm" icon={<Database size={12} />}>
                  PostgreSQL Cached Snapshot (Zero token latency)
                </Badge>
              ) : (
                <Badge variant="primary" size="sm" icon={<Sparkles size={12} />}>
                  Freshly Generated by AI
                </Badge>
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
          <Card variant="default" className="border-blue-500/20 bg-gradient-to-r from-blue-950/20 to-slate-900/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-blue-400 text-xs uppercase tracking-wider">
                <Sparkles size={14} />
                Executive Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <p className="text-sm text-slate-200 leading-relaxed font-medium">
                {explanation.summary}
              </p>
            </CardContent>
          </Card>

          {/* Key Architectural Takeaways Grid */}
          {explanation.keyTakeaways.length > 0 && (
            <Card variant="default">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs uppercase tracking-wider text-slate-300">
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  Key Architectural Takeaways
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {explanation.keyTakeaways.map((takeaway, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-300 leading-relaxed"
                    >
                      <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded-md shrink-0 mt-0.5 font-bold">
                        {i + 1}
                      </span>
                      <span>{takeaway}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Deep Architectural Analysis (Markdown) */}
          <Card variant="default">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs uppercase tracking-wider text-slate-300">
                  Deep Architectural Analysis
                </CardTitle>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Info size={12} />
                  <span>Topic: {TOPICS.find((t) => t.id === selectedTopic)?.label}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 space-y-4 leading-relaxed [&>h1]:text-xl [&>h1]:font-bold [&>h1]:text-white [&>h1]:pb-2 [&>h1]:border-b [&>h1]:border-slate-800 [&>h2]:text-base [&>h2]:font-semibold [&>h2]:text-white [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-slate-200 [&>p]:text-slate-300 [&>p]:leading-relaxed [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-slate-950 [&>pre]:p-4 [&>pre]:rounded-xl [&>pre]:border [&>pre]:border-slate-800 [&>pre]:overflow-x-auto [&>code]:bg-slate-800 [&>code]:px-1.5 [&>code]:py-0.5 [&>code]:rounded [&>code]:text-blue-300 [&>a]:text-blue-400 hover:[&>a]:underline">
                <ReactMarkdown>{explanation.explanation}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>

          {/* Grounded Evidence Citations */}
          {explanation.evidence.length > 0 && (
            <Card variant="default">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-slate-300">
                    <FileCheck2 size={15} className="text-blue-400" />
                    Grounded Evidence ({explanation.evidence.length} Verified Citations)
                  </CardTitle>
                  <span className="text-[11px] text-slate-500">
                    Cross-referenced with Phase 2 manifests, trees, and metrics
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {explanation.evidence.map(getEvidenceCitationCard)}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
