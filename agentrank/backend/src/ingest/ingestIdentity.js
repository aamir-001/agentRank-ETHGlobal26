const { runQuery } = require("../bigquery/client");
const {
  IDENTITY_REGISTRY,
  IDENTITY_LOGS,
  IDENTITY_LOGS_ALL,
} = require("../bigquery/queries");
const { decodeIdentityRegistration } = require("../decode/identityDecoder");
const { fetchAgentMetadata, extractKnownMetadata } = require("./fetchMetadata");
const { enrichAgentEns } = require("../ens/enrichAgentEns");
const { prisma } = require("../db/prisma");

async function ingestIdentity({ days = null, limit = 1000, full = false } = {}) {
  let rows;

  if (full || days === null) {
    console.log(`[identity] Querying ALL identity logs (limit ${limit})...`);
    rows = await runQuery(IDENTITY_LOGS_ALL, {
      identityRegistry: IDENTITY_REGISTRY,
      limit,
    });
  } else {
    console.log(`[identity] Querying last ${days} day(s) of identity logs (limit ${limit})...`);
    rows = await runQuery(IDENTITY_LOGS, {
      days,
      limit,
      identityRegistry: IDENTITY_REGISTRY,
    });
  }

  console.log(`[identity] Fetched ${rows.length} rows from BigQuery`);

  let decodedCount = 0;
  let upsertedCount = 0;
  let metadataCount = 0;
  let metadataFailCount = 0;

  for (const row of rows) {
    const decoded = decodeIdentityRegistration(row);
    if (!decoded) continue;

    decodedCount++;

    await prisma.agent.upsert({
      where: { agentId: decoded.agentId },
      update: {
        ownerAddress: decoded.ownerAddress,
        agentUri: decoded.agentUri,
        registeredTxHash: decoded.registeredTxHash,
        registeredBlockNumber: decoded.registeredBlockNumber,
        registeredAt: decoded.registeredAt,
        identityRegistryAddress: decoded.identityRegistryAddress,
      },
      create: {
        agentId: decoded.agentId,
        identityRegistryAddress: decoded.identityRegistryAddress,
        ownerAddress: decoded.ownerAddress,
        agentUri: decoded.agentUri,
        registeredTxHash: decoded.registeredTxHash,
        registeredBlockNumber: decoded.registeredBlockNumber,
        registeredAt: decoded.registeredAt,
      },
    });

    upsertedCount++;

    if (decoded.agentUri) {
      const metadata = await fetchAgentMetadata(decoded.agentUri);
      if (metadata) {
        const known = extractKnownMetadata(metadata);
        await prisma.agent.update({
          where: { agentId: decoded.agentId },
          data: known,
        });
        metadataCount++;
      } else {
        metadataFailCount++;
      }
    }

    await enrichAgentEns(decoded.agentId).catch(() => null);
  }

  // Update checkpoint
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    await prisma.ingestionCheckpoint.upsert({
      where: { source: "identity" },
      update: {
        lastBlockNumber: BigInt(lastRow.block_number),
        lastTimestamp: new Date(
          lastRow.block_timestamp?.value || lastRow.block_timestamp
        ),
      },
      create: {
        source: "identity",
        lastBlockNumber: BigInt(lastRow.block_number),
        lastTimestamp: new Date(
          lastRow.block_timestamp?.value || lastRow.block_timestamp
        ),
      },
    });
  }

  return {
    fetchedRows: rows.length,
    decodedRegistrations: decodedCount,
    upsertedAgents: upsertedCount,
    metadataFetched: metadataCount,
    metadataFailed: metadataFailCount,
  };
}

module.exports = { ingestIdentity };
