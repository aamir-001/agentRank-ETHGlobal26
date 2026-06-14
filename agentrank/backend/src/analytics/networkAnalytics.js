// Live BigQuery analytics over the FULL ERC-8004 registries on Ethereum
// mainnet — trends and leaderboards that span the whole on-chain dataset, not
// just the agents/feedback we've ingested into SQLite.
const { runQuery } = require("../bigquery/client");
const { prisma } = require("../db/prisma");
const {
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
  IDENTITY_REGISTRATION_EVENT,
  REGISTRY_GROWTH,
  FEEDBACK_VOLUME_TREND,
  MOST_RATED_AGENTS,
  TOP_RATED_AGENTS,
  MOST_ACTIVE_RATERS,
  FRESH_WALLET_PRESSURE_TREND,
  NETWORK_HEALTH,
  OWNER_CONCENTRATION,
  RATER_CONCENTRATION,
  FEEDBACK_SCORE_BANDS,
} = require("../bigquery/queries");

const CACHE_TTL_MS = 10 * 60 * 1000; // BigQuery scans cost money — cache for 10 min
let cache = null;
let cacheAt = 0;

function emptyNetworkAnalytics(reason = null) {
  return {
    registryGrowth: [],
    feedbackVolumeTrend: [],
    mostRatedAgents: [],
    topRatedAgents: [],
    mostActiveRaters: [],
    freshWalletPressureTrend: [],
    networkHealth: null,
    ownerConcentration: null,
    raterConcentration: null,
    feedbackScoreBands: [],
    fetchedAt: new Date().toISOString(),
    degraded: true,
    reason,
  };
}

