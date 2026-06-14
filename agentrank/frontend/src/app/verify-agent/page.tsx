"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { IDKitRequestWidget } from "@worldcoin/idkit";
import { orbLegacy } from "@worldcoin/idkit-core";
import type { RpContext as IdkitRpContext } from "@worldcoin/idkit-core";
import {
  fetchAgentKitRpContext,
  fetchAgentKitStatus,
  fetchAgentKitChallenge,
  verifyAgentKit,
  checkAgentBook,
  type VerifyAgentKitResult,
  type AgentKitStatus,
  type AgentBookCheckResult,
} from "@/lib/api";

const APP_ID = (process.env.NEXT_PUBLIC_WORLD_ID_APP_ID || "") as `app_${string}`;
const WORLD_ID_ENV =
  process.env.NEXT_PUBLIC_WORLD_ID_ENV === "staging" ? "staging" : "production";
const ACTION = "agentrank-agent";

const RISK_COLOR: Record<string, string> = {
  low: "text-emerald-700",
  medium: "text-yellow-700",
  high: "text-red-700",
};

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
function injectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

export default function VerifyAgentPage() {
  const [wallet, setWallet] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [rpContext, setRpContext] = useState<IdkitRpContext | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "verified" | "error">("idle");
  const [alreadyBacked, setAlreadyBacked] = useState(false);
  const [result, setResult] = useState<VerifyAgentKitResult | null>(null);
  const [existing, setExisting] = useState<AgentKitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookChecking, setBookChecking] = useState(false);
  const [bookResult, setBookResult] = useState<AgentBookCheckResult | null>(null);
  const signatureRef = useRef("");

  // The REAL AgentKit path: resolve the wallet against World's on-chain AgentBook
  // via the SDK (no scan/signature needed — AgentBook is the source of truth).
  async function runAgentBookCheck() {
    setError(null);
    setBookResult(null);
    setBookChecking(true);
    try {
      const r = await checkAgentBook(wallet);
      setBookResult(r);
      if (r.humanBacked) setStatus("verified");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AgentBook check failed");
    } finally {
      setBookChecking(false);
    }
  }

  async function connectWallet() {
    setError(null);
    const eth = injectedProvider();
    if (!eth) {
      setError("No browser wallet found. Install MetaMask (or similar) to prove agent-wallet control.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = (accounts?.[0] || "").toLowerCase();
      if (!addr) throw new Error("No account returned by wallet");
      setWallet(addr);
      setStatus("idle");
      setResult(null);
      setAlreadyBacked(false);
      setExisting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }

  async function startVerification() {
    setError(null);
    setResult(null);
    setExisting(null);
    setAlreadyBacked(false);
    setStatus("loading");
    try {
      const cur = await fetchAgentKitStatus(wallet);
      if (cur.humanBacked) {
        setExisting(cur);
        setAlreadyBacked(true);
        setStatus("verified");
        return;
      }
      const eth = injectedProvider();
      if (!eth) throw new Error("No browser wallet found");
      const message = await fetchAgentKitChallenge(wallet);
      const sig = (await eth.request({
        method: "personal_sign",
        params: [message, wallet],
      })) as string;
      signatureRef.current = sig;

      const ctx = await fetchAgentKitRpContext();
      setRpContext(ctx);
      setWidgetOpen(true);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start verification");
      setStatus("error");
    }
  }

  const selfAgents = (result?.agents ?? []).filter((a) => a.isSelf);
  const ratedAgents = (result?.agents ?? []).filter((a) => !a.isSelf);

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
            <span className="text-slate-400 text-xs">· Human-Backed Agent (AgentKit)</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-3">
            Prove your agent is{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
              human-backed
            </span>
          </h1>
          <p className="text-slate-600 text-sm leading-relaxed">
            With AgentKit (Delegated World ID), a unique human stands behind an
            agent without revealing who. You <span className="text-slate-800">sign
            with the agent&apos;s wallet</span> to prove you operate it, and prove
            with your <span className="text-slate-800">World ID</span> that a real
            human backs it. The agent gains a human-backing bonus, and any feedback
            it leaves counts more than an anonymous bot. One human can back a whole
            fleet — and all of them resolve to the same person, so a fleet can&apos;t
            out-vote real humans.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">
              Step 1 · Connect the agent&apos;s wallet
            </label>
            {wallet ? (
              <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                <span className="text-sm font-mono text-emerald-700 truncate">{wallet}</span>
                <button onClick={connectWallet} className="text-xs text-slate-500 hover:text-slate-900 shrink-0">
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                disabled={connecting}
                className="w-full text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 px-6 py-3 rounded-lg transition-all"
              >
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>

          {/* Step 2a — the REAL AgentKit path: read AgentBook on World Chain */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">
              Step 2 · Check AgentBook (real AgentKit)
            </label>
            <button
              onClick={runAgentBookCheck}
              disabled={!wallet || bookChecking}
              className="w-full text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 px-6 py-3 rounded-lg transition-all"
            >
              {bookChecking ? "Querying World Chain…" : "Check AgentBook on World Chain"}
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Resolves the wallet against World&apos;s on-chain AgentBook via the
              AgentKit SDK. No scan needed — AgentBook is the source of truth.
            </p>
          </div>

          {bookResult && !bookResult.humanBacked && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              Not human-backed in AgentBook yet. Register this agent via World&apos;s
              AgentKit delegation flow, or use the demo stand-in below.
            </div>
          )}

          {/* Step 2b — demo stand-in (Delegated World ID + signature) */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">
              Or · Demo stand-in (Delegated World ID)
            </label>
            <button
              onClick={startVerification}
              disabled={!wallet || status === "loading"}
              className="w-full text-sm font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 disabled:bg-slate-50 disabled:text-slate-400 px-6 py-3 rounded-lg transition-all"
            >
              {status === "loading" ? "Awaiting signature…" : "Sign & back with World ID (demo)"}
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Stand-in for when the agent isn&apos;t in AgentBook yet: prove wallet
              control + a unique human via World ID. Same signal, recorded locally.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>
          )}

          {status === "verified" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 space-y-1">
              <p className="font-semibold">
                ✓ {alreadyBacked ? "Already a human-backed agent" : "Verified human-backed agent"}
              </p>
              <p className="text-xs text-emerald-700">
                {alreadyBacked
                  ? `This agent wallet is backed by a human who backs ${existing?.fleetSize ?? 1} agent(s).`
                  : `Agent control + human backing confirmed. ${result ? result.agentsRescored : 0} agent score(s) recomputed.`}
              </p>
            </div>
          )}
        </div>

        {/* The agent's own human-backing bonus */}
        {status === "verified" && !alreadyBacked && selfAgents.length > 0 && (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-sm text-slate-700 mb-1">This agent is now human-backed</h2>
            <p className="text-xs text-slate-400 mb-4">+10 AgentKit personhood on its own trust score.</p>
            <div className="space-y-2">
              {selfAgents.map((a) => (
                <Link
                  key={a.agentId}
                  href={`/agents/${a.agentId}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors"
                >
                  <span className="text-sm text-slate-700 truncate">Agent #{a.agentId}</span>
                  <span className="flex items-center gap-2 text-xs font-mono shrink-0">
                    <span className="text-slate-400">{Math.round(a.before)}</span>
                    <span className="text-slate-300">→</span>
                    <span className={a.after > a.before ? "text-emerald-700 font-semibold" : "text-slate-600"}>
                      {Math.round(a.after)}
                    </span>
                    <span className={`ml-1 ${RISK_COLOR[a.afterRisk] || "text-slate-400"}`}>{a.afterRisk}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Agents this agent rated — its feedback now weighs more */}
        {status === "verified" && !alreadyBacked && ratedAgents.length > 0 && (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-sm text-slate-700 mb-1">Feedback re-weighted</h2>
            <p className="text-xs text-slate-400 mb-4">
              Agents this human-backed agent rated — its feedback now counts at 0.6
              (vs 0.2 for an anonymous wallet).
            </p>
            <div className="space-y-2">
              {ratedAgents.map((a) => (
                <Link
                  key={a.agentId}
                  href={`/agents/${a.agentId}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors"
                >
                  <span className="text-sm text-slate-700 truncate">Agent #{a.agentId}</span>
                  <span className="flex items-center gap-2 text-xs font-mono shrink-0">
                    <span className="text-slate-400">{Math.round(a.before)}</span>
                    <span className="text-slate-300">→</span>
                    <span className={a.after !== a.before ? "text-emerald-700 font-semibold" : "text-slate-600"}>
                      {Math.round(a.after)}
                    </span>
                    <span className={`ml-1 ${RISK_COLOR[a.afterRisk] || "text-slate-400"}`}>{a.afterRisk}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            { t: "Human-backed", d: "A unique human stands behind the agent — proven, not claimed." },
            { t: "One human, one fleet", d: "Back many agents; they all resolve to the same person." },
            { t: "Anti-bot", d: "Human-backed feedback outweighs anonymous wallets, but a fleet is one voice." },
          ].map((c) => (
            <div key={c.t} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
              <p className="font-semibold text-slate-700 mb-1">{c.t}</p>
              <p className="text-slate-500 leading-relaxed">{c.d}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          Other verifications:{" "}
          <Link href="/verify-owner" className="text-teal-700 hover:text-teal-800">Owner</Link>
          {" · "}
          <Link href="/verify" className="text-teal-700 hover:text-teal-800">Rater</Link>
        </p>
      </main>

      {APP_ID && rpContext && (
        <IDKitRequestWidget
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          environment={WORLD_ID_ENV}
          allow_legacy_proofs={true}
          preset={orbLegacy({ signal: wallet })}
          open={widgetOpen}
          onOpenChange={setWidgetOpen}
          handleVerify={async (proof) => {
            const res = await verifyAgentKit(wallet, proof, signatureRef.current);
            setResult(res);
          }}
          onSuccess={() => {
            setStatus("verified");
            setWidgetOpen(false);
          }}
          onError={(code) => {
            setError(`World ID verification failed: ${code}`);
            setStatus("error");
          }}
        />
      )}
    </div>
  );
}
