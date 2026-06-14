const { prisma } = require("../db/prisma");
const { safeJson } = require("../lib/safeJson");
const { getNetworkAnalytics, emptyNetworkAnalytics } = require("../analytics/networkAnalytics");

async function analyticsRoutes(fastify) {
  // GET /analytics/network — live BigQuery trends/leaderboards over the FULL
  // ERC-8004 registries on mainnet (not just our ingested subset). Cached for
  // 10 minutes since these are full-table scans. ?refresh=1 bypasses the cache.
  fastify.get("/analytics/network", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const force = req.query?.refresh === "1";
      const data = await getNetworkAnalytics({ force });
      return data;
    } catch (err) {
      req.log.error(err);
      return emptyNetworkAnalytics(
        "Live BigQuery trends are unavailable in this local environment. Local analytics above are still working."
      );
    }
  });

  // GET /analytics — aggregate views over the indexed agent set
  fastify.get("/analytics", async (req, reply) => {
    // Local analytics update whenever ingestion/demo feedback changes, so avoid
    // browser caching during product demos.
    reply.header("Cache-Control", "no-store");
    const agents = await prisma.agent.findMany({
      include: { trustScore: true, ensRecord: true, feedbackEvents: { where: { isRevoked: false } } },
    });

    // --- Feedback events over time (grouped by day) ---
    const feedbackByDay = new Map();
    for (const agent of agents) {
      for (const f of agent.feedbackEvents) {
        if (!f.blockTimestamp) continue;
        const day = f.blockTimestamp.toISOString().slice(0, 10);
        if (!feedbackByDay.has(day)) feedbackByDay.set(day, { count: 0, sum: 0 });
        const entry = feedbackByDay.get(day);
        entry.count += 1;
        if (typeof f.valueNormalized === "number") entry.sum += f.valueNormalized;
      }
    }
    const feedbackOverTime = [...feedbackByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { count, sum }]) => ({
        date,
        count,
        avgValue: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
      }));

    // --- Top agents by reputation ---
    const topAgentsByReputation = agents
      .filter((a) => (a.trustScore?.reputationScore ?? 0) > 0)
      .sort((a, b) => (b.trustScore?.reputationScore ?? 0) - (a.trustScore?.reputationScore ?? 0))
      .slice(0, 10)
      .map((a) => {
        const values = a.feedbackEvents
          .map((f) => f.valueNormalized)
          .filter((v) => typeof v === "number" && !isNaN(v));
        const avg = values.length > 0 ? values.reduce((x, y) => x + y, 0) / values.length : null;
        return {
          agentId: a.agentId.toString(),
          name: a.name,
          reputationScore: a.trustScore?.reputationScore ?? 0,
          trustScore: a.trustScore?.trustScore ?? 0,
          feedbackCount: a.feedbackEvents.length,
          avgFeedback: avg !== null ? Math.round(avg * 10) / 10 : null,
        };
      });

    // --- Most common service types ---
    const serviceCounts = new Map();
    for (const agent of agents) {
      const services = safeJson(agent.servicesJson, []);
      const seen = new Set();
      for (const svc of services) {
        if (!svc?.name || seen.has(svc.name)) continue;
        seen.add(svc.name);
        serviceCounts.set(svc.name, (serviceCounts.get(svc.name) ?? 0) + 1);
      }
    }
    const serviceTypes = [...serviceCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    // --- Most active owners ---
    // World ID-verified owner wallets, to flag accountable operators.
    const verifiedOwnerSet = new Set(
      (await prisma.verifiedOwner.findMany({ select: { walletAddress: true } })).map(
        (o) => o.walletAddress
      )
    );
    const ownerGroups = new Map();
    for (const agent of agents) {
      const owner = agent.ownerAddress;
      if (!owner) continue;
      if (!ownerGroups.has(owner)) {
        ownerGroups.set(owner, { ownerAddress: owner, ownerEnsName: null, agentCount: 0, agentIds: [], totalTrustScore: 0 });
      }
      const entry = ownerGroups.get(owner);
      entry.agentCount += 1;
      entry.agentIds.push(agent.agentId.toString());
      entry.totalTrustScore += agent.trustScore?.trustScore ?? 0;
      if (!entry.ownerEnsName && agent.ensRecord?.ownerEnsName) {
        entry.ownerEnsName = agent.ensRecord.ownerEnsName;
      }
    }
    const topOwners = [...ownerGroups.values()]
      .sort((a, b) => b.agentCount - a.agentCount)
      .slice(0, 10)
      .map((o) => ({
        ownerAddress: o.ownerAddress,
        ownerEnsName: o.ownerEnsName,
        verifiedHuman: o.ownerAddress
          ? verifiedOwnerSet.has(o.ownerAddress.toLowerCase())
          : false,
        agentCount: o.agentCount,
        avgTrustScore: o.agentCount > 0 ? Math.round((o.totalTrustScore / o.agentCount) * 10) / 10 : 0,
        agentIds: o.agentIds.slice(0, 10),
      }));

    return {
      totalAgents: agents.length,
      totalFeedbackEvents: feedbackOverTime.reduce((sum, d) => sum + d.count, 0),
      feedbackOverTime,
      topAgentsByReputation,
      serviceTypes,
      topOwners,
    };
  });
}

module.exports = analyticsRoutes;
