import React, { useState } from 'react';
import {
  Search,
  Code2,
  Sparkles,
  Clock,
  AlertCircle,
  ExternalLink,
  Database,
  Copy,
  Check,
  Info,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import type {
  RepositoryMetadata,
  SearchResponse,
  ApiError,
  FileCategory,
} from '@archlens/shared';
import { Button } from './ui/Button.tsx';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';
import { Select } from './ui/Select.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { CodeSnippetSkeleton } from './ui/Skeleton.tsx';

interface SemanticSearchViewProps {
  repository: RepositoryMetadata;
  onSelectFile?: (_path: string) => void;
}

const EXAMPLE_QUERIES = [
  'JWT authentication middleware and token verification',
  'Database connection pool and schema migrations',
  'API rate limiting and error handling',
  'Server bootstrapping and application lifecycle',
  'File tree categorization and heuristics',
];

export function SemanticSearchView({ repository, onSelectFile }: SemanticSearchViewProps) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(5);
  const [selectedCategory, setSelectedCategory] = useState<FileCategory | ''>('');
  const [loading, setLoading] = useState(false);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [showFallbackDetails, setShowFallbackDetails] = useState(false);
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(null);

  const handleSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery || query).trim();
    if (q.length < 2) return;

    if (overrideQuery) {
      setQuery(overrideQuery);
    }

    setLoading(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = { query: q, limit };
      if (selectedCategory) {
        payload.category = selectedCategory;
      }

      const res = await fetch(`/api/repositories/${repository.owner}/${repository.name}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data as ApiError);
        setSearchResponse(null);
      } else {
        setSearchResponse(data as SearchResponse);
      }
    } catch (err) {
      setError({
        error: 'NetworkError',
        message: err instanceof Error ? err.message : 'Failed to connect to search API.',
        isRateLimit: false,
        suggestedAction: 'Ensure backend server is running on port 3000.',
      });
      setSearchResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopySnippet = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedSnippetIndex(index);
      setTimeout(() => setCopiedSnippetIndex(null), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const getScoreBadge = (score: number) => {
    const percentage = Math.round(score * 100);
    if (score >= 0.8) {
      return (
        <Badge variant="success" size="xs" mono>
          {percentage}% match
        </Badge>
      );
    }
    if (score >= 0.6) {
      return (
        <Badge variant="primary" size="xs" mono>
          {percentage}% match
        </Badge>
      );
    }
    if (score >= 0.4) {
      return (
        <Badge variant="warning" size="xs" mono>
          {percentage}% match
        </Badge>
      );
    }
    return (
      <Badge variant="neutral" size="xs" mono>
        {percentage}% match
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search Bar Panel */}
      <Card variant="default">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">
                <Search size={17} className="text-cyan-400" />
                Semantic Repository Search
              </CardTitle>
              <p className="text-xs text-slate-400 max-w-2xl">
                Search code slices and landmarks using natural language concepts. Semantic retrieval
                locates relevant implementation slices without executing repository code.
              </p>
            </div>

            {searchResponse && (
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setShowFallbackDetails(!showFallbackDetails)}
                  aria-expanded={showFallbackDetails}
                  aria-controls="fallback-details-drawer"
                  className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
                    searchResponse.fallback
                      ? 'bg-amber-950/50 text-amber-300 border-amber-800/60 hover:bg-amber-950/80'
                      : 'bg-cyan-950/50 text-cyan-300 border-cyan-800/60 hover:bg-cyan-950/80'
                  }`}
                  title="Click for retrieval mode details"
                >
                  <Database size={12} />
                  <span>{searchResponse.fallback ? 'Relational Cosine Fallback' : 'pgvector HNSW Index'}</span>
                  {showFallbackDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                <span className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                  <Clock size={12} />
                  {searchResponse.durationMs}ms
                </span>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-2 space-y-3">
          {/* Fallback Explanation Collapsible Drawer */}
          {searchResponse?.fallback && showFallbackDetails && (
            <div
              id="fallback-details-drawer"
              role="region"
              aria-label="Retrieval mode explanation"
              className="p-3.5 bg-amber-950/30 border border-amber-800/50 rounded-xl space-y-1.5 text-xs text-amber-200/90 animate-in fade-in duration-150"
            >
              <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                <Info size={14} />
                <span>Operating in Relational Cosine Fallback Mode</span>
              </div>
              <p className="leading-relaxed opacity-90">
                The local PostgreSQL development instance does not have the native{' '}
                <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-amber-100">pgvector</code>{' '}
                extension installed. ArchLens automatically fell back to in-memory cosine similarity
                ranking over stored embeddings. This intentional graceful-degradation path guarantees
                zero crashes during local development, but is not representative of production pgvector
                HNSW scale or latency.
              </p>
            </div>
          )}

          {/* Search Input & Filtering Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <div className="relative flex-1">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                size={16}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about architectural components (e.g. 'how is rate limiting handled?')"
                aria-label="Semantic search query"
                className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl pl-10 pr-20 py-2.5 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 transition"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
                  title="Clear search query"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as FileCategory | '')}
                aria-label="Filter by file category"
                selectSize="md"
              >
                <option value="">All Categories</option>
                <option value="source">Source Code</option>
                <option value="doc">Documentation</option>
                <option value="config">Configuration</option>
              </Select>

              <Select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                aria-label="Result limit"
                selectSize="md"
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
                <option value={20}>Top 20</option>
              </Select>

              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={loading}
                disabled={loading || query.trim().length < 2}
                icon={<Sparkles size={14} />}
                className="shrink-0 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 border-cyan-500/30"
              >
                {loading ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </form>

          {/* Quick Example Queries */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] font-medium text-slate-500 mr-1">Try asking:</span>
            {EXAMPLE_QUERIES.map((example, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSearch(example)}
                disabled={loading}
                className="text-[11px] px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded-lg border border-slate-800 hover:border-slate-700 transition cursor-pointer"
              >
                {example}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border bg-red-950/40 border-red-800/60 text-red-200 flex items-start gap-3 text-xs"
        >
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold">{error.error || 'Search Error'}</div>
            <p className="opacity-90">{error.message}</p>
            {error.suggestedAction && (
              <p className="font-medium text-white/95 mt-1">Tip: {error.suggestedAction}</p>
            )}
          </div>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="space-y-4">
          <CodeSnippetSkeleton />
          <CodeSnippetSkeleton />
          <CodeSnippetSkeleton />
        </div>
      )}

      {/* Search Results Display */}
      {!loading && searchResponse && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-300">
              Matched {searchResponse.totalMatches} relevant code{' '}
              {searchResponse.totalMatches === 1 ? 'slice' : 'slices'} for &ldquo;
              {searchResponse.query}&rdquo;
            </span>
          </div>

          {searchResponse.results.length === 0 ? (
            <EmptyState
              icon={<Code2 size={24} />}
              title="No matching code slices found"
              description="No code chunks exceeded the similarity threshold for this query. Try using broader keywords or clearing the category filter."
            />
          ) : (
            <div className="space-y-4">
              {searchResponse.results.map((item, idx) => (
                <div
                  key={`${item.filePath}-${item.chunkIndex}-${idx}`}
                  className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-sm hover:border-slate-700 transition"
                >
                  {/* Card Header */}
                  <div className="bg-slate-950/70 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Code2 size={15} className="text-cyan-400 shrink-0" />
                      <button
                        type="button"
                        onClick={() => onSelectFile?.(item.filePath)}
                        className="text-xs font-mono font-semibold text-cyan-300 hover:text-cyan-200 hover:underline flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
                        title="Click to view full landmark content"
                      >
                        {item.filePath}
                        <ExternalLink size={11} className="opacity-70" />
                      </button>
                      <span className="text-[11px] text-slate-500 font-mono">
                        (lines {item.startLine}–{item.endLine})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.language && (
                        <Badge variant="neutral" size="xs" mono>
                          {item.language}
                        </Badge>
                      )}
                      <Badge variant="neutral" size="xs" mono>
                        {item.category}
                      </Badge>
                      {getScoreBadge(item.score)}

                      <button
                        type="button"
                        onClick={() => handleCopySnippet(item.content, idx)}
                        className="p-1 text-slate-400 hover:text-white rounded transition cursor-pointer"
                        title="Copy snippet"
                        aria-label="Copy snippet code"
                      >
                        {copiedSnippetIndex === idx ? (
                          <Check size={13} className="text-emerald-400" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Code Snippet Box */}
                  <div className="p-4 bg-slate-950 font-mono text-xs text-slate-300 overflow-x-auto max-h-72">
                    <pre className="leading-relaxed">
                      <code>{item.content}</code>
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Initial Empty State */}
      {!searchResponse && !loading && !error && (
        <EmptyState
          icon={<Search size={24} className="text-cyan-400" />}
          title="Explore Implementation Slices"
          description="Type a natural language concept above or pick one of the example queries to discover where features, patterns, and modules are defined across the repository."
        />
      )}
    </div>
  );
}
