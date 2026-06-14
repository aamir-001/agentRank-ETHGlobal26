const { AbiCoder, keccak256, toUtf8Bytes } = require("ethers");

const abiCoder = AbiCoder.defaultAbiCoder();

// keccak256("NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)")
const NEW_FEEDBACK_EVENT =
  "0x" +
  Buffer.from(
    keccak256(
      toUtf8Bytes(
        "NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)"
      )
    ).slice(2),
    "hex"
  ).toString("hex");

// keccak256("FeedbackRevoked(uint256,address,uint64)")
const FEEDBACK_REVOKED_EVENT =
  "0x" +
  Buffer.from(
    keccak256(toUtf8Bytes("FeedbackRevoked(uint256,address,uint64)")).slice(2),
    "hex"
  ).toString("hex");

function topicToBigInt(topic) {
  if (!topic) return null;
  try {
    return BigInt(topic);
  } catch {
    return null;
  }
}

function topicToAddress(topic) {
  if (!topic) return null;
  return "0x" + topic.slice(-40).toLowerCase();
}

function parseTimestamp(raw) {
  if (!raw) return null;
  if (raw && typeof raw === "object" && raw.value) return new Date(raw.value);
  if (typeof raw === "string") return new Date(raw);
  return null;
}

function normalizeValue(valueRaw, valueDecimals) {
  if (valueRaw === null || valueRaw === undefined) return null;
  try {
    const raw = Number(valueRaw);
    if (valueDecimals === 0) return raw;
    return raw / Math.pow(10, valueDecimals);
  } catch {
    return null;
  }
}

function decodeNewFeedback(row) {
  const topics = row.topics || [];
  const sig = topics[0]?.toLowerCase();

  // Accept any event from reputation registry — we'll try to decode
  // Topic layout per spec:
  // topics[0] = event sig
  // topics[1] = indexed agentId (uint256)
  // topics[2] = indexed clientAddress (address)
  // topics[3] = indexed tag1 (string - hashed)
  // data = feedbackIndex, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash

  if (!topics[1] || !topics[2]) return null;

  const agentId = topicToBigInt(topics[1]);
  const clientAddress = topicToAddress(topics[2]);

  if (agentId === null) return null;

  // Try to decode non-indexed data
  let feedbackIndex = null;
  let valueRaw = null;
  let valueDecimals = 0;
  let tag1 = null;
  let tag2 = null;
  let endpoint = null;
  let feedbackUri = null;
  let feedbackHash = null;

  if (row.data && row.data !== "0x" && row.data !== "") {
    try {
      const decoded = abiCoder.decode(
        ["uint64", "int128", "uint8", "string", "string", "string", "string", "bytes32"],
        row.data
      );
      feedbackIndex = decoded[0];
      valueRaw = decoded[1].toString();
      valueDecimals = Number(decoded[2]);
      tag1 = decoded[3] || null;
      tag2 = decoded[4] || null;
      endpoint = decoded[5] || null;
      feedbackUri = decoded[6] || null;
      feedbackHash = decoded[7] !== "0x" + "00".repeat(32) ? decoded[7] : null;
    } catch {
      // data layout may differ — store raw agentId/client at minimum
    }
  }

  const valueNormalized = normalizeValue(valueRaw, valueDecimals);

  return {
    eventType: "NewFeedback",
    agentId,
    clientAddress,
    feedbackIndex: feedbackIndex !== null ? BigInt(feedbackIndex) : null,
    valueRaw,
    valueDecimals,
    valueNormalized,
    tag1,
    tag2,
    endpoint,
    feedbackUri,
    feedbackHash,
    txHash: row.transaction_hash,
    blockNumber: BigInt(row.block_number),
    blockTimestamp: parseTimestamp(row.block_timestamp),
  };
}

function decodeReputationLog(row) {
  const topics = row.topics || [];
  const sig = topics[0]?.toLowerCase();

  if (sig === NEW_FEEDBACK_EVENT) {
    return decodeNewFeedback(row);
  }

  // Attempt decode on any log from reputation registry that has agentId in topics[1]
  if (topics[1] && topics[2]) {
    return decodeNewFeedback(row);
  }

  return null;
}

module.exports = {
  decodeReputationLog,
  decodeNewFeedback,
  NEW_FEEDBACK_EVENT,
  FEEDBACK_REVOKED_EVENT,
};
