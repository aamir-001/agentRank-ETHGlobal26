-- CreateTable
CREATE TABLE "Agent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" BIGINT NOT NULL,
    "identityRegistryAddress" TEXT NOT NULL,
    "ownerAddress" TEXT,
    "agentWallet" TEXT,
    "agentUri" TEXT,
    "name" TEXT,
    "description" TEXT,
    "image" TEXT,
    "active" BOOLEAN,
    "x402Support" BOOLEAN,
    "servicesJson" TEXT,
    "supportedTrustJson" TEXT,
    "rawMetadataJson" TEXT,
    "ensName" TEXT,
    "webEndpoint" TEXT,
    "mcpEndpoint" TEXT,
    "a2aEndpoint" TEXT,
    "registeredTxHash" TEXT,
    "registeredBlockNumber" BIGINT,
    "registeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FeedbackEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" BIGINT NOT NULL,
    "clientAddress" TEXT,
    "feedbackIndex" BIGINT,
    "valueRaw" TEXT,
    "valueDecimals" INTEGER,
    "valueNormalized" REAL,
    "tag1" TEXT,
    "tag2" TEXT,
    "endpoint" TEXT,
    "feedbackUri" TEXT,
    "feedbackHash" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "txHash" TEXT,
    "blockNumber" BIGINT,
    "blockTimestamp" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("agentId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrustScore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentId" BIGINT NOT NULL,
    "trustScore" REAL NOT NULL,
    "identityScore" REAL NOT NULL,
    "reputationScore" REAL NOT NULL,
    "paymentScore" REAL NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "reasonsJson" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustScore_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("agentId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionCheckpoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "lastBlockNumber" BIGINT,
    "lastTimestamp" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentId_key" ON "Agent"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustScore_agentId_key" ON "TrustScore"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionCheckpoint_source_key" ON "IngestionCheckpoint"("source");
