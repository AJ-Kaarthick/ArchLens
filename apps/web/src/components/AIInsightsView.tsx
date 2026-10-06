import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  AnalysisResult,
  ExplainTopic,
  ExplainResponse,
  EvidenceCitation,
  InsightResponse,
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
  History,
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

interface TopicState {
  status: 'idle' | 'pending' | 'ready' | 'failed' | 'disabled';
  data: ExplainResponse | null;
  isStale: boolean;
  error: {
    error: string;
    message: string;
    isRateLimit?: boolean;
    suggestedAction?: string | null;
  } | null;
  retryAt: string | null;
}

const INITIAL_TOPIC_STATES: Record<ExplainTopic, TopicState> = {
  overview: { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
  architecture: { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
  'tech-stack': { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
  entrypoints: { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
};

export const AIInsightsView: React.FC<AIInsightsViewProps> = ({ analysis, onSelectFile }) => {
  const [selectedTopic, setSelectedTopic] = useState<ExplainTopic>('overview');
  const [targetInput, setTargetInput] = useState('');
  const [topicStates, setTopicStates] = useState<Record<ExplainTopic, TopicState>>(INITIAL_TOPIC_STATES);

  // In-flight tracking: active AbortController, request counters, and polling timers
  const abortControllersRef = useRef<Map<ExplainTopic, AbortController>>(new Map());
  const pollTimersRef = useRef<Map<ExplainTopic, ReturnType<typeof setTimeout>>>(new Map());
  const requestIdsRef = useRef<Record<ExplainTopic, number>>({
    overview: 0,
    architecture: 0,
    'tech-stack': 0,
    entrypoints: 0,
  });

  const fetchInsight = useCallback(
    async (topicToFetch: ExplainTopic, targetToFetch?: string, forceRetry = false) => {
      const owner = analysis.repository.owner;
      const repo = analysis.repository.name;
      const cleanTarget = targetToFetch ? targetToFetch.trim() : '';

      // Clear existing poll timer for this topic
      const existingTimer = pollTimersRef.current.get(topicToFetch);
      if (existingTimer) {
        clearTimeout(existingTimer);
        pollTimersRef.current.delete(topicToFetch);
      }

      // Abort any existing in-flight request for this topic
      const prevController = abortControllersRef.current.get(topicToFetch);
      if (prevController) {
        prevController.abort();
      }

      const controller = new AbortController();
      abortControllersRef.current.set(topicToFetch, controller);
      const requestId = ++requestIdsRef.current[topicToFetch];

      // Mark topic as pending without clearing existing stale data
      setTopicStates((prev) => ({
        ...prev,
        [topicToFetch]: {
          ...prev[topicToFetch],
          status: 'pending',
          error: forceRetry ? null : prev[topicToFetch].error,
        },
      }));

      try {
        const params = new URLSearchParams();
        if (cleanTarget) params.set('target', cleanTarget);
        if (forceRetry) params.set('forceRetry', 'true');
        const queryString = params.toString() ? `?${params.toString()}` : '';

        const res = await fetch(
          `/api/repositories/${owner}/${repo}/insights/${topicToFetch}${queryString}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }
        );

        if (requestIdsRef.current[topicToFetch] !== requestId) {
          return;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          setTopicStates((prev) => ({
            ...prev,
            [topicToFetch]: {
              ...prev[topicToFetch],
              status: 'failed',
              error: {
                error: errJson.error || 'FetchError',
                message: errJson.message || 'Failed to resolve AI insights.',
                isRateLimit: Boolean(errJson.isRateLimit),
                suggestedAction: errJson.suggestedAction || 'Please try again later.',
              },
            },
          }));
          return;
        }

        const insight = (await res.json()) as InsightResponse;

        if (requestIdsRef.current[topicToFetch] !== requestId) {
          return;
        }

        setTopicStates((prev) => ({
          ...prev,
          [topicToFetch]: {
            status: insight.status,
            data: insight.result || prev[topicToFetch].data,
            isStale: Boolean(insight.isStale),
            error: insight.error || null,
            retryAt: insight.retryAt || null,
          },
        }));

        // Poll every 2.5 seconds while status remains pending
        if (insight.status === 'pending') {
          const timer = setTimeout(() => {
            fetchInsight(topicToFetch, targetToFetch, false);
          }, 2500);
          pollTimersRef.current.set(topicToFetch, timer);
        }
      } catch (err: unknown) {
        if (requestIdsRef.current[topicToFetch] !== requestId) {
          return;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setTopicStates((prev) => ({
          ...prev,
          [topicToFetch]: {
            ...prev[topicToFetch],
            status: 'failed',
            error: {
              error: 'NetworkError',
              message: err instanceof Error ? err.message : 'Network request failed.',
              isRateLimit: false,
              suggestedAction: 'Please check your connection and click Retry.',
            },
          },
        }));
      } finally {
        if (abortControllersRef.current.get(topicToFetch) === controller) {
          abortControllersRef.current.delete(topicToFetch);
        }
      }
    },
    [analysis.repository.owner, analysis.repository.name]
  );

  // Sync on repository/commit context change or mount
  const repoContext = `${analysis.repository.owner}/${analysis.repository.name}:${analysis.commitSha || ''}`;
  useEffect(() => {
    // Clear all pending timers and abort controllers
    pollTimersRef.current.forEach((t) => clearTimeout(t));
    pollTimersRef.current.clear();
    abortControllersRef.current.forEach((ctrl) => ctrl.abort());
    abortControllersRef.current.clear();

    setTopicStates(INITIAL_TOPIC_STATES);
    setSelectedTopic('overview');

    // Trigger initial fetch for default topic
    fetchInsight('overview', undefined, false);

    return () => {
      pollTimersRef.current.forEach((t) => clearTimeout(t));
      pollTimersRef.current.clear();
      abortControllersRef.current.forEach((ctrl) => ctrl.abort());
      abortControllersRef.current.clear();
    };
  }, [repoContext, fetchInsight]);

  // Non-blocking topic change: user is always free to switch tabs
  const handleTopicChange = (newTopic: ExplainTopic) => {
    if (newTopic === selectedTopic) return;
    setSelectedTopic(newTopic);

    // If new topic has not been fetched yet, trigger fetch
    const targetState = topicStates[newTopic];
    if (targetState.status === 'idle') {
      fetchInsight(newTopic, targetInput, false);
    }
  };

  const handleRefresh = () => {
    fetchInsight(selectedTopic, targetInput, true);
  };

  const currentTopicState = topicStates[selectedTopic];

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
          Deterministic repository analysis (manifests, trees, metrics) remains the primary
          authoritative source of truth. AI explanations run asynchronously in the background and
          synthesize narrative interpretations grounded in verifiable citations audited by{' '}
          <code className="text-slate-300 font-mono">EvidenceValidator</code>.
        </div>
      </div>

      {/* Controls: Topics Tabs & Focus Target Input */}
      <Card variant="default">
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Topic Selector Tabs (Never locked or disabled) */}
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t) => {
              const Icon = t.icon;
              const active = selectedTopic === t.id;
              const isPending = topicStates[t.id].status === 'pending';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleTopicChange(t.id)}
                  aria-pressed={active}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
                      : 'bg-slate-950/80 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
                  }`}
                  title={t.desc}
                >
                  {isPending ? (
                    <RefreshCw size={14} className="animate-spin text-blue-300 shrink-0" />
                  ) : (
                    <Icon size={14} className={active ? 'text-white' : 'text-slate-400'} />
                  )}
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
              loading={currentTopicState.status === 'pending' && !currentTopicState.data}
              onClick={handleRefresh}
              icon={<RefreshCw size={13} />}
              title="Regenerate or refresh explanation in background"
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 1. Disabled State Banner */}
      {currentTopicState.status === 'disabled' && (
        <Card variant="default" className="border-slate-800 bg-slate-900/40">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="p-3 rounded-xl bg-slate-800/80 text-slate-400 shrink-0">
              <Sparkles size={24} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-slate-200">
                AI Insights are Not Configured
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                This ArchLens instance is operating in pure deterministic mode. To enable automated
                AI synthesis, provide a valid <code className="text-slate-300 font-mono">GEMINI_API_KEY</code>.
                Deterministic repository exploration (trees, manifests, dependencies, architecture patterns,
                and metrics) is fully functional.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Error Alert (Shown when current topic failed) */}
      {currentTopicState.status === 'failed' && currentTopicState.error && (
        <div
          role="alert"
          className={`border rounded-xl p-4 flex items-start justify-between gap-3 text-xs ${
            currentTopicState.error.isRateLimit
              ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
              : 'bg-red-950/40 border-red-800/80 text-red-200'
          }`}
        >
          <div className="flex items-start gap-3">
            {currentTopicState.error.isRateLimit ? (
              <Clock size={18} className="text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-semibold">
                {currentTopicState.error.isRateLimit
                  ? 'AI Provider Quota / Rate Limit'
                  : currentTopicState.error.error || 'Insight Generation Failed'}
              </div>
              <p className="opacity-90">{currentTopicState.error.message}</p>
              {currentTopicState.retryAt && (
                <p className="text-[11px] text-amber-300 font-mono">
                  Backoff active until: {new Date(currentTopicState.retryAt).toLocaleTimeString()}
                </p>
              )}
              {currentTopicState.error.suggestedAction && (
                <p className="font-medium text-white/95 mt-1">
                  Tip: {currentTopicState.error.suggestedAction}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            icon={<RefreshCw size={12} />}
            className="shrink-0"
          >
            Retry
          </Button>
        </div>
      )}

      {/* 3. Pending Status Banner (when stale data is available) */}
      {currentTopicState.status === 'pending' && currentTopicState.data && (
        <div className="flex items-center gap-2.5 text-xs text-blue-400 bg-blue-950/30 border border-blue-900/50 px-4 py-3 rounded-xl font-medium">
          <RefreshCw size={13} className="animate-spin text-blue-400 shrink-0" />
          <span>
            Updating explanation for this commit in background. Displaying snapshot from prior run.
          </span>
        </div>
      )}

      {/* 4. Loading Skeleton (Shown ONLY when pending and NO previous data exists) */}
      {currentTopicState.status === 'pending' && !currentTopicState.data && (
        <div className="space-y-5 animate-pulse">
          <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-950/30 border border-blue-900/50 px-3.5 py-2.5 rounded-xl font-medium">
            <RefreshCw size={13} className="animate-spin text-blue-400 shrink-0" />
            <span>Analyzing repository facts and generating insight in the background...</span>
          </div>

          <div className="h-10 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-center px-4 justify-between">
            <Skeleton variant="text" className="w-48 h-4" />
            <Skeleton variant="text" className="w-32 h-4" />
          </div>

          <CardSkeleton lines={3} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>

          <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <Skeleton variant="text" className="w-1/4 h-4 mb-4" />
            <Skeleton variant="text" className="w-full h-3" />
            <Skeleton variant="text" className="w-5/6 h-3" />
            <Skeleton variant="text" className="w-4/5 h-3" />
            <Skeleton variant="text" className="w-2/3 h-3" />
          </div>
        </div>
      )}

      {/* 5. Active Explanation Display (Shown when data is present) */}
      {currentTopicState.data && (
        <div className="space-y-6">
          {/* Metadata & Cache Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-2">
              {currentTopicState.isStale ? (
                <Badge variant="purple" size="sm" icon={<History size={12} />}>
                  Earlier Commit Snapshot
                </Badge>
              ) : currentTopicState.data.cached ? (
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
                Provider: <strong className="text-slate-200">{currentTopicState.data.provider}</strong>
              </span>
              <span>•</span>
              <span>
                Model: <strong className="text-slate-200">{currentTopicState.data.model}</strong>
              </span>
              <span>•</span>
              <span>{new Date(currentTopicState.data.generatedAt).toLocaleTimeString()}</span>
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
                {currentTopicState.data.summary}
              </p>
            </CardContent>
          </Card>

          {/* Key Architectural Takeaways Grid */}
          {currentTopicState.data.keyTakeaways.length > 0 && (
            <Card variant="default">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs uppercase tracking-wider text-slate-300">
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  Key Architectural Takeaways
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {currentTopicState.data.keyTakeaways.map((takeaway, i) => (
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
                <ReactMarkdown>{currentTopicState.data.explanation}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>

          {/* Grounded Evidence Citations */}
          {currentTopicState.data.evidence.length > 0 && (
            <Card variant="default">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-slate-300">
                    <FileCheck2 size={15} className="text-blue-400" />
                    Grounded Evidence ({currentTopicState.data.evidence.length} Verified Citations)
                  </CardTitle>
                  <span className="text-[11px] text-slate-500">
                    Cross-referenced with Phase 2 manifests, trees, and metrics
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {currentTopicState.data.evidence.map(getEvidenceCitationCard)}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
