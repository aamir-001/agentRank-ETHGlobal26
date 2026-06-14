const crypto = require("crypto");
const { prisma } = require("../db/prisma");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const DEMO_TAG = "demo-world-id-rater";

function parseAgentId(value) {
  try {
    if (value === undefined || value === null || value === "") return null;
    return BigInt(value);
  } catch {
    return null;
  }
}

function scoreSummary(score) {
  if (!score) return null;
  return {
    trustScore: score.trustScore,
    identityScore: score.identityScore,
    reputationScore: score.reputationScore,
    ensScore: score.ensScore,
    ownerScore: score.ownerScore,
    agentKitScore: score.agentKitScore,
    riskLevel: score.riskLevel,
    verifiedHumanCount: score.verifiedHumanCount,
    humanBackedRaterCount: score.humanBackedRaterCount,
  };
}

async function demoRoutes(fastify) {
  // POST /demo/verify-rater
  //
  // Local-only escape hatch when World ID request creation is unavailable
  // because the Developer Portal app/action/RP configuration is not accepted.
  // This lets the scoring flow be tested without claiming a real World proof.
  fastify.post("/demo/verify-rater", async (req, reply) => {
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_ROUTES !== "true") {
      return reply.code(404).send({ error: "Not found" });
    }

    const { walletAddress } = req.body || {};
    if (!walletAddress || !ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }

    const wallet = walletAddress.toLowerCase();
    const nullifierHash =
      "demo-rater-" +
      crypto.createHash("sha256").update(`rater:${wallet}`).digest("hex");

    const rater = await prisma.verifiedRater.upsert({
      where: { walletAddress: wallet },
      update: { nullifierHash, verificationLevel: "demo" },
      create: { walletAddress: wallet, nullifierHash, verificationLevel: "demo" },
    });

    const rated = await prisma.feedbackEvent.findMany({
      where: { clientAddress: wallet, isRevoked: false },
      select: { agentId: true },
      distinct: ["agentId"],
    });
    for (const { agentId } of rated) {
      await computeTrustScoreForAgent(agentId);
    }

    return {
      ok: true,
      mode: "local-demo-rater-verification",
      warning:
        "This is a local development bypass. It does not prove World ID personhood.",
      walletAddress: rater.walletAddress,
      verificationLevel: rater.verificationLevel,
      agentsRescored: rated.length,
    };
  });

  // POST /demo/feedback
  //
  // Local workaround for hack/demo testing when the user cannot submit an
  // ERC-8004 mainnet feedback transaction. It creates a synthetic FeedbackEvent
  // in the same table the indexer uses, then recomputes the target agent score.
  fastify.post("/demo/feedback", async (req, reply) => {
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_ROUTES !== "true") {
      return reply.code(404).send({ error: "Not found" });
    }

    const {
      agentId: agentIdRaw,
      walletAddress,
      value = 90,
      replaceExisting = true,
    } = req.body || {};

    const agentId = parseAgentId(agentIdRaw);
    if (!agentId) return reply.code(400).send({ error: "Invalid agentId" });
    if (!walletAddress || !ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }

    const normalizedValue = Number(value);
    if (!Number.isFinite(normalizedValue) || normalizedValue < 0 || normalizedValue > 100) {
      return reply.code(400).send({ error: "value must be a number from 0 to 100" });
    }

    const wallet = walletAddress.toLowerCase();
    const [agent, verifiedRater, humanBackedRater] = await Promise.all([
      prisma.agent.findUnique({ where: { agentId }, include: { trustScore: true } }),
      prisma.verifiedRater.findUnique({ where: { walletAddress: wallet } }),
      prisma.humanBackedAgent.findUnique({ where: { walletAddress: wallet } }),
    ]);

    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    if (replaceExisting) {
      await prisma.feedbackEvent.deleteMany({
        where: { agentId, clientAddress: wallet, tag1: DEMO_TAG },
      });
    }

    const now = new Date();
    const feedbackIndex =
      BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    const txHash =
      "0x" +
      crypto
        .createHash("sha256")
        .update(`${agentId}:${wallet}:${normalizedValue}:${now.toISOString()}`)
        .digest("hex");

    const feedback = await prisma.feedbackEvent.create({
      data: {
        agentId,
        clientAddress: wallet,
        feedbackIndex,
        valueRaw: String(Math.round(normalizedValue)),
        valueDecimals: 0,
        valueNormalized: normalizedValue,
        tag1: DEMO_TAG,
        tag2: verifiedRater
          ? "world-id-rater"
          : humanBackedRater
            ? "agentkit-human-backed-rater"
            : "unverified-demo-rater",
        endpoint: "local-demo",
        feedbackUri: `local://agentrank/demo-feedback/${agentId}/${wallet}`,
        feedbackHash: txHash,
        txHash,
        blockTimestamp: now,
      },
    });

    const before = agent.trustScore
      ? {
          trustScore: agent.trustScore.trustScore,
          reputationScore: agent.trustScore.reputationScore,
          riskLevel: agent.trustScore.riskLevel,
          verifiedHumanCount: agent.trustScore.verifiedHumanCount,
        }
      : null;
    const after = await computeTrustScoreForAgent(agentId);

    return {
      ok: true,
      mode: "local-demo-feedback",
      warning:
        "This creates a local synthetic feedback event only. It is not an ERC-8004 mainnet transaction.",
      agentId: agentId.toString(),
      rater: {
        walletAddress: wallet,
        worldIdVerified: !!verifiedRater,
        agentKitHumanBacked: !!humanBackedRater,
      },
      feedback: {
        id: feedback.id,
        value: normalizedValue,
        tag1: feedback.tag1,
        tag2: feedback.tag2,
        txHash,
      },
      before,
      after: scoreSummary(after),
      nextStep: verifiedRater
        ? "Open the agent report and check the reputation calculation. This rater should count as accountable."
        : "Verify this wallet at /verify first if you want World ID accountable-rater credit.",
    };
  });
}

module.exports = demoRoutes;
