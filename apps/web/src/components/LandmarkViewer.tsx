import React from 'react';
import Markdown from 'react-markdown';
import type { LandmarkContent } from '@archlens/shared';
import { X, FileText, AlertTriangle } from 'lucide-react';

interface LandmarkViewerProps {
  content: LandmarkContent | null;
  loading: boolean;
  onClose: () => void;
}

export const LandmarkViewer: React.FC<LandmarkViewerProps> = ({ content, loading, onClose }) => {
  if (!content && !loading) return null;

  const isMarkdown =
    content?.name.toLowerCase().endsWith('.md') ||
    content?.name.toLowerCase().endsWith('.markdown');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-blue-400" />
            <div>
              <h3 className="font-mono text-sm font-semibold text-white">
                {content?.path || 'Loading file...'}
              </h3>
              {content && (
                <span className="text-[11px] text-slate-400">
                  {(content.size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-950/30 text-sm">
          {loading ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span>Fetching landmark content...</span>
            </div>
          ) : content ? (
            <div className="space-y-4">
              {content.isTruncated && (
                <div className="p-3 bg-amber-950/50 border border-amber-800/80 rounded-lg flex items-center gap-2 text-xs text-amber-300">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>This file exceeded the bounded preview size limit and was truncated.</span>
                </div>
              )}

              {isMarkdown ? (
                <article className="prose prose-invert max-w-none text-slate-300 space-y-4 leading-relaxed [&>h1]:text-2xl [&>h1]:font-bold [&>h1]:text-white [&>h1]:pb-2 [&>h1]:border-b [&>h1]:border-slate-800 [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:text-white [&>h3]:text-lg [&>h3]:font-medium [&>h3]:text-slate-200 [&>p]:text-slate-300 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-slate-900 [&>pre]:p-4 [&>pre]:rounded-lg [&>pre]:overflow-x-auto [&>code]:bg-slate-800 [&>code]:px-1.5 [&>code]:py-0.5 [&>code]:rounded [&>code]:text-blue-300 [&>a]:text-blue-400 hover:[&>a]:underline">
                  <Markdown>{content.content}</Markdown>
                </article>
              ) : (
                <pre className="font-mono text-xs bg-slate-900/80 p-4 rounded-xl border border-slate-800 overflow-x-auto text-slate-200 leading-relaxed">
                  <code>{content.content}</code>
                </pre>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
