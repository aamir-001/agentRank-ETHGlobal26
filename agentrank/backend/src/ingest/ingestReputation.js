const { runQuery } = require("../bigquery/client");
const {
  REPUTATION_REGISTRY,
  REPUTATION_LOGS,
  REPUTATION_LOGS_ALL,
} = require("../bigquery/queries");
const { decodeReputationLog } = require("../decode/reputationDecoder");
const { prisma } = require("../db/prisma");

async function ingestReputation({ days = null, limit = 2000, full = false } = {}) {
  let rows;

  if (full || days === null) {
    console.log(`[reputation] Querying ALL reputation logs (limit ${limit})...`);
    rows = await runQuery(REPUTATION_LOGS_ALL, {
      reputationRegistry: REPUTATION_REGISTRY,
      limit,
    });
  } else {
    console.log(
      `[reputation] Querying last ${days} day(s) of reputation logs (limit ${limit})...`
    );
    rows = await runQuery(REPUTATION_LOGS, {
      days,
      limit,
      reputationRegistry: REPUTATION_REGISTRY,
    });
  }

  console.log(`[reputation] Fetched ${rows.length} rows from BigQuery`);

  // Log unique event signatures for debugging
  const sigs = new Set(rows.map((r) => r.topics?.[0]).filter(Boolean));
  console.log(`[reputation] Unique event signatures found:`, [...sigs]);

  let decodedCount = 0;
  let storedCount = 0;

  for (const row of rows) {
    const decoded = decodeReputationLog(row);
    if (!decoded) continue;

    decodedCount++;

    // Only store feedback if agent exists in our DB
    const agent = await prisma.agent.findUnique({
      where: { agentId: decoded.agentId },
    });
    if (!agent) continue;

    // Upsert by txHash + agentId to avoid duplicates
    const existing = decoded.txHash
      ? await prisma.feedbackEvent.findFirst({
          where: { txHash: decoded.txHash, agentId: decoded.agentId },
        })
      : null;

    if (!existing) {
      await prisma.feedbackEvent.create({
        data: {
          agentId: decoded.agentId,
          clientAddress: decoded.clientAddress,
          feedbackIndex: decoded.feedbackIndex,
          valueRaw: decoded.valueRaw,
          valueDecimals: decoded.valueDecimals,
          valueNormalized: decoded.valueNormalized,
          tag1: decoded.tag1,
          tag2: decoded.tag2,
          endpoint: decoded.endpoint,
          feedbackUri: decoded.feedbackUri,
          feedbackHash: decoded.feedbackHash,
          txHash: decoded.txHash,
          blockNumber: decoded.blockNumber,
          blockTimestamp: decoded.blockTimestamp,
        },
      });
      storedCount++;
    }
  }

  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    await prisma.ingestionCheckpoint.upsert({
      where: { source: "reputation" },
      update: {
        lastBlockNumber: BigInt(lastRow.block_number),
        lastTimestamp: new Date(
          lastRow.block_timestamp?.value || lastRow.block_timestamp
        ),
      },
      create: {
        source: "reputation",
        lastBlockNumber: BigInt(lastRow.block_number),
        lastTimestamp: new Date(
          lastRow.block_timestamp?.value || lastRow.block_timestamp
        ),
      },
    });
  }

  return {
    fetchedRows: rows.length,
    decodedEvents: decodedCount,
    storedFeedback: storedCount,
  };
}

module.exports = { ingestReputation };
