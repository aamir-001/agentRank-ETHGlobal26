const { ethers } = require("ethers");

let provider = null;

function getProvider() {
  if (!provider) {
    provider = process.env.ETH_RPC_URL
      ? new ethers.JsonRpcProvider(process.env.ETH_RPC_URL)
      : ethers.getDefaultProvider("mainnet");
  }
  return provider;
}

async function resolveEnsName(name) {
  if (!name) return null;
  try {
    return await getProvider().resolveName(name);
  } catch {
    return null;
  }
}

async function reverseResolveAddress(address) {
  if (!address) return null;
  try {
    return await getProvider().lookupAddress(address);
  } catch {
    return null;
  }
}

async function getEnsTextRecord(name, key) {
  if (!name) return null;
  try {
    const resolver = await getProvider().getResolver(name);
    if (!resolver) return null;
    return await resolver.getText(key);
  } catch {
    return null;
  }
}

async function getEnsTextRecords(name, keys) {
  const records = {};
  if (!name) return records;

  try {
    const resolver = await getProvider().getResolver(name);
    if (!resolver) return records;

    for (const key of keys) {
      try {
        const value = await resolver.getText(key);
        if (value) records[key] = value;
      } catch {
        // skip unreadable record
      }
    }
  } catch {
    // no resolver
  }

  return records;
}

module.exports = {
  getProvider,
  resolveEnsName,
  reverseResolveAddress,
  getEnsTextRecord,
  getEnsTextRecords,
};
