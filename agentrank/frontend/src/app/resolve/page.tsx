"use client";
import { useState } from "react";
import Link from "next/link";
import { resolveEnsName, type ResolvedAgentProfile } from "@/lib/api";
import { TrustBadge, ScoreBar } from "@/components/TrustBadge";
import { shortAddr } from "@/lib/format";

export default function ResolvePage() {
  const [ensName, setEnsName] = useState("");
  const [result, setResult] = useState<ResolvedAgentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleResolve() {
    if (!ensName.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await resolveEnsName(ensName.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve ENS name");
    } finally {
      setLoading(false);
    }
  }

  const score = result?.trust?.trustScore ?? 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-900 text-sm transition-colors">
            ← Back
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-xs font-bold text-white">
              AR
            </div>
            <span className="font-bold text-slate-900 text-sm">AgentRank</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Resolve ENS Passport</h1>
          <p className="text-slate-500 text-sm">
            Look up an agent by its AgentRank ENS Passport name, e.g.{" "}
            <span className="font-mono text-slate-700">pocketchange.agentrank.eth</span>
          </p>
        </div>

        <div className="flex gap-2">
          <input
            value={ensName}
            onChange={(e) => setEnsName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleResolve()}
            placeholder="pocketchange.agentrank.eth"
            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:border-teal-500"
          />
          <button
            onClick={handleResolve}
            disabled={loading}
            className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? "Resolving..." : "Resolve"}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">
                  {result.agent.name || `Agent #${result.agent.agentId}`}
                </h2>
                <p className="text-slate-500 text-xs font-mono">{result.ensName}</p>
              </div>
              {result.trust && <TrustBadge riskLevel={result.trust.riskLevel} score={score} />}
            </div>

            {result.agent.description && (
              <p className="text-slate-600 text-sm">{result.agent.description}</p>
            )}

            {result.trust && (
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                  <span>Trust Score</span>
                  <span className="font-semibold text-slate-900">{Math.round(score)} / 100</span>
                </div>
                <ScoreBar score={score} />
              </div>
            )}

            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Agent ID</span>
                <span className="text-slate-800 font-mono text-xs">{result.agent.agentId}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Owner</span>
                <span className="text-slate-800 font-mono text-xs">{shortAddr(result.agent.ownerAddress)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">x402 Support</span>
                <span className="text-slate-800 text-xs">{result.agent.x402Support ? "Yes" : "No"}</span>
              </div>
              {result.agent.agentUri && (
                <div className="pt-1">
                  <span className="text-slate-500 text-xs">Agent URI</span>
                  <p className="text-slate-500 text-xs font-mono break-all mt-0.5">{result.agent.agentUri}</p>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200">
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                  result.ensPassport.verified
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-orange-50 text-orange-700 border-orange-200"
                }`}
              >
                ENS Passport {result.ensPassport.status ?? "unknown"}
              </span>
            </div>

            <Link
              href={`/agents/${result.agent.agentId}`}
              className="inline-block text-xs font-semibold text-teal-700 hover:text-teal-800 transition-colors"
            >
              View full AgentRank profile →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
