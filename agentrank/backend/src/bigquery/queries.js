const IDENTITY_REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const REPUTATION_REGISTRY = "0x8004baa17c55a88189ae136b182e5fda19de9b63";

const IDENTITY_LOGS = `
SELECT
  block_timestamp,
  block_number,
  transaction_hash,
  log_index,
  LOWER(address) AS address,
  topics,
  data
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  block_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
  AND LOWER(address) = @identityRegistry
ORDER BY
  block_number ASC
LIMIT @limit
`;

const REPUTATION_LOGS = `
SELECT
  block_timestamp,
  block_number,
  transaction_hash,
  log_index,
  LOWER(address) AS address,
  topics,
  data
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  block_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
  AND LOWER(address) = @reputationRegistry
ORDER BY
  block_number ASC
LIMIT @limit
`;

// Pull all identity logs ever (no time filter) — useful for initial full sync
const IDENTITY_LOGS_ALL = `
SELECT
  block_timestamp,
  block_number,
  transaction_hash,
  log_index,
  LOWER(address) AS address,
  topics,
  data
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @identityRegistry
ORDER BY
  block_number ASC
LIMIT @limit
`;

const REPUTATION_LOGS_ALL = `
SELECT
  block_timestamp,
  block_number,
  transaction_hash,
  log_index,
  LOWER(address) AS address,
  topics,
  data
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @reputationRegistry
ORDER BY
  block_number ASC
LIMIT @limit
`;

// ---------------------------------------------------------------------------
// Sybil-resistance analytics
// ---------------------------------------------------------------------------

// Fan-out / spray signal, computed directly in BigQuery over the raw ERC-8004
// reputation logs: for every rater (indexed clientAddress = topics[2]), how many
// DISTINCT agents (indexed agentId = topics[1]) has it rated, and when did it
// start. A wallet that sprays feedback across hundreds of agents is an
// indiscriminate bot; a wallet that rates a handful looks human. Returns one row
// per rater across the entire registry — the registry is young, so this is cheap.
const RATER_FANOUT = `
SELECT
  LOWER(CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27))) AS client_address,
  COUNT(DISTINCT topics[OFFSET(1)]) AS agents_rated,
  COUNT(*) AS total_feedbacks,
  MIN(block_timestamp) AS first_rating_at,
  MAX(block_timestamp) AS last_rating_at
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @reputationRegistry
  AND ARRAY_LENGTH(topics) >= 3
GROUP BY
  client_address
`;

// On-chain economic profile, joined from the full mainnet transactions table.
// nonce is a per-sender monotonic counter, so MAX(nonce)+1 is the wallet's
// lifetime outbound transaction count in a single pass — no row counting. A
// wallet whose only outbound txs are its feedback calls (tiny lifetime count,
// few counterparties) exists solely to rate.
const RATER_ACTIVITY = `
SELECT
  from_address AS wallet,
  MAX(nonce) AS max_nonce,
  COUNT(DISTINCT to_address) AS distinct_counterparties,
  MIN(block_timestamp) AS first_sent_at,
  MAX(block_timestamp) AS last_sent_at
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions\`
WHERE
  from_address IN UNNEST(@wallets)
GROUP BY
  from_address
`;

// Funding source: the from_address of each wallet's FIRST inbound value
// transfer. Many wallets sharing one funder is the on-chain signature of a
// single entity (a Sybil cluster), so this is the cluster key for raw EOAs we
// can't map to an ERC-8004 owner. Also yields firstFundedAt ("funded just
// before it started rating" is a classic fresh-wallet tell).
const RATER_FUNDING = `
SELECT
  wallet,
  funder,
  first_funded_at
FROM (
  SELECT
    to_address AS wallet,
    from_address AS funder,
    block_timestamp AS first_funded_at,
    ROW_NUMBER() OVER (PARTITION BY to_address ORDER BY block_timestamp ASC) AS rn
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions\`
  WHERE
    to_address IN UNNEST(@wallets)
    AND SAFE_CAST(value AS BIGNUMERIC) > 0
)
WHERE rn = 1
`;

// ---------------------------------------------------------------------------
// Network analytics — live aggregates over the FULL registries on BigQuery,
// not just the agents/feedback we've ingested locally. This is what makes
// these "trends" rather than a re-read of our own SQLite cache.
// ---------------------------------------------------------------------------

// keccak256("Registered(uint256,string,address)") — see decode/identityDecoder.js
const IDENTITY_REGISTRATION_EVENT =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";

// Agent registrations per week, across the entire Identity Registry history.
const REGISTRY_GROWTH = `
SELECT
  TIMESTAMP_TRUNC(block_timestamp, WEEK) AS week,
  COUNT(*) AS registrations
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @identityRegistry
  AND topics[SAFE_OFFSET(0)] = @registeredEventSig
GROUP BY
  week
ORDER BY
  week
`;

