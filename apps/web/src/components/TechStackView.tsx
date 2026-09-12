import React from 'react';
import type { TechStackDetection, TechCategory } from '@archlens/shared';
import { Cpu, CheckCircle, HelpCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';

interface TechStackViewProps {
  techStack: TechStackDetection[];
}

const CATEGORY_LABELS: Record<TechCategory, string> = {
  framework: 'Frameworks & Libraries',
  runtime: 'Runtimes & Environments',
  styling: 'Styling & UI',
  testing: 'Testing & Quality',
  build: 'Build Tools & Bundlers',
  database: 'Databases & ORMs',
  ci: 'CI / CD & Workflows',
  language: 'Programming Languages',
};

export const TechStackView: React.FC<TechStackViewProps> = ({ techStack }) => {
  // Group by category
  const grouped = techStack.reduce<Record<string, TechStackDetection[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const categories = Object.keys(grouped) as TechCategory[];

  if (techStack.length === 0) {
    return (
      <Card variant="default">
        <CardContent className="p-12 text-center text-slate-400 text-xs">
          No third-party framework manifests or package dependencies detected.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {categories.map((cat) => (
          <Card key={cat} variant="default" className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs uppercase tracking-wider text-slate-300">
                  <Cpu size={15} className="text-cyan-400" />
                  {CATEGORY_LABELS[cat] || cat}
                </CardTitle>
                <span className="text-[11px] font-mono text-slate-500">
                  {grouped[cat].length}
                </span>
              </div>
            </CardHeader>

            <CardContent className="space-y-2.5 flex-1 pt-3">
              {grouped[cat].map((item, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 hover:border-slate-700 transition space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white truncate" title={item.name}>
                      {item.name}
                    </span>
                    {item.version && (
                      <Badge variant="cyan" size="xs" mono>
                        v{item.version}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                    <span
                      className="font-mono text-[10px] text-slate-500 truncate max-w-[180px]"
                      title={item.evidence}
                    >
                      {item.evidence}
                    </span>

                    <Badge
                      variant={item.confidence === 'high' ? 'success' : 'warning'}
                      size="xs"
                      icon={
                        item.confidence === 'high' ? (
                          <CheckCircle size={10} />
                        ) : (
                          <HelpCircle size={10} />
                        )
                      }
                    >
                      {item.confidence}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
