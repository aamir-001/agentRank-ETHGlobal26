const { prisma } = require("../db/prisma");
const { ENS_LINKED_THRESHOLD } = require("../ens/enrichAgentEns");
const { safeJson } = require("../lib/safeJson");
const { buildClusterContext, scoreVoices } = require("../scoring/computeTrustScore");
const { buildClusterVoices } = require("../scoring/raterClustering");

// Load cached BigQuery Sybil profiles for a set of feedback rater wallets,
// keyed by lowercase address.
async function raterProfileMap(feedbackEvents) {
  const wallets = [
    ...new Set(
      (feedbackEvents || [])
        .map((f) => f.clientAddress && f.clientAddress.toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (wallets.length === 0) return new Map();
  const rows = await prisma.raterProfile.findMany({
    where: { walletAddress: { in: wallets } },
  });
  return new Map(rows.map((p) => [p.walletAddress.toLowerCase(), p]));
}

// Set of lowercase wallet addresses among these feedback events whose owners
// proved unique personhood via World ID.
async function verifiedRaterSet(feedbackEvents) {
  const wallets = [
    ...new Set(
      (feedbackEvents || [])
        .map((f) => f.clientAddress && f.clientAddress.toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (wallets.length === 0) return new Set();
  const raters = await prisma.verifiedRater.findMany({
    where: { walletAddress: { in: wallets } },
    select: { walletAddress: true },
  });
  return new Set(raters.map((r) => r.walletAddress));
}

function serializeAgent(agent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    description: agent.description,
    image: agent.image,
    ownerAddress: agent.ownerAddress,
    agentUri: agent.agentUri,
    active: agent.active,
    x402Support: agent.x402Support ?? false,
    ensName: agent.ensName,
    webEndpoint: agent.webEndpoint,
    mcpEndpoint: agent.mcpEndpoint,
    a2aEndpoint: agent.a2aEndpoint,
    services: safeJson(agent.servicesJson, []),
    supportedTrust: safeJson(agent.supportedTrustJson, []),
    registeredAt: agent.registeredAt,
    registeredTxHash: agent.registeredTxHash,
    registeredBlockNumber: agent.registeredBlockNumber?.toString(),
    feedbackCount: agent._count?.feedbackEvents ?? agent.feedbackEvents?.length ?? 0,
    trustScore: agent.trustScore
      ? {
          score: agent.trustScore.trustScore,
          identityScore: agent.trustScore.identityScore,
          reputationScore: agent.trustScore.reputationScore,
          naiveReputationScore: agent.trustScore.naiveReputationScore ?? 0,
          verifiedFeedbackCount: agent.trustScore.verifiedFeedbackCount ?? 0,
          verifiedHumanCount: agent.trustScore.verifiedHumanCount ?? 0,
          paymentScore: agent.trustScore.paymentScore,
          ensScore: agent.trustScore.ensScore ?? 0,
          ownerScore: agent.trustScore.ownerScore ?? 0,
          ownerVerified: agent.trustScore.ownerVerified ?? false,
          agentKitScore: agent.trustScore.agentKitScore ?? 0,
          humanBacked: agent.trustScore.humanBacked ?? false,
          riskLevel: agent.trustScore.riskLevel,
          reasons: safeJson(agent.trustScore.reasonsJson, []),
          computedAt: agent.trustScore.computedAt,
        }
      : null,
    ens: agent.ensRecord
      ? {
          declaredEnsName: agent.ensRecord.declaredEnsName,
          ownerEnsName: agent.ensRecord.ownerEnsName,
          resolvedAddress: agent.ensRecord.ensResolvedAddress,
          linked: agent.ensRecord.ensScore >= ENS_LINKED_THRESHOLD,
          verified: agent.ensRecord.ensVerified,
          ensip25Verified: agent.ensRecord.ensip25Verified ?? false,
          ensip25Key: agent.ensRecord.ensip25Key,
          score: agent.ensRecord.ensScore,
          textRecords: safeJson(agent.ensRecord.textRecordsJson, {}),
          reasons: safeJson(agent.ensRecord.reasonsJson, []),
          checkedAt: agent.ensRecord.checkedAt,
        }
      : null,
    ensPassport: agent.ensPassport
      ? {
          ensName: agent.ensPassport.ensName,
          label: agent.ensPassport.label,
          parentName: agent.ensPassport.parentName,
          status: agent.ensPassport.status,
          records: safeJson(agent.ensPassport.recordsJson, {}),
          verification: safeJson(agent.ensPassport.verificationJson, null),
          publishedAt: agent.ensPassport.publishedAt,
          verifiedAt: agent.ensPassport.verifiedAt,
        }
      : null,
  };
}

async function agentsRoutes(fastify) {
  // GET /agents — list with search + filters
  fastify.get("/agents", async (req, reply) => {
    const {
      q,
      x402Support,
      active,
      ensLinked,
      minScore,
      sort = "score",
      page = 1,
      limit = 20,
    } = req.query;

    const where = {};

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { description: { contains: q } },
        { ownerAddress: { contains: q } },
        { ensName: { contains: q } },
      ];
    }

    if (x402Support === "true") where.x402Support = true;
    if (active === "true") where.active = true;
    if (ensLinked === "true") where.ensRecord = { ownerEnsName: { not: null } };

    let agents = await prisma.agent.findMany({
      where,
      include: {
        trustScore: true,
        ensRecord: true,
        ensPassport: true,
        _count: { select: { feedbackEvents: true } },
      },
      orderBy: { registeredAt: "desc" },
    });

    if (minScore !== undefined) {
      const min = parseFloat(minScore);
      agents = agents.filter((a) => (a.trustScore?.trustScore ?? 0) >= min);
    }

    if (sort === "score") {
      agents.sort(
        (a, b) => (b.trustScore?.trustScore ?? 0) - (a.trustScore?.trustScore ?? 0)
      );
    }

    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const total = agents.length;
    const paginated = agents.slice((pageNum - 1) * pageSize, pageNum * pageSize);

    return {
      total,
      page: pageNum,
      limit: pageSize,
      agents: paginated.map(serializeAgent),
    };
  });

  // GET /agents/:agentId — single agent profile
  fastify.get("/agents/:agentId", async (req, reply) => {
    const agentId = BigInt(req.params.agentId);

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: {
        trustScore: true,
        ensRecord: true,
        ensPassport: true,
        feedbackEvents: { orderBy: { blockTimestamp: "desc" }, take: 50 },
      },
    });

    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const verifiedSet = await verifiedRaterSet(agent.feedbackEvents);
    const profiles = await raterProfileMap(agent.feedbackEvents);

    const feedback = (agent.feedbackEvents || []).map((f) => {
      const wallet = f.clientAddress ? f.clientAddress.toLowerCase() : null;
      const verifiedHuman = !!(wallet && verifiedSet.has(wallet));
      const profile = wallet ? profiles.get(wallet) : null;
      return {
        feedbackIndex: f.feedbackIndex?.toString(),
        clientAddress: f.clientAddress,
        verifiedHuman,
        // Sybil signals from BigQuery (null if not profiled yet).
        raterWeight: verifiedHuman ? 1 : profile?.raterWeight ?? null,
        agentsRated: profile?.agentsRated ?? null,
        sybilFlags: profile ? safeJson(profile.flagsJson, []) : [],
        value: f.valueNormalized,
        valueRaw: f.valueRaw,
        valueDecimals: f.valueDecimals,
        tag1: f.tag1,
        tag2: f.tag2,
        endpoint: f.endpoint,
        feedbackUri: f.feedbackUri,
        isRevoked: f.isRevoked,
        blockTimestamp: f.blockTimestamp,
        txHash: f.txHash,
      };
    });

    return { ...serializeAgent(agent), feedbackEvents: feedback };
  });

  // GET /agents/:agentId/risk — trust report
  fastify.get("/agents/:agentId/risk", async (req, reply) => {
    const agentId = BigInt(req.params.agentId);

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: {
        trustScore: true,
        ensRecord: true,
        feedbackEvents: { where: { isRevoked: false } },
      },
    });

    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const ts = agent.trustScore;
    const feedback = agent.feedbackEvents || [];

    const values = feedback
      .map((f) => f.valueNormalized)
      .filter((v) => typeof v === "number" && !isNaN(v));

    const avgFeedback =
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

    // Personhood-weighted view of the same feedback (World ID)
    const verifiedSet = await verifiedRaterSet(feedback);
    const verifiedValues = feedback
      .filter((f) => f.clientAddress && verifiedSet.has(f.clientAddress.toLowerCase()))
      .map((f) => f.valueNormalized)
      .filter((v) => typeof v === "number" && !isNaN(v));
    const humanAvg =
      verifiedValues.length > 0
        ? verifiedValues.reduce((a, b) => a + b, 0) / verifiedValues.length
        : null;
    const verifiedFeedbackCount = ts?.verifiedFeedbackCount ?? verifiedValues.length;
    // Plenty of wallet praise, zero humans behind it → classic Sybil shape.
    const sybilRiskFlag = feedback.length >= 3 && verifiedSet.size === 0;

    // Sybil clustering view: how much of the raw event count survives once
    // feedback is collapsed by controlling entity and bot raters are flagged.
    const ctx = await buildClusterContext(feedback);
    const humanBackedRaterCount = new Set(
      feedback
        .map((f) => f.clientAddress && f.clientAddress.toLowerCase())
        .filter((w) => w && ctx.humanBackedByWallet?.has(w))
        .map((w) => ctx.humanBackedByWallet.get(w))
    ).size;
    const { voices, totalEvents, clusterCount } = buildClusterVoices(feedback, ctx);
    const reputationBreakdown = scoreVoices(voices).components;
    const profiles = await raterProfileMap(feedback);
    const flaggedRaters = [...profiles.values()].filter(
      (p) => safeJson(p.flagsJson, []).length > 0
    ).length;
    const raterAnalysis = {
      feedbackEvents: totalEvents,
      independentSources: clusterCount,
      collapsedBySybilClustering: totalEvents - clusterCount,
      effectiveWeightedVoices:
        Math.round(voices.reduce((a, v) => a + v.weight, 0) * 100) / 100,
      flaggedRaters,
      sybilRiskFlag,
    };

    let recommendation = "proceed";
    if (!ts || ts.riskLevel === "high") recommendation = "do_not_call";
    else if (ts.riskLevel === "medium") recommendation = "review_before_calling";

    return {
      agentId: agentId.toString(),
      safe: ts ? ts.riskLevel !== "high" : false,
      riskLevel: ts?.riskLevel ?? "high",
      trustScore: ts?.trustScore ?? 0,
      identity: {
        registered: true,
        agentUriValid: !!agent.agentUri,
        metadataFetched: !!agent.rawMetadataJson,
        active: agent.active ?? false,
        servicesFound: safeJson(agent.servicesJson, []).length > 0,
      },
      payment: {
        x402Support: agent.x402Support ?? false,
      },
      reputation: {
        feedbackCount: feedback.length,
        averageFeedback: avgFeedback !== null ? parseFloat(avgFeedback.toFixed(2)) : null,
        verifiedHumanCount: ts?.verifiedHumanCount ?? verifiedSet.size,
        verifiedFeedbackCount,
        humanBackedRaterCount,
        humanWeightedAverage: humanAvg !== null ? parseFloat(humanAvg.toFixed(2)) : null,
        sybilRiskFlag,
        breakdown: reputationBreakdown,
      },
      raterAnalysis,
      ens: {
        declaredEnsName: agent.ensRecord?.declaredEnsName ?? null,
        ownerEnsName: agent.ensRecord?.ownerEnsName ?? null,
        verified: agent.ensRecord?.ensVerified ?? false,
        ensip25Verified: agent.ensRecord?.ensip25Verified ?? false,
      },
      owner: {
        ownerAddress: agent.ownerAddress ?? null,
        verifiedHuman: ts?.ownerVerified ?? false,
      },
      agentKit: {
        humanBacked: ts?.humanBacked ?? false,
      },
      scores: ts
        ? {
            identity: ts.identityScore,
            reputation: ts.reputationScore,
            naiveReputation: ts.naiveReputationScore ?? 0,
            ens: ts.ensScore ?? 0,
            owner: ts.ownerScore ?? 0,
            agentKit: ts.agentKitScore ?? 0,
            total: ts.trustScore,
          }
        : null,
      reasons: ts ? safeJson(ts.reasonsJson, []) : [],
      recommendation,
    };
  });
}

module.exports = agentsRoutes;
module.exports.serializeAgent = serializeAgent;
