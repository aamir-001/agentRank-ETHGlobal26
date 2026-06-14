-- CreateTable
CREATE TABLE "EnsRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" BIGINT NOT NULL,
    "declaredEnsName" TEXT,
    "ownerEnsName" TEXT,
    "ensResolvedAddress" TEXT,
    "ensVerified" BOOLEAN NOT NULL DEFAULT false,
    "ensScore" REAL NOT NULL DEFAULT 0,
    "textRecordsJson" TEXT,
    "reasonsJson" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EnsRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("agentId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TrustScore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" BIGINT NOT NULL,
    "trustScore" REAL NOT NULL,
    "identityScore" REAL NOT NULL,
    "reputationScore" REAL NOT NULL,
    "paymentScore" REAL NOT NULL,
    "ensScore" REAL NOT NULL DEFAULT 0,
    "riskLevel" TEXT NOT NULL,
    "reasonsJson" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustScore_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("agentId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TrustScore" ("agentId", "computedAt", "id", "identityScore", "paymentScore", "reasonsJson", "reputationScore", "riskLevel", "trustScore") SELECT "agentId", "computedAt", "id", "identityScore", "paymentScore", "reasonsJson", "reputationScore", "riskLevel", "trustScore" FROM "TrustScore";
DROP TABLE "TrustScore";
ALTER TABLE "new_TrustScore" RENAME TO "TrustScore";
CREATE UNIQUE INDEX "TrustScore_agentId_key" ON "TrustScore"("agentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EnsRecord_agentId_key" ON "EnsRecord"("agentId");
