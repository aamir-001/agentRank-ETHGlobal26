const { AbiCoder } = require("ethers");

const abiCoder = AbiCoder.defaultAbiCoder();

const IDENTITY_REGISTRATION_EVENT =
  "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
const ERC721_TRANSFER_EVENT =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const METADATA_SET_EVENT =
  "0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b";
const URI_UPDATED_EVENT =
  "0x11a4a3e20f9d5e92041c5b44b50fcda78a6f5e22af2f64a2e7c1e8a1ad58e7b";

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

function decodeAbiString(data) {
  if (!data || data === "0x" || data === "") return null;
  try {
    const decoded = abiCoder.decode(["string"], data);
    return decoded[0] || null;
  } catch {
    return null;
  }
}

function parseTimestamp(raw) {
  if (!raw) return null;
  if (raw && typeof raw === "object" && raw.value) return new Date(raw.value);
  if (typeof raw === "string") return new Date(raw);
  return null;
}

function decodeIdentityRegistration(row) {
  const topics = row.topics || [];
  const sig = topics[0]?.toLowerCase();

  if (sig !== IDENTITY_REGISTRATION_EVENT) return null;

  const agentId = topicToBigInt(topics[1]);
  const ownerAddress = topicToAddress(topics[2]);
  const agentUri = decodeAbiString(row.data);

  if (agentId === null) return null;

  return {
    eventType: "Registered",
    agentId,
    ownerAddress,
    agentUri,
    identityRegistryAddress: row.address?.toLowerCase(),
    registeredTxHash: row.transaction_hash,
    registeredBlockNumber: BigInt(row.block_number),
    registeredAt: parseTimestamp(row.block_timestamp),
    logIndex: Number(row.log_index),
  };
}

function decodeTransfer(row) {
  const topics = row.topics || [];
  const sig = topics[0]?.toLowerCase();

  if (sig !== ERC721_TRANSFER_EVENT) return null;

  return {
    eventType: "Transfer",
    from: topicToAddress(topics[1]),
    to: topicToAddress(topics[2]),
    tokenId: topicToBigInt(topics[3]),
    txHash: row.transaction_hash,
    blockNumber: BigInt(row.block_number),
    blockTimestamp: parseTimestamp(row.block_timestamp),
  };
}

function decodeIdentityLog(row) {
  return decodeIdentityRegistration(row) || decodeTransfer(row);
}

module.exports = {
  decodeIdentityLog,
  decodeIdentityRegistration,
  decodeTransfer,
  IDENTITY_REGISTRATION_EVENT,
  ERC721_TRANSFER_EVENT,
  METADATA_SET_EVENT,
  URI_UPDATED_EVENT,
};
