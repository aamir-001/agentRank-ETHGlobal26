const { ingestIdentity } = require("../ingest/ingestIdentity");
const { ingestReputation } = require("../ingest/ingestReputation");
const { recomputeAllScores } = require("../scoring/computeTrustScore");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");
const { prisma } = require("../db/prisma");

async function ingestRoutes(fastify) {
  // POST /ingest/identity
  fastify.post("/ingest/identity", async (req, reply) => {
    const { days, limit, full } = req.body || {};
    try {
      const result = await ingestIdentity({
        days: days ?? null,
        limit: limit ?? 1000,
        full: full ?? false,
      });

      // Recompute scores for all newly ingested agents
      const agents = await prisma.agent.findMany({ select: { agentId: true } });
      for (const { agentId } of agents) {
        await computeTrustScoreForAgent(agentId);
      }

      return { success: true, ...result };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /ingest/reputation
  fastify.post("/ingest/reputation", async (req, reply) => {
    const { days, limit, full } = req.body || {};
    try {
      const result = await ingestReputation({
        days: days ?? null,
        limit: limit ?? 2000,
        full: full ?? false,
      });

      await recomputeAllScores();

      return { success: true, ...result };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /scores/recompute
  fastify.post("/scores/recompute", async (req, reply) => {
    try {
      const result = await recomputeAllScores();
      return { success: true, ...result };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /ingest/status — checkpoint info
  fastify.get("/ingest/status", async (req, reply) => {
    const checkpoints = await prisma.ingestionCheckpoint.findMany();
    const agentCount = await prisma.agent.count();
    const feedbackCount = await prisma.feedbackEvent.count();
    const scoreCount = await prisma.trustScore.count();

    return {
      agentCount,
      feedbackCount,
      scoreCount,
      checkpoints: checkpoints.map((c) => ({
        source: c.source,
        lastBlockNumber: c.lastBlockNumber?.toString(),
        lastTimestamp: c.lastTimestamp,
        updatedAt: c.updatedAt,
      })),
    };
  });
}

module.exports = ingestRoutes;
