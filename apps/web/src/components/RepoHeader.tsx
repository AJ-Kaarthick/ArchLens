import React from 'react';
import type { RepositoryMetadata } from '@archlens/shared';
import { Star, GitFork, ExternalLink, GitBranch, Calendar, Code2 } from 'lucide-react';

interface RepoHeaderProps {
  repository: RepositoryMetadata;
  analyzedAt: string;
}

export const RepoHeader: React.FC<RepoHeaderProps> = ({ repository, analyzedAt }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              <span className="text-slate-400 font-normal">{repository.owner} / </span>
              {repository.name}
            </h1>
            <a
              href={repository.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
            >
              GitHub <ExternalLink size={12} />
            </a>
          </div>

          {repository.description && (
            <p className="mt-2 text-slate-300 text-sm max-w-3xl leading-relaxed">
              {repository.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/60">
            <Star size={14} className="text-yellow-400" />
            <span className="font-semibold text-white">{repository.stars.toLocaleString()}</span>
            <span className="text-slate-400">stars</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/60">
            <GitFork size={14} className="text-blue-400" />
            <span className="font-semibold text-white">{repository.forks.toLocaleString()}</span>
            <span className="text-slate-400">forks</span>
          </div>

          {repository.primaryLanguage && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/60">
              <Code2 size={14} className="text-emerald-400" />
              <span className="font-medium text-white">{repository.primaryLanguage}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/60">
            <GitBranch size={14} className="text-purple-400" />
            <span className="text-slate-300">{repository.defaultBranch}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 rounded-lg border border-slate-700/60 text-slate-400">
            <Calendar size={14} />
            <span>Analyzed {new Date(analyzedAt).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
