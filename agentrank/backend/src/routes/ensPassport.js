const { prisma } = require("../db/prisma");
const { buildEnsPassport } = require("../ens/ensPassportBuilder");
const { verifyEnsPassport } = require("../ens/ensPassportVerifier");
const {
  publishSubnameOnchain,
  getAgentAttestation,
  isConfigured,
} = require("../ens/subnameRegistrar");
const { safeJson } = require("../lib/safeJson");

function serializePassport(passport) {
  if (!passport) return null;
  return {
    agentId: passport.agentId.toString(),
    ensName: passport.ensName,
    label: passport.label,
    parentName: passport.parentName,
    status: passport.status,
    records: safeJson(passport.recordsJson, {}),
    verification: safeJson(passport.verificationJson, null),
    txHash: passport.txHash,
    publishedAt: passport.publishedAt,
    verifiedAt: passport.verifiedAt,
    createdAt: passport.createdAt,
    updatedAt: passport.updatedAt,
  };
}

async function ensPassportRoutes(fastify) {
  // POST /agents/:agentId/ens-passport/generate
  fastify.post("/agents/:agentId/ens-passport/generate", async (req, reply) => {
    let agentId;
    try {
      agentId = BigInt(req.params.agentId);
    } catch {
      return reply.code(400).send({ error: "Invalid agentId" });
    }

    try {
      const passport = await buildEnsPassport(agentId);
      return passport;
    } catch (err) {
      if (err.message === "Agent not found") {
        return reply.code(404).send({ error: "Agent not found" });
      }
      req.log.error(err);
      return reply.code(500).send({ error: "Failed to generate ENS passport" });
    }
  });

  // GET /agents/:agentId/ens-passport
  fastify.get("/agents/:agentId/ens-passport", async (req, reply) => {
    let agentId;
    try {
      agentId = BigInt(req.params.agentId);
    } catch {
      return reply.code(400).send({ error: "Invalid agentId" });
    }

    const passport = await prisma.ensPassport.findUnique({ where: { agentId } });
    if (!passport) return reply.code(404).send({ error: "No ENS passport for this agent" });

    return serializePassport(passport);
  });

  // POST /agents/:agentId/ens-passport/publish — issue the subname ON-CHAIN
  // (NameWrapper / Registry + PublicResolver on Sepolia) and write all text
  // records, the ENSIP-25 attestation record, and the signed trust credential.
  fastify.post("/agents/:agentId/ens-passport/publish", async (req, reply) => {
    let agentId;
    try {
      agentId = BigInt(req.params.agentId);
    } catch {
      return reply.code(400).send({ error: "Invalid agentId" });
    }

    if (!isConfigured()) {
      return reply.code(503).send({
        error:
          "On-chain registrar not configured. Set ENS_REGISTRAR_RPC_URL and ENS_REGISTRAR_PRIVATE_KEY (Sepolia).",
      });
    }

    try {
      const result = await publishSubnameOnchain(agentId);
      return result;
    } catch (err) {
      if (err.message === "Agent not found") {
        return reply.code(404).send({ error: "Agent not found" });
      }
      req.log.error(err);
      return reply.code(500).send({ error: err.message || "Failed to publish subname" });
    }
  });

  // GET /agents/:agentId/ens-attestation — the portable, offline-verifiable
  // trust credential stored in the name's `agentrank.attestation` record.
  fastify.get("/agents/:agentId/ens-attestation", async (req, reply) => {
    let agentId;
    try {
      agentId = BigInt(req.params.agentId);
    } catch {
      return reply.code(400).send({ error: "Invalid agentId" });
    }
    const result = await getAgentAttestation(agentId);
    if (!result) return reply.code(404).send({ error: "No attestation for this agent" });
    return result;
  });

  // POST /ens-passport/verify
  fastify.post("/ens-passport/verify", async (req, reply) => {
    const { ensName } = req.body || {};
    if (!ensName || typeof ensName !== "string") {
      return reply.code(400).send({ error: "ensName is required" });
    }

    try {
      const result = await verifyEnsPassport(ensName);
      return {
        ensName: result.ensName,
        agentId: result.agentId ?? null,
        verified: result.verified,
        score: result.score,
        checks: result.checks,
        textRecords: result.textRecords,
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: "Failed to verify ENS passport" });
    }
  });
}

module.exports = ensPassportRoutes;
