-- AlterTable
ALTER TABLE "TrustScore" ADD COLUMN "ownerScore" REAL NOT NULL DEFAULT 0;
ALTER TABLE "TrustScore" ADD COLUMN "ownerVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VerifiedOwner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "nullifierHash" TEXT NOT NULL,
    "verificationLevel" TEXT,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedOwner_walletAddress_key" ON "VerifiedOwner"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedOwner_nullifierHash_key" ON "VerifiedOwner"("nullifierHash");
