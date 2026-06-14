// One-off census: how much ERC-8004 activity actually exists on mainnet,
// per registry and event type. Used to size the full ingest.
const { runQuery } = require("../bigquery/client");

const IDENTITY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const REPUTATION = "0x8004baa17c55a88189ae136b182e5fda19de9b63";

async function main() {
  const sql = `
    SELECT
      LOWER(address) AS registry,
      topics[OFFSET(0)] AS topic0,
      COUNT(*) AS cnt,
      MIN(block_timestamp) AS first_seen,
      MAX(block_timestamp) AS last_seen
    FROM \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
    WHERE LOWER(address) IN (@identity, @reputation)
    GROUP BY registry, topic0
    ORDER BY registry, cnt DESC
  `;
  const rows = await runQuery(sql, { identity: IDENTITY, reputation: REPUTATION });
  for (const r of rows) {
    console.log(
      `${r.registry === IDENTITY ? "IDENTITY  " : "REPUTATION"} ${r.topic0} cnt=${r.cnt} first=${r.first_seen?.value ?? r.first_seen} last=${r.last_seen?.value ?? r.last_seen}`
    );
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
