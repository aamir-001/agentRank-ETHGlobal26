const { prisma } = require("../db/prisma");
const {
  resolveEnsName,
  reverseResolveAddress,
  getEnsTextRecords,
} = require("./ensClient");
const { checkEnsip25 } = require("./ensip25");

const TEXT_RECORD_KEYS = [
  "url",
  "description",
  "avatar",
  "com.twitter",
  "com.github",
  "agent.id",
  "agent.registry",
  "agent.uri",
  "agent.x402",
  "agent.endpoint.web",
  "agent.endpoint.mcp",
  "agent.supportedTrust",
];

const MAX_ENS_SCORE = 20;
const ENS_LINKED_THRESHOLD = 5;
const ENS_VERIFIED_THRESHOLD = 10;

// ENS is a trust *bonus* on top of ERC-8004, not a hard requirement.
// Agents without any ENS presence simply score 0 here.
async function enrichAgentEns(agentId) {
  const agent = await prisma.agent.findUnique({ where: { agentId } });
  if (!agent) return null;

  const reasons = [];
  let score = 0;

  let ownerEnsName = null;
  let ensResolvedAddress = null;
  let textRecords = {};
  let ensip25Verified = false;
  let ensip25Key = null;

  const declaredEnsName = agent.ensName || null;

  try {
    // --- Tier 1: ENS Linked (+5) — owner wallet has an ENS identity ---
    if (agent.ownerAddress) {
      ownerEnsName = await reverseResolveAddress(agent.ownerAddress);
      if (ownerEnsName) {
        score += 5;
        reasons.push(`Owner address reverse-resolves to ENS name ${ownerEnsName}`);
      }
    }

    if (declaredEnsName) {
      reasons.push(`Agent metadata declares ENS name ${declaredEnsName}`);

      // --- Tier 2: heuristic verified (+5) — the declared name genuinely
      // belongs to the owner (forward-resolves to it or reverse record matches) ---
      ensResolvedAddress = await resolveEnsName(declaredEnsName);
      const resolvesToOwner =
        ensResolvedAddress &&
        agent.ownerAddress &&
        ensResolvedAddress.toLowerCase() === agent.ownerAddress.toLowerCase();
      const reverseMatches =
        ownerEnsName && ownerEnsName.toLowerCase() === declaredEnsName.toLowerCase();
      if (resolvesToOwner || reverseMatches) {
        score += 5;
        reasons.push(
          resolvesToOwner
            ? `${declaredEnsName} resolves to the agent owner address`
            : `Owner reverse-resolution matches declared ENS name`
        );
      }

      textRecords = await getEnsTextRecords(declaredEnsName, TEXT_RECORD_KEYS);

      // --- Tier 3: ENSIP-25 canonical bidirectional verification (+10) ---
      // Registry side: metadata declares the name (above). ENS side: the name
      // carries the agent-registration[<erc7930-registry>][<agentId>] record.
      const ensip25 = await checkEnsip25(
        declaredEnsName,
        agent.identityRegistryAddress,
        agent.agentId
      );
      ensip25Key = ensip25.key;
      if (ensip25.present) {
        ensip25Verified = true;
        score += 10;
        reasons.push(
          `ENSIP-25 verified: ${declaredEnsName} sets ${ensip25.key} — bidirectional attestation with the ERC-8004 registry`
        );
      } else {
        reasons.push(`No ENSIP-25 agent-registration record on ${declaredEnsName}`);
      }
    } else {
      reasons.push("No ENS name declared in agent metadata");
    }
  } catch (err) {
    reasons.push(`ENS lookup error: ${err.message}`);
  }

  score = Math.min(MAX_ENS_SCORE, score);
  // ENSIP-25 is the strongest proof, so it counts as verified regardless of the
  // numeric heuristic; otherwise fall back to the score threshold.
  const ensVerified = ensip25Verified || score >= ENS_VERIFIED_THRESHOLD;

  const data = {
    declaredEnsName,
    ownerEnsName,
    ensResolvedAddress,
    ensVerified,
    ensip25Verified,
    ensip25Key,
    ensScore: score,
    textRecordsJson: JSON.stringify(textRecords),
    reasonsJson: JSON.stringify(reasons),
  };

  await prisma.ensRecord.upsert({
    where: { agentId },
    update: { ...data, checkedAt: new Date() },
    create: { agentId, ...data },
  });

  return { ...data, textRecords, reasons };
}

module.exports = {
  enrichAgentEns,
  TEXT_RECORD_KEYS,
  MAX_ENS_SCORE,
  ENS_LINKED_THRESHOLD,
  ENS_VERIFIED_THRESHOLD,
};
