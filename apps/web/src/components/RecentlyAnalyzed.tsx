import React, { useState, useEffect } from 'react';
import { Clock, Star, ArrowRight, Sparkles } from 'lucide-react';
import type { RecentRepository } from '@archlens/shared';
import { Card } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';

interface RecentlyAnalyzedProps {
  onSelectRepo: (repoPath: string) => void;
  disabled?: boolean;
}

const PRESET_FALLBACKS = [
  { name: 'fastify/fastify', tag: 'TypeScript', desc: 'Fast, low-overhead web framework for Node.js' },
  { name: 'facebook/react', tag: 'JavaScript', desc: 'The library for web and native user interfaces' },
  { name: 'gin-gonic/gin', tag: 'Go', desc: 'High-performance HTTP web framework in Go' },
  { name: 'tokio-rs/tokio', tag: 'Rust', desc: 'Asynchronous runtime for the Rust programming language' },
  { name: 'tiangolo/fastapi', tag: 'Python', desc: 'Modern, high-performance web framework for APIs' },
];

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Recently';
  }
}

export function RecentlyAnalyzed({ onSelectRepo, disabled }: RecentlyAnalyzedProps) {
  const [recents, setRecents] = useState<RecentRepository[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchRecent() {
      try {
        const res = await fetch('/api/repositories/recent?limit=10');
        if (res.ok) {
          const data: RecentRepository[] = await res.json();
          if (!cancelled) {
            setRecents(data);
          }
        }
      } catch {
        // Silently fall back to preset repositories on network/fetch errors
      }
    }

    fetchRecent();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasRecents = recents.length > 0;

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2 font-medium">
          {hasRecents ? (
            <>
              <Clock size={14} className="text-blue-400" />
              <span>Recently Analyzed Repositories</span>
              <Badge variant="neutral" className="text-[10px] py-0.5 px-1.5 font-mono">
                {recents.length}
              </Badge>
            </>
          ) : (
            <>
              <Sparkles size={14} className="text-amber-400" />
              <span>Curated Presets (Instant Evaluation)</span>
            </>
          )}
        </div>
        <span className="text-[11px] text-slate-500 hidden sm:inline">
          {hasRecents ? 'Cached in PostgreSQL for instant restoration' : 'Pre-tested popular repositories'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {hasRecents
          ? recents.map((r) => {
              const fullPath = `${r.owner}/${r.name}`;
              return (
                <Card
                  key={fullPath}
                  variant="subtle"
                  onClick={() => !disabled && onSelectRepo(fullPath)}
                  className="p-3.5 flex flex-col justify-between gap-2.5 transition-all text-left group cursor-pointer border-slate-800/80 hover:border-blue-500/50 hover:bg-slate-900/60"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white group-hover:text-blue-400 transition font-mono truncate">
                        {fullPath}
                      </span>
                      <ArrowRight
                        size={12}
                        className="text-slate-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all shrink-0"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/40">
                    <div className="flex items-center gap-2">
                      {r.language && (
                        <span className="text-blue-300 font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-800/40">
                          {r.language}
                        </span>
                      )}
                      {r.stars > 0 && (
                        <span className="flex items-center gap-1 text-slate-400 text-[10px] font-mono">
                          <Star size={10} className="text-amber-400 fill-amber-400" />
                          {r.stars.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {formatTimeAgo(r.analyzedAt)}
                    </span>
                  </div>
                </Card>
              );
            })
          : PRESET_FALLBACKS.map((preset) => (
              <Card
                key={preset.name}
                variant="subtle"
                onClick={() => !disabled && onSelectRepo(preset.name)}
                className="p-3.5 flex flex-col justify-between gap-2.5 transition-all text-left group cursor-pointer border-slate-800/80 hover:border-blue-500/50 hover:bg-slate-900/60"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white group-hover:text-blue-400 transition font-mono">
                      {preset.name}
                    </span>
                    <ArrowRight
                      size={12}
                      className="text-slate-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all shrink-0"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-1">{preset.desc}</p>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/40">
                  <span className="text-slate-500 text-[10px] font-mono">Preset Target</span>
                  <Badge variant="primary" className="text-[10px] py-0.2 px-1.5 font-mono">
                    {preset.tag}
                  </Badge>
                </div>
              </Card>
            ))}
      </div>
    </div>
  );
}
