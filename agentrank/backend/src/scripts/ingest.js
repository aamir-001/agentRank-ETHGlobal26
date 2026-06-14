require("dotenv").config();
const { ingestIdentity } = require("../ingest/ingestIdentity");
const { ingestReputation } = require("../ingest/ingestReputation");
const { recomputeAllScores } = require("../scoring/computeTrustScore");
const { prisma } = require("../db/prisma");

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const days = args.includes("--days")
    ? parseInt(args[args.indexOf("--days") + 1])
    : null;
  const limit = args.includes("--limit")
    ? parseInt(args[args.indexOf("--limit") + 1])
    : 1000;

  console.log("=== AgentRank Ingestion ===");
  console.log(`Mode: ${full ? "full sync" : days ? `last ${days} days` : "all"}`);
  console.log(`Limit: ${limit}`);
  console.log("");

  // Step 1: Identity
  console.log("--- Step 1: Identity Registry ---");
  const identityResult = await ingestIdentity({ days, limit, full });
  console.log("Identity result:", identityResult);
  console.log("");

  // Step 2: Reputation
  console.log("--- Step 2: Reputation Registry ---");
  const reputationResult = await ingestReputation({ days, limit: limit * 2, full });
  console.log("Reputation result:", reputationResult);
  console.log("");

  // Step 3: Scores
  console.log("--- Step 3: Computing Trust Scores ---");
  const scoreResult = await recomputeAllScores();
  console.log("Score result:", scoreResult);
  console.log("");

  // Summary
  const agentCount = await prisma.agent.count();
  const withScore = await prisma.trustScore.count();
  const withMetadata = await prisma.agent.count({ where: { rawMetadataJson: { not: null } } });
  const x402Count = await prisma.agent.count({ where: { x402Support: true } });

  console.log("=== Summary ===");
  console.log(`Total agents:       ${agentCount}`);
  console.log(`With trust scores:  ${withScore}`);
  console.log(`With metadata:      ${withMetadata}`);
  console.log(`x402 supported:     ${x402Count}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
