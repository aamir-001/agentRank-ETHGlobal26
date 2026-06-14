const { prisma } = require("../db/prisma");
const { readAgentTextRecords } = require("../ens/ensPassportVerifier");
const { serializeAgent } = require("./agents");

async function resolveRoutes(fastify) {
  // GET /resolve/:ensName — read ENS text records and return the AgentRank profile
  fastify.get("/resolve/:ensName", async (req, reply) => {
    const { ensName } = req.params;

    const textRecords = await readAgentTextRecords(ensName);
    const agentIdRaw = textRecords["agent.id"];

    if (!agentIdRaw) {
      return reply.code(404).send({
        error: "No AgentRank ENS Passport records found for this name",
        ensName,
      });
    }

    let agentId;
    try {
      agentId = BigInt(agentIdRaw);
    } catch {
      return reply.code(400).send({ error: "Invalid agent.id text record", ensName, textRecords });
    }

    const agent = await prisma.agent.findUnique({
      where: { agentId },
      include: { trustScore: true, ensRecord: true, ensPassport: true },
    });

    if (!agent) {
      return reply.code(404).send({
        error: "ENS records reference an agent not indexed by AgentRank",
        ensName,
        textRecords,
      });
    }

    const serialized = serializeAgent(agent);

    return {
      ensName,
      source: "ENS text records + AgentRank ERC-8004 index",
      agent: {
        agentId: serialized.agentId,
        name: serialized.name,
        description: serialized.description,
        ownerAddress: serialized.ownerAddress,
        agentUri: serialized.agentUri,
        x402Support: serialized.x402Support,
        services: serialized.services,
      },
      trust: serialized.trustScore
        ? {
            trustScore: serialized.trustScore.score,
            riskLevel: serialized.trustScore.riskLevel,
            identityScore: serialized.trustScore.identityScore,
            reputationScore: serialized.trustScore.reputationScore,
            paymentScore: serialized.trustScore.paymentScore,
            ensScore: serialized.trustScore.ensScore,
          }
        : null,
      ensPassport: {
        status: agent.ensPassport?.status ?? null,
        verified: agent.ensPassport?.status === "verified",
        records: textRecords,
      },
    };
  });
}

module.exports = resolveRoutes;
