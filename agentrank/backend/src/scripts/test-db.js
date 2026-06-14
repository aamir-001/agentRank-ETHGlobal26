require("dotenv").config();
const { prisma } = require("../db/prisma");

async function main() {
  const count = await prisma.agent.count();
  console.log("DB OK — agent count:", count);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("DB error:", e.message); process.exit(1); });
