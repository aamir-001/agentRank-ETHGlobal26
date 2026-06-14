require("dotenv").config();
const { runQuery } = require("../bigquery/client");
const { IDENTITY_REGISTRY, REPUTATION_REGISTRY, IDENTITY_LOGS, REPUTATION_LOGS } = require("../bigquery/queries");

async function main() {
  const idRows = await runQuery(IDENTITY_LOGS, { days: 90, limit: 1, identityRegistry: IDENTITY_REGISTRY });
  console.log("--- RAW IDENTITY LOG ---");
  console.log(JSON.stringify(idRows[0], null, 2));

  const repRows = await runQuery(REPUTATION_LOGS, { days: 90, limit: 1, reputationRegistry: REPUTATION_REGISTRY });
  console.log("\n--- RAW REPUTATION LOG ---");
  console.log(JSON.stringify(repRows[0], null, 2));
}

main().catch(console.error);
