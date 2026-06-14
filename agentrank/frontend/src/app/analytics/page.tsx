"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fetchAnalytics,
  fetchNetworkAnalytics,
  type AnalyticsResponse,
  type NetworkAnalyticsResponse,
} from "@/lib/api";
import { shortAddr } from "@/lib/format";

const SERVICE_COLORS: Record<string, string> = {
  web: "bg-teal-500",
  MCP: "bg-cyan-500",
  A2A: "bg-emerald-500",
  "a2a-inbox": "bg-emerald-400",
  "agent-card": "bg-amber-500",
  UniversalProfile: "bg-pink-500",
};

const BAND_LABELS: Record<string, string> = {
  excellent: "Excellent",
  positive: "Positive",
  mixed: "Mixed",
  negative: "Negative",
  zero: "Zero",
};

function fmt(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(n ?? 0);
}

function pct(n: number | null | undefined) {
  return `${Math.round((n ?? 0) * 10) / 10}%`;
}

function InfoIcon({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-slate-300 text-[9px] leading-none text-slate-400 cursor-help shrink-0 hover:border-slate-400 hover:text-slate-600"
    >
      i
    </span>
  );
}

function Card({
  title,
  subtitle,
  children,
  action,
  tooltip,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-1.5">
            {title}
            {tooltip && <InfoIcon text={tooltip} />}
          </h2>
          {subtitle && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "default",
  tooltip,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "good" | "warn" | "info";
  tooltip?: string;
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "info"
          ? "border-cyan-200 bg-cyan-50 text-cyan-800"
          : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={`border rounded-lg p-4 ${toneClass}`}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-xs font-medium mt-2 flex items-center gap-1">
        {label}
        {tooltip && <InfoIcon text={tooltip} />}
      </p>
      {detail && <p className="text-[11px] opacity-75 mt-1 leading-relaxed">{detail}</p>}
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  suffix,
  color = "bg-cyan-500",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 font-mono w-24 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
      </div>
      <span className="text-xs text-slate-700 w-16 text-right">
        {fmt(value)}
        {suffix}
      </span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 italic py-8 text-center">{text}</p>;
}

function BigQueryUnavailable({
  reason,
  onRetry,
  retrying,
}: {
  reason?: string | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <section className="border border-amber-200 bg-amber-50 rounded-lg p-5 mb-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-amber-700 mb-1">BigQuery live scan unavailable</p>
          <h3 className="text-lg font-bold text-slate-950">Showing indexed AgentRank data instead</h3>
          <p className="text-sm text-amber-900/80 mt-2 max-w-3xl leading-relaxed">
            {reason ||
              "The local app could not reach Google BigQuery, so full-network Ethereum registry analytics are paused. The panels below still use the local indexed ERC-8004 database."}
          </p>
        </div>
        <button
          onClick={onRetry}
          disabled={retrying}
          className="text-xs font-medium text-amber-900 bg-white border border-amber-200 hover:border-amber-300 px-3 py-2 rounded-lg transition-all disabled:opacity-50 whitespace-nowrap"
        >
          {retrying ? "Retrying..." : "Retry BigQuery"}
        </button>
      </div>
    </section>
  );
}

function ConcentrationCard({
  title,
  data,
}: {
  title: string;
  data: NetworkAnalyticsResponse["ownerConcentration"];
}) {
  if (!data) return <EmptyState text="No concentration data available." />;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Metric label="top wallet" value={pct(data.top1SharePct)} detail={data.eventName} tone="warn" tooltip={`Share of all ${data.eventName} produced by the single most active ${data.entityName === "owners" ? "owner" : "rater"} wallet.`} />
        <Metric label="top 5" value={pct(data.top5SharePct)} detail={data.eventName} tone="info" tooltip={`Share of all ${data.eventName} produced by the 5 most active ${data.entityName} combined.`} />
        <Metric label="top 10" value={pct(data.top10SharePct)} detail={data.eventName} tooltip={`Share of all ${data.eventName} produced by the 10 most active ${data.entityName} combined.`} />
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        {title}: {fmt(data.entities)} {data.entityName} produced {fmt(data.totalEvents)} {data.eventName}.
      </p>
    </div>
  );
}

function RankLine({
  left,
  sub,
  right,
  href,
}: {
  left: string;
  sub?: string;
  right: string;
  href?: string;
}) {
  const row = (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-slate-900 truncate">{left}</p>
        {sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}
      </div>
      <p className="text-sm font-semibold text-slate-900 shrink-0">{right}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:bg-slate-50 -mx-2 px-2 rounded-md transition-colors">
      {row}
    </Link>
  ) : (
    row
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState<NetworkAnalyticsResponse | null>(null);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const loadNetwork = useCallback((refresh = false) => {
    setNetworkLoading(true);
    setNetworkError(null);
    fetchNetworkAnalytics(refresh)
      .then(setNetwork)
      .catch((err) => setNetworkError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setNetworkLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadNetwork());
  }, [loadNetwork]);

  const local = useMemo(() => {
    if (!data) return null;
    const activeFeedbackDays = data.feedbackOverTime.length;
    const avgFeedbackPerAgent =
      data.totalAgents > 0 ? Math.round((data.totalFeedbackEvents / data.totalAgents) * 100) / 100 : 0;
    const topOwner = data.topOwners[0];
    const serviceLeader = data.serviceTypes[0];
    const reputationCoverage =
      data.totalAgents > 0
        ? Math.round((data.topAgentsByReputation.length / data.totalAgents) * 1000) / 10
        : 0;
    return { activeFeedbackDays, avgFeedbackPerAgent, topOwner, serviceLeader, reputationCoverage };
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center text-slate-400">
        Loading analytics...
      </div>
    );
  }

  if (!data || !local) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center text-slate-400">
        Failed to load analytics
      </div>
    );
  }

  const maxFeedback = Math.max(1, ...data.feedbackOverTime.map((d) => d.count));
  const maxServiceCount = Math.max(1, ...data.serviceTypes.map((s) => s.count));
  const maxBand = Math.max(1, ...(network?.feedbackScoreBands ?? []).map((b) => b.count));
  const health = network?.networkHealth;
  const topLocalFeedbackAgent = data.topAgentsByReputation[0];
  const topLocalOwner = data.topOwners[0];
  const networkHasLiveData = Boolean(
    network &&
      !network.degraded &&
      ((health?.totalAgents ?? 0) > 0 ||
        network.registryGrowth.length > 0 ||
        network.feedbackVolumeTrend.length > 0 ||
        network.mostRatedAgents.length > 0 ||
        network.topRatedAgents.length > 0 ||
        network.mostActiveRaters.length > 0)
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur sticky top-0 z-10">
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
          <Link
            href="/dashboard"
            className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-all"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-xs font-semibold text-teal-700 mb-2">Google BigQuery intelligence layer</p>
          <h1 className="text-3xl font-bold mb-3">Agent Economy Analytics</h1>
          <p className="text-slate-600 text-sm max-w-3xl leading-relaxed">
            AgentRank uses BigQuery to read raw Ethereum mainnet ERC-8004 registry logs, decode identity
            and reputation events, and turn them into trust, concentration, and Sybil-pressure signals.
            Local panels use the indexed database; Network Trends scans the broader on-chain economy.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Metric label="agents indexed locally" value={fmt(data.totalAgents)} detail="Decoded from ERC-8004 identity logs" tone="info" tooltip="Total number of ERC-8004 agents whose identity registration has been decoded and stored in AgentRank's local database." />
          <Metric label="local feedback events" value={fmt(data.totalFeedbackEvents)} detail={`${local.activeFeedbackDays} active feedback day(s)`} tooltip="Number of Reputation Registry feedback submissions stored locally for indexed agents." />
          <Metric label="avg feedback per agent" value={String(local.avgFeedbackPerAgent)} detail="Shows reputation cold-start pressure" tone={local.avgFeedbackPerAgent < 0.1 ? "warn" : "good"} tooltip="Local feedback events divided by indexed agents. A low number means most agents have no reviews yet." />
          <Metric label="top owner footprint" value={fmt(local.topOwner?.agentCount ?? 0)} detail={local.topOwner ? shortAddr(local.topOwner.ownerAddress) : "No owner data"} tooltip="The largest number of agents registered by a single owner wallet among indexed agents. A high count can indicate one operator running many agents." />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card
            title="Reputation Cold Start"
            subtitle="Most agents are registered before they have meaningful feedback."
            tooltip="Share of indexed agents that have at least one feedback event and therefore appear in the local reputation leaderboard."
          >
            <div className="flex items-end gap-3">
              <p className="text-4xl font-bold text-slate-950">{pct(local.reputationCoverage)}</p>
              <p className="text-xs text-slate-500 pb-1">of indexed agents appear in the reputation leaderboard</p>
            </div>
            <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, local.reputationCoverage)}%` }} />
            </div>
            <p className="text-xs text-amber-700 mt-3">
              This is the core AgentRank gap: ERC-8004 creates identity quickly, but trust signals arrive slowly.
            </p>
          </Card>

          <Card title="Service Surface" subtitle="What agents say they can do." tooltip="The most common service endpoint type (e.g. web, MCP, A2A) declared in indexed agents' metadata, and how many agents expose it.">
            {local.serviceLeader ? (
              <>
                <p className="text-4xl font-bold text-slate-950">{local.serviceLeader.name}</p>
                <p className="text-xs text-slate-500 mt-2">{fmt(local.serviceLeader.count)} indexed agents expose this service.</p>
              </>
            ) : (
              <EmptyState text="No service metadata found." />
            )}
          </Card>

          <Card title="Trust API Readiness" subtitle="What a caller can safely use today." tooltip="Snapshot of which AgentRank trust-score components are reliably populated today versus still sparse, for callers integrating the risk API.">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Identity registry</span>
                <span className="font-semibold text-emerald-700">indexed</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Metadata enrichment</span>
                <span className="font-semibold text-emerald-700">parsed</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Reputation coverage</span>
                <span className="font-semibold text-amber-700">sparse</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Risk endpoint</span>
                <span className="font-semibold text-cyan-700">usable</span>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card title="Feedback Over Time" subtitle="Local indexed Reputation Registry submissions grouped by day." tooltip="Count of local Reputation Registry feedback events, grouped by the on-chain day they were recorded.">
            {data.feedbackOverTime.length === 0 ? (
              <EmptyState text="No local feedback events found." />
            ) : (
              <div className="space-y-2">
                {data.feedbackOverTime.slice(-12).map((d) => (
                  <BarRow key={d.date} label={d.date} value={d.count} max={maxFeedback} color="bg-cyan-500" />
                ))}
              </div>
            )}
          </Card>

          <Card title="Service Types" subtitle="Metadata-derived capabilities and reachable endpoints." tooltip="Counts of declared service endpoints (web, MCP, A2A, etc.) parsed from each indexed agent's metadata JSON.">
            {data.serviceTypes.length === 0 ? (
              <EmptyState text="No service metadata found." />
            ) : (
              <div className="space-y-2">
                {data.serviceTypes.slice(0, 10).map((s) => (
                  <BarRow
                    key={s.name}
                    label={s.name}
                    value={s.count}
                    max={maxServiceCount}
                    color={SERVICE_COLORS[s.name] ?? "bg-slate-300"}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Top Agents by Reputation" subtitle="Local trust-score reputation component, max 30." tooltip="Agents ranked by AgentRank's reputation score component (0-30), derived from the quality, quantity, and credibility of the feedback they've received.">
            {data.topAgentsByReputation.length === 0 ? (
              <EmptyState text="No agent has reputation events yet." />
            ) : (
              <div className="space-y-1">
                {data.topAgentsByReputation.slice(0, 8).map((a) => (
                  <RankLine
                    key={a.agentId}
                    href={`/agents/${a.agentId}`}
                    left={a.name || `Agent #${a.agentId}`}
                    sub={`${a.feedbackCount} feedback${a.feedbackCount === 1 ? "" : "s"}${a.avgFeedback !== null ? ` - avg ${a.avgFeedback}` : ""}`}
                    right={`${a.reputationScore}/30`}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="Owner Concentration" subtitle="Local owner wallets with the largest registered fleets." tooltip="Owner wallets controlling the most registered agents in the local index, with their average trust score.">
            <div className="space-y-1">
              {data.topOwners.slice(0, 8).map((o) => (
                <RankLine
                  key={o.ownerAddress}
                  left={o.ownerEnsName || shortAddr(o.ownerAddress)}
                  sub={`${fmt(o.agentCount)} agents registered${o.verifiedHuman ? " - World ID owner" : ""}`}
                  right={`avg ${o.avgTrustScore}`}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-xl font-bold">Network Trends</h2>
              <p className="text-slate-600 text-sm max-w-3xl mt-1">
                Live aggregates computed directly on Google BigQuery over the entire ERC-8004 Identity and
                Reputation registries on Ethereum mainnet, not just agents ingested locally.
              </p>
            </div>
            <button
              onClick={() => loadNetwork(true)}
              disabled={networkLoading}
              className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
            >
              {networkLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {network && (
            <p className="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${network.degraded ? "bg-amber-500" : "bg-cyan-500"}`} />
              {network.degraded ? "Live BigQuery unavailable" : "Powered by Google BigQuery"} - fetched{" "}
              {new Date(network.fetchedAt).toLocaleString()}
            </p>
          )}

          {networkError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 mb-6">
              {networkError}
            </div>
          )}

          {network?.degraded && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 mb-6">
              {network.reason || "Live BigQuery trends are unavailable right now."}
            </div>
          )}

          {networkLoading && !network ? (
            <EmptyState text="Loading network trends..." />
          ) : network?.degraded ? (
            <>
              <BigQueryUnavailable
                reason={network.reason}
                retrying={networkLoading}
                onRetry={() => loadNetwork(true)}
              />

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Metric label="indexed agents" value={fmt(data.totalAgents)} detail="Local ERC-8004 cache" tone="info" tooltip="Total number of agents indexed in AgentRank's local database, used as a fallback while live BigQuery network trends are unavailable." />
                <Metric label="indexed feedback" value={fmt(data.totalFeedbackEvents)} detail="Local Reputation events" tooltip="Number of Reputation Registry feedback events stored locally for indexed agents." />
                <Metric
                  label="top local owner"
                  value={fmt(topLocalOwner?.agentCount ?? 0)}
                  detail={topLocalOwner ? shortAddr(topLocalOwner.ownerAddress) : "No owner data"}
                  tone={(topLocalOwner?.agentCount ?? 0) > 100 ? "warn" : "default"}
                  tooltip="The largest number of agents registered by a single owner wallet in the local index."
                />
                <Metric
                  label="local reputation leader"
                  value={topLocalFeedbackAgent ? `${topLocalFeedbackAgent.reputationScore}/30` : "0/30"}
                  detail={topLocalFeedbackAgent?.name || "No reputation data"}
                  tone={topLocalFeedbackAgent ? "good" : "warn"}
                  tooltip="The highest reputation score (0-30) among locally indexed agents."
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card
                  title="Local Feedback Pulse"
                  subtitle="Fallback view from the indexed Reputation Registry while BigQuery live scans are offline."
                  tooltip="Local feedback events grouped by day, shown as a substitute for the network-wide Feedback Volume trend."
                >
                  {data.feedbackOverTime.length === 0 ? (
                    <EmptyState text="No local feedback events found." />
                  ) : (
                    <div className="space-y-2">
                      {data.feedbackOverTime.slice(-14).map((d) => (
                        <BarRow key={d.date} label={d.date} value={d.count} max={maxFeedback} color="bg-cyan-500" />
                      ))}
                    </div>
                  )}
                </Card>

                <Card
                  title="Local Owner Footprint"
                  subtitle="Largest owner wallets in the indexed cache. BigQuery normally expands this to the full registry."
                  tooltip="Owner wallets with the most registered agents in the local index, shown as a substitute for the network-wide Owner Concentration view."
                >
                  {data.topOwners.length === 0 ? (
                    <EmptyState text="No local owner data found." />
                  ) : (
                    <div className="space-y-1">
                      {data.topOwners.slice(0, 10).map((o) => (
                        <RankLine
                          key={o.ownerAddress}
                          left={o.ownerEnsName || shortAddr(o.ownerAddress)}
                          sub={`${fmt(o.agentCount)} agents registered${o.verifiedHuman ? " - World ID owner" : ""}`}
                          right={`avg ${o.avgTrustScore}`}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </>
          ) : network && !networkHasLiveData ? (
            <Card
              title="No BigQuery Rows Returned"
              subtitle="The BigQuery request succeeded, but the ERC-8004 registry queries returned no rows."
              tooltip="BigQuery connected and ran successfully, but the Identity/Reputation registry queries returned zero rows — likely a query shape issue rather than zero on-chain activity."
              action={
                <button
                  onClick={() => loadNetwork(true)}
                  disabled={networkLoading}
                  className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {networkLoading ? "Refreshing..." : "Refresh"}
                </button>
              }
            >
              <p className="text-sm text-slate-600 leading-relaxed">
                This usually means the registry/event query shape needs adjusting, not that the network has no activity.
                The local analytics above are still reading indexed AgentRank data.
              </p>
            </Card>
          ) : network ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Metric label="network agents" value={fmt(health?.totalAgents)} detail="Identity Registry total" tone="info" tooltip="Total number of agents ever registered on the ERC-8004 Identity Registry across all of Ethereum mainnet." />
                <Metric label="agents with feedback" value={pct(health?.coveragePct)} detail={`${fmt(health?.agentsWithFeedback)} agents`} tone={(health?.coveragePct ?? 0) < 10 ? "warn" : "good"} tooltip="Percentage of all network agents that have received at least one Reputation Registry feedback event." />
                <Metric label="unique raters" value={fmt(health?.uniqueRaters)} detail={`${fmt(health?.totalFeedback)} feedback events`} tooltip="Number of distinct wallet addresses that have ever submitted feedback on the Reputation Registry, network-wide." />
                <Metric label="last 30 days" value={fmt(health?.feedback30d)} detail={`${fmt(health?.agents30d)} new agents`} tooltip="Feedback events submitted and new agents registered network-wide in the last 30 days." />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <Card title="Registry Growth" subtitle="New agent registrations per week across the full Identity Registry." tooltip="Weekly count of Registered events emitted by the Identity Registry contract, across its full on-chain history.">
                  {network.registryGrowth.length === 0 ? (
                    <EmptyState text="No registrations found." />
                  ) : (
                    <div className="space-y-2">
                      {network.registryGrowth.slice(-14).map((d) => (
                        <BarRow
                          key={d.week}
                          label={d.week}
                          value={d.registrations}
                          max={Math.max(1, ...network.registryGrowth.map((x) => x.registrations))}
                          color="bg-teal-500"
                        />
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Feedback Volume" subtitle="Reputation Registry submissions per week, network-wide." tooltip="Weekly count of NewFeedback events emitted by the Reputation Registry contract, across the entire network.">
                  {network.feedbackVolumeTrend.length === 0 ? (
                    <EmptyState text="No feedback events found." />
                  ) : (
                    <div className="space-y-2">
                      {network.feedbackVolumeTrend.slice(-14).map((d) => (
                        <BarRow
                          key={d.week}
                          label={d.week}
                          value={d.feedbackCount}
                          max={Math.max(1, ...network.feedbackVolumeTrend.map((x) => x.feedbackCount))}
                          color="bg-cyan-500"
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <Card title="Owner Concentration" subtitle="Whether agent registrations are spread out or clustered." tooltip="How concentrated agent registrations are among owner wallets, network-wide. High concentration means a few wallets own most agents.">
                  <ConcentrationCard title="Identity Registry" data={network.ownerConcentration} />
                </Card>

                <Card title="Rater Concentration" subtitle="Whether reputation is written by many raters or a few prolific wallets." tooltip="How concentrated feedback submissions are among rater wallets, network-wide. High concentration can indicate a small number of accounts driving most reputation signals.">
                  <ConcentrationCard title="Reputation Registry" data={network.raterConcentration} />
                </Card>

                <Card title="Feedback Score Bands" subtitle="Decoded value distribution from raw Reputation logs." tooltip="Each feedback event's normalized value (0-100) bucketed into bands: excellent (80+), positive (60-79), mixed (40-59), negative (1-39), and zero, decoded directly from raw Reputation Registry logs.">
                  {network.feedbackScoreBands.length === 0 ? (
                    <EmptyState text="No score distribution found." />
                  ) : (
                    <div className="space-y-2">
                      {network.feedbackScoreBands.map((b) => (
                        <BarRow
                          key={b.band}
                          label={BAND_LABELS[b.band] ?? b.band}
                          value={b.count}
                          max={maxBand}
                          color={b.band === "excellent" || b.band === "positive" ? "bg-emerald-500" : b.band === "mixed" ? "bg-amber-500" : "bg-red-500"}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <Card title="Most-Rated Agents" subtitle="Highest feedback counts across the whole Reputation Registry." tooltip="Agents with the highest total feedback counts across the entire Reputation Registry, network-wide, including agents not yet indexed locally.">
                  {network.mostRatedAgents.length === 0 ? (
                    <EmptyState text="No feedback events found." />
                  ) : (
                    <div className="space-y-1">
                      {network.mostRatedAgents.map((a) => (
                        <RankLine
                          key={a.agentId}
                          href={a.name ? `/agents/${a.agentId}` : undefined}
                          left={a.name || `Agent #${a.agentId}`}
                          sub="Network-wide feedback count"
                          right={`${fmt(a.feedbackCount)} feedback${a.feedbackCount === 1 ? "" : "s"}`}
                        />
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Top-Rated Agents by Avg Score" subtitle="Average feedback value decoded directly from raw log data." tooltip="Agents with the highest average feedback value (0-100), computed by decoding the value field directly from raw Reputation Registry logs.">
                  {network.topRatedAgents.length === 0 ? (
                    <EmptyState text="No feedback events found." />
                  ) : (
                    <div className="space-y-1">
                      {network.topRatedAgents.map((a) => (
                        <RankLine
                          key={a.agentId}
                          href={a.name ? `/agents/${a.agentId}` : undefined}
                          left={a.name || `Agent #${a.agentId}`}
                          sub={`${fmt(a.feedbackCount)} feedback${a.feedbackCount === 1 ? "" : "s"}`}
                          right={`avg ${Math.round(a.avgScore * 10) / 10}`}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title="Most Active Raters" subtitle="Wallets rating the most distinct agents. High fan-out is a Sybil/bot signal." tooltip="Wallets that have submitted feedback for the largest number of distinct agents, network-wide. A high count can indicate automated or bot-driven rating activity.">
                  {network.mostActiveRaters.length === 0 ? (
                    <EmptyState text="No raters found." />
                  ) : (
                    <div className="space-y-1">
                      {network.mostActiveRaters.map((r) => (
                        <div key={r.clientAddress} className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
                          <div className="min-w-0">
                            <p className="text-sm font-mono text-slate-900 truncate">{shortAddr(r.clientAddress)}</p>
                            <p className="text-xs text-slate-500">
                              {fmt(r.totalFeedbacks)} feedback across {fmt(r.agentsRated)} agents
                              {r.verifiedHuman ? " - World ID" : ""}
                              {r.humanBacked ? " - AgentKit" : ""}
                            </p>
                          </div>
                          {r.agentsRated > 8 && (
                            <span
                              title="This wallet has rated more than 8 distinct agents, a common threshold for flagging non-human rating behavior."
                              className="text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-medium whitespace-nowrap cursor-help"
                            >
                              high fan-out
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card title="Fresh-Wallet Pressure" subtitle="Percent of weekly feedback from wallets less than 7 days old at rating time." tooltip="Percentage of each week's feedback submitted by wallets that were less than 7 days old (by first on-chain transaction) at the time they rated — a proxy for Sybil/spam pressure.">
                  {network.freshWalletPressureTrend.length === 0 ? (
                    <EmptyState text="No feedback events found." />
                  ) : (
                    <div className="space-y-2">
                      {network.freshWalletPressureTrend.slice(-14).map((d) => (
                        <BarRow
                          key={d.week}
                          label={d.week}
                          value={d.freshWalletPct}
                          max={100}
                          suffix="%"
                          color="bg-amber-500"
                        />
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
