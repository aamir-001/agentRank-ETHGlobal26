// Real AgentKit integration — resolves an agent's human backing against the
// canonical AgentBook registry on World Chain via the official SDK.
//
//   lookupHuman(agentWallet) -> anonymous backing-human id (string) | null
//
// This is the genuine "is this agent backed by a unique human?" determination:
// AgentBook is World's on-chain registry of delegated-World-ID agents. Reading
// it needs no credentials — just a World Chain RPC (the SDK defaults to the
// public one; override with WORLD_CHAIN_RPC_URL). The returned id is anonymous
// (never the human's identity) and is stable per backing human, so it doubles
// as our Sybil cluster key (one person's fleet shares one id).
const { createAgentBookVerifier } = require("@worldcoin/agentkit-core");

let verifier = null;
function getVerifier() {
  if (!verifier) {
    verifier = createAgentBookVerifier(
      process.env.WORLD_CHAIN_RPC_URL
        ? { rpcUrl: process.env.WORLD_CHAIN_RPC_URL }
        : undefined
    );
  }
  return verifier;
}

/**
 * Resolve the anonymous backing-human id for an agent wallet from AgentBook.
 * Returns null if the agent is not human-backed, or if the on-chain read fails
 * (so callers degrade gracefully rather than throwing in the scoring path).
 * @param {string} walletAddress agent wallet (0x…)
 * @returns {Promise<string|null>}
 */
async function lookupBackingHuman(walletAddress) {
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return null;
  try {
    const human = await getVerifier().lookupHuman(walletAddress);
    return human || null;
  } catch (err) {
    console.error("[agentBook] lookupHuman failed:", err.message);
    return null;
  }
}

module.exports = { lookupBackingHuman };
