# How Data Flows: BigQuery → Decoded → Stored

This doc walks through exactly what AgentRank pulls from BigQuery, how it's
decoded, and what ends up in our two main tables (`Agent` and `FeedbackEvent`).
Every example below is **real data** pulled during testing.

---

## 1. Identity Registry → `Agent` table

### Step 1: Raw row from BigQuery

This is one row from `bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`,
filtered to the Identity Registry contract address
(`0x8004a169fb4a3325136eb29fa0ceb6d2e539a432`):

```json
{
  "block_timestamp": { "value": "2026-03-12T18:47:59.000Z" },
  "block_number": 24643273,
  "transaction_hash": "0xad5d188240e808d79ff8579666d858e7e0c8ef92539d82abe685df4fe20261a3",
  "log_index": 391,
  "address": "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  "topics": [
    "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a",
    "0x0000000000000000000000000000000000000000000000000000000000006f58",
    "0x00000000000000000000000006b7c2a8531ba71f59230d932692ccbeeb8e0990"
  ],
  "data": "0x0000...0020 0000...0042 69706673...000" // ABI-encoded string
}
```

A raw log is just **4 things**:

| Field | What it means |
|---|---|
| `topics[0]` | The event signature hash — tells us *which event* this is |
| `topics[1]`, `topics[2]`, ... | "Indexed" parameters — fixed-size values like IDs and addresses |
| `data` | "Non-indexed" parameters — variable-length stuff like strings, ABI-encoded |
| `transaction_hash`, `block_number`, `block_timestamp` | Where/when this happened on-chain |

### Step 2: Decoding (`identityDecoder.js`)

We check `topics[0]` against known event signatures:

```js
const IDENTITY_REGISTRATION_EVENT =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
```

This row's `topics[0]` matches → it's a **`Registered`** event. The spec says:

```
event Registered(uint256 indexed agentId, address indexed owner, string agentURI)
```

So:

| Raw field | Decoded as | Value |
|---|---|---|
| `topics[1]` | `agentId` (uint256) | `0x6f58` → **28504** |
| `topics[2]` | `owner` (address, last 20 bytes of the 32-byte topic) | `0x06b7c2a8531ba71f59230d932692ccbeeb8e0990` |
| `data` | `agentURI` (ABI-decoded string) | `ipfs://bafkreidwhovmlrdypdhrvshbesl6azlw4uw6nioyo7rc35okaribcmcxi4` |

The address conversion is just: take the last 40 hex chars (20 bytes) of the
32-byte topic and prepend `0x`. The string in `data` is standard Solidity ABI
encoding (offset + length + UTF-8 bytes), decoded with `ethers.AbiCoder`.

### Step 3: What gets stored in the `Agent` table

After decoding, we **upsert** a row keyed on `agentId`. Using a real example
from our test run — agent **#32334** ("Zyfai Rebalancer Agent"):

```js
// First write — straight from the decoded log
{
  agentId: 32334n,
  identityRegistryAddress: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  ownerAddress: "0x200fab0ef58b7e378d1a10529f2b62703c0014f7",
  agentUri: "ipfs://bafkreiaato3gacey6v6h4hk5ylsil7qa2p43rinq42rsbpseb7sjt7nu2q",
  registeredTxHash: "0xb6fc818c723386a85489114eef0a91ebbdf3c08d9f4103a4a0c3f0e96c8e1b56",
  registeredBlockNumber: 25080752n,
  registeredAt: "2026-05-12T18:12:59.000Z"
}
```

At this point we have an **identity** but no idea what the agent actually
*does*. That's what `agentUri` is for.

### Step 4: Metadata enrichment (`fetchMetadata.js`)

`agentUri` is `ipfs://...`, so we resolve it through an IPFS gateway
(`cloudflare-ipfs.com/ipfs/<cid>`) and fetch the JSON. That file looks like
the ERC-8004 registration format — a `name`, `description`, `services` array,
`x402Support` flag, `supportedTrust` array, etc.

We extract the known fields and **update the same row**:

```js
{
  name: "Zyfai Rebalancer Agent for 0x200faB0eF58B7E378D1A10529f2b62703C0014F7",
  description: "A ZK powered rebalancer agent that finds the best yet low risk yield opportunities...",
  image: "https://www.zyf.ai/Zyfai-logo-png.png",
  active: true,
  x402Support: false,
  servicesJson: '[{"name":"web","endpoint":"https://www.zyf.ai"},{"name":"MCP","endpoint":"https://mcp.zyf.ai","version":"v1"}]',
  supportedTrustJson: '["crypto-economic","reputation"]',
  webEndpoint: "https://www.zyf.ai",
  mcpEndpoint: "https://mcp.zyf.ai",
  ensName: null,
  a2aEndpoint: null,
  rawMetadataJson: "{...the entire fetched JSON file, untouched...}"
}
```

`rawMetadataJson` is a catch-all — even fields we don't explicitly model are
preserved, so nothing is lost if the agent's metadata has extra/custom fields.

