import React from 'react';
import type { StructuralMetrics } from '@archlens/shared';
import { BarChart3, HardDrive, Files, FileCode, PieChart } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';

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
  'bg-cyan-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-rose-500',
  'bg-slate-500',
];

export const MetricsView: React.FC<MetricsViewProps> = ({ metrics }) => {
  const languageList = Object.entries(metrics.languages).sort(([, a], [, b]) => b.bytes - a.bytes);
  const categoryList = Object.entries(metrics.categories).sort(([, a], [, b]) => b.bytes - a.bytes);

  return (
    <div className="space-y-6">
      {/* Top Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Card variant="default">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-xl shrink-0">
              <Files size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-white tracking-tight">
                {metrics.totalFiles.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 font-medium">Total Indexed Files</div>
            </div>
          </CardContent>
        </Card>

        <Card variant="default">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl shrink-0">
              <HardDrive size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-white tracking-tight">
                {formatBytes(metrics.totalBytes)}
              </div>
              <div className="text-xs text-slate-400 font-medium">Total Codebase Size</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Language Composition Breakdown */}
      <Card variant="default">
        <CardHeader className="pb-3">
          <CardTitle>
            <BarChart3 size={16} className="text-blue-400" />
            Language Composition
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stacked Percentage Bar */}
          <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
            {languageList.map(([lang, stat], i) => (
              <div
                key={lang}
                className={`${LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]} transition-all duration-300`}
                style={{ width: `${Math.max(stat.percentage, 0.5)}%` }}
                title={`${lang}: ${stat.percentage}% (${formatBytes(stat.bytes)})`}
              />
            ))}
          </div>

          {/* Language Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-1">
            {languageList.map(([lang, stat], i) => (
              <div
                key={lang}
                className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${LANGUAGE_COLORS[i % LANGUAGE_COLORS.length]}`}
                  />
                  <span className="text-xs font-semibold text-slate-200 truncate">{lang}</span>
                </div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-white font-bold">{stat.percentage}%</span>
                  <span className="text-slate-400 font-mono text-[11px]">
                    {formatBytes(stat.bytes)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">{stat.fileCount} files</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Categories Breakdown & Largest Files */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Categories */}
        <Card variant="default">
          <CardHeader>
            <CardTitle>
              <PieChart size={16} className="text-emerald-400" />
              File Categories Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 divide-y divide-slate-800/60">
              {categoryList.map(([cat, stat]) => (
                <div
                  key={cat}
                  className="flex items-center justify-between text-xs py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="font-medium text-slate-300 uppercase text-[11px] tracking-wider font-mono">
                    {cat}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 text-[11px]">{stat.fileCount} files</span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      {formatBytes(stat.bytes)}
                    </span>
                    <Badge variant="neutral" size="xs" mono className="w-12 text-right justify-end">
                      {stat.percentage}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Largest Files */}
        <Card variant="default">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                <FileCode size={16} className="text-amber-400" />
                Largest Files (Top 10)
              </CardTitle>
              <span className="text-[11px] text-slate-500 font-mono">by raw bytes</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 divide-y divide-slate-800/60 max-h-72 overflow-y-auto pr-1">
              {metrics.largestFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs py-2 first:pt-0 last:pb-0 gap-2"
                >
                  <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                    <span className="font-mono text-[10px] text-slate-600 w-4 text-right shrink-0">
                      {i + 1}.
                    </span>
                    <span className="font-mono text-slate-300 truncate text-xs" title={file.path}>
                      {file.path}
                    </span>
                  </div>
                  <span className="font-mono text-slate-400 text-[11px] shrink-0">
                    {formatBytes(file.size)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
