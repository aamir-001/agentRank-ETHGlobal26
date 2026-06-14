"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { IDKitRequestWidget } from "@worldcoin/idkit";
import { orbLegacy } from "@worldcoin/idkit-core";
import type { RpContext as IdkitRpContext } from "@worldcoin/idkit-core";
import {
  fetchOwnerRpContext,
  fetchOwnerStatus,
  fetchOwnerChallenge,
  verifyOwner,
  type VerifyOwnerResult,
  type OwnerStatus,
} from "@/lib/api";

const APP_ID = (process.env.NEXT_PUBLIC_WORLD_ID_APP_ID || "") as `app_${string}`;
const WORLD_ID_ENV =
  process.env.NEXT_PUBLIC_WORLD_ID_ENV === "staging" ? "staging" : "production";
const ACTION = "agentrank-owner";

const RISK_COLOR: Record<string, string> = {
  low: "text-emerald-700",
  medium: "text-yellow-700",
  high: "text-red-700",
};

// Minimal injected-provider shape — avoids pulling in wagmi just to personal_sign.
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
function injectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

export default function VerifyOwnerPage() {
  const [wallet, setWallet] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [rpContext, setRpContext] = useState<IdkitRpContext | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "verified" | "error">("idle");
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [result, setResult] = useState<VerifyOwnerResult | null>(null);
  const [existingStatus, setExistingStatus] = useState<OwnerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so the IDKit handleVerify closure always reads the latest sig.
  const signatureRef = useRef("");

  async function connectWallet() {
    setError(null);
    const eth = injectedProvider();
    if (!eth) {
      setError("No browser wallet found. Install MetaMask (or similar) to prove wallet ownership.");
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
      setAlreadyVerified(false);
      setExistingStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }

  async function startVerification() {
    setError(null);
    setResult(null);
    setExistingStatus(null);
    setAlreadyVerified(false);
    setStatus("loading");
    try {
      // Short-circuit if this wallet is already a verified owner.
      const existing = await fetchOwnerStatus(wallet);
      if (existing.verifiedHuman) {
        setExistingStatus(existing);
        setAlreadyVerified(true);
        setStatus("verified");
        return;
      }

      // Proof of ownership: sign the server's challenge with the wallet key.
      const eth = injectedProvider();
      if (!eth) throw new Error("No browser wallet found");
      const message = await fetchOwnerChallenge(wallet);
      const sig = (await eth.request({
        method: "personal_sign",
        params: [message, wallet],
      })) as string;
      signatureRef.current = sig;

      // Proof of personhood: open the World ID widget.
      const ctx = await fetchOwnerRpContext();
      setRpContext(ctx);
      setWidgetOpen(true);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start verification");
      setStatus("error");
    }
  }

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
            <span className="text-slate-400 text-xs">· Owner Verification</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-3">
            Verify you are the{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
              human behind your agents
            </span>
          </h1>
          <p className="text-slate-600 text-sm leading-relaxed">
            Two proofs, one verification. You <span className="text-slate-800">sign
            with your wallet</span> to prove you control the address that owns
            your agents on-chain, and prove with your{" "}
            <span className="text-slate-800">World ID</span> that you are a real,
            unique human. Every agent that wallet owns then becomes operated by a{" "}
            <span className="text-slate-800">known, accountable human</span> and
            gains an owner-personhood bonus on its trust score. One human, one
            owner wallet — and you can only verify an address you actually hold.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
          {/* Step 1 — connect the owner wallet */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">
              Step 1 · Connect the wallet that owns your agents
            </label>
            {wallet ? (
              <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                <span className="text-sm font-mono text-emerald-700 truncate">{wallet}</span>
                <button
                  onClick={connectWallet}
                  className="text-xs text-slate-500 hover:text-slate-900 shrink-0"
                >
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

          {/* Step 2 — sign + World ID */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">
              Step 2 · Prove ownership &amp; personhood
            </label>
            <button
              onClick={startVerification}
              disabled={!wallet || status === "loading"}
              className="w-full text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 px-6 py-3 rounded-lg transition-all"
            >
              {status === "loading" ? "Awaiting signature…" : "Sign & verify with World ID"}
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">
              You&apos;ll sign a free message (no gas, no transaction), then scan
              with World App.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          {status === "verified" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-700 space-y-1">
              <p className="font-semibold">
                ✓ {alreadyVerified ? "Already verified" : "Verified human owner"}
              </p>
              <p className="text-xs text-emerald-600">
                {alreadyVerified
                  ? `This wallet is already bound to a World ID and owns ${
                      existingStatus?.ownedAgentCount ?? 0
                    } agent(s).`
                  : `Wallet control + World ID confirmed. ${
                      result ? result.agentsRescored : 0
                    } owned agent(s) re-scored with the owner-personhood bonus.`}
              </p>
            </div>
          )}
        </div>

        {/* Before / after — the personhood lift this verification caused */}
        {status === "verified" && !alreadyVerified && result && result.agents.length > 0 && (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-sm text-slate-700 mb-1">Trust score lift</h2>
            <p className="text-xs text-slate-500 mb-4">
              These agents are now operated by a verified human owner.
            </p>
            <div className="space-y-2">
              {result.agents.map((a) => (
                <Link
                  key={a.agentId}
                  href={`/agents/${a.agentId}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors"
                >
                  <span className="text-sm text-slate-800 truncate">
                    {a.name || `Agent #${a.agentId}`}
                  </span>
                  <span className="flex items-center gap-2 text-xs font-mono shrink-0">
                    <span className="text-slate-500">{Math.round(a.before)}</span>
                    <span className="text-slate-400">→</span>
                    <span
                      className={`font-semibold ${
                        a.after > a.before ? "text-emerald-700" : "text-slate-600"
                      }`}
                    >
                      {Math.round(a.after)}
                    </span>
                    <span className={`ml-1 ${RISK_COLOR[a.afterRisk] || "text-slate-500"}`}>
                      {a.afterRisk}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Already-verified: show owned agents and current scores */}
        {status === "verified" && alreadyVerified && existingStatus && existingStatus.agents.length > 0 && (
          <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-sm text-slate-700 mb-4">
              Agents owned by this verified human ({existingStatus.ownedAgentCount})
            </h2>
            <div className="space-y-2">
              {existingStatus.agents.map((a) => (
                <Link
                  key={a.agentId}
                  href={`/agents/${a.agentId}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors"
                >
                  <span className="text-sm text-slate-800 truncate">
                    {a.name || `Agent #${a.agentId}`}
                  </span>
                  <span className="flex items-center gap-2 text-xs font-mono shrink-0">
                    <span className="font-semibold text-slate-700">
                      {Math.round(a.trustScore)}
                    </span>
                    <span className={RISK_COLOR[a.riskLevel] || "text-slate-500"}>
                      {a.riskLevel}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            { t: "Proven ownership", d: "A wallet signature proves you control the address — you can't claim someone else's." },
            { t: "One human, one fleet", d: "The same World ID cannot claim a second owner wallet." },
            { t: "Accountable", d: "Every agent you own is now operated by a known, unique human." },
          ].map((c) => (
            <div key={c.t} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
              <p className="font-semibold text-slate-700 mb-1">{c.t}</p>
              <p className="text-slate-500 leading-relaxed">{c.d}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          Rate agents instead?{" "}
          <Link href="/verify" className="text-teal-600 hover:text-teal-700">
            Verify as a human rater →
          </Link>
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
            // Backend re-checks the wallet signature (ownership) AND forwards the
            // proof to World ID (personhood) before binding owner ⇄ nullifier.
            const res = await verifyOwner(wallet, proof, signatureRef.current);
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
