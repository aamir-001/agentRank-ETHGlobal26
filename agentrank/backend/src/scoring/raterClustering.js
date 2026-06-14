// Sybil-resistant rater clustering and weighting.
//
// Two ideas, one mechanism:
//   1. CLUSTER  — collapse all feedback from one controlling entity into a
//      single voice per rated agent. Kills both vote-stuffing (many wallets,
//      one owner -> one voice) and repeat-spam (one wallet, many events ->
//      one voice). Cluster key: ERC-8004 owner > funding source > self.
//   2. WEIGHT   — down-weight a voice by BigQuery sybil signals: fan-out/spray,
//      fresh wallet, thin activity, low counterparty diversity. World ID
//      verified bypasses all of it (full weight) — you can fake transactions,
//      not unique humanity.
//
// Pure functions only (no DB / BigQuery) so they are deterministic and reusable
// by both the profile snapshot and live trust scoring.

const UNVERIFIED_BASE = 0.2; // base weight for an unverified-but-clean rater
// A human-backed agent (AgentKit / Delegated World ID) sits between a direct
// verified human (1.0) and an anonymous wallet (0.2). A unique human is
// accountable for it and it's Sybil-resistant — but the rating is the agent's
// autonomous, machine-generated judgement, not a person's deliberate one. So we
// discount for *deliberateness*, not for Sybil risk. Like verified humans, it
// bypasses the BigQuery decay (you can fake transactions, not human backing).
const HUMAN_BACKED_WEIGHT = 0.6;
const WEIGHT_FLOOR = 0.02; // a flagged rater is near-silent, never fully zero

// Rating up to this many distinct agents looks human; beyond it, weight decays
// inversely with fan-out (an indiscriminate review bot).
const SPRAY_FREE = 8;
// Wallet first seen / funded within this many days of its first rating = fresh.
const FRESH_DAYS = 7;
// A wallet with fewer lifetime outbound txs than this has no real economic life.
const MIN_TXS = 5;
// Distinct counterparties below this = self-referential / single-purpose wallet.
const MIN_COUNTERPARTIES = 3;
// If this share of a wallet's outbound txs are feedback calls, it exists to rate.
const RATE_ONLY_RATIO = 0.8;

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 30 * DAY_MS;

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
}

/**
 * Compute an unverified rater's sybil-adjusted weight from its BigQuery profile.
 * Verified humans short-circuit to full weight. Missing signals (no BigQuery
 * row yet) simply don't penalize, so scoring degrades gracefully to the base
 * weight with owner-only clustering.
 *
 * @param {object|null} profile raw RaterProfile fields
 * @param {boolean} verified World ID-verified rater wallet
 * @param {boolean} humanBacked AgentKit human-backed agent rater
 * @returns {{weight:number, flags:string[]}}
 */
function computeRaterWeight(profile, verified, humanBacked = false) {
  // A direct verified human outranks a human-backed agent outranks a wallet.
  if (verified) return { weight: 1, flags: [] };
  if (humanBacked) return { weight: HUMAN_BACKED_WEIGHT, flags: [] };

  let weight = UNVERIFIED_BASE;
  const flags = [];
  const p = profile || {};

  // Fan-out / spray — the judge's "are they rating a lot of people?"
  if (typeof p.agentsRated === "number" && p.agentsRated > SPRAY_FREE) {
    weight *= SPRAY_FREE / p.agentsRated;
    flags.push(`Sprays feedback across ${p.agentsRated} agents`);
  }

  // Fresh wallet — born or funded right before it started rating.
  const gapDays = Math.min(
    ...[
      daysBetween(p.firstSeen, p.firstRatingAt),
      daysBetween(p.firstFundedAt, p.firstRatingAt),
    ].filter((d) => d !== null),
    Infinity
  );
  if (gapDays !== Infinity && gapDays < FRESH_DAYS) {
    weight *= 0.3;
    flags.push(`Wallet active only ${gapDays.toFixed(1)}d before rating`);
  }

  // Thin lifetime activity.
  if (typeof p.lifetimeTxsSent === "number" && p.lifetimeTxsSent < MIN_TXS) {
    weight *= 0.5;
    flags.push(`Only ${p.lifetimeTxsSent} lifetime transactions`);
  }

  // Exists mainly to rate: outbound txs are almost all feedback calls.
  if (
    typeof p.lifetimeTxsSent === "number" &&
    p.lifetimeTxsSent > 0 &&
    typeof p.totalFeedbacks === "number" &&
    p.totalFeedbacks / p.lifetimeTxsSent >= RATE_ONLY_RATIO
  ) {
    weight *= 0.5;
    flags.push("Outbound activity is almost entirely feedback");
  }

  // Low counterparty diversity — self-referential / manufactured activity.
  if (
    typeof p.distinctCounterparties === "number" &&
    p.distinctCounterparties < MIN_COUNTERPARTIES
  ) {
    weight *= 0.6;
    flags.push(`Only ${p.distinctCounterparties} distinct counterparties`);
  }

  weight = Math.max(WEIGHT_FLOOR, Math.min(1, weight));
  return { weight, flags };
}

