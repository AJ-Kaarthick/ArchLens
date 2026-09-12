import React, { useState, useEffect } from 'react';
import {
  Terminal,
  Play,
  Clock,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  FileCode,
  Globe,
  Sliders,
} from 'lucide-react';
import type {
  RepositoryMetadata,
  ExecutionEligibility,
  ExecutionResult,
  ExecutionProfile,
  ApiError,
} from '@archlens/shared';
import { Button } from './ui/Button.tsx';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';
import { Select } from './ui/Select.tsx';

interface ExecutionViewProps {
  repository: RepositoryMetadata;
}

export function ExecutionView({ repository }: ExecutionViewProps) {
  const [eligibility, setEligibility] = useState<ExecutionEligibility | null>(null);
  const [loadingEligibility, setLoadingEligibility] = useState(true);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  const [selectedProfile, setSelectedProfile] = useState<ExecutionProfile>('node-script');
  const [entrypoint, setEntrypoint] = useState<string>('');
  const [argsString, setArgsString] = useState<string>('');
  const [timeoutMs, setTimeoutMs] = useState<number>(5000);

  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<ApiError | null>(null);

  // Fetch eligibility on mount / repo change
  useEffect(() => {
    let cancelled = false;

    async function fetchEligibility() {
      setLoadingEligibility(true);
      setEligibilityError(null);
      setExecutionResult(null);
      setExecutionError(null);

      try {
        const res = await fetch(
          `/api/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(
            repository.name
          )}/eligibility`
        );
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setEligibilityError((data as ApiError).message || 'Failed to check eligibility');
        } else {
          const elig = data as ExecutionEligibility;
          setEligibility(elig);
          if (elig.recommendedProfile) {
            setSelectedProfile(elig.recommendedProfile);
          }
          if (elig.detectedEntrypoints.length > 0) {
            setEntrypoint(elig.detectedEntrypoints[0]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setEligibilityError((err as Error).message || 'Network error fetching eligibility.');
        }
      } finally {
        if (!cancelled) {
          setLoadingEligibility(false);
        }
      }
    }

    fetchEligibility();

    return () => {
      cancelled = true;
    };
  }, [repository.owner, repository.name]);

  const handleExecute = async () => {
    if (executing) return;

    setExecuting(true);
    setExecutionError(null);

    const args = argsString
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0);

    try {
      const res = await fetch(
        `/api/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(
          repository.name
        )}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: selectedProfile,
            entrypoint: entrypoint.trim() || undefined,
            args: args.length > 0 ? args : undefined,
            timeoutMs,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setExecutionError(data as ApiError);
      } else {
        setExecutionResult(data as ExecutionResult);
      }
    } catch (err) {
      setExecutionError({
        error: 'NetworkError',
        message: (err as Error).message || 'Failed to reach execution runner.',
        isRateLimit: false,
        suggestedAction: 'Ensure backend server is running and try again.',
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview & Security Disclosures */}
      <Card variant="default" className="border-slate-800/80 bg-slate-900/40">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                <Terminal size={18} className="text-emerald-400" />
                Sandboxed Repository Execution & Live Preview
              </CardTitle>
              <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
                Safely evaluate eligible repository entrypoints inside an ephemeral, client-agnostic
                sandbox environment. Untrusted code executes with zero access to host secrets, bounded
                memory, stripped network credentials, and hard timeout isolation.
              </p>
            </div>

            {eligibility && (
              <Badge
                variant={eligibility.eligible ? 'success' : 'warning'}
                className="self-start md:self-auto text-xs py-1 px-3"
              >
                {eligibility.eligible ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={13} />
                    Sandbox Eligible
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    Execution Refused
                  </span>
                )}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Security Guardrails Disclosure */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-2 text-[11px] text-slate-400 font-mono">
            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center gap-2">
              <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
              <span>Zero Host Secrets</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center gap-2">
              <Clock size={14} className="text-amber-400 shrink-0" />
              <span>Max 10s Timeout</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center gap-2">
              <FileCode size={14} className="text-blue-400 shrink-0" />
              <span>Max 25 Files / 2MB</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center gap-2">
              <Terminal size={14} className="text-purple-400 shrink-0" />
              <span>64 KB Bounded Buffer</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Eligibility Error Notice */}
      {eligibilityError && (
        <div className="p-4 rounded-xl bg-red-950/30 border border-red-800/60 text-red-200 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0 text-red-400" />
          <span>{eligibilityError}</span>
        </div>
      )}

      {/* Eligibility Refusal Notice */}
      {eligibility && !eligibility.eligible && (
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/60 text-amber-200 text-xs space-y-2">
          <div className="font-semibold flex items-center gap-2 text-amber-300">
            <AlertTriangle size={15} />
            Execution Refused: {eligibility.refusalReason || 'Policy Boundary'}
          </div>
          <p className="leading-relaxed opacity-90">{eligibility.reasonMessage}</p>
          <div className="text-[11px] text-amber-400/80 font-mono">
            Supported in Phase 6: Standalone Node scripts (node-script) & static HTML/CSS/JS (static-web).
          </div>
        </div>
      )}

      {/* Warnings */}
      {eligibility && eligibility.warnings.length > 0 && (
        <div className="space-y-1.5">
          {eligibility.warnings.map((w, idx) => (
            <div
              key={idx}
              className="p-3 rounded-lg bg-blue-950/20 border border-blue-800/40 text-blue-300 text-xs flex items-center gap-2"
            >
              <AlertCircle size={14} className="shrink-0 text-blue-400" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Configuration & Controls */}
      <Card variant="default" className="border-slate-800/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
            <Sliders size={16} className="text-blue-400" />
            Execution Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Profile Selection */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Execution Profile
              </label>
              <Select
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value as ExecutionProfile)}
                disabled={executing}
                className="w-full text-xs"
              >
                <option value="node-script">Node.js Script (node-script)</option>
                <option value="static-web">Static Web Preview (static-web)</option>
              </Select>
            </div>

            {/* Entrypoint Selection / Input */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Entrypoint File
              </label>
              {eligibility && eligibility.detectedEntrypoints.length > 0 ? (
                <div className="space-y-1.5">
                  <Select
                    value={entrypoint}
                    onChange={(e) => setEntrypoint(e.target.value)}
                    disabled={executing}
                    className="w-full text-xs font-mono"
                  >
                    {eligibility.detectedEntrypoints.map((ep) => (
                      <option key={ep} value={ep}>
                        {ep}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. index.js or index.html"
                  value={entrypoint}
                  onChange={(e) => setEntrypoint(e.target.value)}
                  disabled={executing}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>

            {/* Timeout Selection */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Timeout (ms)
              </label>
              <Select
                value={String(timeoutMs)}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
                disabled={executing}
                className="w-full text-xs font-mono"
              >
                <option value="1000">1,000 ms (Fast)</option>
                <option value="3000">3,000 ms (Standard)</option>
                <option value="5000">5,000 ms (Default)</option>
                <option value="10000">10,000 ms (Maximum)</option>
              </Select>
            </div>
          </div>

          {/* Arguments Input for Node Script */}
          {selectedProfile === 'node-script' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Command Line Arguments (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. --help or arg1 arg2"
                value={argsString}
                onChange={(e) => setArgsString(e.target.value)}
                disabled={executing}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="pt-2 flex items-center justify-between">
            <div className="text-[11px] text-slate-500 font-mono">
              Process Group Isolation • V8 Heap Guard • No Docker Required
            </div>

            <Button
              variant="primary"
              size="md"
              loading={executing}
              disabled={
                executing ||
                loadingEligibility ||
                Boolean(eligibility && !eligibility.eligible)
              }
              onClick={handleExecute}
              icon={selectedProfile === 'static-web' ? <Globe size={14} /> : <Play size={14} />}
              className="px-5 text-xs"
            >
              {executing
                ? 'Running in Sandbox...'
                : selectedProfile === 'static-web'
                ? 'Prepare Live Preview'
                : 'Run in Sandbox'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Execution Error Notice */}
      {executionError && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/80 text-red-200 text-xs space-y-1.5">
          <div className="font-semibold flex items-center gap-2 text-red-300">
            <AlertCircle size={15} />
            Execution Failure: {executionError.error}
          </div>
          <p className="opacity-90">{executionError.message}</p>
          {executionError.suggestedAction && (
            <div className="text-[11px] text-red-300/80 pt-1">
              <strong>Suggestion:</strong> {executionError.suggestedAction}
            </div>
          )}
        </div>
      )}

      {/* Execution Result View */}
      {executionResult && (
        <div className="space-y-4">
          {/* Metadata bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <div className="flex items-center gap-3">
              <Badge
                variant={
                  executionResult.status === 'success'
                    ? 'success'
                    : executionResult.status === 'timeout'
                    ? 'danger'
                    : executionResult.status === 'refused'
                    ? 'warning'
                    : 'danger'
                }
              >
                Status: {executionResult.status.toUpperCase()}
              </Badge>

              {executionResult.exitCode !== null && (
                <span className="font-mono text-slate-400">
                  Exit Code:{' '}
                  <span
                    className={
                      executionResult.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {executionResult.exitCode}
                  </span>
                </span>
              )}

              <span className="font-mono text-slate-400">
                Duration:{' '}
                <span className="text-slate-200">{executionResult.durationMs}ms</span>
              </span>
            </div>

            <div className="font-mono text-[11px] text-slate-500">
              ID: {executionResult.executionId}
            </div>
          </div>

          {/* Refusal Message */}
          {executionResult.refusalMessage && (
            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/60 text-amber-200 text-xs">
              <strong>Refusal Reason ({executionResult.refusalReason}):</strong>{' '}
              {executionResult.refusalMessage}
            </div>
          )}

          {/* Live Preview Display for Static Web */}
          {executionResult.preview && executionResult.preview.previewUrl && (
            <Card variant="default" className="border-slate-800/80 overflow-hidden">
              <CardHeader className="bg-slate-950 border-b border-slate-800/80 py-2.5 px-4 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                  <Globe size={14} className="text-cyan-400" />
                  <span>Live Static Preview</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">{executionResult.preview.entrypoint}</span>
                </div>

                <a
                  href={executionResult.preview.previewUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1.5 transition"
                >
                  <span>Open in New Tab</span>
                  <ExternalLink size={12} />
                </a>
              </CardHeader>
              <CardContent className="p-0 bg-white">
                <iframe
                  src={executionResult.preview.previewUrl}
                  title="ArchLens Live Sandboxed Preview"
                  sandbox="allow-scripts allow-same-origin"
                  className="w-full h-96 border-none"
                />
              </CardContent>
            </Card>
          )}

          {/* Console / Terminal Output */}
          <Card variant="default" className="border-slate-800/80 overflow-hidden">
            <CardHeader className="bg-slate-950 border-b border-slate-800/80 py-2.5 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <Terminal size={14} className="text-emerald-400" />
                <span>Console Output</span>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {new TextEncoder().encode(executionResult.stdout + executionResult.stderr).length} bytes
              </span>
            </CardHeader>
            <CardContent className="p-0 bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed overflow-x-auto max-h-96 divide-y divide-slate-900">
              {executionResult.stdout && (
                <div className="p-4 whitespace-pre font-mono">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 select-none">
                    stdout
                  </div>
                  <div className="text-emerald-200/90">{executionResult.stdout}</div>
                </div>
              )}

              {executionResult.stderr && (
                <div className="p-4 whitespace-pre font-mono bg-red-950/10">
                  <div className="text-[10px] uppercase tracking-wider text-rose-500 font-semibold mb-1 select-none">
                    stderr
                  </div>
                  <div className="text-rose-300/90">{executionResult.stderr}</div>
                </div>
              )}

              {!executionResult.stdout && !executionResult.stderr && (
                <div className="p-6 text-center text-slate-600 font-mono text-xs">
                  (No output received)
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
