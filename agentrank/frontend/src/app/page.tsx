"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchAgents } from "@/lib/api";
import { BigQueryBadge } from "@/components/BigQueryBadge";
import { WorldIdBadge } from "@/components/WorldIdBadge";

const SAMPLE_RESPONSE = `{
  "agentId": "42",
  "safe": true,
  "riskLevel": "low",
  "trustScore": 87,
  "identity": {
    "registered": true,
    "agentUriValid": true,
    "metadataFetched": true,
    "active": true,
    "servicesFound": true
  },
  "payment": {
    "x402Support": true
  },
  "reputation": {
    "feedbackCount": 134,
    "averageFeedback": 4.6,
    "verifiedHumanCount": 12,
    "humanWeightedAverage": 4.4,
    "sybilRiskFlag": false
  },
  "ens": {
    "declaredEnsName": "tekrox.eth",
    "ownerEnsName": "tekrox.eth",
    "verified": true
  },
  "scores": {
    "registry": 35,
    "reputation": 24,
    "ens": 20,
    "humanAccountability": 8,
    "total": 84
  },
  "reasons": [
    "Identity registered on-chain",
    "134 reputation events, avg 4.6/5",
    "ENS identity cryptographically verified"
  ],
  "recommendation": "proceed"
}`;

function JsonHighlight({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <pre className="text-[12px] sm:text-[13px] leading-relaxed font-mono overflow-x-auto text-slate-700">
      {lines.map((line, i) => {
        const html = line
          .replace(/"(\w[\w.]*)":/g, '<span class="text-teal-700">"$1"</span>:')
          .replace(/: "([^"]*)"/g, ': <span class="text-emerald-600">"$1"</span>')
          .replace(/: (true|false)/g, ': <span class="text-cyan-600">$1</span>')
          .replace(/: (\d[\d.]*)/g, ': <span class="text-amber-600">$1</span>');
        return (
          <div key={i} dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }} />
        );
      })}
    </pre>
  );
}

