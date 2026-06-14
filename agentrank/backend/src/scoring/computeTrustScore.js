const { prisma } = require("../db/prisma");
const { MAX_ENS_SCORE } = require("../ens/enrichAgentEns");
const { buildClusterVoices } = require("./raterClustering");

// With zero verified-human raters an agent's reputation can never exceed this
// floor, no matter how many wallets praise it. Wallets are free; humans are not.
const UNVERIFIED_REP_CAP = 8;

// Owner personhood signal (World ID, OWNER_ACTION). When the agent's on-chain
// owner has proven unique humanity on AgentRank, the agent is operated by a
// known, accountable, non-Sybil human rather than an anonymous deployer. This
// is a distinct, weaker fallback signal than AgentKit backing because it proves
// the registrant/operator wallet, not the running agent wallet.
const MAX_OWNER_SCORE = 5;

// AgentKit human-backing (Delegated World ID / AgentBook). The agent wallet
// itself is backed by a unique human, so it earns the full human-accountability
// component. Owner World ID does not stack on top of this; AgentKit subsumes it.
const MAX_AGENTKIT_SCORE = 15;

// Score a set of cluster-collapsed feedback "voices" (each = one controlling
// entity, carrying a 0..1 Sybil-adjusted weight). The naive before/after view
// passes one full-weight voice per event with no clustering. Max 30.
function scoreVoices(voices) {
  if (!voices.length) {
    return {
      score: 0,
      avg: null,
      weightedCount: 0,
      recentWeight: 0,
      ratedCount: 0,
      directHumanVoices: 0,
      humanBackedVoices: 0,
      accountableWeight: 0,
      components: {
        quality: 0,
        accountableRaters: 0,
        independentSources: 0,
        recency: 0,
        integrity: 0,
      },
    };
  }

  const weightedCount = voices.reduce((acc, v) => acc + v.weight, 0);
  const directHumanVoices = voices.filter((v) => v.verified).length;
  const humanBackedVoices = voices.filter((v) => v.humanBacked).length;
  // Direct human rating = 1.0 accountable voice. AgentKit-backed rating = 0.6:
  // accountable to a human, but less deliberate than a person rating directly.
  const accountableWeight = directHumanVoices + humanBackedVoices * 0.6;

  const rated = voices.filter(
    (v) => typeof v.value === "number" && !isNaN(v.value)
  );
  let avg = null;
  let qualityScore = 0;
  if (rated.length > 0) {
    const totalW = rated.reduce((acc, v) => acc + v.weight, 0) || 1;
    avg = rated.reduce((acc, v) => acc + v.value * v.weight, 0) / totalW;
    if (avg >= 80) qualityScore = 10;
    else if (avg >= 70) qualityScore = 8;
    else if (avg >= 50) qualityScore = 5;
    else if (avg >= 30) qualityScore = 2;
  }

  let accountableScore = 0;
  if (accountableWeight >= 2) accountableScore = 10;
  else if (accountableWeight >= 1) accountableScore = 6;
  else if (accountableWeight > 0) accountableScore = 3;

  let sourceScore = 0;
  if (voices.length >= 3 && weightedCount >= 1.5) sourceScore = 5;
  else if (voices.length >= 2 || weightedCount >= 1) sourceScore = 3;
  else sourceScore = 1;

  const recentWeight = voices
    .filter((v) => v.recent)
    .reduce((acc, v) => acc + v.weight, 0);
  let recencyScore = 0;
  if (recentWeight >= 1) recencyScore = 3;
  else if (recentWeight > 0) recencyScore = 1;

  // Revoked events are excluded upstream; this is the clean-record credit.
  const integrityScore = 2;

  const score =
    qualityScore + accountableScore + sourceScore + recencyScore + integrityScore;

  return {
    score,
    avg,
    weightedCount,
    recentWeight,
    ratedCount: rated.length,
    directHumanVoices,
    humanBackedVoices,
    accountableWeight,
    components: {
      quality: qualityScore,
      accountableRaters: accountableScore,
      independentSources: sourceScore,
      recency: recencyScore,
      integrity: integrityScore,
    },
  };
}

// One full-weight voice per event, no clustering — the naive "every wallet is a
// distinct trusted rater" baseline kept for the Sybil-exposure before/after.
function naiveVoices(feedback) {
  const now = Date.now();
  const recentMs = 30 * 24 * 60 * 60 * 1000;
  return feedback.map((f) => ({
    weight: 1,
    verified: true,
    humanBacked: false,
    value:
      typeof f.valueNormalized === "number" && !isNaN(f.valueNormalized)
        ? f.valueNormalized
        : null,
    recent:
      !!f.blockTimestamp && now - new Date(f.blockTimestamp).getTime() <= recentMs,
  }));
}

