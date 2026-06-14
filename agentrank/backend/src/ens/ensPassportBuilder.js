const { prisma } = require("../db/prisma");
const { safeJson } = require("../lib/safeJson");

function slugifyAgentName(name, agentId) {
  if (!name) return `agent-${agentId.toString()}`;

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `agent-${agentId.toString()}`
  );
}

function buildEnsPassportRecords(agent, trustScore, baseUrl) {
  const services = safeJson(agent.servicesJson, []);

  const web = services.find((s) => String(s.name).toLowerCase() === "web");
  const a2a = services.find((s) => String(s.name).toLowerCase() === "a2a");
  const mcp = services.find((s) => String(s.name).toLowerCase() === "mcp");

  const records = {
    "agent.id": agent.agentId.toString(),
    "agent.registry": `eip155:1:${agent.identityRegistryAddress}`,
    "agent.uri": agent.agentUri || "",
    "agent.name": agent.name || `Agent ${agent.agentId.toString()}`,
    "agent.x402": String(Boolean(agent.x402Support)),
    "agentrank.profile": `${baseUrl}/agents/${agent.agentId.toString()}`,
  };

  if (agent.ownerAddress) records["agent.owner"] = agent.ownerAddress;
  if (agent.description) records["agent.description"] = agent.description.slice(0, 240);
  if (agent.image) records["agent.image"] = agent.image;

  if (web?.endpoint) records["agent.endpoint.web"] = web.endpoint;
  if (a2a?.endpoint) records["agent.endpoint.a2a"] = a2a.endpoint;
  if (mcp?.endpoint) records["agent.endpoint.mcp"] = mcp.endpoint;

  const supportedTrust = safeJson(agent.supportedTrustJson, null);
  if (supportedTrust && supportedTrust.length > 0) {
    records["agent.supportedTrust"] = supportedTrust.join(",");
  }

  if (trustScore) {
    records["agentrank.trustScore"] = String(Math.round(trustScore.trustScore));
    records["agentrank.riskLevel"] = trustScore.riskLevel;
    records["agentrank.updatedAt"] = new Date().toISOString();
  }

  return records;
}

async function buildEnsPassport(agentId) {
  const agent = await prisma.agent.findUnique({
    where: { agentId: BigInt(agentId) },
    include: { trustScore: true },
  });

  if (!agent) throw new Error("Agent not found");

  const parentName = process.env.ENS_PARENT_NAME || "agentrank.eth";
  const baseUrl = process.env.PUBLIC_APP_URL || "https://agentrank.xyz";
  const records = buildEnsPassportRecords(agent, agent.trustScore, baseUrl);

  // Slug subnames must be unique. If another agent already claimed this slug,
  // disambiguate with the agentId so the name stays deterministic and unique.
  let label = slugifyAgentName(agent.name, agent.agentId);
  const collision = await prisma.ensPassport.findUnique({
    where: { ensName: `${label}.${parentName}` },
  });
  if (collision && collision.agentId !== agent.agentId) {
    label = `${label}-${agent.agentId.toString()}`;
  }
  const ensName = `${label}.${parentName}`;

  await prisma.ensPassport.upsert({
    where: { agentId: agent.agentId },
    update: {
      ensName,
      label,
      parentName,
      recordsJson: JSON.stringify(records),
    },
    create: {
      agentId: agent.agentId,
      ensName,
      label,
      parentName,
      status: "generated",
      recordsJson: JSON.stringify(records),
    },
  });

  return {
    agentId: agent.agentId.toString(),
    ensName,
    label,
    parentName,
    records,
  };
}

module.exports = {
  slugifyAgentName,
  buildEnsPassportRecords,
  buildEnsPassport,
};
