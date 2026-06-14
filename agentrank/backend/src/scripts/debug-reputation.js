require("dotenv").config();
const { runQuery } = require("../bigquery/client");
const { REPUTATION_REGISTRY, REPUTATION_LOGS } = require("../bigquery/queries");
const { decodeReputationLog } = require("../decode/reputationDecoder");
const { prisma } = require("../db/prisma");

async function main() {
  const rows = await runQuery(REPUTATION_LOGS, {
    days: 30,
    limit: 20,
    reputationRegistry: REPUTATION_REGISTRY,
  });

  for (const row of rows.slice(0, 10)) {
    const decoded = decodeReputationLog(row);
    console.log({
      agentId: decoded?.agentId?.toString(),
      client: decoded?.clientAddress,
      value: decoded?.valueRaw,
      decimals: decoded?.valueDecimals,
      normalized: decoded?.valueNormalized,
      tag1: decoded?.tag1,
      tag2: decoded?.tag2,
    });
  }

  const agentIds = await prisma.agent.findMany({ select: { agentId: true } });
  console.log("Our agent IDs:", agentIds.map((a) => a.agentId.toString()));

  await prisma.$disconnect();
}

main().catch(console.error);
