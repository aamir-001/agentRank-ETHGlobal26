-- AlterTable
ALTER TABLE "TrustScore" ADD COLUMN "agentKitScore" REAL NOT NULL DEFAULT 0;
ALTER TABLE "TrustScore" ADD COLUMN "humanBacked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "HumanBackedAgent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "backingHuman" TEXT NOT NULL,
    "verificationLevel" TEXT,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "HumanBackedAgent_walletAddress_key" ON "HumanBackedAgent"("walletAddress");

-- CreateIndex
CREATE INDEX "HumanBackedAgent_backingHuman_idx" ON "HumanBackedAgent"("backingHuman");
