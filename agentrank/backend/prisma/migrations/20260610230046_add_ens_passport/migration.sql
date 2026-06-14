-- CreateTable
CREATE TABLE "EnsPassport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" BIGINT NOT NULL,
    "ensName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "recordsJson" TEXT,
    "verificationJson" TEXT,
    "txHash" TEXT,
    "publishedAt" DATETIME,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EnsPassport_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("agentId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EnsPassport_agentId_key" ON "EnsPassport"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "EnsPassport_ensName_key" ON "EnsPassport"("ensName");
