const crypto = require("crypto");
const { verifyMessage } = require("ethers");
const { prisma } = require("../db/prisma");
const { verifyWorldIdProof, OWNER_ACTION } = require("../worldid/verifyProof");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");
const { signRequest } = require("@worldcoin/idkit-server");

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// Short-lived ownership challenges: wallet (lowercase) -> { message, exp }.
// The owner must sign the exact message with the wallet's key, proving CONTROL
// of the address — World ID proves they are a unique human, the signature
// proves the wallet (and therefore its agents) is actually theirs. In-memory is
// fine: a challenge is single-use and expires in minutes.
const challenges = new Map();
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function buildChallenge(wallet) {
  const nonce = "0x" + crypto.randomBytes(16).toString("hex");
  const issued = new Date().toISOString();
  const message =
    "AgentRank ownership verification\n\n" +
    "I am proving control of this wallet to verify the agents I own on AgentRank.\n\n" +
    `Wallet: ${wallet}\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${issued}`;
  challenges.set(wallet, { message, exp: Date.now() + CHALLENGE_TTL_MS });
  return message;
}

// Agents whose on-chain ownerAddress matches `wallet` (stored lowercased during
// identity ingestion — see decode/identityDecoder.js#topicToAddress).
async function ownedAgents(wallet) {
  return prisma.agent.findMany({
    where: { ownerAddress: wallet },
    include: { trustScore: true },
    orderBy: { registeredAt: "desc" },
  });
}

