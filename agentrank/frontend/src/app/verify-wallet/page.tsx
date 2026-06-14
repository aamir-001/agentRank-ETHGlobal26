"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { IDKitRequestWidget } from "@worldcoin/idkit";
import { orbLegacy } from "@worldcoin/idkit-core";
import type { RpContext as IdkitRpContext } from "@worldcoin/idkit-core";
import {
  // rater
  fetchRpContext,
  fetchRaterChallenge,
  fetchRaterStatus,
  verifyRater,
  type RaterStatus,
  // owner
  fetchOwnerRpContext,
  fetchOwnerChallenge,
  fetchOwnerStatus,
  verifyOwner,
  type OwnerStatus,
  // agent (AgentKit)
  fetchAgentKitRpContext,
  fetchAgentKitChallenge,
  fetchAgentKitStatus,
  verifyAgentKit,
  checkAgentBook,
  type AgentKitStatus,
  type AgentBookCheckResult,
} from "@/lib/api";

const APP_ID = (process.env.NEXT_PUBLIC_WORLD_ID_APP_ID || "") as `app_${string}`;
const WORLD_ID_ENV =
  process.env.NEXT_PUBLIC_WORLD_ID_ENV === "staging" ? "staging" : "production";

type Role = "rater" | "owner" | "agent";
const ACTIONS: Record<Role, string> = {
  rater: "agentrank-rater",
  owner: "agentrank-owner",
  agent: "agentrank-agent",
};

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
function injectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

async function challengeFor(role: Role, wallet: string): Promise<string> {
  if (role === "rater") return fetchRaterChallenge(wallet);
  if (role === "owner") return fetchOwnerChallenge(wallet);
  return fetchAgentKitChallenge(wallet);
}
async function rpContextFor(role: Role): Promise<IdkitRpContext> {
  if (role === "rater") return fetchRpContext();
  if (role === "owner") return fetchOwnerRpContext();
  return fetchAgentKitRpContext();
}
async function verifyFor(role: Role, wallet: string, proof: unknown, sig: string) {
  if (role === "rater") return verifyRater(wallet, proof, sig);
  if (role === "owner") return verifyOwner(wallet, proof, sig);
  return verifyAgentKit(wallet, proof, sig);
}