function bqDate(raw) {
  if (!raw) return null;
  const v = typeof raw === "object" && raw.value !== undefined ? raw.value : raw;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function bqInt(raw) {
  if (raw === null || raw === undefined) return null;
  const v = typeof raw === "object" && raw.value !== undefined ? raw.value : raw;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bqFloat(raw) {
  if (raw === null || raw === undefined) return null;
  const v = typeof raw === "object" && raw.value !== undefined ? raw.value : raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function weekLabel(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

async function fetchRegistryGrowth() {
  const rows = await runQuery(REGISTRY_GROWTH, {
    identityRegistry: IDENTITY_REGISTRY.toLowerCase(),
    registeredEventSig: IDENTITY_REGISTRATION_EVENT.toLowerCase(),
  });
  return rows
    .map((r) => ({ week: weekLabel(bqDate(r.week)), registrations: bqInt(r.registrations) ?? 0 }))
    .filter((r) => r.week);
}

async function fetchFeedbackVolumeTrend() {
  const rows = await runQuery(FEEDBACK_VOLUME_TREND, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return rows
    .map((r) => ({ week: weekLabel(bqDate(r.week)), feedbackCount: bqInt(r.feedback_count) ?? 0 }))
    .filter((r) => r.week);
}

async function fetchMostRatedAgents() {
  const rows = await runQuery(MOST_RATED_AGENTS, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return rows
    .map((r) => ({ agentId: bqInt(r.agent_id), feedbackCount: bqInt(r.feedback_count) ?? 0 }))
    .filter((r) => r.agentId !== null);
}

async function fetchTopRatedAgents() {
  const rows = await runQuery(TOP_RATED_AGENTS, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return rows
    .map((r) => ({
      agentId: bqInt(r.agent_id),
      feedbackCount: bqInt(r.feedback_count) ?? 0,
      avgScore: bqFloat(r.avg_score),
    }))
    .filter((r) => r.agentId !== null && r.avgScore !== null);
}

async function fetchMostActiveRaters() {
  const rows = await runQuery(MOST_ACTIVE_RATERS, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return rows
    .map((r) => ({
      clientAddress: r.client_address ? r.client_address.toLowerCase() : null,
      agentsRated: bqInt(r.agents_rated) ?? 0,
      totalFeedbacks: bqInt(r.total_feedbacks) ?? 0,
      firstRatingAt: bqDate(r.first_rating_at),
      lastRatingAt: bqDate(r.last_rating_at),
    }))
    .filter((r) => r.clientAddress);
}

async function fetchFreshWalletPressureTrend() {
  const rows = await runQuery(FRESH_WALLET_PRESSURE_TREND, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return rows
    .map((r) => {
      const total = bqInt(r.total_feedback) ?? 0;
      const fresh = bqInt(r.fresh_wallet_feedback) ?? 0;
      return {
        week: weekLabel(bqDate(r.week)),
        totalFeedback: total,
        freshWalletFeedback: fresh,
        freshWalletPct: total > 0 ? Math.round((fresh / total) * 1000) / 10 : 0,
      };
    })
    .filter((r) => r.week);
}

async function fetchNetworkHealth() {
  const rows = await runQuery(NETWORK_HEALTH, {
    identityRegistry: IDENTITY_REGISTRY.toLowerCase(),
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
    registeredEventSig: IDENTITY_REGISTRATION_EVENT.toLowerCase(),
  });
  const r = rows[0] || {};
  const totalAgents = bqInt(r.total_agents) ?? 0;
  const agentsWithFeedback = bqInt(r.agents_with_feedback) ?? 0;
  const totalFeedback = bqInt(r.total_feedback) ?? 0;
  return {
    totalAgents,
    uniqueOwners: bqInt(r.unique_owners) ?? 0,
    agents30d: bqInt(r.agents_30d) ?? 0,
    totalFeedback,
    agentsWithFeedback,
    uniqueRaters: bqInt(r.unique_raters) ?? 0,
    feedback30d: bqInt(r.feedback_30d) ?? 0,
    coveragePct:
      totalAgents > 0 ? Math.round((agentsWithFeedback / totalAgents) * 1000) / 10 : 0,
    feedbackPerRatedAgent:
      agentsWithFeedback > 0 ? Math.round((totalFeedback / agentsWithFeedback) * 10) / 10 : 0,
  };
}

function concentrationShape(row, entityName, eventName) {
  const totalEvents = bqInt(row.total_agents ?? row.total_feedback) ?? 0;
  const top1 = bqInt(row.top1_agents ?? row.top1_feedback) ?? 0;
  const top5 = bqInt(row.top5_agents ?? row.top5_feedback) ?? 0;
  const top10 = bqInt(row.top10_agents ?? row.top10_feedback) ?? 0;
  const entities = bqInt(row.owner_count ?? row.rater_count) ?? 0;
  const pct = (n) => (totalEvents > 0 ? Math.round((n / totalEvents) * 1000) / 10 : 0);
  return {
    entityName,
    eventName,
    entities,
    totalEvents,
    top1SharePct: pct(top1),
    top5SharePct: pct(top5),
    top10SharePct: pct(top10),
  };
}

async function fetchOwnerConcentration() {
  const rows = await runQuery(OWNER_CONCENTRATION, {
    identityRegistry: IDENTITY_REGISTRY.toLowerCase(),
    registeredEventSig: IDENTITY_REGISTRATION_EVENT.toLowerCase(),
  });
  return concentrationShape(rows[0] || {}, "owners", "registrations");
}

async function fetchRaterConcentration() {
  const rows = await runQuery(RATER_CONCENTRATION, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return concentrationShape(rows[0] || {}, "raters", "feedback events");
}

async function fetchFeedbackScoreBands() {
  const rows = await runQuery(FEEDBACK_SCORE_BANDS, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  return rows.map((r) => ({
    band: r.band,
    count: bqInt(r.count) ?? 0,
  }));
}

// Enrich agentId-only rows with names/links for agents we've ingested locally.
async function enrichWithAgentNames(rows) {
  if (rows.length === 0) return rows;
  const agents = await prisma.agent.findMany({
    where: { agentId: { in: rows.map((r) => BigInt(r.agentId)) } },
    select: { agentId: true, name: true },
  });
  const nameById = new Map(agents.map((a) => [a.agentId.toString(), a.name]));
  return rows.map((r) => ({ ...r, name: nameById.get(String(r.agentId)) ?? null }));
}

// Enrich rater wallets with World ID verification + AgentKit human-backing
// status from our local DB, so the leaderboard can flag verified/backed raters.
async function enrichRaters(rows) {
  if (rows.length === 0) return rows;
  const wallets = rows.map((r) => r.clientAddress);
  const [verified, backed] = await Promise.all([
    prisma.verifiedRater.findMany({ where: { walletAddress: { in: wallets } }, select: { walletAddress: true } }),
    prisma.humanBackedAgent.findMany({ where: { walletAddress: { in: wallets } }, select: { walletAddress: true } }),
  ]);
  const verifiedSet = new Set(verified.map((v) => v.walletAddress.toLowerCase()));
  const backedSet = new Set(backed.map((b) => b.walletAddress.toLowerCase()));
  return rows.map((r) => ({
    ...r,
    verifiedHuman: verifiedSet.has(r.clientAddress),
    humanBacked: backedSet.has(r.clientAddress),
  }));
}

async function getNetworkAnalytics({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL_MS) {
    return cache;
  }

  const [
    registryGrowth,
    feedbackVolumeTrend,
    mostRatedAgents,
    topRatedAgents,
    mostActiveRaters,
    freshWalletPressureTrend,
    networkHealth,
    ownerConcentration,
    raterConcentration,
    feedbackScoreBands,
  ] =
    await Promise.all([
      fetchRegistryGrowth(),
      fetchFeedbackVolumeTrend(),
      fetchMostRatedAgents(),
      fetchTopRatedAgents(),
      fetchMostActiveRaters(),
      fetchFreshWalletPressureTrend(),
      fetchNetworkHealth(),
      fetchOwnerConcentration(),
      fetchRaterConcentration(),
      fetchFeedbackScoreBands(),
    ]);

  const [mostRatedEnriched, topRatedEnriched, ratersEnriched] = await Promise.all([
    enrichWithAgentNames(mostRatedAgents),
    enrichWithAgentNames(topRatedAgents),
    enrichRaters(mostActiveRaters),
  ]);

  cache = {
    registryGrowth,
    feedbackVolumeTrend,
    mostRatedAgents: mostRatedEnriched,
    topRatedAgents: topRatedEnriched,
    mostActiveRaters: ratersEnriched,
    freshWalletPressureTrend,
    networkHealth,
    ownerConcentration,
    raterConcentration,
    feedbackScoreBands,
    fetchedAt: new Date().toISOString(),
  };
  cacheAt = Date.now();
  return cache;
}

module.exports = { getNetworkAnalytics, emptyNetworkAnalytics };
