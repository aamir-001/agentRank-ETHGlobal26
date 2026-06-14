# ENS Integration — Summary

ERC-8004 gives agents on-chain identity and reputation, but that identity is
just a number (`agentId`) and a hex address. AgentRank uses **ENS** as the
human-readable, discoverable layer on top: it resolves agent owner wallets to
ENS names, and — where an agent's own metadata declares an ENS identity —
cross-checks that declaration against the on-chain ERC-8004 record to produce
a verifiable trust signal.

ENS is treated as a **bonus on top of ERC-8004**, never a replacement and
never a hard requirement. Agents with no ENS presence are unaffected.

## What was built

### 1. ENS enrichment pipeline (`backend/src/ens/`)
- `ensClient.js` — thin wrapper around `ethers` for forward resolution,
  reverse resolution, and ENS text record reads, against a configurable
  `ETH_RPC_URL`.
- `enrichAgentEns.js` — runs automatically after metadata enrichment during
  identity ingestion. For each agent it:
  1. Reverse-resolves the owner wallet → primary ENS name (`ownerEnsName`)
  2. If the agent's ERC-8004 metadata declares an ENS name (via a `services[]`
     entry), forward-resolves it and checks it against the owner address
  3. Checks whether the owner's reverse record matches the declared ENS name
  4. Reads ENS text records (`agent.id`, `agent.uri`, etc.) and compares them
     against the on-chain registry data

### 2. New data model (`EnsRecord` table)
One row per agent, storing `declaredEnsName`, `ownerEnsName`,
`ensResolvedAddress`, `ensScore` (0-15), `ensVerified`, raw text records, and
human-readable reasons — linked 1:1 to `Agent` via `agentId`.

### 3. Trust score integration
- `ensScore` (0-15) is added as a bonus to the existing Identity (45) +
  Reputation (40) + Payment (15) score, capped at 100 overall.
- Two tiers, both surfaced as badges everywhere an agent appears:
  - **ENS Linked** (score ≥ 5) — owner wallet has *some* ENS identity
  - **ENS Verified** (score ≥ 10) — agent's declared ENS identity
    cryptographically cross-checks against its ERC-8004 record

### 4. API surface
- `GET /agents` — new `ensVerified=true` filter
- `GET /agents/:id` — new `ens: { declaredEnsName, ownerEnsName,
  resolvedAddress, linked, verified, score, textRecords, reasons }`
- `GET /agents/:id/risk` — `scores.ens` and an `ens` summary block

### 5. Dashboard
- Leaderboard cards: "ENS Linked" / "ENS Verified" badges (lit when active,
  dimmed otherwise) + owner's ENS name shown next to their wallet address
- New "ENS Verified" leaderboard filter
- Agent detail page:
  - Identity card now shows **Owner ENS** and **Agent ENS** rows when available
  - New **ENS Verification** panel with resolved address, reverse record,
    ENS score (/15), and the specific reasons behind the score
  - Risk Report score breakdown now includes an ENS bar (/15)

## Infrastructure note: RPC provider matters

Initial backfill used ethers' default provider (shared, globally
rate-limited free Alchemy/Infura keys) — ~6 agents in 10+ minutes. Switching
to a dedicated public endpoint (`https://ethereum-rpc.publicnode.com`, no
signup) and parallelizing 10-at-a-time processed all 115 agents in ~15
seconds. `ETH_RPC_URL` is now set in `backend/.env` and used automatically
for all future ENS lookups (ingestion and the backfill script
`backend/src/scripts/backfill-ens.js`).

## Results from the current dataset (115 agents)

| Metric | Count |
|---|---|
| Agents processed | 115 |
| **ENS Linked** (owner wallet has a primary ENS name) | **47** |
| **ENS Verified** (declared ENS identity cross-checks ERC-8004) | 0 |
| Agents declaring an ENS name in their own metadata | 0 |

47 of the 115 agent owner wallets resolve to real, primary ENS names —
e.g. `tekrox.eth`, `holi-dao.eth`, `loveandlove.eth`, `jojo-p.eth`,
`rainbow-shower.eth`. None of the agents currently declare their *own* ENS
identity in ERC-8004 metadata, so the full cross-verification (and the
"ENS Verified" badge) hasn't fired yet for this dataset — which is the
expected, honest outcome: verification requires an agent operator to
explicitly link their agent's identity to an ENS name and have it agree with
the on-chain registry, not just own a wallet that happens to have an ENS name.

## Why this matters for the pitch

> ERC-8004 gives agents on-chain identity and reputation. ENS makes that
> identity human-readable and discoverable, and AgentRank verifies that an
> agent's declared ENS name, owner wallet, ERC-8004 registry record, and
> metadata all agree before awarding an "ENS Verified" trust badge — a
> meaningful, cryptographically-checked signal rather than a cosmetic label.

The 47 "ENS Linked" agents already make the dashboard noticeably more
human-readable today, and any agent operator can unlock "ENS Verified" simply
by adding an `ENS` service entry to their ERC-8004 metadata and matching text
records — no changes to AgentRank required.
