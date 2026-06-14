# Sybil-Resistant Reputation with BigQuery

*How AgentRank stops fake / spam feedback on ERC-8004 — and why BigQuery is the
engine that makes it possible.*

---

## The problem

ERC-8004's Reputation Registry is **permissionless and free**: any wallet can
post feedback about any agent, at no cost beyond gas. So a reputation score that
is just "average of ratings × number of ratings" is trivially farmable:

- **Vote-stuffing** — spin up 50 wallets, have them all praise your agent.
- **Repeat-spam** — one wallet posts the same 5-star feedback 30 times.
- **Bot raters** — a script sprays feedback across hundreds of agents.

The Google track asks builders to *"rank agents by feedback and reputation… a
one-stop place to discover **trustworthy** agents."* A ranking built on farmable
reputation isn't trustworthy. So Sybil resistance isn't a side feature — it's
what makes the core ranking credible.

A judge framed the key intuition directly: **"check what kind of agents are
giving the feedback — are they giving it to a lot of people?"** That question is
answered below, in SQL, over the raw ERC-8004 events.

---

## The approach: cluster → weight

Two ideas, one pass.

### 1. Cluster — collapse feedback to one voice per controlling entity

Before scoring, all of an agent's feedback is grouped by *who actually controls
each rater*. The cluster key is resolved in priority order:

1. **ERC-8004 owner** — if the rater is itself a registered owner, or is the
   wallet of a registered agent, it maps to that owner. Reliable, straight from
   the Identity Registry.
2. **Shared funder** — otherwise, the `from_address` of the rater's *first
   inbound value transfer* (BigQuery). Many wallets funded by one address are the
   on-chain signature of a single entity. **Never** used to merge a World
   ID-verified human (avoids wrongly clustering two real people who happened to
   cash out of the same exchange).
3. **Self** — a genuine standalone wallet.

Each cluster contributes **one voice per rated agent**. Consequences:

- 50 wallets under one owner all praising agent Y → **1 voice** (kills
  vote-stuffing).
- One wallet posting 30 feedbacks → **1 voice** (kills repeat-spam).
- An honest owner with 3 agents leaving one review each on 3 *different* agents →
  still 3 legit voices (granularity is per *rated* agent, so real reviewers are
  not punished).

### 2. Weight — down-weight each voice by BigQuery Sybil signals

An unverified voice starts at weight `0.2` and is multiplied down by on-chain
behaviour:

| Signal | Source | Sybil shape it catches |
|--------|--------|------------------------|
| **Fan-out / spray** | ERC-8004 reputation logs | rates ≫ 8 distinct agents → indiscriminate bot |
| **Wallet age** | mainnet `transactions` | born / funded days before its first rating → fresh wallet |
| **Activity** | mainnet `transactions` | few lifetime txs, or outbound txs are almost all feedback → exists only to rate |
| **Counterparty diversity** | mainnet `transactions` | self-referential / manufactured activity |

### 3. World ID is the backstop

A **World ID-verified** rater bypasses all of the above at full weight `1.0`.
Rationale: a determined, funded bot can *manufacture* age, activity, and even
tasks-it-then-rates — you can fake on-chain history for money. You **cannot**
cheaply fake being a unique human. So:

- On-chain heuristics make **cheap** Sybils worthless and **expensive** Sybils
  detectable + bounded.
- A hard cap keeps an agent with **zero** verified raters from climbing out of
  the Sybil floor (10/40), no matter how many wallets praise it.
- World ID personhood is the thing nothing on-chain can buy past.

---

## The SQL

All three queries run against Google BigQuery's public Ethereum dataset
(`bigquery-public-data.goog_blockchain_ethereum_mainnet_us`). The fan-out query
operates on the **raw ERC-8004 reputation logs**; the other two join the **full
mainnet transactions table** — this is where BigQuery stops being a log reader
and becomes the anti-Sybil analytics engine.

### Query 1 — Fan-out / spray (the judge's question, in SQL)

For every rater (`topics[2]` = indexed `clientAddress`), how many **distinct**
agents (`topics[1]` = indexed `agentId`) has it rated, and when did it start?

```sql
SELECT
  LOWER(CONCAT('0x', SUBSTR(topics[OFFSET(2)], 27))) AS client_address,
  COUNT(DISTINCT topics[OFFSET(1)])                  AS agents_rated,
  COUNT(*)                                           AS total_feedbacks,
  MIN(block_timestamp)                               AS first_rating_at,
  MAX(block_timestamp)                               AS last_rating_at
FROM
  `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`
WHERE
  LOWER(address) = @reputationRegistry      -- 0x8004baa1...de9b63
  AND ARRAY_LENGTH(topics) >= 3
GROUP BY
  client_address
```

- `topics[OFFSET(2)]` is a 32-byte word; `SUBSTR(..., 27)` extracts the trailing
  20-byte address and we re-prefix `0x`.
- `agents_rated` **is** "are they rating a lot of people?" — a wallet spraying
  200 agents is a bot; a wallet rating 1–5 looks human.
- The registry is young, so this aggregation is cheap (small scan).

### Query 2 — Activity (does it have a life besides rating?)

