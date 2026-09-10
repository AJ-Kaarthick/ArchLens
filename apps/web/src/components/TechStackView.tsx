import React from 'react';
import type { TechStackDetection, TechCategory } from '@archlens/shared';
import { Cpu, CheckCircle, HelpCircle } from 'lucide-react';

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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">
        No specific tech stack dependencies or tools detected.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => (
          <div
            key={cat}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
              <Cpu size={16} className="text-cyan-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                {CATEGORY_LABELS[cat] || cat}
              </h3>
            </div>

            <div className="space-y-2.5 flex-1">
              {grouped[cat].map((item, idx) => (
                <div
                  key={idx}
                  className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 hover:border-slate-600 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{item.name}</span>
                    {item.version && (
                      <span className="font-mono text-xs px-2 py-0.5 bg-slate-900 text-cyan-300 rounded border border-slate-700">
                        v{item.version}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate max-w-[200px]" title={item.evidence}>
                      {item.evidence}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        item.confidence === 'high'
                          ? 'bg-emerald-950 text-emerald-400'
                          : 'bg-amber-950 text-amber-400'
                      }`}
                    >
                      {item.confidence === 'high' ? (
                        <CheckCircle size={10} />
                      ) : (
                        <HelpCircle size={10} />
                      )}
                      {item.confidence}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
