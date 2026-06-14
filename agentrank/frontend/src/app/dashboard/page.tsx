"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchAgents, type Agent } from "@/lib/api";
import { AgentCard } from "@/components/AgentCard";
import { SearchFilters } from "@/components/SearchFilters";
import { IngestPanel } from "@/components/IngestPanel";
import { BigQueryBadge } from "@/components/BigQueryBadge";

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [x402Only, setX402Only] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [ensLinkedOnly, setEnsLinkedOnly] = useState(false);
  const [minScore, setMinScore] = useState("");
  const [showIngest, setShowIngest] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAgents({
        q: q || undefined,
        x402Support: x402Only || undefined,
        active: activeOnly || undefined,
        ensLinked: ensLinkedOnly || undefined,
        minScore: minScore ? parseFloat(minScore) : undefined,
        sort: "score",
        limit: 50,
      });
      setAgents(res.agents);
      setTotal(res.total);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [q, x402Only, activeOnly, ensLinkedOnly, minScore]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-sm font-bold text-white">
              AR
            </div>
            <div>
              <span className="font-bold text-slate-900">AgentRank</span>
              <span className="text-slate-400 text-xs ml-2">ERC-8004 Trust API</span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-all"
            >
              ← Home
            </Link>
            <Link
              href="/analytics"
              className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-all"
            >
              Analytics
            </Link>
            <Link
              href="/verify-wallet"
              className="text-xs text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-300 px-3 py-1.5 rounded-lg transition-all"
            >
              ✓ Verify Wallet
            </Link>
            <button
              onClick={() => setShowIngest((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-all"
            >
              {showIngest ? "Hide" : "Ingest Data"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            Agent Trust{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
              Leaderboard
            </span>
          </h1>
          <p className="text-slate-600 text-sm max-w-xl">
            Before your agent pays another agent, call AgentRank. Real-time trust
            scores from ERC-8004 Identity and Reputation registries on Ethereum mainnet.
          </p>
        </div>

        {showIngest && (
          <div className="mb-6">
            <IngestPanel />
          </div>
        )}

        <div className="mb-6">
          <SearchFilters
            q={q}
            x402Only={x402Only}
            activeOnly={activeOnly}
            ensLinkedOnly={ensLinkedOnly}
            minScore={minScore}
            onChange={(u) => {
              if (u.q !== undefined) setQ(u.q);
              if (u.x402Only !== undefined) setX402Only(u.x402Only);
              if (u.activeOnly !== undefined) setActiveOnly(u.activeOnly);
              if (u.ensLinkedOnly !== undefined) setEnsLinkedOnly(u.ensLinkedOnly);
              if (u.minScore !== undefined) setMinScore(u.minScore);
            }}
          />
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500 mb-6 flex-wrap">
          <span>{total} agents indexed</span>
          <span>·</span>
          <span>Sorted by trust score</span>
          {x402Only && (
            <>
              <span>·</span>
              <span className="text-teal-600">x402 filter active</span>
            </>
          )}
          <BigQueryBadge className="ml-auto" />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse h-44" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-lg mb-2">No agents found</p>
            <p className="text-sm">Run ingestion to pull data from BigQuery</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((a) => (
              <AgentCard key={a.agentId} agent={a} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
