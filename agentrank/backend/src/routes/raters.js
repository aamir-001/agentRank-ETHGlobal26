const crypto = require("crypto");
const { verifyMessage } = require("ethers");
const { prisma } = require("../db/prisma");
const { verifyWorldIdProof, ACTION } = require("../worldid/verifyProof");
const {
  computeTrustScoreForAgent,
  recomputeAllScores,
} = require("../scoring/computeTrustScore");
const { refreshRaterProfiles, allRaterWallets } = require("../raters/raterProfile");
const { safeJson } = require("../lib/safeJson");
const { signRequest } = require("@worldcoin/idkit-server");

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// Short-lived control challenges (proves the rater controls the wallet, so they
// can't bind someone else's feedback to their World ID). wallet -> { message, exp }.
const challenges = new Map();
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function buildChallenge(wallet) {
  const nonce = "0x" + crypto.randomBytes(16).toString("hex");
  const issued = new Date().toISOString();
  const message =
    "AgentRank rater verification\n\n" +
    "I control this wallet and a unique human (World ID) is vouching for its feedback.\n\n" +
    `Wallet: ${wallet}\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${issued}`;
  challenges.set(wallet, { message, exp: Date.now() + CHALLENGE_TTL_MS });
  return message;
}

async function ratersRoutes(fastify) {
  // GET /raters/rp-context — RP-signed request context for IDKit (World ID 4.0).
  // The RP signing key never leaves the server; IDKit needs the resulting
  // signature to open a proof request in World App.
  fastify.get("/raters/rp-context", async (req, reply) => {
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
      action: ACTION,
    });
    return {
      rp_id: rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    };
  });

  // GET /raters/challenge/:walletAddress — message for the rater wallet to sign.
  fastify.get("/raters/challenge/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;
    if (!ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    return { message: buildChallenge(walletAddress.toLowerCase()) };
  });

  // POST /raters/verify — bind a rater wallet to a unique human, gated by:
  //   1. signature — proves control of the wallet (you can't bind feedback you
  //      don't control to your World ID).
  //   2. proof     — World ID proof bound to the wallet as signal. The nullifier
  //      is unique per (human, action): the same human verifying a second wallet
  //      is rejected — the Sybil-resistance guarantee.
  fastify.post("/raters/verify", async (req, reply) => {
    const { walletAddress, proof, signature } = req.body || {};

    if (!walletAddress || !ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    if (!proof || typeof proof !== "object") {
      return reply.code(400).send({ error: "Missing World ID proof payload" });
    }
    if (!signature || typeof signature !== "string") {
      return reply.code(400).send({ error: "Missing wallet signature (proof of control)" });
    }

    const wallet = walletAddress.toLowerCase();

    // --- Proof of control: verify the signature over the issued challenge ---
    const challenge = challenges.get(wallet);
    if (!challenge || challenge.exp < Date.now()) {
      challenges.delete(wallet);
      return reply.code(400).send({
        error: "No valid control challenge — request a fresh one and re-sign.",
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
        error: "Signature does not prove control of this wallet.",
        code: "control_mismatch",
      });
    }
    challenges.delete(wallet);

    let result;
    try {
      result = await verifyWorldIdProof(proof, wallet);
    } catch (err) {
      return reply.code(400).send({ error: err.message, code: err.code });
    }

    const nullifierHash = result.nullifierHash;
    if (!nullifierHash) {
      return reply.code(400).send({ error: "Verification response missing nullifier" });
    }

    // One human (nullifier) ↔ one wallet. Re-verifying the same pair is a
    // no-op; binding a second wallet to the same human is rejected.
    const existing = await prisma.verifiedRater.findUnique({
      where: { nullifierHash },
    });
    if (existing && existing.walletAddress !== wallet) {
      return reply.code(409).send({
        error:
          "This World ID has already vouched for a different wallet. One human, one rater wallet.",
        boundWallet: existing.walletAddress,
      });
    }

    const rater = await prisma.verifiedRater.upsert({
      where: { walletAddress: wallet },
      update: { nullifierHash, verificationLevel: result.verificationLevel },
      create: {
        walletAddress: wallet,
        nullifierHash,
        verificationLevel: result.verificationLevel,
      },
    });

    // This wallet's past on-chain feedback just became human-backed —
    // recompute scores for every agent it rated so the change is live.
    const rated = await prisma.feedbackEvent.findMany({
      where: { clientAddress: wallet, isRevoked: false },
      select: { agentId: true },
      distinct: ["agentId"],
    });
    for (const { agentId } of rated) {
      await computeTrustScoreForAgent(agentId);
    }

    return {
      verified: true,
      walletAddress: rater.walletAddress,
      nullifierHash: rater.nullifierHash,
      verificationLevel: rater.verificationLevel,
      action: ACTION,
      agentsRescored: rated.length,
    };
  });

  // POST /raters/profiles/refresh — recompute BigQuery Sybil profiles for all
  // known rater wallets, then rescore every agent. This is the "fan-out / wallet
  // age / activity" analytics pass over Google BigQuery.
  fastify.post("/raters/profiles/refresh", async () => {
    const wallets = await allRaterWallets();
    const result = await refreshRaterProfiles(wallets);
    const { recomputed } = await recomputeAllScores();
    return {
      ratersConsidered: wallets.length,
      profilesRefreshed: result.refreshed,
      bigQuerySkipped: result.skipped ?? false,
      error: result.error,
      agentsRescored: recomputed,
    };
  });

  // GET /raters/:walletAddress — personhood status + BigQuery Sybil profile
  fastify.get("/raters/:walletAddress", async (req, reply) => {
    const { walletAddress } = req.params;
    if (!ADDR_RE.test(walletAddress)) {
      return reply.code(400).send({ error: "Invalid walletAddress" });
    }
    const wallet = walletAddress.toLowerCase();
    const [rater, profile] = await Promise.all([
      prisma.verifiedRater.findUnique({ where: { walletAddress: wallet } }),
      prisma.raterProfile.findUnique({ where: { walletAddress: wallet } }),
    ]);
    return {
      walletAddress: wallet,
      verifiedHuman: !!rater,
      verifiedAt: rater?.verifiedAt ?? null,
      verificationLevel: rater?.verificationLevel ?? null,
      profile: profile
        ? {
            agentsRated: profile.agentsRated,
            totalFeedbacks: profile.totalFeedbacks,
            firstRatingAt: profile.firstRatingAt,
            firstSeen: profile.firstSeen,
            lifetimeTxsSent: profile.lifetimeTxsSent,
            distinctCounterparties: profile.distinctCounterparties,
            funder: profile.funder,
            firstFundedAt: profile.firstFundedAt,
            raterWeight: profile.raterWeight,
            flags: safeJson(profile.flagsJson, []),
            fetchedAt: profile.fetchedAt,
          }
        : null,
    };
  });

  // GET /raters — all verified raters (demo/leaderboard support)
  fastify.get("/raters", async () => {
    const raters = await prisma.verifiedRater.findMany({
      orderBy: { verifiedAt: "desc" },
    });
    return {
      total: raters.length,
      raters: raters.map((r) => ({
        walletAddress: r.walletAddress,
        verificationLevel: r.verificationLevel,
        verifiedAt: r.verifiedAt,
      })),
    };
  });
}

module.exports = ratersRoutes;
