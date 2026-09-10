import React from 'react';
import type { ArchitectureOverview, LandmarkInfo } from '@archlens/shared';
import { Layers, Box, Compass, FileCode2, ArrowRight } from 'lucide-react';

interface ArchitectureViewProps {
  architecture: ArchitectureOverview;
  onSelectLandmark?: (_landmark: LandmarkInfo) => void;
}

export const ArchitectureView: React.FC<ArchitectureViewProps> = ({
  architecture,
  onSelectLandmark,
}) => {
  return (
    <div className="space-y-6">
      {/* Pattern & Monorepo Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monorepo Info */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-slate-200 font-semibold mb-3">
            <Box size={18} className="text-indigo-400" />
            Repository Structure
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Type:</span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-medium ${
                  architecture.isMonorepo
                    ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {architecture.isMonorepo ? 'Monorepo' : 'Standard Single Repository'}
              </span>
              {architecture.monorepoTool && (
                <span className="text-xs text-slate-400">
                  via <strong className="text-slate-200">{architecture.monorepoTool}</strong>
                </span>
              )}
            </div>

            {architecture.workspaces.length > 0 && (
              <div className="mt-3">
                <span className="text-xs text-slate-400 block mb-1">Declared Workspaces:</span>
                <div className="flex flex-wrap gap-1.5">
                  {architecture.workspaces.map((ws, i) => (
                    <span
                      key={i}
                      className="font-mono text-xs px-2 py-0.5 bg-slate-800 text-indigo-300 rounded border border-slate-700/60"
                    >
                      {ws}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Detected Patterns */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-slate-200 font-semibold mb-3">
            <Layers size={18} className="text-emerald-400" />
            Detected Architectural Patterns
          </div>

          {architecture.detectedPatterns.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {architecture.detectedPatterns.map((pattern, i) => (
                <span
                  key={i}
                  className="text-xs px-3 py-1 bg-emerald-950/60 text-emerald-300 border border-emerald-800/80 rounded-lg font-medium"
                >
                  {pattern}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No standard high-level patterns detected.</p>
          )}
        </div>
      </div>

      {/* Primary Entrypoints & Key Landmarks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Entrypoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-slate-200 font-semibold mb-3">
            <FileCode2 size={18} className="text-blue-400" />
            Primary Entrypoints
          </div>

          {architecture.primaryEntrypoints.length > 0 ? (
            <ul className="divide-y divide-slate-800">
              {architecture.primaryEntrypoints.map((entry, i) => (
                <li key={i} className="py-2 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-200">{entry}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">No canonical entrypoint detected.</p>
          )}
        </div>

        {/* Key Landmarks */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 text-slate-200 font-semibold mb-3">
            <Compass size={18} className="text-amber-400" />
            Key Repository Landmarks
          </div>

          {architecture.keyLandmarks.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {architecture.keyLandmarks.map((landmark, i) => (
                <button
                  key={i}
                  onClick={() => onSelectLandmark && onSelectLandmark(landmark)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 transition flex items-center justify-between group"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-200 group-hover:text-blue-400">
                        {landmark.path}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-slate-400">
                        {landmark.type}
                      </span>
                    </div>
                    {landmark.description && (
                      <p className="text-[11px] text-slate-400 mt-0.5">{landmark.description}</p>
                    )}
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-slate-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No key landmarks identified.</p>
          )}
        </div>
      </div>
    </div>
  );
};