// Build the clustering context for an agent's feedback: who is verified, each
// rater's cached BigQuery profile, and each rater's controlling owner.
async function buildClusterContext(feedback) {
  const raterWallets = [
    ...new Set(
      feedback
        .map((f) => f.clientAddress && f.clientAddress.toLowerCase())
        .filter(Boolean)
    ),
  ];

  if (raterWallets.length === 0) {
    return {
      verifiedSet: new Set(),
      profileByWallet: new Map(),
      ownerByWallet: new Map(),
      humanBackedByWallet: new Map(),
    };
  }

  const [verified, profiles, ownerAgents, humanBacked] = await Promise.all([
    prisma.verifiedRater.findMany({
      where: { walletAddress: { in: raterWallets } },
      select: { walletAddress: true },
    }),
    prisma.raterProfile.findMany({
      where: { walletAddress: { in: raterWallets } },
    }),
    // Map a rater wallet to a controlling owner when the rater is itself a
    // registered owner, or is the wallet of a registered agent.
    prisma.agent.findMany({
      where: {
        OR: [
          { ownerAddress: { in: raterWallets } },
          { agentWallet: { in: raterWallets } },
        ],
      },
      select: { ownerAddress: true, agentWallet: true },
    }),
    // AgentKit human-backed raters: each maps to its backing human (the cluster
    // key that collapses one person's fleet of agents into a single voice).
    prisma.humanBackedAgent.findMany({
      where: { walletAddress: { in: raterWallets } },
      select: { walletAddress: true, backingHuman: true },
    }),
  ]);

  const verifiedSet = new Set(verified.map((r) => r.walletAddress.toLowerCase()));
  const profileByWallet = new Map(
    profiles.map((p) => [p.walletAddress.toLowerCase(), p])
  );
  const humanBackedByWallet = new Map(
    humanBacked.map((h) => [h.walletAddress.toLowerCase(), h.backingHuman])
  );
  const ownerByWallet = new Map();
  const raterSet = new Set(raterWallets);
  for (const a of ownerAgents) {
    const owner = a.ownerAddress ? a.ownerAddress.toLowerCase() : null;
    if (!owner) continue;
    if (raterSet.has(owner)) ownerByWallet.set(owner, owner);
    const aw = a.agentWallet ? a.agentWallet.toLowerCase() : null;
    if (aw && raterSet.has(aw)) ownerByWallet.set(aw, owner);
  }

  return { verifiedSet, profileByWallet, ownerByWallet, humanBackedByWallet };
}

