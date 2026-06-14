const { prisma } = require("../db/prisma");
const { getEnsTextRecords } = require("./ensClient");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");

const AGENT_TEXT_KEYS = [
  "agent.id",
  "agent.registry",
  "agent.uri",
  "agent.name",
  "agent.x402",
  "agent.endpoint.web",
  "agent.endpoint.a2a",
  "agent.endpoint.mcp",
  "agentrank.trustScore",
  "agentrank.riskLevel",
  "agentrank.profile",
  "agentrank.updatedAt",
];

async function readAgentTextRecords(ensName) {
  return getEnsTextRecords(ensName, AGENT_TEXT_KEYS);
}

async function verifyEnsPassport(ensName) {
  const textRecords = await readAgentTextRecords(ensName);

  const agentId = textRecords["agent.id"];
  const registry = textRecords["agent.registry"];

  const checks = [];
  let score = 0;

  if (!agentId) {
    checks.push({ key: "agent.id", ok: false, reason: "Missing agent.id" });
    return { ensName, verified: false, score, checks, textRecords };
  }

  const agent = await prisma.agent.findUnique({
    where: { agentId: BigInt(agentId) },
    include: { trustScore: true },
  });

  if (!agent) {
    checks.push({ key: "agent.id", ok: false, reason: "Agent not found in AgentRank index" });
    return { ensName, agentId, verified: false, score, checks, textRecords };
  }

  const expectedRegistry = `eip155:1:${agent.identityRegistryAddress.toLowerCase()}`;

  const registryOk = registry?.toLowerCase() === expectedRegistry.toLowerCase();
  checks.push({
    key: "agent.registry",
    ok: registryOk,
    expected: expectedRegistry,
    actual: registry,
  });
  if (registryOk) score += 4;

  const uriOk = textRecords["agent.uri"] === agent.agentUri;
  checks.push({
    key: "agent.uri",
    ok: uriOk,
    expected: agent.agentUri,
    actual: textRecords["agent.uri"],
  });
  if (uriOk) score += 4;

  const x402Ok = textRecords["agent.x402"] === String(Boolean(agent.x402Support));
  checks.push({
    key: "agent.x402",
    ok: x402Ok,
    expected: String(Boolean(agent.x402Support)),
    actual: textRecords["agent.x402"],
  });
  if (x402Ok) score += 2;

  const scoreOk =
    !agent.trustScore ||
    textRecords["agentrank.trustScore"] === String(Math.round(agent.trustScore.trustScore));

  checks.push({
    key: "agentrank.trustScore",
    ok: scoreOk,
    expected: agent.trustScore ? String(Math.round(agent.trustScore.trustScore)) : null,
    actual: textRecords["agentrank.trustScore"],
  });
  if (scoreOk) score += 2;

  const verified = registryOk && uriOk;

  await prisma.ensPassport.upsert({
    where: { agentId: agent.agentId },
    update: {
      ensName,
      status: verified ? "verified" : "published",
      recordsJson: JSON.stringify(textRecords),
      verificationJson: JSON.stringify({ score, checks }),
      verifiedAt: verified ? new Date() : null,
    },
    create: {
      agentId: agent.agentId,
      ensName,
      label: ensName.split(".")[0],
      status: verified ? "verified" : "published",
      recordsJson: JSON.stringify(textRecords),
      verificationJson: JSON.stringify({ score, checks }),
      verifiedAt: verified ? new Date() : null,
    },
  });

  if (verified) {
    await computeTrustScoreForAgent(agent.agentId);
  }

  return {
    ensName,
    agentId: agent.agentId.toString(),
    verified,
    score,
    checks,
    textRecords,
    agent,
  };
}

module.exports = {
  AGENT_TEXT_KEYS,
  readAgentTextRecords,
  verifyEnsPassport,
};