/**
 * Resolve the controlling entity (cluster key) for a rater wallet.
 * Priority: backing human (AgentKit — collapses a fleet of one person's agents)
 * > ERC-8004 owner (reliable) > funding source (heuristic, never used to merge a
 * verified human) > the wallet itself. A directly-verified human keeps its own
 * voice and is never merged into a fleet cluster.
 */
function resolveClusterKey(wallet, profile, ownerByWallet, verified, humanBackedByWallet) {
  if (!wallet) return `self:unknown`;
  const backing = humanBackedByWallet && humanBackedByWallet.get(wallet);
  if (!verified && backing) return `human:${backing}`;
  const owner = ownerByWallet.get(wallet);
  if (owner) return `owner:${owner}`;
  if (!verified && profile && profile.funder) return `fund:${profile.funder}`;
  return `self:${wallet}`;
}

/**
 * Collapse an agent's feedback events into one voice per controlling entity.
 *
 * @param {Array} feedback FeedbackEvent rows (non-revoked) for one agent
 * @param {object} ctx
 * @param {Set<string>} ctx.verifiedSet lowercase verified rater wallets
 * @param {Map<string,object>} ctx.profileByWallet lowercase -> RaterProfile
 * @param {Map<string,string>} ctx.ownerByWallet lowercase rater -> owner address
 * @param {Map<string,string>} ctx.humanBackedByWallet lowercase rater -> backing human
 * @returns {{voices:Array, totalEvents:number, clusterCount:number}}
 */
function buildClusterVoices(feedback, ctx) {
  const { verifiedSet, profileByWallet, ownerByWallet } = ctx;
  const humanBackedByWallet = ctx.humanBackedByWallet || new Map();
  const now = Date.now();
  const clusters = new Map();

  feedback.forEach((f, i) => {
    const wallet = f.clientAddress ? f.clientAddress.toLowerCase() : null;
    const verified = !!(wallet && verifiedSet.has(wallet));
    const humanBacked = !!(wallet && humanBackedByWallet.has(wallet));
    const profile = wallet ? profileByWallet.get(wallet) || null : null;
    const { weight } = computeRaterWeight(profile, verified, humanBacked);
    // Feedback with no rater address can't be clustered or trusted — its own
    // singleton cluster keeps it from merging with anything.
    const key = wallet
      ? resolveClusterKey(wallet, profile, ownerByWallet, verified, humanBackedByWallet)
      : `self:null:${i}`;

    if (!clusters.has(key)) {
      clusters.set(key, {
        key,
        members: [],
        wallets: new Set(),
        maxWeight: 0,
        verified: false,
        humanBacked: false,
        recent: false,
        values: [],
      });
    }
    const c = clusters.get(key);
    c.members.push(f);
    if (wallet) c.wallets.add(wallet);
    c.maxWeight = Math.max(c.maxWeight, weight);
    if (verified) c.verified = true;
    if (humanBacked) c.humanBacked = true;
    if (typeof f.valueNormalized === "number" && !isNaN(f.valueNormalized)) {
      c.values.push(f.valueNormalized);
    }
    if (f.blockTimestamp && now - new Date(f.blockTimestamp).getTime() <= RECENT_WINDOW_MS) {
      c.recent = true;
    }
  });

  const voices = [...clusters.values()].map((c) => ({
    key: c.key,
    // One entity = one voice, carried at its most-credible member's weight.
    weight: Math.min(1, c.maxWeight),
    value: c.values.length
      ? c.values.reduce((a, b) => a + b, 0) / c.values.length
      : null,
    recent: c.recent,
    verified: c.verified,
    humanBacked: c.humanBacked,
    walletCount: c.wallets.size,
    eventCount: c.members.length,
  }));

  return { voices, totalEvents: feedback.length, clusterCount: voices.length };
}

module.exports = {
  computeRaterWeight,
  resolveClusterKey,
  buildClusterVoices,
  UNVERIFIED_BASE,
  HUMAN_BACKED_WEIGHT,
};
