// Seed a demo agent owned by a given wallet, so the owner-verification flow has
// something to lift. The World ID + signature verification stays 100% real;
// only this sample agent's ownership record is seeded (you don't own a real
// mainnet ERC-8004 agent to demo with).
//
//   node src/scripts/seed-demo-agent.js 0xYourWalletAddress
//
// Identity components score to 45 (medium); after you verify ownership the +10
// owner-personhood bonus lifts it to 55 (low) — a clean medium→low demo.

require("dotenv").config();
const { prisma } = require("../db/prisma");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");

const IDENTITY_REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const DEMO_AGENT_ID = 999000001n;

async function main() {
  const walletArg = process.argv[2];
  if (!walletArg || !/^0x[0-9a-fA-F]{40}$/.test(walletArg)) {
    console.error("Usage: node src/scripts/seed-demo-agent.js 0xYourWalletAddress");
    process.exit(1);
  }
  const owner = walletArg.toLowerCase();

  await prisma.agent.upsert({
    where: { agentId: DEMO_AGENT_ID },
    update: { ownerAddress: owner, agentWallet: owner },
    create: {
      agentId: DEMO_AGENT_ID,
      identityRegistryAddress: IDENTITY_REGISTRY,
      ownerAddress: owner,
      // Same wallet as the agent's own wallet for the demo, so a single
      // connect+sign+World ID run can demo BOTH owner verification and AgentKit
      // human-backing against the wallet you control.
      agentWallet: owner,
      agentUri: "https://agentrank.xyz/demo/agent.json",
      name: "AgentRank Demo Agent",
      description:
        "Demo agent for the owner-verification flow. Owned by the connected wallet so the World ID personhood bonus is visible.",
      active: true,
      x402Support: true,
      servicesJson: JSON.stringify([
        { name: "web", endpoint: "https://agentrank.xyz/demo" },
      ]),
      supportedTrustJson: JSON.stringify(["reputation"]),
      rawMetadataJson: "{}",
      registeredAt: new Date(),
    },
  });

  const score = await computeTrustScoreForAgent(DEMO_AGENT_ID);
  console.log(`Seeded demo agent #${DEMO_AGENT_ID} owned by ${owner}`);
  console.log(
    `Baseline trust: ${score.trustScore} (${score.riskLevel}) · ownerVerified: ${score.ownerVerified}`
  );
  console.log(
    "After you verify ownership of this wallet, it should rise by +10 (owner personhood)."
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
