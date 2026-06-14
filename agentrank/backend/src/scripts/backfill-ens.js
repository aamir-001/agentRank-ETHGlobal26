require("dotenv").config();
const { prisma } = require("../db/prisma");
const { enrichAgentEns } = require("../ens/enrichAgentEns");
const { recomputeAllScores } = require("../scoring/computeTrustScore");

const CONCURRENCY = 10;

async function main() {
  const agents = await prisma.agent.findMany({ select: { agentId: true, name: true } });
  console.log(`Backfilling ENS data for ${agents.length} agent(s)...`);

  let verified = 0;
  let withEnsName = 0;
  let processed = 0;

  for (let i = 0; i < agents.length; i += CONCURRENCY) {
    const batch = agents.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(({ agentId }) => enrichAgentEns(agentId).catch(() => null))
    );

    results.forEach((result, idx) => {
      const { agentId, name } = batch[idx];
      processed++;
      if (result?.declaredEnsName || result?.ownerEnsName) withEnsName++;
      if (result?.ensVerified) {
        verified++;
        console.log(`  #${agentId} (${name || "unnamed"}): ENS verified, score ${result.ensScore}`);
      }
    });

    console.log(`  ...${processed}/${agents.length} processed`);
  }

  console.log("");
  console.log("--- Recomputing trust scores ---");
  await recomputeAllScores();

  console.log("");
  console.log(`Done. Agents with any ENS name: ${withEnsName}, verified: ${verified}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