export default function VerifyWalletPage() {
  const [wallet, setWallet] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [rater, setRater] = useState<RaterStatus | null>(null);
  const [owner, setOwner] = useState<OwnerStatus | null>(null);
  const [agent, setAgent] = useState<AgentKitStatus | null>(null);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [pending, setPending] = useState<Role | "agentbook" | null>(null);
  const [rpContext, setRpContext] = useState<IdkitRpContext | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [bookResult, setBookResult] = useState<AgentBookCheckResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signatureRef = useRef("");

  async function loadStatuses(addr: string) {
    const [r, o, a] = await Promise.all([
      fetchRaterStatus(addr).catch(() => null),
      fetchOwnerStatus(addr).catch(() => null),
      fetchAgentKitStatus(addr).catch(() => null),
    ]);
    setRater(r);
    setOwner(o);
    setAgent(a);
  }

  async function connectWallet() {
    setError(null);
    setNotice(null);
    const eth = injectedProvider();
    if (!eth) {
      setError("No browser wallet found. Install MetaMask (or similar) to verify.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = (accounts?.[0] || "").toLowerCase();
      if (!addr) throw new Error("No account returned by wallet");
      setWallet(addr);
      setBookResult(null);
      await loadStatuses(addr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }

  // Connect → sign control challenge → open the World ID widget for this role.
  async function startRole(role: Role) {
    setError(null);
    setNotice(null);
    setPending(role);
    try {
      const eth = injectedProvider();
      if (!eth) throw new Error("No browser wallet found");
      const message = await challengeFor(role, wallet);
      const sig = (await eth.request({
        method: "personal_sign",
        params: [message, wallet],
      })) as string;
      signatureRef.current = sig;
      const ctx = await rpContextFor(role);
      setRpContext(ctx);
      setActiveRole(role);
      setWidgetOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start verification");
    } finally {
      setPending(null);
    }
  }

  // The REAL AgentKit path — resolve the wallet against AgentBook on World Chain.
  async function runAgentBook() {
    setError(null);
    setNotice(null);
    setBookResult(null);
    setPending("agentbook");
    try {
      const r = await checkAgentBook(wallet);
      setBookResult(r);
      if (r.humanBacked) {
        setNotice("This agent is human-backed on World's AgentBook (AgentKit).");
        await loadStatuses(wallet);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AgentBook check failed");
    } finally {
      setPending(null);
    }
  }

  const walletReady = !!wallet;

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
            <span className="text-slate-400 text-xs">· Verify Wallet</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-3">
            Verify your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
              wallet
            </span>
          </h1>
          <p className="text-slate-600 text-sm leading-relaxed">
            Connect the wallet once, then claim what it is. Each role binds the
            connected wallet to your World ID with a wallet signature — so you can
            only verify an address you actually control. A wallet can hold more
            than one role.
          </p>
        </div>

        {/* Connect */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
          <label className="block text-xs text-slate-500 mb-1.5">Connected wallet</label>
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
              className="w-full text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-6 py-3 rounded-lg transition-all"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 mb-4">{error}</div>
        )}
        {notice && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 mb-4">{notice}</div>
        )}

        {/* Roles */}
        <div className="space-y-4">
          {/* Rater */}
          <RoleCard
            title="Human Rater"
            verified={!!rater?.verifiedHuman}
            badge="World ID"
            blurb="Your on-chain feedback counts at full weight (1.0) instead of being discounted as an anonymous wallet."
            disabled={!walletReady}
            pending={pending === "rater"}
            onVerify={() => startRole("rater")}
          />

          {/* Owner */}
          <RoleCard
            title="Agent Owner"
            verified={!!owner?.verifiedHuman}
            badge="World ID"
            blurb={
              owner && owner.ownedAgentCount > 0
                ? `Owns ${owner.ownedAgentCount} agent(s) — each gains a +10 owner-personhood bonus.`
                : "Agents this wallet owns on-chain each gain a +10 owner-personhood bonus."
            }
            disabled={!walletReady}
            pending={pending === "owner"}
            onVerify={() => startRole("owner")}
          />

          {/* Agent (AgentKit) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="font-semibold text-slate-900">Human-Backed Agent</h3>
              {agent?.humanBacked ? (
                <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-semibold">
                  ✓ {agent.source === "agentbook" ? "AgentBook" : "Stand-in"}
                </span>
              ) : (
                <span className="text-xs text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full">
                  Not backed
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              The agent itself is operated by a unique human (AgentKit). Gains a +10
              bonus; its feedback as a rater counts at 0.6.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={runAgentBook}
                disabled={!walletReady || pending === "agentbook"}
                className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 px-4 py-2 rounded-lg transition-all"
              >
                {pending === "agentbook" ? "Querying World Chain…" : "Check AgentBook (real)"}
              </button>
              <button
                onClick={() => startRole("agent")}
                disabled={!walletReady || pending === "agent"}
                className="text-sm font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 disabled:bg-slate-50 disabled:text-slate-400 px-4 py-2 rounded-lg transition-all"
              >
                {pending === "agent" ? "Awaiting signature…" : "Back with World ID (demo)"}
              </button>
            </div>
            {bookResult && !bookResult.humanBacked && (
              <p className="text-[11px] text-amber-700 mt-2">
                Not in AgentBook yet — register via World&apos;s AgentKit delegation, or use the demo stand-in.
              </p>
            )}
          </div>
        </div>

        {!walletReady && (
          <p className="text-center text-xs text-slate-400 mt-6">Connect a wallet to claim roles.</p>
        )}
      </main>

      {APP_ID && rpContext && activeRole && (
        <IDKitRequestWidget
          app_id={APP_ID}
          action={ACTIONS[activeRole]}
          rp_context={rpContext}
          environment={WORLD_ID_ENV}
          allow_legacy_proofs={true}
          preset={orbLegacy({ signal: wallet })}
          open={widgetOpen}
          onOpenChange={setWidgetOpen}
          handleVerify={async (proof) => {
            await verifyFor(activeRole, wallet, proof, signatureRef.current);
          }}
          onSuccess={async () => {
            setWidgetOpen(false);
            setNotice(`Verified as ${activeRole}.`);
            await loadStatuses(wallet);
          }}
          onError={(code) => {
            setError(`World ID verification failed: ${code}`);
          }}
        />
      )}
    </div>
  );
}

function RoleCard({
  title,
  verified,
  badge,
  blurb,
  disabled,
  pending,
  onVerify,
}: {
  title: string;
  verified: boolean;
  badge: string;
  blurb: string;
  disabled: boolean;
  pending: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {verified ? (
          <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
            ✓ Verified
          </span>
        ) : (
          <span className="text-xs text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">{blurb}</p>
      <button
        onClick={onVerify}
        disabled={disabled || pending || verified}
        className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 px-4 py-2 rounded-lg transition-all"
      >
        {verified ? "Verified" : pending ? "Awaiting signature…" : "Verify with World ID"}
      </button>
    </div>
  );
}