// Feedback events per week, across the entire Reputation Registry — network-
// wide activity, not limited to agents we've ingested identity for.
const FEEDBACK_VOLUME_TREND = `
SELECT
  TIMESTAMP_TRUNC(block_timestamp, WEEK) AS week,
  COUNT(*) AS feedback_count
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @reputationRegistry
  AND ARRAY_LENGTH(topics) >= 3
GROUP BY
  week
ORDER BY
  week
`;

// Most-rated agents network-wide — COUNT(*) GROUP BY agentId over raw logs.
// Surfaces popular agents even if we haven't ingested their identity yet.
const MOST_RATED_AGENTS = `
SELECT
  SAFE_CAST(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(1)], 27)) AS INT64) AS agent_id,
  COUNT(*) AS feedback_count
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @reputationRegistry
  AND ARRAY_LENGTH(topics) >= 3
GROUP BY
  agent_id
HAVING
  agent_id IS NOT NULL
ORDER BY
  feedback_count DESC
LIMIT 10
`;

// Top-rated agents by average feedback score, decoded directly from the raw
// log `data` field. NewFeedback's non-indexed head is
// (uint64 feedbackIndex, int128 value, uint8 valueDecimals, ...dynamic...),
// each occupying a 32-byte slot. value's low 16 bytes live at hex offset
// 67+32=99 (32 hex chars); valueDecimals' low byte at hex offset 131+62=193
// (2 hex chars). BigQuery's CAST(STRING AS INT64) accepts "0x..." hex strings.
const TOP_RATED_AGENTS = `
SELECT
  SAFE_CAST(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(1)], 27)) AS INT64) AS agent_id,
  COUNT(*) AS feedback_count,
  AVG(
    SAFE_CAST(CONCAT('0x', SUBSTR(data, 99, 32)) AS INT64)
    / POW(10, COALESCE(SAFE_CAST(CONCAT('0x', SUBSTR(data, 193, 2)) AS INT64), 0))
  ) AS avg_score
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @reputationRegistry
  AND ARRAY_LENGTH(topics) >= 3
  AND LENGTH(data) >= 194
GROUP BY
  agent_id
HAVING
  agent_id IS NOT NULL
  AND avg_score IS NOT NULL
ORDER BY
  avg_score DESC,
  feedback_count DESC
LIMIT 10
`;

// Most active raters network-wide — same fan-out signal used for Sybil
// scoring, surfaced as a "most prolific raters" / bot-watch leaderboard.
const MOST_ACTIVE_RATERS = `
SELECT
  LOWER(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS client_address,
  COUNT(DISTINCT topics[SAFE_OFFSET(1)]) AS agents_rated,
  COUNT(*) AS total_feedbacks,
  MIN(block_timestamp) AS first_rating_at,
  MAX(block_timestamp) AS last_rating_at
FROM
  \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
WHERE
  LOWER(address) = @reputationRegistry
  AND ARRAY_LENGTH(topics) >= 3
GROUP BY
  client_address
ORDER BY
  agents_rated DESC,
  total_feedbacks DESC
LIMIT 10
`;

// "Fresh wallet" pressure over time: for each week, what fraction of feedback
// came from a wallet that was less than 7 days old (by its first-ever mainnet
// tx) at the moment it rated. Joins the raw reputation logs against the full
// transactions table — a classic Sybil/spam-pressure trend line.
const FRESH_WALLET_PRESSURE_TREND = `
WITH feedback AS (
  SELECT
    LOWER(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS rater,
    block_timestamp AS rated_at,
    TIMESTAMP_TRUNC(block_timestamp, WEEK) AS week
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE
    LOWER(address) = @reputationRegistry
    AND ARRAY_LENGTH(topics) >= 3
),
wallet_birth AS (
  SELECT
    from_address AS wallet,
    MIN(block_timestamp) AS first_tx_at
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions\`
  WHERE
    from_address IN (SELECT DISTINCT rater FROM feedback)
  GROUP BY
    from_address
)
SELECT
  f.week AS week,
  COUNT(*) AS total_feedback,
  COUNTIF(w.first_tx_at IS NOT NULL AND TIMESTAMP_DIFF(f.rated_at, w.first_tx_at, DAY) < 7) AS fresh_wallet_feedback
FROM
  feedback f
LEFT JOIN
  wallet_birth w ON w.wallet = f.rater
GROUP BY
  week
ORDER BY
  week
`;

