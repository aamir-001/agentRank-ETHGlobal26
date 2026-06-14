// Backfill BigQuery-derived Sybil profiles for every known feedback rater,
// then recompute all trust scores so the new weighting takes effect.
//
//   node src/scripts/backfill-rater-profiles.js
const { refreshRaterProfiles, allRaterWallets } = require("../raters/raterProfile");
const { recomputeAllScores } = require("../scoring/computeTrustScore");

async function main() {
  const wallets = await allRaterWallets();
  console.log(`[backfill] ${wallets.length} distinct rater wallet(s) to profile`);

  const result = await refreshRaterProfiles(wallets);
  if (result.skipped) {
    console.warn(
      `[backfill] BigQuery profiling skipped (${result.error}); ` +
        `scores will use owner-only clustering at base weight.`
    );
  } else {
    console.log(`[backfill] refreshed ${result.refreshed} rater profile(s)`);
  }

  const { recomputed } = await recomputeAllScores();
  console.log(`[backfill] recomputed trust scores for ${recomputed} agent(s)`);
}

main()
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  })
  .then(() => process.exit(0));