**Final `Agent` row** (combination of on-chain + off-chain data) is what
`/agents/32334` returns.

---

## 2. Reputation Registry → `FeedbackEvent` table

### Step 1: Raw row from BigQuery

Same source table, filtered to the Reputation Registry address
(`0x8004baa17c55a88189ae136b182e5fda19de9b63`). `topics[0]` here is always:

```
0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc
```

which is `keccak256("NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)")`
— i.e. the `NewFeedback` event from the spec:

```
event NewFeedback(
  uint256 indexed agentId,
  address indexed clientAddress,
  uint64 feedbackIndex,
  int128 value,
  uint8 valueDecimals,
  string indexed indexedTag1,
  string tag1,
  string tag2,
  string endpoint,
  string feedbackURI,
  bytes32 feedbackHash
)
```

### Step 2: Decoding (`reputationDecoder.js`)

| Raw field | Decoded as | Real example |
|---|---|---|
| `topics[1]` | `agentId` | **28511** |
| `topics[2]` | `clientAddress` | `0x668add9213985e7fd613aec87767c892f4b9df1c` |
| `data` (ABI-decoded: `uint64,int128,uint8,string,string,string,string,bytes32`) | `feedbackIndex`, `value`, `valueDecimals`, `tag1`, `tag2`, `endpoint`, `feedbackUri`, `feedbackHash` | `value=80`, `valueDecimals=0` |

We then compute `valueNormalized = value / 10^valueDecimals`. With
`valueDecimals = 0`, `valueNormalized = 80` — a 0–100 quality score.

A different real example we decoded (agent #23012):

```js
{
  agentId: 23012n,
  clientAddress: "0x668add9213985e7fd613aec87767c892f4b9df1c",
  valueRaw: "88",
  valueDecimals: 0,
  valueNormalized: 88,
  tag1: "responseTime",
  tag2: "mcp"
}
```

This says: *"client `0x668a...` rated agent #23012's MCP response time as
88/100."*

### Step 3: What gets stored in `FeedbackEvent`

**Important guard**: we only store feedback for agents that already exist in
our `Agent` table (from Identity ingestion). If `agentId` isn't recognized,
we skip it — there's nothing to attach the feedback to yet.

For agent #28511, the stored row looks like:

```js
{
  agentId: 28511n,
  clientAddress: "0x668add9213985e7fd613aec87767c892f4b9df1c",
  feedbackIndex: 1n,
  valueRaw: "80",
  valueDecimals: 0,
  valueNormalized: 80,
  tag1: "...",
  tag2: "...",
  isRevoked: false,
  txHash: "0x...",
  blockNumber: 25xxxxxxn,
  blockTimestamp: "2026-..."
}
```

This row is linked back to `Agent` via the `agentId` foreign key.

---

## 3. How these feed the Trust Score

`computeTrustScore.js` reads both tables together for a given `agentId`:

- **From `Agent`**: is it registered? Does it have a working `agentUri`? Did
  metadata fetch succeed? Is it `active`? Does it expose services? Does it
  declare `x402Support`?
- **From `FeedbackEvent`** (where `isRevoked = false`): how many feedback
  events exist? What's the average `valueNormalized`? Any in the last 30 days?

For agent #28511, this produced:

```json
{
  "trustScore": 75,
  "identityScore": 45,   // fully registered + active + has services + declares reputation support
  "reputationScore": 30, // has feedback (10) + positive avg of 80 (15) + no revocations (5)
  "paymentScore": 0,     // x402Support = false
  "riskLevel": "medium",
  "recommendation": "review_before_calling"
}
```

---

## Summary: One Agent's Full Journey

```
BigQuery raw log (Registered event, topics + data)
        ↓ decode
{ agentId: 32334, owner: 0x200f..., agentUri: "ipfs://bafkrei..." }
        ↓ upsert into Agent table
        ↓ fetch agentUri from IPFS gateway
{ name: "Zyfai Rebalancer Agent...", services: [...], x402Support: false, ... }
        ↓ update Agent row

BigQuery raw log (NewFeedback event, topics + data)
        ↓ decode
{ agentId: 28511, client: 0x668a..., value: 80, tag1: "...", tag2: "..." }
        ↓ check agentId exists in Agent table → yes
        ↓ insert into FeedbackEvent table

computeTrustScore(agentId)
        ↓ reads Agent + FeedbackEvent
{ trustScore: 75, riskLevel: "medium", reasons: [...] }
        ↓ upsert into TrustScore table

GET /agents/28511/risk → returns the combined view above
```

---

## Note on BigQuery quota

Each query against `goog_blockchain_ethereum_mainnet_us.logs` scans a large
amount of data. The free tier has a monthly bytes-scanned quota — running
many large/full ingests back to back can exhaust it (we hit this while
pulling a sample row for this doc). Keep `days` and `limit` small for repeated
testing, and reserve `--full` syncs for when you actually need a big backfill.