async function ownersRoutes(fastify) {
  // GET /owners/rp-context — RP-signed request context for IDKit, bound to the
  // OWNER action (distinct from the rater action so a person can verify both a
  // rater wallet and an owner wallet). The RP signing key never leaves the
  // server.
  fastify.get("/owners/rp-context", async (req, reply) => {
    const rpId = process.env.WORLD_ID_RP_ID;
    const signingKey = process.env.WORLD_ID_RP_SIGNING_KEY;
    if (!rpId || !signingKey) {
      return reply.code(500).send({
        error:
          "World ID RP not configured (WORLD_ID_RP_ID / WORLD_ID_RP_SIGNING_KEY)",
      });
    }
    const { sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: signingKey,
      action: OWNER_ACTION,
    });
    return {
      rp_id: rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    };
  });

  // GET /owners/challenge/:walletAddress — issue a one-time message for the
  // owner to sign, proving they control the wallet (proof of ownership). Pair
  // this with the World ID proof (proof of personhood) in /owners/verify.
  fastify.get("/owners/challenge/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;
    if (!ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    const message = buildChallenge(walletAddress.toLowerCase());
    return { message };
  });

  // POST /owners/verify — bind an agent-owner wallet to a unique human, gated by
  // TWO proofs. Body: { walletAddress, proof, signature }.
  //   1. signature  — the wallet's personal_sign over the issued challenge,
  //                    proving CONTROL of the address (the agents are really
  //                    theirs). Without this, anyone could claim any wallet.
  //   2. proof      — the World ID proof, bound to the wallet as its signal,
  //                    proving the owner is a unique human (no Sybil fleets).
  // The nullifier is unique per (human, OWNER_ACTION): the same human verifying
  // a second owner wallet is rejected. On success every agent the wallet owns
  // on-chain is re-scored; we return each before/after so the UI shows the lift.
  fastify.post("/owners/verify", async (req, reply) => {
    const { walletAddress, proof, signature } = req.body || {};

    if (!walletAddress || !ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    if (!proof || typeof proof !== "object") {
      return reply.code(400).send({ error: "Missing World ID proof payload" });
    }
    if (!signature || typeof signature !== "string") {
      return reply
        .code(400)
        .send({ error: "Missing wallet signature (proof of ownership)" });
    }

    const wallet = walletAddress.toLowerCase();

    // --- Proof of ownership: verify the signature over the issued challenge ---
    const challenge = challenges.get(wallet);
    if (!challenge || challenge.exp < Date.now()) {
      challenges.delete(wallet);
      return reply.code(400).send({
        error: "No valid ownership challenge — request a fresh one and re-sign.",
        code: "challenge_expired",
      });
    }
    let recovered;
    try {
      recovered = verifyMessage(challenge.message, signature);
    } catch {
      return reply
        .code(401)
        .send({ error: "Malformed signature", code: "bad_signature" });
    }
    if (recovered.toLowerCase() !== wallet) {
      return reply.code(401).send({
        error:
          "Signature does not prove control of this wallet — you can only verify an address you own.",
        code: "ownership_mismatch",
      });
    }
    // Single-use: consume the challenge so the signature can't be replayed.
    challenges.delete(wallet);

    // --- Proof of personhood: verify the World ID proof, bound to the wallet ---
    let result;
    try {
      result = await verifyWorldIdProof(proof, wallet, OWNER_ACTION);
    } catch (err) {
      return reply.code(400).send({ error: err.message, code: err.code });
    }

    const nullifierHash = result.nullifierHash;
    if (!nullifierHash) {
      return reply
        .code(400)
        .send({ error: "Verification response missing nullifier" });
    }

    // One human (nullifier) ↔ one owner wallet. Re-verifying the same pair is a
    // no-op; binding a second wallet to the same human is rejected.
    const existing = await prisma.verifiedOwner.findUnique({
      where: { nullifierHash },
    });
    if (existing && existing.walletAddress !== wallet) {
      return reply.code(409).send({
        error:
          "This World ID has already verified a different owner wallet. One human, one owner wallet.",
        boundWallet: existing.walletAddress,
      });
    }

    const owner = await prisma.verifiedOwner.upsert({
      where: { walletAddress: wallet },
      update: { nullifierHash, verificationLevel: result.verificationLevel },
      create: {
        walletAddress: wallet,
        nullifierHash,
        verificationLevel: result.verificationLevel,
      },
    });

    // Re-score every agent this human now provably operates, capturing the
    // before/after so the demo can show the trust lift the verification caused.
    const owned = await ownedAgents(wallet);
    const agents = [];
    for (const a of owned) {
      const before = a.trustScore?.trustScore ?? 0;
      const beforeRisk = a.trustScore?.riskLevel ?? "high";
      const res = await computeTrustScoreForAgent(a.agentId);
      agents.push({
        agentId: a.agentId.toString(),
        name: a.name,
        before,
        after: res ? res.trustScore : before,
        beforeRisk,
        afterRisk: res ? res.riskLevel : beforeRisk,
      });
    }

    return {
      verified: true,
      walletAddress: owner.walletAddress,
      nullifierHash: owner.nullifierHash,
      verificationLevel: owner.verificationLevel,
      action: OWNER_ACTION,
      agentsRescored: agents.length,
      agents,
    };
  });

  // GET /owners/:walletAddress — owner personhood status + the agents it owns.
  fastify.get("/owners/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;
    if (!ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    const wallet = walletAddress.toLowerCase();
    const owner = await prisma.verifiedOwner.findUnique({
      where: { walletAddress: wallet },
    });
    const owned = await ownedAgents(wallet);
    return {
      walletAddress: wallet,
      verifiedHuman: !!owner,
      verifiedAt: owner?.verifiedAt ?? null,
      verificationLevel: owner?.verificationLevel ?? null,
      ownedAgentCount: owned.length,
      agents: owned.map((a) => ({
        agentId: a.agentId.toString(),
        name: a.name,
        trustScore: a.trustScore?.trustScore ?? 0,
        riskLevel: a.trustScore?.riskLevel ?? "high",
      })),
    };
  });

  // GET /owners — all verified owners (demo/leaderboard support)
  fastify.get("/owners", async () => {
    const owners = await prisma.verifiedOwner.findMany({
      orderBy: { verifiedAt: "desc" },
    });
    return {
      total: owners.length,
      owners: owners.map((o) => ({
        walletAddress: o.walletAddress,
        verificationLevel: o.verificationLevel,
        verifiedAt: o.verifiedAt,
      })),
    };
  });
}

module.exports = ownersRoutes;
