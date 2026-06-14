const crypto = require("crypto");
const { verifyMessage } = require("ethers");
const { prisma } = require("../db/prisma");
const { verifyWorldIdProof, AGENT_ACTION } = require("../worldid/verifyProof");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");
const { lookupBackingHuman } = require("../agentkit/agentBook");
const { signRequest } = require("@worldcoin/idkit-server");

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// Short-lived ownership challenges for the AGENT wallet (proves control of the
// agent's key, analogous to the owner flow). wallet (lowercase) -> { message, exp }.
const challenges = new Map();
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function buildChallenge(wallet) {
  const nonce = "0x" + crypto.randomBytes(16).toString("hex");
  const issued = new Date().toISOString();
  const message =
    "AgentRank human-backed agent verification\n\n" +
    "I control this agent wallet and a unique human (World ID) is backing it.\n\n" +
    `Agent wallet: ${wallet}\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${issued}`;
  challenges.set(wallet, { message, exp: Date.now() + CHALLENGE_TTL_MS });
  return message;
}

// Agents affected by this wallet becoming a human-backed agent:
//   - the agent whose own wallet IS this wallet (scored-agent +10), and
//   - every agent this wallet has rated (rater side: human-backed weight 0.6).
async function affectedAgentIds(wallet) {
  const [owned, rated] = await Promise.all([
    prisma.agent.findMany({ where: { agentWallet: wallet }, select: { agentId: true } }),
    prisma.feedbackEvent.findMany({
      where: { clientAddress: wallet, isRevoked: false },
      select: { agentId: true },
      distinct: ["agentId"],
    }),
  ]);
  const ids = new Set();
  for (const a of owned) ids.add(a.agentId);
  for (const f of rated) ids.add(f.agentId);
  return [...ids];
}

