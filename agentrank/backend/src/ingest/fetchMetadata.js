const IPFS_GATEWAYS = [
  "https://cloudflare-ipfs.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

const FETCH_TIMEOUT_MS = 8000;

function normalizeUri(uri) {
  if (!uri) return null;

  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    return IPFS_GATEWAYS.map((g) => g + cid);
  }

  if (uri.startsWith("data:application/json;base64,")) {
    return [uri];
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return [uri];
  }

  return null;
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchAgentMetadata(agentUri) {
  const urls = normalizeUri(agentUri);
  if (!urls) return null;

  // base64 data URI — decode inline
  if (urls[0].startsWith("data:application/json;base64,")) {
    try {
      const b64 = urls[0].replace("data:application/json;base64,", "");
      return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!res.ok) continue;
      const json = await res.json();
      return json;
    } catch {
      // try next gateway
    }
  }

  return null;
}

function extractKnownMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};

  const services = Array.isArray(metadata.services) ? metadata.services : [];

  const find = (name) =>
    services.find((s) => String(s.name || "").toLowerCase() === name.toLowerCase());

  const webSvc = find("web");
  const mcpSvc = find("mcp");
  const a2aSvc = find("a2a");
  const ensSvc = find("ens");

  return {
    name: metadata.name || null,
    description: metadata.description || null,
    image: metadata.image || null,
    active: typeof metadata.active === "boolean" ? metadata.active : null,
    x402Support:
      typeof metadata.x402Support === "boolean" ? metadata.x402Support : false,
    servicesJson: JSON.stringify(services),
    supportedTrustJson: JSON.stringify(
      Array.isArray(metadata.supportedTrust) ? metadata.supportedTrust : []
    ),
    rawMetadataJson: JSON.stringify(metadata),
    ensName: ensSvc?.endpoint || null,
    webEndpoint: webSvc?.endpoint || null,
    mcpEndpoint: mcpSvc?.endpoint || null,
    a2aEndpoint: a2aSvc?.endpoint || null,
  };
}

module.exports = { fetchAgentMetadata, extractKnownMetadata, normalizeUri };
