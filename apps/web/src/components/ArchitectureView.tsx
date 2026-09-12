import React from 'react';
import type { ArchitectureOverview, LandmarkInfo } from '@archlens/shared';
import {
  Layers,
  Box,
  Compass,
  FileCode2,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';

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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Monorepo Info */}
        <Card variant="default">
          <CardHeader>
            <CardTitle>
              <Box size={16} className="text-indigo-400" />
              Repository Structure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">Type:</span>
              <Badge
                variant={architecture.isMonorepo ? 'purple' : 'default'}
                size="sm"
                icon={<CheckCircle2 size={11} />}
              >
                {architecture.isMonorepo ? 'Monorepo' : 'Standard Single Repository'}
              </Badge>

              {architecture.monorepoTool && (
                <span className="text-xs text-slate-400">
                  via{' '}
                  <strong className="text-slate-200 font-semibold">
                    {architecture.monorepoTool}
                  </strong>
                </span>
              )}
            </div>

            {architecture.workspaces.length > 0 ? (
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Declared Workspaces ({architecture.workspaces.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {architecture.workspaces.map((ws, i) => (
                    <span
                      key={i}
                      className="font-mono text-xs px-2.5 py-1 bg-slate-950/80 text-indigo-300 rounded-md border border-slate-800"
                    >
                      {ws}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic pt-2 border-t border-slate-800/80">
                No workspace packages declared in root manifest.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Detected Patterns */}
        <Card variant="default">
          <CardHeader>
            <CardTitle>
              <Layers size={16} className="text-emerald-400" />
              Detected Architectural Patterns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {architecture.detectedPatterns.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {architecture.detectedPatterns.map((pattern, i) => (
                  <Badge key={i} variant="success" size="sm">
                    {pattern}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-slate-950/50 border border-slate-800/60 text-xs text-slate-400">
                No standard multi-layer or framework patterns detected from repository manifests.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Primary Entrypoints & Key Landmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Entrypoints */}
        <Card variant="default">
          <CardHeader>
            <CardTitle>
              <FileCode2 size={16} className="text-blue-400" />
              Primary Runtime Entrypoints
            </CardTitle>
          </CardHeader>
          <CardContent>
            {architecture.primaryEntrypoints.length > 0 ? (
              <ul className="divide-y divide-slate-800/80">
                {architecture.primaryEntrypoints.map((entry, i) => (
                  <li
                    key={i}
                    className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between text-xs"
                  >
                    <span className="font-mono text-slate-200 bg-slate-950/80 px-2 py-1 rounded border border-slate-800">
                      {entry}
                    </span>
                    <Badge variant="primary" size="xs">
                      Entrypoint
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 italic">No canonical entrypoint detected.</p>
            )}
          </CardContent>
        </Card>

        {/* Key Landmarks */}
        <Card variant="default">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                <Compass size={16} className="text-amber-400" />
                Key Repository Landmarks
              </CardTitle>
              <span className="text-[11px] text-slate-500">
                {architecture.keyLandmarks.length} identified
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {architecture.keyLandmarks.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {architecture.keyLandmarks.map((landmark, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSelectLandmark && onSelectLandmark(landmark)}
                    className="w-full text-left p-3 rounded-lg bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-200 group-hover:text-blue-400 transition-colors">
                          {landmark.path}
                        </span>
                        <Badge variant="neutral" size="xs" mono>
                          {landmark.type}
                        </Badge>
                      </div>
                      {landmark.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-1">
                          {landmark.description}
                        </p>
                      )}
                    </div>
                    <ArrowRight
                      size={14}
                      className="text-slate-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition shrink-0 ml-2"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No key landmarks identified.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