// One-row executive summary over both ERC-8004 registries. This is intentionally
// a full-network BigQuery view: local SQLite cannot answer coverage/concentration
// questions for agents we have not ingested yet.
const NETWORK_HEALTH = `
WITH registrations AS (
  SELECT
    SAFE_CAST(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(1)], 27)) AS INT64) AS agent_id,
    LOWER(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS owner,
    block_timestamp
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE
    LOWER(address) = @identityRegistry
    AND topics[SAFE_OFFSET(0)] = @registeredEventSig
),
feedback AS (
  SELECT
    SAFE_CAST(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(1)], 27)) AS INT64) AS agent_id,
    LOWER(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS rater,
    block_timestamp
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE
    LOWER(address) = @reputationRegistry
    AND ARRAY_LENGTH(topics) >= 3
)
SELECT
  (SELECT COUNT(*) FROM registrations) AS total_agents,
  (SELECT COUNT(DISTINCT owner) FROM registrations WHERE owner IS NOT NULL) AS unique_owners,
  (SELECT COUNT(*) FROM registrations WHERE block_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)) AS agents_30d,
  (SELECT COUNT(*) FROM feedback) AS total_feedback,
  (SELECT COUNT(DISTINCT agent_id) FROM feedback WHERE agent_id IS NOT NULL) AS agents_with_feedback,
  (SELECT COUNT(DISTINCT rater) FROM feedback WHERE rater IS NOT NULL) AS unique_raters,
  (SELECT COUNT(*) FROM feedback WHERE block_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)) AS feedback_30d
`;

// How concentrated is agent creation in the hands of top owner wallets?
const OWNER_CONCENTRATION = `
WITH registrations AS (
  SELECT
    LOWER(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS owner
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE
    LOWER(address) = @identityRegistry
    AND topics[SAFE_OFFSET(0)] = @registeredEventSig
),
owner_counts AS (
  SELECT owner, COUNT(*) AS agents_registered
  FROM registrations
  WHERE owner IS NOT NULL
  GROUP BY owner
),
ranked AS (
  SELECT
    owner,
    agents_registered,
    ROW_NUMBER() OVER (ORDER BY agents_registered DESC) AS rn
  FROM owner_counts
)
SELECT
  COUNT(*) AS owner_count,
  SUM(agents_registered) AS total_agents,
  SUM(IF(rn <= 1, agents_registered, 0)) AS top1_agents,
  SUM(IF(rn <= 5, agents_registered, 0)) AS top5_agents,
  SUM(IF(rn <= 10, agents_registered, 0)) AS top10_agents
FROM ranked
`;

// How concentrated is reputation writing among prolific raters?
const RATER_CONCENTRATION = `
WITH feedback AS (
  SELECT
    LOWER(CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS rater
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE
    LOWER(address) = @reputationRegistry
    AND ARRAY_LENGTH(topics) >= 3
),
rater_counts AS (
  SELECT rater, COUNT(*) AS feedback_count
  FROM feedback
  WHERE rater IS NOT NULL
  GROUP BY rater
),
ranked AS (
  SELECT
    rater,
    feedback_count,
    ROW_NUMBER() OVER (ORDER BY feedback_count DESC) AS rn
  FROM rater_counts
)
SELECT
  COUNT(*) AS rater_count,
  SUM(feedback_count) AS total_feedback,
  SUM(IF(rn <= 1, feedback_count, 0)) AS top1_feedback,
  SUM(IF(rn <= 5, feedback_count, 0)) AS top5_feedback,
  SUM(IF(rn <= 10, feedback_count, 0)) AS top10_feedback
FROM ranked
`;

// Distribution of decoded reputation values. This lets the UI show whether
// feedback is informative, uniformly glowing, or mostly punitive.
const FEEDBACK_SCORE_BANDS = `
WITH scored AS (
  SELECT
    SAFE_CAST(CONCAT('0x', SUBSTR(data, 99, 32)) AS INT64)
      / POW(10, COALESCE(SAFE_CAST(CONCAT('0x', SUBSTR(data, 193, 2)) AS INT64), 0)) AS score
  FROM
    \`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs\`
  WHERE
    LOWER(address) = @reputationRegistry
    AND ARRAY_LENGTH(topics) >= 3
    AND LENGTH(data) >= 194
)
SELECT
  CASE
    WHEN score >= 80 THEN 'excellent'
    WHEN score >= 60 THEN 'positive'
    WHEN score >= 40 THEN 'mixed'
    WHEN score >= 1 THEN 'negative'
    ELSE 'zero'
  END AS band,
  COUNT(*) AS count
FROM scored
WHERE score IS NOT NULL
GROUP BY band
ORDER BY count DESC
`;

module.exports = {
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
  IDENTITY_LOGS,
  REPUTATION_LOGS,
  IDENTITY_LOGS_ALL,
  REPUTATION_LOGS_ALL,
  RATER_FANOUT,
  RATER_ACTIVITY,
  RATER_FUNDING,
  IDENTITY_REGISTRATION_EVENT,
  REGISTRY_GROWTH,
  FEEDBACK_VOLUME_TREND,
  MOST_RATED_AGENTS,
  TOP_RATED_AGENTS,
  MOST_ACTIVE_RATERS,
  FRESH_WALLET_PRESSURE_TREND,
  NETWORK_HEALTH,
  OWNER_CONCENTRATION,
  RATER_CONCENTRATION,
  FEEDBACK_SCORE_BANDS,
};
