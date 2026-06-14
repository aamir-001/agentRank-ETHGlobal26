const { getEnsTextRecord } = require("./ensClient");

// ENSIP-25: Verifiable AI Agent Identity with ENS.
// An ENS name owner attests an ERC-8004 agent by setting the text record
//   agent-registration[<erc7930-registry>][<agentId>] = "1" (any non-empty value)
// Verification is bidirectional: the agent's on-chain metadata must claim the
// ENS name (registry side) AND the name must carry this record (ENS side).

// ERC-8004 agents in this index live on Ethereum mainnet.
const DEFAULT_CHAIN_ID = 1;

// Build an ERC-7930 interoperable address for an EVM (eip155) chain + address:
//   0x0001 | chainType(0x0000) | chainRefLen | chainRef | addrLen | address
// e.g. chainId 1 + 0x8004…432 -> 0x000100000101148004…432 (matches the ENSIP-25 spec example).
function erc7930InteropAddress(chainId, address) {
  const addr = address.toLowerCase().replace(/^0x/, "");
  let chainRef = chainId.toString(16);
  if (chainRef.length % 2) chainRef = "0" + chainRef;
  const chainRefLen = (chainRef.length / 2).toString(16).padStart(2, "0");
  const addrLen = (addr.length / 2).toString(16).padStart(2, "0");
  return "0x0001" + "0000" + chainRefLen + chainRef + addrLen + addr;
}

function agentRegistrationKey(registryAddress, agentId, chainId = DEFAULT_CHAIN_ID) {
  const reg = erc7930InteropAddress(chainId, registryAddress);
  return `agent-registration[${reg}][${agentId.toString()}]`;
}

// Read the ENSIP-25 attestation from a name. Returns { key, value, present }.
// `present` (record set to a non-empty value) is the ENS-side half of the proof.
async function checkEnsip25(ensName, registryAddress, agentId, chainId = DEFAULT_CHAIN_ID) {
  const key = agentRegistrationKey(registryAddress, agentId, chainId);
  if (!ensName) return { key, value: null, present: false };
  const value = await getEnsTextRecord(ensName, key);
  return { key, value: value || null, present: !!value };
}

module.exports = {
  erc7930InteropAddress,
  agentRegistrationKey,
  checkEnsip25,
  DEFAULT_CHAIN_ID,
};
