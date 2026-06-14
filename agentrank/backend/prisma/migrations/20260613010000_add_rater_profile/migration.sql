-- CreateTable
CREATE TABLE "RaterProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletAddress" TEXT NOT NULL,
    "agentsRated" INTEGER,
    "totalFeedbacks" INTEGER,
    "firstRatingAt" DATETIME,
    "lastRatingAt" DATETIME,
    "firstSeen" DATETIME,
    "lifetimeTxsSent" INTEGER,
    "distinctCounterparties" INTEGER,
    "funder" TEXT,
    "firstFundedAt" DATETIME,
    "clusterKey" TEXT,
    "raterWeight" REAL,
    "flagsJson" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "RaterProfile_walletAddress_key" ON "RaterProfile"("walletAddress");
