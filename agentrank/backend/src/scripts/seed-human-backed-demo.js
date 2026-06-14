// Preview helper: mark a few demo agents as AgentKit human-backed so the
// "Backed by real human" badge is visible on the dashboard WITHOUT an Orb scan.
// This only writes HumanBackedAgent rows (+ a couple of demo agents) — it does
// not touch real ingested agents. Reverse it any time with `--undo`.
//
//   node src/scripts/seed-human-backed-demo.js          # add preview rows
//   node src/scripts/seed-human-backed-demo.js --undo   # remove them

require("dotenv").config();
const { prisma } = require("../db/prisma");
const { computeTrustScoreForAgent } = require("../scoring/computeTrustScore");

const IDENTITY_REGISTRY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

// Demo agents to show the badge on. agentId 999000001 is the existing owner-demo
// agent (its wallet was seeded by seed-demo-agent.js). The other two are
// preview-only agents with synthetic wallets. The two share one backing human
// to also illustrate a "fleet" (one person, many agents).
const ROWS = [
  { agentId: 999000001n, wallet: null, backing: "demo-human-A", name: null }, // uses existing agent.agentWallet
  { agentId: 999000002n, wallet: "0xdead000000000000000000000000000000000a02", backing: "demo-human-B", name: "Demo Agent · Human-Backed" },
  { agentId: 999000003n, wallet: "0xdead000000000000000000000000000000000a03", backing: "demo-human-B", name: "Demo Agent · Same Human" },
];

async function ensureDemoAgent(agentId, wallet, name) {
  await prisma.agent.upsert({
    where: { agentId },
    update: { agentWallet: wallet },
    create: {
      agentId,
      identityRegistryAddress: IDENTITY_REGISTRY,
      ownerAddress: wallet,
      agentWallet: wallet,
      agentUri: "https://agentrank.xyz/demo/agent.json",
      name,
      description: "Preview agent demonstrating the AgentKit human-backed badge.",
      active: true,
      x402Support: true,
      servicesJson: JSON.stringify([{ name: "web", endpoint: "https://agentrank.xyz/demo" }]),
      supportedTrustJson: JSON.stringify(["reputation"]),
      rawMetadataJson: "{}",
      registeredAt: new Date(),
    },
  });
}

async function main() {
  const undo = process.argv.includes("--undo");

  for (const row of ROWS) {
    // Resolve the agent's wallet (existing agent for the first row).
    let wallet = row.wallet;
    if (!wallet) {
      const a = await prisma.agent.findUnique({ where: { agentId: row.agentId } });
      wallet = a?.agentWallet ? a.agentWallet.toLowerCase() : null;
      if (!wallet) {
        console.log(`skip #${row.agentId}: no agentWallet (run seed-demo-agent.js first)`);
        continue;
      }
    } else {
      wallet = wallet.toLowerCase();
      if (row.agentId !== 999000001n) await ensureDemoAgent(row.agentId, wallet, row.name);
    }

    if (undo) {
      await prisma.humanBackedAgent.deleteMany({ where: { walletAddress: wallet } });
    } else {
      await prisma.humanBackedAgent.upsert({
        where: { walletAddress: wallet },
        update: { backingHuman: row.backing, verificationLevel: "orb" },
        create: { walletAddress: wallet, backingHuman: row.backing, verificationLevel: "orb" },
      });
    }

    const res = await computeTrustScoreForAgent(row.agentId);
    console.log(
      `#${row.agentId} ${undo ? "un-backed" : "human-backed"} -> trust ${res.trustScore} (${res.riskLevel}), humanBacked=${res.humanBacked}`
    );
  }

  console.log(undo ? "Preview rows removed." : "Preview rows added — check the dashboard.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
