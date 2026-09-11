import React, { useState } from 'react';
import {
  Search,
  Code2,
  FileCode,
  Sparkles,
  Clock,
  AlertCircle,
  ExternalLink,
  Database,
} from 'lucide-react';
import type { RepositoryMetadata, SearchResponse, ApiError, FileCategory } from '@archlens/shared';

interface SemanticSearchViewProps {
  repository: RepositoryMetadata;
  onSelectFile?: (path: string) => void;
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

  const handleSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery || query).trim();
    if (q.length < 2) return;

    if (overrideQuery) {
      setQuery(overrideQuery);
    }

    setLoading(true);
    setError(null);

    try {
      const payload: any = { query: q, limit };
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
        suggestedAction: 'Ensure backend server is running.',
      });
      setSearchResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const getScoreBadgeColor = (score: number) => {
    if (score >= 0.8) return 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';
    if (score >= 0.6) return 'bg-blue-950/80 text-blue-300 border-blue-800/60';
    if (score >= 0.4) return 'bg-amber-950/80 text-amber-300 border-amber-800/60';
    return 'bg-slate-800 text-slate-400 border-slate-700';
  };

  return (
    <div className="space-y-6">
      {/* Header & Description */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400 border border-cyan-500/20">
                <Search size={20} />
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight">Semantic Code Search</h2>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl">
              Search code chunks and landmarks using natural language concepts. Semantic retrieval
              locates relevant implementation slices without executing untrusted repository code.
            </p>
          </div>

          {searchResponse && (
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span
                className={`text-[11px] px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium ${
                  searchResponse.fallback
                    ? 'bg-amber-950/60 text-amber-300 border-amber-800/50'
                    : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/50'
                }`}
              >
                <Database size={12} />
                {searchResponse.fallback ? 'Relational Cosine Fallback' : 'pgvector HNSW Index'}
              </span>
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Clock size={12} />
                {searchResponse.durationMs}ms
              </span>
            </div>
          )}
        </div>

        {/* Search Bar */}
        <div className="mt-6 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                size={16}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about an architectural component or feature (e.g. 'how is rate limiting handled?')"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as FileCategory | '')}
                aria-label="Filter by file category"
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="">All Categories</option>
                <option value="source">Source Code</option>
                <option value="doc">Documentation</option>
                <option value="config">Configuration</option>
              </select>

              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                aria-label="Result limit"
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
                <option value={20}>Top 20</option>
              </select>

              <button
                type="submit"
                disabled={loading || query.trim().length < 2}
                className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium text-xs rounded-lg transition shadow-sm cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Search
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Examples */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] font-medium text-slate-500 mr-1">Try asking:</span>
            {EXAMPLE_QUERIES.map((example, i) => (
              <button
                key={i}
                onClick={() => handleSearch(example)}
                className="text-[11px] px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded-md border border-slate-800/80 transition cursor-pointer"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-xl border bg-red-950/40 border-red-800/60 text-red-200 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-xs font-semibold">{error.error || 'Search Error'}</div>
            <p className="text-xs text-red-300/90">{error.message}</p>
            {error.suggestedAction && (
              <p className="text-[11px] text-white/80 mt-1">Tip: {error.suggestedAction}</p>
            )}
          </div>
        </div>
      )}

      {/* Search Results List */}
      {searchResponse && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-300">
              Matched {searchResponse.totalMatches} relevant code{' '}
              {searchResponse.totalMatches === 1 ? 'slice' : 'slices'} for &ldquo;
              {searchResponse.query}&rdquo;
            </span>
          </div>

          {searchResponse.results.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-12 text-center space-y-3">
              <FileCode size={36} className="mx-auto text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-300">
                No matching code slices found
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No code chunks exceeded the similarity threshold for this query. Try broader
                keywords or clear the category filter.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {searchResponse.results.map((item, idx) => (
                <div
                  key={`${item.filePath}-${item.chunkIndex}-${idx}`}
                  className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm hover:border-slate-700 transition"
                >
                  {/* Card Header */}
                  <div className="bg-slate-950/60 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Code2 size={15} className="text-cyan-400" />
                      <button
                        onClick={() => onSelectFile?.(item.filePath)}
                        className="text-xs font-mono font-semibold text-cyan-300 hover:text-cyan-200 hover:underline flex items-center gap-1 cursor-pointer"
                        title="Click to view full file content"
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
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {item.language}
                        </span>
                      )}
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        {item.category}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getScoreBadgeColor(
                          item.score
                        )}`}
                      >
                        {Math.round(item.score * 100)}% match
                      </span>
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
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-12 text-center space-y-3">
          <div className="p-3 bg-cyan-500/10 rounded-full w-fit mx-auto text-cyan-400 border border-cyan-500/20">
            <Search size={28} />
          </div>
          <h3 className="text-sm font-semibold text-slate-200">Explore Implementation Slices</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Type a natural language concept above or pick one of the example queries to discover
            where components are defined and structured across the codebase.
          </p>
        </div>
      )}
    </div>
  );
}
