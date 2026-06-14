// Builds and caches the Sybil-resistance profile for feedback rater wallets,
// derived from Google BigQuery over Ethereum mainnet. This is the only place
// that touches BigQuery for rater analytics — results are persisted to the
// RaterProfile table so trust scoring never hits BigQuery in the hot path.
//
// Three BigQuery passes per refresh:
//   1. RATER_FANOUT   (ERC-8004 reputation logs) — how many agents each wallet
//                      rates (the judge's "are they rating a lot of people?")
//   2. RATER_ACTIVITY (mainnet transactions)     — lifetime tx count (max nonce),
//                      distinct counterparties, first sent — "does it have a life
//                      besides rating?"
//   3. RATER_FUNDING  (mainnet transactions)     — first inbound funder + time —
//                      cross-wallet cluster key + fresh-wallet tell
const { runQuery } = require("../bigquery/client");
const {
  REPUTATION_REGISTRY,
  RATER_FANOUT,
  RATER_ACTIVITY,
  RATER_FUNDING,
} = require("../bigquery/queries");
const { prisma } = require("../db/prisma");
const { computeRaterWeight } = require("../scoring/raterClustering");

// BigQuery returns DATETIME/TIMESTAMP as { value: "..." } objects.
function bqDate(raw) {
  if (!raw) return null;
  const v = typeof raw === "object" && raw.value !== undefined ? raw.value : raw;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function bqInt(raw) {
  if (raw === null || raw === undefined) return null;
  // BigQuery INT64 may come back as a string or a { value } wrapper.
  const v = typeof raw === "object" && raw.value !== undefined ? raw.value : raw;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Fetch fan-out for the whole registry (cheap; young registry) and index by
// rater address. Returns Map<wallet, {agentsRated,totalFeedbacks,first,last}>.
async function fetchFanout() {
  const rows = await runQuery(RATER_FANOUT, {
    reputationRegistry: REPUTATION_REGISTRY.toLowerCase(),
  });
  const map = new Map();
  for (const r of rows) {
    if (!r.client_address) continue;
    map.set(r.client_address.toLowerCase(), {
      agentsRated: bqInt(r.agents_rated),
      totalFeedbacks: bqInt(r.total_feedbacks),
      firstRatingAt: bqDate(r.first_rating_at),
      lastRatingAt: bqDate(r.last_rating_at),
    });
  }
  return map;
}

async function fetchActivity(wallets) {
  if (wallets.length === 0) return new Map();
  const rows = await runQuery(
    RATER_ACTIVITY,
    { wallets },
    { wallets: ["STRING"] }
  );
  const map = new Map();
  for (const r of rows) {
    if (!r.wallet) continue;
    const maxNonce = bqInt(r.max_nonce);
    map.set(r.wallet.toLowerCase(), {
      lifetimeTxsSent: maxNonce === null ? null : maxNonce + 1,
      distinctCounterparties: bqInt(r.distinct_counterparties),
      firstSentAt: bqDate(r.first_sent_at),
    });
  }
  return map;
}

async function fetchFunding(wallets) {
  if (wallets.length === 0) return new Map();
  const rows = await runQuery(
    RATER_FUNDING,
    { wallets },
    { wallets: ["STRING"] }
  );
  const map = new Map();
  for (const r of rows) {
    if (!r.wallet) continue;
    map.set(r.wallet.toLowerCase(), {
      funder: r.funder ? r.funder.toLowerCase() : null,
      firstFundedAt: bqDate(r.first_funded_at),
    });
  }
  return map;
}

/**
 * Refresh RaterProfile rows for the given wallets from BigQuery.
 * @param {string[]} walletList lowercase-able rater addresses
 * @returns {Promise<{refreshed:number, skipped:boolean, error?:string}>}
 */
async function refreshRaterProfiles(walletList) {
  const wallets = [
    ...new Set((walletList || []).map((w) => w && w.toLowerCase()).filter(Boolean)),
  ];
  if (wallets.length === 0) return { refreshed: 0, skipped: false };

  let fanout, activity, funding;
  try {
    // Fan-out is registry-wide; the other two are scoped to our wallets.
    [fanout, activity, funding] = await Promise.all([
      fetchFanout(),
      fetchActivity(wallets),
      fetchFunding(wallets),
    ]);
  } catch (err) {
    // BigQuery unavailable (no creds / quota) — degrade gracefully. Scoring
    // still works via owner-only clustering at the base unverified weight.
    console.error("[raterProfile] BigQuery fetch failed:", err.message);
    return { refreshed: 0, skipped: true, error: err.message };
  }

  let refreshed = 0;
  for (const wallet of wallets) {
    const fo = fanout.get(wallet) || {};
    const ac = activity.get(wallet) || {};
    const fu = funding.get(wallet) || {};

    const firstSeen = [ac.firstSentAt, fu.firstFundedAt]
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null;

    const raw = {
      agentsRated: fo.agentsRated ?? null,
      totalFeedbacks: fo.totalFeedbacks ?? null,
      firstRatingAt: fo.firstRatingAt ?? null,
      lastRatingAt: fo.lastRatingAt ?? null,
      firstSeen,
      lifetimeTxsSent: ac.lifetimeTxsSent ?? null,
      distinctCounterparties: ac.distinctCounterparties ?? null,
      funder: fu.funder ?? null,
      firstFundedAt: fu.firstFundedAt ?? null,
    };

    // Snapshot weight for display/debug. Scoring recomputes live (verified
    // status can change), but this lets the dashboard show the BigQuery verdict.
    const { weight, flags } = computeRaterWeight(raw, false);

    await prisma.raterProfile.upsert({
      where: { walletAddress: wallet },
      update: {
        ...raw,
        raterWeight: weight,
        flagsJson: JSON.stringify(flags),
        fetchedAt: new Date(),
      },
      create: {
        walletAddress: wallet,
        ...raw,
        raterWeight: weight,
        flagsJson: JSON.stringify(flags),
      },
    });
    refreshed++;
  }

  return { refreshed, skipped: false };
}

// All distinct, non-revoked feedback rater wallets we know about.
async function allRaterWallets() {
  const rows = await prisma.feedbackEvent.findMany({
    where: { isRevoked: false, clientAddress: { not: null } },
    select: { clientAddress: true },
    distinct: ["clientAddress"],
  });
  return rows.map((r) => r.clientAddress.toLowerCase()).filter(Boolean);
}

module.exports = { refreshRaterProfiles, allRaterWallets };
