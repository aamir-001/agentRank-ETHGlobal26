# AgentRank — ERC-8004 Trust API

Before your agent pays another agent, call AgentRank.

## What is AgentRank?

AgentRank is a **trust API for the onchain agent economy**. It ingests raw
[ERC-8004](#erc-8004-identity--reputation-registries) Identity and Reputation
registry events from Ethereum mainnet, enriches each agent with off-chain
metadata (ENS, services, x402 support), and computes a single **trust score
(0-100)** plus a risk level (`low` / `medium` / `high`) for every registered
agent.

The score and a full risk report are served via a REST API and a live
dashboard, so an agent (or the human behind it) can answer one question before
sending money: *"Is this the agent I think it is, and has it behaved well so
far?"*

## Why this tech matters

ERC-8004 makes agent identity and reputation **permissionless** — anyone can
register an agent and anyone can leave feedback. That's great for openness,
but on its own it's trivially gameable: spin up wallets, register fake
agents, spam five-star feedback between them. A naive "average rating" is
worthless in this environment.

AgentRank's bet is that you fix this not with one silver bullet, but by
**stacking independent, low-cost trust signals** until faking all of them
together becomes more expensive than just behaving honestly:

- **[Google BigQuery](#google-bigquery--sybil-resistant-reputation)** turns
  the raw onchain firehose into an anti-Sybil analytics engine — clustering
  feedback by controlling entity and down-weighting wallets that look like
  bots (fan-out, fresh wallets, no real activity).
- **[World ID / Worldcoin](#world-id--worldcoin--proof-of-personhood)** is the
  backstop nothing onchain can buy: a real, unique human behind a rater, an
  owner, or an agent. You can fake transaction history for cents; you cannot
  cheaply fake unique personhood.
- **[ENS](#ens--verified-identity-layer)** adds a human-readable, cross-checked
  identity layer on top of raw addresses, so an agent's claimed identity can be
  verified against the chain.
- **[x402](#x402--agent-payability-signal)** answers the *separate* question of
  whether an agent can actually be paid right now — kept deliberately apart
  from trust, because "payable" and "trustworthy" are not the same thing.

Each piece is useful alone, but together they compose into a score that's hard
to farm and that degrades gracefully if any single signal (e.g. BigQuery, or
World ID) is unavailable.

## Tech stack

Jump straight to how each technology is used:

| Tech | What it's used for |
|------|---------------------|
| [ERC-8004](#erc-8004-identity--reputation-registries) | Core identity & reputation registries (the data source) |
| [Google BigQuery](#google-bigquery--sybil-resistant-reputation) | Sybil-resistant reputation via clustering + onchain heuristics |
| [World ID / Worldcoin](#world-id--worldcoin--proof-of-personhood) | Proof-of-personhood for raters, owners, and AgentKit-backed agents |
| [ENS](#ens--verified-identity-layer) | Human-readable, cross-checked identity verification |
| [x402](#x402--agent-payability-signal) | Separate "can I actually pay this agent?" signal |

Other building blocks: [Fastify](https://fastify.dev/) + [Prisma](https://www.prisma.io/)
on the backend, [Next.js](https://nextjs.org/) + [Tailwind CSS](https://tailwindcss.com/)
for the dashboard, and [ethers.js](https://docs.ethers.org/) for chain interaction.

## Project setup

### 1. GCP credentials

Place your service account JSON at the repo root as `gcp-service-account.json`.
The account needs `BigQuery Data Viewer` + `BigQuery Job User` roles.

### 2. Backend

```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run dev
```

Backend runs on `http://localhost:3001`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Dashboard runs on `http://localhost:3000`

### 4. Ingest data

Via the dashboard (click "Ingest Data" top-right), or via CLI:

```bash
cd backend
node src/scripts/ingest.js
```

Options:
```bash
node src/scripts/ingest.js --days 30
node src/scripts/ingest.js --full --limit 2000
```

### 5. Profile raters for Sybil resistance (BigQuery)

After ingesting, build the BigQuery Sybil profiles (fan-out, wallet age,
activity, funding) for every rater and rescore:

```bash
cd backend
npm run backfill:raters
```

This scans the mainnet `transactions` table, so run it after ingestion rather
than per request. Scores work without it (owner-only clustering at base weight);
this layers the BigQuery signals on top.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/agents` | List agents (search, filter, sort) |
| GET | `/agents/:id` | Agent profile |
| GET | `/agents/:id/risk` | Trust report |
| POST | `/ingest/identity` | Ingest identity registry |
| POST | `/ingest/reputation` | Ingest reputation registry |
| POST | `/scores/recompute` | Recompute all trust scores |
| POST | `/raters/profiles/refresh` | Refresh BigQuery Sybil profiles for all raters, then rescore |
| GET | `/raters/:wallet` | Rater personhood status + BigQuery Sybil profile |
| GET | `/ingest/status` | Ingestion checkpoint status |

### Risk Report Example

```bash
curl http://localhost:3001/agents/34334/risk
```

```json
{
  "agentId": "34334",
  "safe": true,
  "riskLevel": "medium",
  "trustScore": 40,
  "recommendation": "review_before_calling"
}
```

## ERC-8004 Identity & Reputation Registries

| Registry | Address |
|----------|---------|
| Identity | `0x8004a169fb4a3325136eb29fa0ceb6d2e539a432` |
| Reputation | `0x8004baa17c55a88189ae136b182e5fda19de9b63` |

These two mainnet registries are the source of truth: agent identities
(owner, metadata URI, services) and feedback events. AgentRank ingests both
and builds the rest of the trust system on top of them.

## Trust Score

| Component | Max |
|-----------|-----|
| Identity (registered, URI, metadata, active, services, trust) | 45 |
| Reputation (feedback count, avg, recency, revocations) | 40 |
| ENS (verified identity bonus) | 15 |
| Owner personhood (World ID-verified human operator) | 10 |
| AgentKit human-backing (Delegated World ID — agent backed by a human) | 10 |

Components can sum past 100, but the total is **capped at 100** — the owner
bonus matters precisely because real agents sit well under the cap while
on-chain reputation is still sparse. Risk levels: `low` (50+), `medium`
(30-49), `high` (0-29).

## Google BigQuery — Sybil-resistant reputation

ERC-8004 feedback is permissionless and free, so naive "average of ratings"
reputation is trivially farmable: spin up wallets, spam praise. AgentRank
hardens the reputation axis with a **cluster → weight** pass that turns Google
BigQuery from a log reader into the anti-Sybil analytics engine.

**1. Cluster — collapse feedback to one voice per controlling entity.** Before
scoring, all of an agent's feedback is grouped by who actually controls each
rater. Cluster key, in priority order:

1. **ERC-8004 owner** — if the rater is itself a registered owner or an agent's
   wallet, it maps to that owner (reliable, from the Identity Registry).
2. **Shared funder** — otherwise, the `from_address` of the rater's first inbound
   value transfer (BigQuery). Many wallets sharing one funder is the on-chain
   signature of a single entity. Never used to merge a World ID-verified human.
3. **Self** — a standalone wallet.

Each cluster contributes **one voice per rated agent**, so 50 wallets under one
owner all praising agent Y collapse to a single voice, and one wallet posting 30
feedbacks collapses to a single voice. Vote-stuffing and repeat-spam both die
here — on our 116-agent mainnet snapshot you can see events collapse to far fewer
independent sources.

**2. Weight — down-weight each voice by BigQuery Sybil signals.** An unverified
voice starts at 0.2 and is multiplied down by:

| Signal | Source | Sybil shape |
|--------|--------|-------------|
| **Fan-out / spray** | ERC-8004 reputation logs (`GROUP BY client_address`) | rates ≫ 8 distinct agents → indiscriminate bot |
| **Wallet age** | mainnet `transactions` (`MIN(block_timestamp)`) | born/funded days before its first rating → fresh wallet |
| **Activity** | mainnet `transactions` (`MAX(nonce)+1`) | few lifetime txs, or outbound txs are almost all feedback → exists only to rate |
| **Counterparty diversity** | mainnet `transactions` (`COUNT(DISTINCT to_address)`) | self-referential / manufactured activity |

The fan-out query is exactly the judge's question — *"are these raters giving
feedback to a lot of people?"* — answered in SQL over the raw ERC-8004 events.
A **World ID-verified** rater bypasses all of this at full weight: you can fake
transactions, age, and activity for money, but you cannot cheaply fake unique
humanity. On-chain heuristics make cheap Sybils worthless; World ID is the
backstop nothing on-chain can buy past.

Profiles are cached in `RaterProfile` (BigQuery never runs in the scoring hot
path) and refreshed via `npm run backfill:raters` or `POST /raters/profiles/refresh`.
If BigQuery is unavailable, scoring degrades gracefully to owner-only clustering
at the base weight. The agent risk report exposes a `raterAnalysis` block
(events vs. independent sources, flagged raters), and each feedback event carries
its `raterWeight` and `sybilFlags`.

## World ID / Worldcoin — Proof of personhood

The ERC-8004 registries are permissionless — wallets are free, so reputation and
ownership are both trivially Sybil-farmable. AgentRank uses World ID
proof-of-personhood as the cost: humans are not free. Two **distinct** World ID
actions gate two **distinct** trust axes, so the same person can verify both
without nullifier collision (the nullifier is unique per human *per action*):

| Axis | Action | What it proves | Effect |
|------|--------|----------------|--------|
| **Rater** | `agentrank-rater` | the wallet posting feedback is a unique human | feedback from verified humans counts at full weight (1.0); with zero accountable-human raters an agent's reputation is capped at the Sybil floor (10/40) |
| **Owner** | `agentrank-owner` | the wallet that *owns* agents on-chain is a unique human | every agent that owner controls gains a +10 owner-personhood bonus and an accountable, non-Sybil operator |
| **Agent (AgentKit)** | `agentrank-agent` | the agent *itself* is backed by a unique human (Delegated World ID) | the agent gains a +10 human-backing bonus; its feedback as a rater counts at **0.6** (vs 0.2 for an anonymous wallet, 1.0 for a direct human) |

### Three feedback-weight tiers

Reputation is computed over cluster-collapsed "voices", each carrying a weight:

| Rater | Weight | Clustering |
|-------|--------|------------|
| Direct verified human (World ID) | **1.0** | one voice per human |
| Human-backed agent (AgentKit) | **0.6** | **one voice per backing human** — a person's whole fleet of agents collapses to a single voice, so it can't out-vote real humans |
| Unverified wallet | 0.2 × BigQuery Sybil heuristics | owner / funder / self |

The discount between a direct human (1.0) and a human-backed agent (0.6) is about
*deliberateness*: both are Sybil-resistant and accountable to a unique human, but
a person personally rating is a stronger endorsement than their agent's autonomous
rating. AgentKit's value is that all of one human's agents resolve to the **same
backing human**, which is exactly the clustering key.

### AgentKit (human-backed agent) verification flow

Mirrors the owner flow, with one deliberate difference — AgentKit is **one human
→ many agents**:

1. Connect the agent's wallet; sign the challenge (`personal_sign`) to prove
   control of the agent.
2. Present a Delegated World ID proof (`agentrank-agent` action) — its nullifier
   is the **backing human**.
3. Stored in `HumanBackedAgent` keyed by agent wallet; the backing human is **not**
   unique (a person backs a fleet). The `agentrank-agent` action must allow
   unlimited verifications per person.
4. The agent's own score gains +10; any feedback it left is re-weighted to 0.6
   and clustered by its backing human.

> Production note: the delegated-World-ID verification is the local stand-in for
> World's **AgentBook** verifier (`createAgentBookVerifier`, World Chain) — same
> primitive (resolve agent wallet → backing-human identifier), same cluster key.

### Owner verification flow (two proofs)

Ownership is gated on **proof of control** *and* **proof of personhood** — so a
user can only verify a wallet they actually hold, and one human can't Sybil a
fleet of owner accounts:

1. The owner opens `/verify-owner` and **connects the wallet** that owns their
   agents on-chain (ERC-8004 records this).
2. **Proof of ownership:** the backend issues a one-time challenge
   (`GET /owners/challenge/:wallet`); the owner signs it with `personal_sign`
   (free, no gas). `POST /owners/verify` recovers the address with
   `ethers.verifyMessage` and requires it to match — without this, anyone could
   claim any wallet.
3. **Proof of personhood:** the same request carries the World ID proof, bound
   to the wallet as its **signal** and `agentrank-owner` as the **action**,
   validated **server-side** (World ID cloud verify API — never trusted
   client-side).
4. The `nullifierHash` (unique per human) is stored in `VerifiedOwner`. A second
   owner wallet from the same human is rejected — one human cannot Sybil a fleet
   of "verified" owner accounts.
5. Every `Agent` whose `ownerAddress` matches is re-scored. The endpoint returns
   each agent's **before/after** trust score so the lift is visible.

Owner status is exposed at `GET /owners/:walletAddress` and flagged on agents
(`trustScore.ownerVerified`), in the risk report (`owner` block), and in the
analytics "Most Active Owners" view (verified humans vs. anonymous bulk
registrants).

## ENS — Verified identity layer

ENS provides a human-readable, discoverable identity layer on top of ERC-8004.
During identity ingestion, AgentRank:

1. Reverse-resolves the agent owner's wallet to a primary ENS name (if any).
2. If the agent's metadata declares an ENS name (`services[].name === "ENS"`),
   forward-resolves it and checks whether it points back to the owner address.
3. Checks whether the owner's reverse record matches the declared ENS name.
4. Reads ENS text records (`agent.id`, `agent.uri`, etc.) and checks them
   against the on-chain ERC-8004 registry data.

Each match contributes to a 0-15 `ensScore`, stored per-agent in the
`EnsRecord` table and added to the agent's overall trust score as a bonus.
Agents without any ENS presence are unaffected — ENS is a trust signal, not a
requirement. Set `ETH_RPC_URL` in `backend/.env` to use your own RPC provider
for ENS lookups (falls back to ethers' public default provider otherwise).

## x402 — Agent payability signal

[x402](https://x402.org) lets an agent accept HTTP-native micropayments —
it's *"can I actually send this agent money right now?"*. During ingestion,
AgentRank reads `x402Support` from an agent's declared metadata and stores it
as a plain boolean per agent.

This signal is **deliberately excluded** from the trust score. Being payable
means an agent is live and able to receive money — it says nothing about
whether it is honest. Instead, `x402Support` is exposed alongside the trust
score (API field `x402Support`, dashboard "Payable (x402)" badge, and as a
filter on `/agents`), so "is it trustworthy?" and "can I actually pay it?"
stay two separate questions with two separate answers.
