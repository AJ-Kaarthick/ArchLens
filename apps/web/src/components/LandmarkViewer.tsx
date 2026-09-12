import React, { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import type { LandmarkContent } from '@archlens/shared';
import { X, FileText, AlertTriangle, Copy, Check } from 'lucide-react';
import { Badge } from './ui/Badge.tsx';

interface LandmarkViewerProps {
  content: LandmarkContent | null;
  loading: boolean;
  onClose: () => void;
}

export const LandmarkViewer: React.FC<LandmarkViewerProps> = ({ content, loading, onClose }) => {
  const [copied, setCopied] = useState(false);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (content || loading) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [content, loading, handleKeyDown]);

  if (!content && !loading) return null;

  const handleCopy = async () => {
    if (!content?.content) return;
    try {
      await navigator.clipboard.writeText(content.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const isMarkdown =
    content?.name.toLowerCase().endsWith('.md') ||
    content?.name.toLowerCase().endsWith('.markdown');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="landmark-viewer-title"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-3 truncate pr-4">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              <FileText size={16} />
            </div>
            <div className="truncate">
              <h3
                id="landmark-viewer-title"
                className="font-mono text-xs sm:text-sm font-semibold text-white truncate"
              >
                {content?.path || 'Loading file content...'}
              </h3>
              {content && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {(content.size / 1024).toFixed(1)} KB
                  </span>
                  <span className="text-slate-600">•</span>
                  <Badge variant="neutral" size="xs" mono>
                    {content.encoding || 'utf-8'}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {content?.content && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg border border-slate-700/80 transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                title="Copy entire file content"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              aria-label="Close landmark viewer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Content Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-950/40 text-sm">
          {loading ? (
            <div className="py-20 text-center text-slate-400 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">Fetching landmark content from GitHub API...</span>
            </div>
          ) : content ? (
            <div className="space-y-4">
              {content.isTruncated && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl flex items-center gap-2.5 text-xs text-amber-300">
                  <AlertTriangle size={16} className="shrink-0 text-amber-400" />
                  <span>
                    This file exceeded the 256 KB landmark preview bound and has been truncated.
                  </span>
                </div>
              )}

              {isMarkdown ? (
                <article className="prose prose-invert max-w-none text-slate-300 space-y-4 leading-relaxed [&>h1]:text-2xl [&>h1]:font-bold [&>h1]:text-white [&>h1]:pb-2 [&>h1]:border-b [&>h1]:border-slate-800 [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:text-white [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-slate-200 [&>p]:text-slate-300 [&>p]:text-xs sm:[&>p]:text-sm [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-slate-950 [&>pre]:p-4 [&>pre]:rounded-xl [&>pre]:border [&>pre]:border-slate-800 [&>pre]:overflow-x-auto [&>code]:bg-slate-800 [&>code]:px-1.5 [&>code]:py-0.5 [&>code]:rounded [&>code]:text-blue-300 [&>a]:text-blue-400 hover:[&>a]:underline [&>table]:w-full [&>table]:border-collapse [&>table]:text-xs [&>table_th]:border [&>table_th]:border-slate-800 [&>table_th]:p-2 [&>table_th]:bg-slate-900 [&>table_td]:border [&>table_td]:border-slate-800 [&>table_td]:p-2">
                  <Markdown>{content.content}</Markdown>
                </article>
              ) : (
                <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950 font-mono text-xs">
                  <pre className="p-4 text-slate-200 leading-relaxed overflow-x-auto">
                    <code>{content.content}</code>
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
