"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchAgent, fetchRisk, type AgentDetail, type RiskReport } from "@/lib/api";
import { TrustBadge } from "@/components/TrustBadge";
import { shortAddr } from "@/lib/format";

export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchAgent(id), fetchRisk(id)])
      .then(([a, r]) => {
        setAgent(a);
        setRisk(r);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center text-slate-400">
        Loading...
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center text-slate-400">
        Agent not found
      </div>
    );
  }

  const score = agent.trustScore?.score ?? 0;
  const decision =
    risk?.recommendation === "proceed"
      ? {
          label: "Safe to call",
          detail: "This agent has enough verified signal to proceed.",
          className: "bg-emerald-50 text-emerald-800 border-emerald-200",
        }
      : risk?.recommendation === "review_before_calling"
      ? {
          label: "Review before calling",
          detail: "The agent is usable, but some trust signals are weak or missing.",
          className: "bg-amber-50 text-amber-800 border-amber-200",
        }
      : {
          label: "Do not call",
          detail: "This agent does not have enough trust signal yet.",
          className: "bg-red-50 text-red-800 border-red-200",
        };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
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

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Hero */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold mb-1">
                {agent.name || `Agent #${agent.agentId}`}
              </h1>
              <p className="text-slate-500 text-sm font-mono">ID: {agent.agentId}</p>
            </div>
            <TrustBadge riskLevel={agent.trustScore?.riskLevel} />
          </div>

          {agent.description && (
            <p className="text-slate-600 text-sm mb-4">{agent.description}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {(agent.trustScore?.verifiedHumanCount ?? 0) > 0 && (
              <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {agent.trustScore?.verifiedHumanCount} World ID-verified human
                {agent.trustScore?.verifiedHumanCount === 1 ? "" : "s"} ·{" "}
                {agent.trustScore?.verifiedFeedbackCount} verified review
                {agent.trustScore?.verifiedFeedbackCount === 1 ? "" : "s"}
              </span>
            )}
            {agent.trustScore?.ownerVerified && (
              <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200 px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                Owner verified by World ID
              </span>
            )}
            {agent.trustScore?.humanBacked && (
              <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                Human-backed agent (AgentKit)
              </span>
            )}
            {agent.x402Support && (
              <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2.5 py-1 rounded-full font-medium">
                x402 Payments
              </span>
            )}
            {agent.active && (
              <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-medium">
                Active
              </span>
            )}
            {agent.supportedTrust?.map((t) => (
              <span
                key={t}
                className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Trust Decision */}
          {risk && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className={`rounded-lg border p-4 mb-4 ${decision.className}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-base">{decision.label}</h2>
                    <p className="text-xs mt-1 opacity-80 leading-relaxed">
                      {decision.detail}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold leading-none">{Math.round(score)}</p>
                  </div>
                </div>
              </div>

              <h3 className="font-semibold text-sm text-slate-700 mb-3">What AgentRank checked</h3>

              <div className="space-y-2 mb-4">
                {[
                  {
                    label: "Registry profile",
                    value: `${risk.scores?.identity ?? 0}/35`,
                    status: (risk.scores?.identity ?? 0) >= 30 ? "Complete" : "Incomplete",
                    detail: "ERC-8004 registration, metadata, active status, and service endpoints.",
                    tone:
                      (risk.scores?.identity ?? 0) >= 30
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : "text-amber-700 bg-amber-50 border-amber-200",
                  },
                  {
                    label: "Reputation",
                    value: `${risk.scores?.reputation ?? 0}/30`,
                    status:
                      risk.reputation.verifiedHumanCount > 0 ||
                      (risk.reputation.humanBackedRaterCount ?? 0) > 0
                        ? "Human-backed"
                        : "Capped",
                    detail:
                      risk.reputation.verifiedHumanCount > 0
                        ? `${risk.reputation.verifiedHumanCount} verified human rater(s) back this feedback.`
                        : (risk.reputation.humanBackedRaterCount ?? 0) > 0
                        ? `${risk.reputation.humanBackedRaterCount ?? 0} AgentKit human-backed rater(s) back this feedback.`
                        : "Feedback exists, but no verified human rater backs it yet.",
                    tone:
                      risk.reputation.verifiedHumanCount > 0 ||
                      (risk.reputation.humanBackedRaterCount ?? 0) > 0
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : "text-amber-700 bg-amber-50 border-amber-200",
                  },
                  {
                    label: "ENS identity",
                    value: `${risk.scores?.ens ?? 0}/20`,
                    status: risk.ens.verified ? "Verified" : risk.ens.ownerEnsName ? "Linked" : "Missing",
                    detail: risk.ens.verified
                      ? "The agent's ENS identity matches its registry record."
                      : risk.ens.ownerEnsName
                      ? "The owner has an ENS name, but the agent is not fully verified."
                      : "No ENS identity is linked to this agent.",
                    tone: risk.ens.verified
                      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                      : "text-slate-500 bg-slate-50 border-slate-200",
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm text-slate-800">{item.label}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${item.tone}`}>
                            {item.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">{item.detail}</p>
                      </div>
                      <span className="text-xs font-mono text-slate-500 shrink-0">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              {risk.reputation.breakdown && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="font-semibold text-slate-700">Reputation calculation</span>
                    <span className="text-slate-500">{risk.scores?.reputation ?? 0} / 30</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-slate-500">
                    <span>Feedback quality</span>
                    <span className="text-right font-mono">{risk.reputation.breakdown.quality} / 10</span>
                    <span>World ID / AgentKit raters</span>
                    <span className="text-right font-mono">{risk.reputation.breakdown.accountableRaters} / 10</span>
                    <span>Independent sources</span>
                    <span className="text-right font-mono">{risk.reputation.breakdown.independentSources} / 5</span>
                    <span>Recent feedback</span>
                    <span className="text-right font-mono">{risk.reputation.breakdown.recency} / 3</span>
                    <span>Clean record</span>
                    <span className="text-right font-mono">{risk.reputation.breakdown.integrity} / 2</span>
                  </div>
                </div>
              )}

              <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="font-semibold text-slate-700">Human accountability</span>
                  <span className="text-slate-500">
                    {risk.scores?.agentKit
                      ? risk.scores.agentKit
                      : risk.scores?.owner ?? 0} / 15
                  </span>
                </div>
                {risk.agentKit.humanBacked ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Agent wallet</span>
                      <span className="text-indigo-700 font-semibold">Human-backed via AgentKit</span>
                    </div>
                    <p className="text-slate-400 mt-2 leading-relaxed">
                      This is the strongest signal: the agent itself is backed by a unique human, so it receives the full human-accountability score.
                    </p>
                  </div>
                ) : risk.owner.verifiedHuman ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Owner wallet</span>
                      <span className="text-cyan-700 font-semibold">Verified human owner</span>
                    </div>
                    <p className="text-slate-400 mt-2 leading-relaxed">
                      The owner wallet is accountable, but the agent wallet itself is not human-backed yet, so this is partial credit.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Human backing</span>
                      <span className="text-slate-400">Not verified</span>
                    </div>
                    <p className="text-slate-400 mt-2 leading-relaxed">
                      No verified owner or AgentKit human-backed agent wallet is recorded yet.
                    </p>
                  </div>
                )}
              </div>

              {/* Sybil exposure: explain why the reputation score was adjusted. */}
              {risk.scores && risk.scores.naiveReputation !== risk.scores.reputation && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="font-semibold text-amber-800">Reputation adjusted for Sybil risk</span>
                    <span className="text-amber-800 font-semibold">
                      {risk.scores.reputation} / 30
                    </span>
                  </div>
                  <p className="text-amber-800/80 leading-relaxed">
                    Raw wallet feedback would score {risk.scores.naiveReputation}/30, but
                    only {risk.reputation.verifiedHumanCount} verified human rater(s) and{" "}
                    {risk.reputation.humanBackedRaterCount ?? 0} AgentKit-backed rater(s) stand
                    behind it, so AgentRank caps the reputation score.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <h3 className="font-semibold text-sm text-slate-700 mb-2">Evidence</h3>
                {risk.reasons.slice(0, 7).map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-slate-500">
                    <span className="text-emerald-600 mt-0.5">✓</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>

              {/* Payability — a separate axis from trust */}
              <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs text-slate-500">Payable (x402)</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    risk.payment?.x402Support
                      ? "bg-teal-50 text-teal-700 border-teal-200"
                      : "bg-transparent text-slate-400 border-slate-200"
                  }`}
                >
                  {risk.payment?.x402Support ? "Accepts x402 payments" : "No x402 endpoint"}
                </span>
              </div>

              <div
                className={`hidden ${
                  risk.recommendation === "proceed"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : risk.recommendation === "review_before_calling"
                    ? "bg-yellow-50 text-yellow-700 border border-yellow-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {risk.recommendation === "proceed"
                  ? "✓ Safe to call"
                  : risk.recommendation === "review_before_calling"
                  ? "⚠ Review before calling"
                  : "✗ Do not call"}
              </div>
            </div>
          )}

          {/* Identity */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-sm text-slate-700 mb-1">Registry Identity</h2>
            <p className="text-xs text-slate-400 mb-4">
              ERC-8004 registration and metadata. ENS is verified separately.
            </p>
            <div className="space-y-2.5 text-sm">
              {[
                { label: "Owner", value: shortAddr(agent.ownerAddress), mono: true },
                ...(agent.ens?.ownerEnsName
                  ? [{ label: "Owner ENS", value: agent.ens.ownerEnsName, mono: true }]
                  : []),
                ...(agent.ens?.declaredEnsName
                  ? [{ label: "Agent ENS", value: agent.ens.declaredEnsName, mono: true }]
                  : []),
                { label: "Registry", value: shortAddr(agent.identityRegistryAddress ?? "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432"), mono: true },
                {
                  label: "Registered",
                  value: agent.registeredAt
                    ? new Date(agent.registeredAt).toLocaleDateString()
                    : "—",
                },
                {
                  label: "Block",
                  value: agent.registeredBlockNumber ?? "—",
                  mono: true,
                },
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex justify-between gap-2">
                  <span className="text-slate-500">{label}</span>
                  <span className={`text-slate-800 ${mono ? "font-mono text-xs" : "text-sm"}`}>
                    {String(value)}
                  </span>
                </div>
              ))}
              {agent.agentUri && (
                <div className="pt-1">
                  <span className="text-slate-500 text-xs">Agent URI</span>
                  <p className="text-slate-500 text-xs font-mono break-all mt-0.5 max-h-24 overflow-auto rounded-lg bg-slate-50 border border-slate-200 p-2">
                    {agent.agentUri}
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ENS Verification */}
        {agent.ens && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-sm text-slate-700">ENS Identity</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Human-readable identity for the owner or agent, when available.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    agent.ens.linked
                      ? "bg-orange-50 text-orange-700 border-orange-200"
                      : "bg-transparent text-slate-300 border-slate-200"
                  }`}
                >
                  ENS Linked
                </span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                    agent.ens.verified
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-transparent text-slate-300 border-slate-200"
                  }`}
                >
                  ENS Verified
                </span>
              </div>
            </div>

            <div className="space-y-2.5 text-sm mb-4">
              {agent.ens.declaredEnsName && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Declared ENS name</span>
                  <span className="text-slate-800 font-mono text-xs">{agent.ens.declaredEnsName}</span>
                </div>
              )}
              {agent.ens.resolvedAddress && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Resolves to</span>
                  <span className="text-slate-800 font-mono text-xs">{shortAddr(agent.ens.resolvedAddress)}</span>
                </div>
              )}
              {agent.ens.ownerEnsName && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Owner reverse record</span>
                  <span className="text-slate-800 font-mono text-xs">{agent.ens.ownerEnsName}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">ENS score</span>
                <span className="text-slate-800 text-xs">{agent.ens.score} / 15</span>
              </div>
            </div>

            <div className="space-y-1.5">
              {agent.ens.reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-500">
                  <span className="text-emerald-600 mt-0.5">✓</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Services */}
        {agent.services && agent.services.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-semibold text-sm text-slate-700 mb-4">
              Services ({agent.services.length})
            </h2>
            <div className="space-y-2">
              {agent.services.map((svc, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 py-2 border-b border-slate-200 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                      {svc.name}
                    </span>
                    {svc.version && (
                      <span className="text-xs text-slate-400">v{svc.version}</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 font-mono truncate max-w-xs">
                    {svc.endpoint}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback */}
        {agent.feedbackEvents && agent.feedbackEvents.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm text-slate-700">
                Feedback ({agent.feedbackEvents.length})
              </h2>
              <Link
                href="/verify-wallet"
                className="text-xs text-teal-600 hover:text-teal-700 transition-colors"
              >
                Verify as human rater →
              </Link>
            </div>
            <div className="space-y-2">
              {agent.feedbackEvents.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 py-2 border-b border-slate-200 last:border-0 text-xs"
                >
                  <span className="font-mono text-slate-500 flex items-center gap-2">
                    {shortAddr(f.clientAddress)}
                    {f.verifiedHuman ? (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
                        ✓ Human
                      </span>
                    ) : (
                      <span className="text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded-full text-[10px]">
                        unverified
                      </span>
                    )}
                  </span>
                  {f.value !== null && (
                    <span
                      className={`font-semibold ${
                        f.value >= 70
                          ? "text-emerald-600"
                          : f.value >= 40
                          ? "text-yellow-600"
                          : "text-red-600"
                      }`}
                    >
                      {f.value}
                    </span>
                  )}
                  {f.tag1 && (
                    <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {f.tag1}
                    </span>
                  )}
                  {f.isRevoked && (
                    <span className="text-red-500">revoked</span>
                  )}
                  <span className="text-slate-400">
                    {f.blockTimestamp
                      ? new Date(f.blockTimestamp).toLocaleDateString()
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tx hash */}
        {agent.registeredTxHash && (
          <div className="text-xs text-slate-400 font-mono text-center pb-4">
            Registered in tx: {agent.registeredTxHash}
          </div>
        )}
      </main>
    </div>
  );
}