```sql
SELECT
  from_address              AS wallet,
  MAX(nonce)                AS max_nonce,              -- +1 = lifetime txs sent
  COUNT(DISTINCT to_address) AS distinct_counterparties,
  MIN(block_timestamp)      AS first_sent_at,
  MAX(block_timestamp)      AS last_sent_at
FROM
  `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions`
WHERE
  from_address IN UNNEST(@wallets)
GROUP BY
  from_address
```

- **`MAX(nonce) + 1` is the trick.** A sender's nonce is a monotonic counter of
  every transaction it has ever signed (starts at 0), so the max nonce gives the
  wallet's lifetime outbound transaction count in a single pass — no row
  counting.
- `feedback_count / lifetime_txs ≈ 1` → the wallet exists only to rate.
- `distinct_counterparties` low → no real economic footprint.

### Query 3 — Funding source (cross-wallet clustering + fresh-wallet tell)

The `from_address` of each wallet's **first** inbound value transfer.

```sql
SELECT wallet, funder, first_funded_at
FROM (
  SELECT
    to_address     AS wallet,
    from_address   AS funder,
    block_timestamp AS first_funded_at,
    ROW_NUMBER() OVER (PARTITION BY to_address ORDER BY block_timestamp ASC) AS rn
  FROM
    `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.transactions`
  WHERE
    to_address IN UNNEST(@wallets)
    AND SAFE_CAST(value AS BIGNUMERIC) > 0
)
WHERE rn = 1
```

- **Shared `funder` across many raters = one Sybil cluster** — the on-chain
  version of "all these wallets belong to one person."
- `first_funded_at` close to `first_rating_at` = funded-just-to-rate.
- `SAFE_CAST(... AS BIGNUMERIC)` handles wei values safely regardless of the
  column's stored type.

---

## How a voice's weight is computed

Pseudocode (`src/scoring/raterClustering.js`), unverified rater:

```
weight = 0.2
if agents_rated > 8:                weight *= 8 / agents_rated     # spray
if days(firstSeen → firstRating)<7: weight *= 0.3                  # fresh
if lifetime_txs < 5:                weight *= 0.5                  # thin
if feedback / lifetime_txs ≥ 0.8:   weight *= 0.5                  # rate-only
if distinct_counterparties < 3:     weight *= 0.6                  # no diversity
weight = clamp(weight, 0.02, 1)

verified human → weight = 1.0   (bypasses everything)
```

A cluster carries **one voice** at its most-credible member's weight. The
reputation score (max 40) is then computed over these collapsed, weighted
voices, and capped at the Sybil floor if there are zero verified humans.

---

## Defending against the sophisticated bot

*"What if the bot gives out lots of tasks and rates them?"* — i.e. it
manufactures real on-chain activity so age and activity look healthy.

This is the genuine limit of any age/activity heuristic, handled in layers:

1. **The manufactured activity is self-referential.** Its "tasks" flow between
   its own wallets, which trace back to a shared funder — so the whole ring
   collapses under funder-clustering to ~1 voice. The real metric isn't *how
   much* activity but how many *independent* counterparties (Query 2), which
   stays near-zero.
2. **The unverified pool is bounded.** Even a flawless, undetectable bot can't
   out-vote the verified humans — that's a design cap, not a detection.
3. **World ID is the guarantee.** Fake transactions are cheap; fake humans are
   not. Verified = full weight; everything else is bounded and discounted.

---

## Data model & flow

- **`RaterProfile`** caches the BigQuery output per wallet, so trust scoring
  **never hits BigQuery in the hot path.** Refreshed via `npm run
  backfill:raters` or `POST /raters/profiles/refresh`.
- **Graceful degradation:** if BigQuery is unavailable, scoring still runs with
  **owner-only clustering at base weight** — BigQuery signals are additive, never
  required.
- **Visibility:** the agent risk report exposes a `raterAnalysis` block (events
  vs. independent sources, flagged raters, effective weighted voices); each
  feedback event carries its `raterWeight` and `sybilFlags`.

| Component | File |
|-----------|------|
| BigQuery SQL | `src/bigquery/queries.js` |
| Profile fetch + cache | `src/raters/raterProfile.js` |
| Clustering + weighting | `src/scoring/raterClustering.js` |
| Score integration | `src/scoring/computeTrustScore.js` |
| Backfill | `src/scripts/backfill-rater-profiles.js` |

---

## Talking points for the judge

1. **BigQuery is the engine, not a log dump.** We join the ERC-8004 reputation
   logs *against the full mainnet transactions table* to compute fan-out, wallet
   age, activity, and funding clusters — analytics you can only do at this scale
   in BigQuery.
2. **We answered your question in SQL.** "Are they rating a lot of people?" is
   `COUNT(DISTINCT agent_id) GROUP BY client_address` over the raw events
   (Query 1).
3. **`MAX(nonce)+1`** gives a wallet's lifetime activity in one pass — a clean,
   cheap economic-life signal.
4. **Shared funder = one entity** turns a pile of Sybil wallets into a single
   discounted voice.
5. **It makes the ranking credible.** Without this, "discover trustworthy agents"
   is hollow; with it, fake feedback can't move the ranking.