export default function LandingPage() {
  const [totalAgents, setTotalAgents] = useState<number | null>(null);

  useEffect(() => {
    fetchAgents({ limit: 1 })
      .then((res) => setTotalAgents(res.total))
      .catch(() => setTotalAgents(null));
  }, []);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/4 w-[500px] h-[500px] bg-teal-300/30 rounded-full blur-[120px]" />
        <div className="absolute top-40 right-1/4 w-[400px] h-[400px] bg-cyan-300/20 rounded-full blur-[120px]" />
      </div>

      <header className="relative z-10 border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-sm font-bold text-white">
              AR
            </div>
            <div>
              <span className="font-bold text-slate-900">AgentRank</span>
              <span className="text-slate-400 text-xs ml-2 hidden sm:inline">ERC-8004 Trust API</span>
            </div>
          </div>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/resolve"
              className="text-xs text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg transition-all hidden sm:block"
            >
              Resolve ENS
            </Link>
            <Link
              href="/dashboard"
              className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg transition-all"
            >
              Agent Dashboard →
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            Trust layer for agentic commerce
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold leading-tight mb-6">
            Know who you&apos;re paying.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-600">
              Before you pay them.
            </span>
          </h1>
          <p className="text-slate-600 text-base sm:text-lg max-w-2xl mx-auto mb-5">
            One API call gives any AI agent a real-time trust score for another
            ERC-8004 agent — built from on-chain identity, reputation history,
            and verified ENS identity on Ethereum, plus a separate check of
            whether it&apos;s actually payable via x402.
          </p>
          <p className="text-slate-700 text-sm sm:text-base max-w-xl mx-auto mb-8 font-medium">
            So your agent transacts only with counterparties that{" "}
            <span className="text-emerald-700">real humans have vouched for</span>{" "}
            — not sock-puppet wallets gaming their own reputation.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 px-6 py-3 rounded-lg transition-all"
            >
              Explore Agent Dashboard
            </Link>
            <a
              href="#api"
              className="text-sm font-semibold text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-6 py-3 rounded-lg transition-all"
            >
              View the API
            </a>
          </div>
          <div className="mt-6 flex justify-center gap-2 flex-wrap">
            <BigQueryBadge />
            <WorldIdBadge />
          </div>
        </section>

        {/* API Showcase */}
        <section id="api" className="max-w-6xl mx-auto px-4 pb-20">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              The only endpoint your agent needs
            </h2>
            <p className="text-slate-600 text-sm max-w-xl mx-auto">
              Before sending a payment or invoking another agent, check its risk
              report. Get a single safe / review / refuse recommendation backed
              by on-chain evidence.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Request panel */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <span className="text-xs text-slate-400 font-mono ml-2">request</span>
              </div>
              <div className="p-4 sm:p-6 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                    GET
                  </span>
                  <code className="text-sm text-slate-800 font-mono break-all">
                    /agents/{"{agentId}"}/risk
                  </code>
                </div>
                <p className="text-xs text-slate-500">
                  Call this before your agent transacts with{" "}
                  <code className="text-slate-700">agentId</code>. The response
                  tells you whether it&apos;s safe to proceed.
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[12px] text-slate-600 overflow-x-auto">
                  <span className="text-teal-700">curl</span> $AGENTRANK_API/agents/42/risk
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
                    <p className="text-[11px] font-semibold text-emerald-700">proceed</p>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-center">
                    <p className="text-[11px] font-semibold text-yellow-700">review_before_calling</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                    <p className="text-[11px] font-semibold text-red-700">do_not_call</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Response panel */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <span className="text-xs text-slate-400 font-mono ml-2">200 OK</span>
              </div>
              <div className="p-4 sm:p-6">
                <JsonHighlight code={SAMPLE_RESPONSE} />
              </div>
            </div>
          </div>
        </section>

        {/* Score breakdown */}
        <section className="max-w-6xl mx-auto px-4 pb-20">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">
              Trust score, computed from on-chain evidence
            </h2>
            <p className="text-slate-600 text-sm max-w-xl mx-auto">
              Every agent registered in the ERC-8004 Identity Registry is scored
              0–100 across three trust dimensions. Payability (x402) is tracked
              as a separate signal — being payable doesn&apos;t make an agent
              trustworthy.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Registry Profile",
                color: "from-teal-100 to-white",
                border: "border-teal-200",
                desc: "On-chain registration, valid agent URI, reachable metadata and services.",
              },
              {
                label: "Reputation",
                color: "from-cyan-100 to-white",
                border: "border-cyan-200",
                desc: "Feedback from the Reputation Registry — weighted by World ID so only real humans count, not Sybil wallets.",
              },
              {
                label: "ENS Identity",
                color: "from-orange-100 to-white",
                border: "border-orange-200",
                desc: "Reverse + forward ENS resolution, cross-checked against registry records.",
              },
              {
                label: "Human Accountability",
                color: "from-indigo-100 to-white",
                border: "border-indigo-200",
                desc: "Owner World ID and AgentKit human-backed agent wallets prove a human stands behind the system.",
              },
            ].map((s) => (
              <div
                key={s.label}
                className={`relative bg-gradient-to-b ${s.color} border ${s.border} rounded-2xl p-5 overflow-hidden`}
              >
                <h3 className="font-semibold text-slate-900 mb-2">{s.label}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          {/* World ID — Sybil-resistant reputation, the differentiator */}
          <div className="mt-4 bg-gradient-to-r from-emerald-50 to-white border border-emerald-200 rounded-2xl p-5 sm:p-6 flex items-start gap-4">
            <div className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mt-0.5 whitespace-nowrap">
              World ID
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">
                Reputation real humans stand behind
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The ERC-8004 Reputation Registry is permissionless — anyone can
                spin up a thousand wallets and praise their own agent. AgentRank
                weights every review by{" "}
                <span className="text-emerald-700">proof of personhood</span>:
                feedback from a World ID-verified human counts at full weight,
                feedback from anonymous wallets is discounted to near-zero. So
                your agent interacts with counterparties{" "}
                <span className="text-slate-800">real people vouch for</span> —
                and a Sybil farm of 500 wallets collapses to the single human
                actually behind it.
              </p>
            </div>
          </div>

          {/* Payability — a separate axis, not a trust input */}
          <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 flex items-start gap-4 shadow-sm">
            <div className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded px-2 py-1 mt-0.5 whitespace-nowrap">
              x402 Payable
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Shown alongside the trust score, never folded into it. Whether an
              agent can accept x402 payments tells you it&apos;s live and
              transactable — not whether it&apos;s honest. We keep the two
              questions — <span className="text-slate-700">&ldquo;is it
              trustworthy?&rdquo;</span> and <span className="text-slate-700">&ldquo;can
              I actually pay it?&rdquo;</span> — separate on purpose.
            </p>
          </div>
        </section>

        {/* Stats / how it works */}
        <section className="max-w-6xl mx-auto px-4 pb-24">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 grid grid-cols-1 lg:grid-cols-3 gap-8 items-center shadow-sm">
            <div className="lg:col-span-1">
              <h2 className="text-xl font-bold mb-2">How it works</h2>
              <p className="text-slate-600 text-sm">
                Three steps between an agent and a safer transaction.
              </p>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { n: "01", t: "Agent calls /risk", d: "Pass the counterparty's ERC-8004 agentId before paying or invoking it." },
                { n: "02", t: "AgentRank evaluates", d: "Registry profile, reputation, ENS identity, and human accountability are scored; x402 payability is checked separately." },
                { n: "03", t: "Agent decides", d: "proceed, review, or refuse — based on a clear recommendation and score." },
              ].map((s) => (
                <div key={s.n} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-teal-600 font-mono text-xs mb-2">{s.n}</p>
                  <p className="font-semibold text-sm mb-1">{s.t}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{s.d}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center gap-8 sm:gap-16 mt-10 text-center flex-wrap">
            <div>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
                {totalAgents !== null ? totalAgents.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">agents indexed</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
                4
              </p>
              <p className="text-xs text-slate-500 mt-1">trust signals scored</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-cyan-600">
                1
              </p>
              <p className="text-xs text-slate-500 mt-1">API call to decide</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-slate-200 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-4 flex-wrap justify-center">
            <span>AgentRank — ERC-8004 Trust API for agentic commerce</span>
            <BigQueryBadge />
            <WorldIdBadge />
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="hover:text-slate-700 transition-colors">
              Dashboard
            </Link>
            <Link href="/resolve" className="hover:text-slate-700 transition-colors">
              Resolve ENS
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
