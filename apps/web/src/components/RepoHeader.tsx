import React, { useState } from 'react';
import type { RepositoryMetadata } from '@archlens/shared';
import {
  Star,
  GitFork,
  ExternalLink,
  GitBranch,
  Calendar,
  Code2,
  Copy,
  Check,
  BookOpen,
  RotateCcw,
} from 'lucide-react';
import { Button } from './ui/Button.tsx';

interface RepoHeaderProps {
  repository: RepositoryMetadata;
  analyzedAt: string;
  hasReadme?: boolean;
  onViewReadme?: () => void;
  onNewAnalysis?: () => void;
}

export const RepoHeader: React.FC<RepoHeaderProps> = ({
  repository,
  analyzedAt,
  hasReadme = false,
  onViewReadme,
  onNewAnalysis,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(repository.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        {/* Left Column: Repository Identity */}
        <div className="space-y-2 max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-1.5">
              <span className="text-slate-400 font-normal">{repository.owner}</span>
              <span className="text-slate-600 font-light">/</span>
              <span className="text-white hover:text-blue-400 transition-colors">
                {repository.name}
              </span>
            </h1>

            <div className="flex items-center gap-2">
              <a
                href={repository.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700/70 transition font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="View repository on GitHub (opens in new tab)"
              >
                GitHub <ExternalLink size={12} className="opacity-70" />
              </a>

              <button
                type="button"
                onClick={handleCopyUrl}
                title="Copy repository URL"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-700/70 transition font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label={copied ? 'URL Copied' : 'Copy repository URL'}
              >
                {copied ? (
                  <>
                    <Check size={12} className="text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    <span>Copy URL</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {repository.description ? (
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              {repository.description}
            </p>
          ) : (
            <p className="text-slate-500 italic text-xs">No repository description provided.</p>
          )}
        </div>

        {/* Right Column: Quick Actions */}
        <div className="flex items-center gap-2 self-start shrink-0">
          {hasReadme && onViewReadme && (
            <Button
              variant="secondary"
              size="sm"
              icon={<BookOpen size={14} className="text-blue-400" />}
              onClick={onViewReadme}
            >
              README.md
            </Button>
          )}

          {onNewAnalysis && (
            <Button
              variant="outline"
              size="sm"
              icon={<RotateCcw size={13} className="text-slate-400" />}
              onClick={onNewAnalysis}
            >
              New Analysis
            </Button>
          )}
        </div>
      </div>

      {/* Metadata Badges Ribbon */}
      <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800">
          <Star size={13} className="text-amber-400 fill-amber-400/20" />
          <span className="font-semibold text-white">{repository.stars.toLocaleString()}</span>
          <span className="text-slate-400">stars</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800">
          <GitFork size={13} className="text-blue-400" />
          <span className="font-semibold text-white">{repository.forks.toLocaleString()}</span>
          <span className="text-slate-400">forks</span>
        </div>

        {repository.primaryLanguage && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800">
            <Code2 size={13} className="text-emerald-400" />
            <span className="font-medium text-white">{repository.primaryLanguage}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800 font-mono text-[11px]">
          <GitBranch size={13} className="text-purple-400" />
          <span className="text-slate-300">{repository.defaultBranch}</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800 text-slate-400 text-[11px] ml-auto">
          <Calendar size={13} />
          <span>Analyzed {new Date(analyzedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  );
};
