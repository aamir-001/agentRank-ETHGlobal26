import Link from "next/link";
import type { Agent } from "@/lib/api";
import { TrustBadge, ScoreBar } from "./TrustBadge";

export function AgentCard({ agent }: { agent: Agent }) {
  const score = agent.trustScore?.score ?? 0;
  const displayName = agent.name || `Agent #${agent.agentId}`;
  const feedbackCount = Math.max(
    agent.feedbackCount ?? 0,
    agent.trustScore?.verifiedFeedbackCount ?? 0
  );
  const verifiedHumans = agent.trustScore?.verifiedHumanCount ?? 0;
  const humanBacked = agent.trustScore?.humanBacked ?? false;

  return (
    <Link href={`/agents/${agent.agentId}`} className="block h-full">
      <div className="group h-full min-h-[248px] bg-white border border-slate-200 rounded-lg p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md flex flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-950 leading-snug truncate">
              {displayName}
            </h3>
            <p className="text-xs text-slate-500 font-mono mt-1">#{agent.agentId}</p>
          </div>
          <div className="shrink-0">
            <TrustBadge riskLevel={agent.trustScore?.riskLevel} score={score} />
          </div>
        </div>

        <p className="text-sm text-slate-600 truncate mt-3 leading-relaxed">
          {agent.description || "No public description provided."}
        </p>

        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Trust score</span>
            <span className="font-mono text-slate-700">{Math.round(score)}/100</span>
          </div>
          <ScoreBar score={score} />
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-slate-500">Feedback</p>
            <p className="mt-0.5 font-semibold text-slate-900">
              {feedbackCount} {feedbackCount === 1 ? "rating" : "ratings"}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-slate-500">Human signal</p>
            <p className="mt-0.5 font-semibold text-slate-900 truncate">
              {humanBacked
                ? "AgentKit backed"
                : verifiedHumans > 0
                  ? `${verifiedHumans} rater${verifiedHumans === 1 ? "" : "s"}`
                  : "Not verified"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap min-h-10 content-start">
          {humanBacked && (
            <span
              title="This agent wallet is backed by a verified human through AgentKit."
              className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full font-semibold"
            >
              AgentKit backed
            </span>
          )}
          {verifiedHumans > 0 && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">
              {verifiedHumans} human rater{verifiedHumans === 1 ? "" : "s"}
            </span>
          )}
          {agent.active && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-medium">
              Active
            </span>
          )}
          {agent.x402Support && (
            <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2.5 py-1 rounded-full font-medium">
              x402
            </span>
          )}
          {agent.mcpEndpoint && (
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full">
              MCP
            </span>
          )}
          {(agent.ens?.linked || agent.ens?.verified) && (
            <span
              className={`text-xs font-medium ${
                agent.ens?.verified ? "text-amber-700" : "text-slate-500"
              }`}
            >
              {agent.ens?.verified ? "ENS verified" : "ENS linked"}
            </span>
          )}
          {agent.a2aEndpoint && (
            <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200 px-2.5 py-1 rounded-full">
              A2A
            </span>
          )}
          {agent.webEndpoint && (
            <span className="text-xs bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">
              Web
            </span>
          )}
        </div>

        <div className="mt-auto pt-3 flex items-center justify-end border-t border-slate-100 text-xs text-slate-500">
          <span className="font-mono text-slate-400">Open report</span>
        </div>
      </div>
    </Link>
  );
}