async function computeTrustScoreForAgent(agentId) {
  const agent = await prisma.agent.findUnique({
    where: { agentId },
    include: { feedbackEvents: { where: { isRevoked: false } }, ensRecord: true, ensPassport: true },
  });

  if (!agent) return null;

  const reasons = [];
  let identityScore = 0;
  let reputationScore = 0;
  // Payment (x402) is tracked as a separate "transactability" signal, NOT a
  // trust input. Being payable says an agent is live and able to receive money;
  // it says nothing about whether it is honest. We keep paymentScore for the
  // payable-axis display but it does NOT count toward the trust score.
  let paymentScore = 0;

  // --- Registry profile (max 35) ---
  identityScore += 10;
  reasons.push("Registered in ERC-8004 Identity Registry");

  if (agent.agentUri) {
    identityScore += 5;
    reasons.push("Has an agentURI");
  }

  if (agent.rawMetadataJson) {
    identityScore += 8;
    reasons.push("Metadata file fetched successfully");
  }

  if (agent.active === true) {
    identityScore += 7;
    reasons.push("Metadata marks agent as active");
  }

  let services = [];
  try {
    services = agent.servicesJson ? JSON.parse(agent.servicesJson) : [];
  } catch {}

  if (services.length > 0) {
    identityScore += 3;
    reasons.push(`Exposes ${services.length} service endpoint(s)`);
  }

  let supportedTrust = [];
  try {
    supportedTrust = agent.supportedTrustJson
      ? JSON.parse(agent.supportedTrustJson)
      : [];
  } catch {}

  if (supportedTrust.includes("reputation")) {
    identityScore += 2;
    reasons.push("Declares reputation trust support");
  }

  // --- Reputation (max 30: Sybil-clustered + BigQuery-weighted) ---
  // Feedback is collapsed into one voice per controlling entity (ERC-8004 owner
  // / shared funder / wallet), then each voice is weighted by BigQuery sybil
  // signals (fan-out, wallet age, activity). World ID-verified raters carry full
  // weight. This kills vote-stuffing (many wallets, one owner), repeat-spam (one
  // wallet, many events), and bot raters in one pass.
  const feedback = agent.feedbackEvents || [];

  const ctx = await buildClusterContext(feedback);
  const { verifiedSet, humanBackedByWallet } = ctx;

  const verifiedFeedbackCount = feedback.filter(
    (f) => f.clientAddress && verifiedSet.has(f.clientAddress.toLowerCase())
  ).length;
  const verifiedHumanCount = verifiedSet.size;
  // Distinct backing humans behind human-backed-agent (AgentKit) raters.
  const humanBackedRaterCount = new Set(
    feedback
      .map((f) => f.clientAddress && f.clientAddress.toLowerCase())
      .filter((w) => w && humanBackedByWallet.has(w))
      .map((w) => humanBackedByWallet.get(w))
  ).size;

  const { voices, totalEvents, clusterCount } = buildClusterVoices(feedback, ctx);
  const weighted = scoreVoices(voices);
  const naiveReputationScore = scoreVoices(naiveVoices(feedback)).score;

  reputationScore = weighted.score;

  if (totalEvents > 0) {
    if (clusterCount < totalEvents) {
      reasons.push(
        `${totalEvents} feedback event(s) collapsed to ${clusterCount} independent source(s) (Sybil clustering)`
      );
    } else {
      reasons.push(`${clusterCount} independent feedback source(s)`);
    }
    if (weighted.avg !== null) {
      if (weighted.avg >= 70)
        reasons.push(`Positive weighted feedback (${weighted.avg.toFixed(1)})`);
      else if (weighted.avg >= 40)
        reasons.push(`Mixed weighted feedback (${weighted.avg.toFixed(1)})`);
      else reasons.push(`Low weighted feedback (${weighted.avg.toFixed(1)})`);
    }
    if (weighted.weightedCount >= 3)
      reasons.push("Multiple independent weighted sources");
    if (weighted.recentWeight >= 1)
      reasons.push("Has recent feedback (last 30 days)");
  }

  if (totalEvents > 0) {
    // Escape the Sybil floor only with an accountable-human voice behind the
    // feedback — a directly-verified human OR an AgentKit human-backed agent.
    // Wallets are free; humans are not.
    if (verifiedHumanCount === 0 && humanBackedRaterCount === 0) {
      reputationScore = Math.min(reputationScore, UNVERIFIED_REP_CAP);
      reasons.push(
        `No World ID-verified or human-backed raters — reputation capped at ${UNVERIFIED_REP_CAP}/30 (Sybil risk)`
      );
    } else {
      if (verifiedHumanCount > 0) {
        reasons.push(
          `${verifiedFeedbackCount} of ${totalEvents} feedback event(s) from ${verifiedHumanCount} World ID-verified human(s)`
        );
      }
      if (humanBackedRaterCount > 0) {
        reasons.push(
          `Feedback from ${humanBackedRaterCount} AgentKit human-backed agent(s) (weighted 0.6)`
        );
      }
    }
  }

  // --- Payment / transactability (separate axis, NOT added to trust) ---
  // Recorded so the UI can show a "payable" signal next to the trust score.
  if (agent.x402Support === true) {
    paymentScore = 15;
  }

  // --- ENS identity (max 20) ---
  let ensScore = 0;
  if (agent.ensRecord) {
    ensScore = agent.ensRecord.ensScore || 0;
    const ensReasons = [];
    try {
      const parsed = JSON.parse(agent.ensRecord.reasonsJson || "[]");
      for (const r of parsed) {
        if (!r.startsWith("No ENS name") && !r.startsWith("ENS lookup error")) {
          ensReasons.push(r);
        }
      }
    } catch {}
    reasons.push(...ensReasons);
  }

  // ENS Passport status can raise (never lower) the ENS bonus.
  if (agent.ensPassport) {
    if (agent.ensPassport.status === "verified") {
      ensScore = MAX_ENS_SCORE;
      reasons.push(`ENS Passport ${agent.ensPassport.ensName} verified against ERC-8004 registry`);
    } else if (agent.ensPassport.status === "published" && ensScore < 10) {
      ensScore = 10;
      reasons.push(`ENS Passport ${agent.ensPassport.ensName} published with readable records`);
    }
  }
  ensScore = Math.min(MAX_ENS_SCORE, ensScore);

  // --- Owner personhood (max 5, World ID fallback) ---
  // The agent's on-chain owner proved unique humanity via World ID. This is
  // partial accountability unless the agent wallet itself is human-backed.
  let ownerScore = 0;
  let ownerVerified = false;
  if (agent.ownerAddress) {
    const verifiedOwner = await prisma.verifiedOwner.findUnique({
      where: { walletAddress: agent.ownerAddress.toLowerCase() },
    });
    if (verifiedOwner) {
      ownerVerified = true;
      ownerScore = MAX_OWNER_SCORE;
      reasons.push("Owner verified as a unique human via World ID");
    }
  }

  // --- AgentKit human-backing (max 15, Delegated World ID / AgentBook) ---
  // The agent's own wallet is a verified human-backed agent: a unique human
  // stands behind it at runtime. This is full human accountability and
  // supersedes the weaker owner-wallet fallback.
  let agentKitScore = 0;
  let humanBacked = false;
  if (agent.agentWallet) {
    const backed = await prisma.humanBackedAgent.findUnique({
      where: { walletAddress: agent.agentWallet.toLowerCase() },
    });
    if (backed) {
      humanBacked = true;
      agentKitScore = MAX_AGENTKIT_SCORE;
      reasons.push(
        backed.source === "agentbook"
          ? "Human-backed agent verified on World's AgentBook (AgentKit)"
          : "Human-backed agent (AgentKit — delegated World ID stand-in)"
      );
    }
  }

  if (humanBacked && ownerScore > 0) {
    ownerScore = 0;
    reasons.push("Owner World ID is verified, but AgentKit human-backing already grants full human accountability");
  }

  // Trust = registry profile (35) + reputation (30) + ENS identity (20) +
  // human accountability (15: AgentKit-backed agent wallet, or 5 fallback for
  // owner World ID when the agent wallet itself is not human-backed).
  // Payment is deliberately excluded.
  const trustScore = Math.min(
    100,
    identityScore + reputationScore + ensScore + ownerScore + agentKitScore
  );

  // Thresholds reflect the realistic achievable range now that trust =
  // registry profile (35) + reputation (30) + ENS (20) + human accountability
  // (15), with on-chain reputation still
  // near-empty in this young economy. "low" requires verifiable signal beyond a
  // self-described identity (ENS proof and/or real feedback push an agent past
  // 50); a complete-but-unproven identity lands in "medium" (review first); a
  // bare registration is "high".
  let riskLevel = "high";
  if (trustScore >= 50) riskLevel = "low";
  else if (trustScore >= 30) riskLevel = "medium";

  await prisma.trustScore.upsert({
    where: { agentId },
    update: {
      trustScore,
      identityScore,
      reputationScore,
      paymentScore,
      ensScore,
      ownerScore,
      ownerVerified,
      agentKitScore,
      humanBacked,
      riskLevel,
      naiveReputationScore,
      verifiedFeedbackCount,
      verifiedHumanCount,
      reasonsJson: JSON.stringify(reasons),
      computedAt: new Date(),
    },
    create: {
      agentId,
      trustScore,
      identityScore,
      reputationScore,
      paymentScore,
      ensScore,
      ownerScore,
      ownerVerified,
      agentKitScore,
      humanBacked,
      riskLevel,
      naiveReputationScore,
      verifiedFeedbackCount,
      verifiedHumanCount,
      reasonsJson: JSON.stringify(reasons),
    },
  });

  return {
    agentId,
    trustScore,
    identityScore,
    reputationScore,
    naiveReputationScore,
    verifiedFeedbackCount,
    verifiedHumanCount,
    humanBackedRaterCount,
    paymentScore,
    ensScore,
    ownerScore,
    ownerVerified,
    agentKitScore,
    humanBacked,
    riskLevel,
    reasons,
  };
}

async function recomputeAllScores() {
  const agents = await prisma.agent.findMany({ select: { agentId: true } });
  let count = 0;
  for (const { agentId } of agents) {
    await computeTrustScoreForAgent(agentId);
    count++;
  }
  return { recomputed: count };
}

module.exports = {
  computeTrustScoreForAgent,
  recomputeAllScores,
  buildClusterContext,
  scoreVoices,
};
