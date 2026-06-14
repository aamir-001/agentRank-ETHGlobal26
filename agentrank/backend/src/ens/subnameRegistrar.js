const { ethers } = require("ethers");
const { prisma } = require("../db/prisma");
const { buildEnsPassportRecords } = require("./ensPassportBuilder");
const { agentRegistrationKey } = require("./ensip25");
const { safeJson } = require("../lib/safeJson");

// On-chain ENS subname issuance — the "real" half of the ENS Passport.
//
// Instead of a self-hosted CCIP-Read offchain resolver (fiddly on testnets),
// this writes subnames + text records DIRECTLY to ENS core contracts. There is
// no gateway and no signing server to break: just `ethers` sending two
// transactions against ENS's own Registry / NameWrapper + PublicResolver, which
// are deployed on Sepolia. The parent (e.g. agentrank.eth) is owned by the
// registrar wallet; each agent gets `<label>.<parent>` resolvable in ANY ENS
// client, carrying live trust metadata and a signed trust attestation.
//
// IMPORTANT: this uses its OWN Sepolia provider/key (ENS_REGISTRAR_*). The
// global ETH_RPC_URL stays pointed at mainnet, where the ERC-8004 agents and
// their mainnet ENS reads live — we must not move that.

// ENS core contracts. Registry address is identical across networks; NameWrapper
// and PublicResolver are the Sepolia deployments. All overridable via env in
// case a network ships new addresses.
const ENS_REGISTRY =
  process.env.ENS_REGISTRY_ADDRESS || "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAME_WRAPPER =
  process.env.ENS_NAME_WRAPPER || "0x0635513f179D50A207757E05759CbD106d7dFcE8";
const PUBLIC_RESOLVER =
  process.env.ENS_PUBLIC_RESOLVER || "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD";
const EXPLORER =
  process.env.ENS_REGISTRAR_EXPLORER || "https://sepolia.etherscan.io";

const REGISTRY_ABI = [
  "function owner(bytes32 node) view returns (address)",
  "function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)",
];

const NAME_WRAPPER_ABI = [
  "function ownerOf(uint256 id) view returns (address)",
  "function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry) returns (bytes32)",
];

const RESOLVER_ABI = [
  "function setText(bytes32 node, string key, string value)",
  "function setAddr(bytes32 node, address a)",
  "function multicall(bytes[] data) returns (bytes[] results)",
];

// EIP-712 attestation: a portable, offline-verifiable trust credential stored in
// the `agentrank.attestation` text record. Anyone can resolve the name, read the
// record, and recover the signer — proving the trust score came from AgentRank
// WITHOUT calling our API or trusting our server at read time.
const ATTESTATION_TYPES = {
  TrustAttestation: [
    { name: "agentId", type: "uint256" },
    { name: "trustScore", type: "uint16" },
    { name: "riskLevel", type: "string" },
    { name: "verifiedHuman", type: "bool" },
    { name: "ownerVerified", type: "bool" },
    { name: "issuedAt", type: "uint256" },
  ],
};

function registrarChainId() {
  return Number(process.env.ENS_REGISTRAR_CHAIN_ID || 11155111); // Sepolia
}

function attestationDomain() {
  return { name: "AgentRank", version: "1", chainId: registrarChainId() };
}

