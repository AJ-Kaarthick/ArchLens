import React from 'react';
import type { StructuralMetrics } from '@archlens/shared';
import { BarChart3, HardDrive, Files, FileCode } from 'lucide-react';

interface MetricsViewProps {
  metrics: StructuralMetrics;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LANGUAGE_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-cyan-500',
  'bg-red-500',
  'bg-indigo-500',
];

export const MetricsView: React.FC<MetricsViewProps> = ({ metrics }) => {
  const languageList = Object.entries(metrics.languages).sort(([, a], [, b]) => b.bytes - a.bytes);

  const categoryList = Object.entries(metrics.categories).sort(([, a], [, b]) => b.bytes - a.bytes);

  return (
    <div className="space-y-6">
      {/* Top Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
          <div className="p-3 bg-blue-950/60 text-blue-400 border border-blue-900/60 rounded-lg">
            <Files size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {metrics.totalFiles.toLocaleString()}
            </div>
            <div className="text-xs text-slate-400">Total Indexed Files</div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
          <div className="p-3 bg-purple-950/60 text-purple-400 border border-purple-900/60 rounded-lg">
            <HardDrive size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{formatBytes(metrics.totalBytes)}</div>
            <div className="text-xs text-slate-400">Total Codebase Size</div>
          </div>
        </div>
      </div>

      {/* Languages Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
          <BarChart3 size={16} className="text-blue-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Language Composition
          </h3>
        </div>

        {/* Stacked Percentage Bar */}
        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex mb-4">
          {languageList.map(([lang, stat], i) => (
            <div
              key={lang}
              className={`${LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]}`}
              style={{ width: `${stat.percentage}%` }}
              title={`${lang}: ${stat.percentage}%`}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {languageList.map(([lang, stat], i) => (
            <div key={lang} className="p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/60">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]}`}
                />
                <span className="text-xs font-semibold text-slate-200">{lang}</span>
              </div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-white font-bold">{stat.percentage}%</span>
                <span className="text-slate-400 text-[11px]">{formatBytes(stat.bytes)}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">{stat.fileCount} files</div>
            </div>
          ))}
        </div>
      </div>

      {/* Categories Breakdown & Largest Files */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Categories */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3 pb-2 border-b border-slate-800">
            File Categories Breakdown
          </h3>

          <div className="space-y-2">
            {categoryList.map(([cat, stat]) => (
              <div
                key={cat}
                className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60"
              >
                <span className="font-medium text-slate-300 uppercase text-[11px] tracking-wider">
                  {cat}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">{stat.fileCount} files</span>
                  <span className="font-mono text-slate-300">{formatBytes(stat.bytes)}</span>
                  <span className="font-bold text-white w-12 text-right">{stat.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Largest Files */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3 pb-2 border-b border-slate-800">
            Largest Files (Top 10)
          </h3>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {metrics.largestFiles.map((file, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60"
              >
                <div className="flex items-center gap-2 truncate max-w-[260px]">
                  <FileCode size={13} className="text-slate-400 shrink-0" />
                  <span className="font-mono text-slate-300 truncate" title={file.path}>
                    {file.path}
                  </span>
                </div>
                <span className="font-mono text-slate-400 text-[11px] shrink-0">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