async function agentkitRoutes(fastify) {
  // GET /agentkit/rp-context — RP-signed context for IDKit, bound to the AGENT
  // action (Delegated World ID). Distinct action so backing an agent never
  // collides with a person's own rater/owner verification.
  fastify.get("/agentkit/rp-context", async (req, reply) => {
    const rpId = process.env.WORLD_ID_RP_ID;
    const signingKey = process.env.WORLD_ID_RP_SIGNING_KEY;
    if (!rpId || !signingKey) {
      return reply.code(500).send({
        error: "World ID RP not configured (WORLD_ID_RP_ID / WORLD_ID_RP_SIGNING_KEY)",
      });
    }
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: signingKey,
      action: AGENT_ACTION,
    });
    return { rp_id: rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig };
  });

  // GET /agentkit/challenge/:walletAddress — message for the agent wallet to sign.
  fastify.get("/agentkit/challenge/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;
    if (!ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    return { message: buildChallenge(walletAddress.toLowerCase()) };
  });

  // POST /agentkit/verify — mark an agent wallet as human-backed, gated by:
  //   1. signature — proves control of the AGENT wallet (you operate it).
  //   2. proof     — Delegated World ID proof (AGENT_ACTION) proving a unique
  //                  human backs the agent; its nullifier is the backing human.
  // AgentKit is one-human-to-MANY-agents, so — unlike owners/raters — the same
  // backing human (nullifier) backing additional agent wallets is ALLOWED. The
  // World portal action must permit unlimited verifications per person.
  fastify.post("/agentkit/verify", async (req, reply) => {
    const { walletAddress, proof, signature } = req.body || {};

    if (!walletAddress || !ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    if (!proof || typeof proof !== "object") {
      return reply.code(400).send({ error: "Missing World ID proof payload" });
    }
    if (!signature || typeof signature !== "string") {
      return reply.code(400).send({ error: "Missing agent wallet signature" });
    }

    const wallet = walletAddress.toLowerCase();

    // --- Proof of control: verify the signature over the issued challenge ---
    const challenge = challenges.get(wallet);
    if (!challenge || challenge.exp < Date.now()) {
      challenges.delete(wallet);
      return reply.code(400).send({
        error: "No valid challenge — request a fresh one and re-sign.",
        code: "challenge_expired",
      });
    }
    let recovered;
    try {
      recovered = verifyMessage(challenge.message, signature);
    } catch {
      return reply.code(401).send({ error: "Malformed signature", code: "bad_signature" });
    }
    if (recovered.toLowerCase() !== wallet) {
      return reply.code(401).send({
        error: "Signature does not prove control of this agent wallet.",
        code: "control_mismatch",
      });
    }
    challenges.delete(wallet);

    // --- Proof of human backing: Delegated World ID proof, bound to the wallet ---
    let result;
    try {
      result = await verifyWorldIdProof(proof, wallet, AGENT_ACTION);
    } catch (err) {
      return reply.code(400).send({ error: err.message, code: err.code });
    }

    const backingHuman = result.nullifierHash;
    if (!backingHuman) {
      return reply.code(400).send({ error: "Verification response missing nullifier" });
    }

    // One agent wallet → one row; one human (backingHuman) → MANY agents allowed.
    const backed = await prisma.humanBackedAgent.upsert({
      where: { walletAddress: wallet },
      update: { backingHuman, verificationLevel: result.verificationLevel, source: "standin" },
      create: {
        walletAddress: wallet,
        backingHuman,
        verificationLevel: result.verificationLevel,
        source: "standin",
      },
    });

    // Re-score affected agents, capturing before/after for the demo.
    const ids = await affectedAgentIds(wallet);
    const agents = [];
    for (const agentId of ids) {
      const prev = await prisma.trustScore.findUnique({ where: { agentId } });
      const before = prev?.trustScore ?? 0;
      const beforeRisk = prev?.riskLevel ?? "high";
      const res = await computeTrustScoreForAgent(agentId);
      agents.push({
        agentId: agentId.toString(),
        before,
        after: res ? res.trustScore : before,
        beforeRisk,
        afterRisk: res ? res.riskLevel : beforeRisk,
        // true when this is the agent's OWN wallet (scored-agent +10) vs an
        // agent it merely rated (rater-side reweight).
        isSelf: res ? res.humanBacked : false,
      });
    }

    return {
      verified: true,
      walletAddress: backed.walletAddress,
      backingHuman: backed.backingHuman,
      verificationLevel: backed.verificationLevel,
      action: AGENT_ACTION,
      agentsRescored: agents.length,
      agents,
    };
  });

  // POST /agentkit/check — the REAL AgentKit determination. Resolve the agent
  // wallet against World's on-chain AgentBook via the official SDK. If it maps to
  // a backing human, the agent is genuinely human-backed — AgentBook itself is
  // the proof, so no World ID / signature step is needed here. Records the row
  // with source="agentbook" and re-scores affected agents.
  fastify.post("/agentkit/check", async (req, reply) => {
    const { walletAddress } = req.body || {};
    if (!walletAddress || !ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    const wallet = walletAddress.toLowerCase();

    const backingHuman = await lookupBackingHuman(wallet);
    if (!backingHuman) {
      // Not in AgentBook (or not yet registered as human-backed).
      return {
        walletAddress: wallet,
        humanBacked: false,
        source: "agentbook",
        message:
          "Not human-backed in AgentBook. Register the agent via World's AgentKit delegation flow, or use the demo stand-in.",
      };
    }

    const backed = await prisma.humanBackedAgent.upsert({
      where: { walletAddress: wallet },
      update: { backingHuman, source: "agentbook", verificationLevel: "agentbook" },
      create: { walletAddress: wallet, backingHuman, source: "agentbook", verificationLevel: "agentbook" },
    });

    const ids = await affectedAgentIds(wallet);
    const agents = [];
    for (const agentId of ids) {
      const prev = await prisma.trustScore.findUnique({ where: { agentId } });
      const before = prev?.trustScore ?? 0;
      const res = await computeTrustScoreForAgent(agentId);
      agents.push({
        agentId: agentId.toString(),
        before,
        after: res ? res.trustScore : before,
        afterRisk: res ? res.riskLevel : prev?.riskLevel ?? "high",
        isSelf: res ? res.humanBacked : false,
      });
    }

    return {
      walletAddress: backed.walletAddress,
      humanBacked: true,
      source: "agentbook",
      backingHuman: backed.backingHuman,
      agentsRescored: agents.length,
      agents,
    };
  });

  // GET /agentkit/:walletAddress — human-backed status for an agent wallet.
  fastify.get("/agentkit/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;
    if (!ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    const wallet = walletAddress.toLowerCase();
    const backed = await prisma.humanBackedAgent.findUnique({
      where: { walletAddress: wallet },
    });
    let fleetSize = 0;
    if (backed) {
      fleetSize = await prisma.humanBackedAgent.count({
        where: { backingHuman: backed.backingHuman },
      });
    }
    return {
      walletAddress: wallet,
      humanBacked: !!backed,
      source: backed?.source ?? null,
      backingHuman: backed?.backingHuman ?? null,
      verificationLevel: backed?.verificationLevel ?? null,
      verifiedAt: backed?.verifiedAt ?? null,
      // How many agents this same human backs (their fleet).
      fleetSize,
    };
  });
}

module.exports = agentkitRoutes;