// Build the registrar signer from its dedicated Sepolia env. Throws a clear,
// actionable error when not configured so the route can surface it.
function registrarSigner() {
  const rpc = process.env.ENS_REGISTRAR_RPC_URL;
  const pk = process.env.ENS_REGISTRAR_PRIVATE_KEY;
  if (!rpc) {
    throw new Error(
      "ENS_REGISTRAR_RPC_URL is not set (Sepolia RPC for on-chain subname issuance)"
    );
  }
  if (!pk) {
    throw new Error(
      "ENS_REGISTRAR_PRIVATE_KEY is not set (wallet that owns the parent ENS name)"
    );
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  return { provider, wallet };
}

function isConfigured() {
  return !!(process.env.ENS_REGISTRAR_RPC_URL && process.env.ENS_REGISTRAR_PRIVATE_KEY);
}

// Sign the trust attestation for an agent with the registrar key.
async function signTrustAttestation(wallet, agent) {
  const ts = agent.trustScore;
  const value = {
    agentId: agent.agentId.toString(),
    trustScore: ts ? Math.round(ts.trustScore) : 0,
    riskLevel: ts ? ts.riskLevel : "high",
    verifiedHuman: !!(ts && ts.verifiedHumanCount > 0),
    ownerVerified: !!(ts && ts.ownerVerified),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const signature = await wallet.signTypedData(
    attestationDomain(),
    ATTESTATION_TYPES,
    value
  );
  return { domain: attestationDomain(), value, signature, signer: wallet.address };
}

// Recover and validate an attestation offline. Returns { valid, signer, value }.
function verifyTrustAttestation(attestation) {
  if (!attestation || !attestation.value || !attestation.signature) {
    return { valid: false, reason: "Malformed attestation" };
  }
  let signer;
  try {
    signer = ethers.verifyTypedData(
      attestation.domain || attestationDomain(),
      ATTESTATION_TYPES,
      attestation.value,
      attestation.signature
    );
  } catch (err) {
    return { valid: false, reason: `Recovery failed: ${err.message}` };
  }
  const expected = (process.env.ENS_ATTESTATION_SIGNER || attestation.signer || "").toLowerCase();
  const valid = !expected || signer.toLowerCase() === expected;
  return { valid, signer, expected: expected || null, value: attestation.value };
}

/**
 * Publish an agent's ENS Passport on-chain: create `<label>.<parent>` as a real
 * subname and write its text records (agent metadata + live trust score + the
 * ENSIP-25 attestation record + the signed trust credential).
 *
 * Auto-detects whether the parent is held in the NameWrapper (the default when a
 * .eth name is registered via the ENS app today) or directly in the Registry,
 * and uses the matching write path. Returns tx hashes + explorer links.
 */
async function publishSubnameOnchain(agentId) {
  const { wallet } = registrarSigner();

  const agent = await prisma.agent.findUnique({
    where: { agentId: BigInt(agentId) },
    include: { trustScore: true },
  });
  if (!agent) throw new Error("Agent not found");

  // Sepolia parent may differ from the mainnet passport parent — allow override.
  const parentName =
    process.env.ENS_REGISTRAR_PARENT_NAME || process.env.ENS_PARENT_NAME || "agentrank.eth";

  // Reuse the existing passport label (kept unique) when present; otherwise slug.
  const existing = await prisma.ensPassport.findUnique({
    where: { agentId: agent.agentId },
  });
  const { slugifyAgentName } = require("./ensPassportBuilder");
  const label = existing?.label || slugifyAgentName(agent.name, agent.agentId);
  const ensName = `${label}.${parentName}`;

  const parentNode = ethers.namehash(parentName);
  const labelhash = ethers.id(label);
  const node = ethers.namehash(ensName);

  // --- 1. Create the subname, owned by the registrar so it can set records ---
  const registry = new ethers.Contract(ENS_REGISTRY, REGISTRY_ABI, wallet);
  const parentOwner = await registry.owner(parentNode);

  let createTx;
  if (parentOwner.toLowerCase() === NAME_WRAPPER.toLowerCase()) {
    // Wrapped parent: issue via NameWrapper (fuses=0, expiry=0 → no fuses burned).
    const nw = new ethers.Contract(NAME_WRAPPER, NAME_WRAPPER_ABI, wallet);
    createTx = await nw.setSubnodeRecord(
      parentNode,
      label,
      wallet.address,
      PUBLIC_RESOLVER,
      0,
      0,
      0
    );
  } else if (parentOwner.toLowerCase() === wallet.address.toLowerCase()) {
    // Unwrapped parent held directly in the Registry.
    createTx = await registry.setSubnodeRecord(
      parentNode,
      labelhash,
      wallet.address,
      PUBLIC_RESOLVER,
      0
    );
  } else {
    throw new Error(
      `Registrar wallet ${wallet.address} does not control ${parentName} ` +
        `(on-chain owner is ${parentOwner}). Transfer the name (or its manager) ` +
        `to the registrar wallet, or unwrap it.`
    );
  }
  const createReceipt = await createTx.wait();

  // --- 2. Build records and write them in a single multicall ---
  const baseUrl = process.env.PUBLIC_APP_URL || "https://agentrank.xyz";
  const records = buildEnsPassportRecords(agent, agent.trustScore, baseUrl);

  // ENSIP-25 bidirectional attestation record — setting this on the name we
  // control completes the ENS side of the proof, so the agent auto-qualifies as
  // ENSIP-25 verified on the next ENS enrichment pass.
  const registryAddr =
    agent.identityRegistryAddress || "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
  records[agentRegistrationKey(registryAddr, agent.agentId)] = "1";

  // Portable, offline-verifiable trust credential (the "creative" layer).
  const attestation = await signTrustAttestation(wallet, agent);
  records["agentrank.attestation"] = JSON.stringify(attestation);

  const resolver = new ethers.Contract(PUBLIC_RESOLVER, RESOLVER_ABI, wallet);
  const calls = [];
  if (agent.ownerAddress) {
    calls.push(
      resolver.interface.encodeFunctionData("setAddr", [node, agent.ownerAddress])
    );
  }
  for (const [key, val] of Object.entries(records)) {
    if (val === undefined || val === null || val === "") continue;
    calls.push(
      resolver.interface.encodeFunctionData("setText", [node, key, String(val)])
    );
  }
  const writeTx = await resolver.multicall(calls);
  const writeReceipt = await writeTx.wait();

  // --- 3. Persist published state ---
  await prisma.ensPassport.upsert({
    where: { agentId: agent.agentId },
    update: {
      ensName,
      label,
      parentName,
      status: "published",
      recordsJson: JSON.stringify(records),
      txHash: writeReceipt.hash,
      publishedAt: new Date(),
    },
    create: {
      agentId: agent.agentId,
      ensName,
      label,
      parentName,
      status: "published",
      recordsJson: JSON.stringify(records),
      txHash: writeReceipt.hash,
      publishedAt: new Date(),
    },
  });

  return {
    agentId: agent.agentId.toString(),
    ensName,
    parentName,
    label,
    wrapped: parentOwner.toLowerCase() === NAME_WRAPPER.toLowerCase(),
    records,
    attestation,
    createTxHash: createReceipt.hash,
    txHash: writeReceipt.hash,
    explorer: {
      create: `${EXPLORER}/tx/${createReceipt.hash}`,
      records: `${EXPLORER}/tx/${writeReceipt.hash}`,
      name: `https://sepolia.app.ens.domains/${ensName}`,
    },
  };
}

// Read the stored attestation for an agent (from the published passport records)
// and validate its signature offline.
async function getAgentAttestation(agentId) {
  const passport = await prisma.ensPassport.findUnique({
    where: { agentId: BigInt(agentId) },
  });
  if (!passport) return null;
  const records = safeJson(passport.recordsJson, {});
  const raw = records["agentrank.attestation"];
  if (!raw) return null;
  const attestation = safeJson(raw, null);
  if (!attestation) return null;
  return { ensName: passport.ensName, attestation, verification: verifyTrustAttestation(attestation) };
}

module.exports = {
  publishSubnameOnchain,
  signTrustAttestation,
  verifyTrustAttestation,
  getAgentAttestation,
  isConfigured,
  registrarChainId,
};
