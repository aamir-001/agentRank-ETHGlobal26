const { keccak256, toUtf8Bytes, getBytes } = require("ethers");

// World ID cloud verification.
//
// We accept the payload exactly as IDKit hands it to the frontend and forward
// it to the World ID verify API, so proofs are checked by Worldcoin's
// infrastructure — never trusted client-side. Supports both the legacy 3.0
// ISuccessResult shape ({ proof, merkle_root, nullifier_hash,
// verification_level }) via /api/v2/verify and the 4.0 request payload via
// /api/v4/verify.

const APP_ID = process.env.WORLD_ID_APP_ID || "";
// Two distinct World ID actions, two distinct trust axes:
//   - RATER_ACTION  → a wallet that POSTS feedback is a unique human
//   - OWNER_ACTION  → the wallet that OWNS an agent is a unique human
// The nullifier is unique per (human, action), so the same person can verify
// one rater wallet AND one owner wallet without collision — but cannot register
// two wallets within the same axis. Each action is its own Sybil boundary.
const RATER_ACTION = process.env.WORLD_ID_ACTION || "agentrank-rater";
const OWNER_ACTION = process.env.WORLD_ID_OWNER_ACTION || "agentrank-owner";
// AgentKit "human-backed agent" action (Delegated World ID). Unlike the rater
// and owner actions, this one is ONE human → MANY agents: it must be configured
// in the World portal to allow unlimited verifications per person, so the same
// human can back a fleet. The nullifier is identical across that human's agents
// (deterministic per human+action) — that is exactly the backing-human key we
// cluster on.
const AGENT_ACTION = process.env.WORLD_ID_AGENT_ACTION || "agentrank-agent";
// Back-compat alias: existing callers import { ACTION } expecting the rater one.
const ACTION = RATER_ACTION;

function apiBase() {
  if (process.env.WORLD_ID_API_BASE) return process.env.WORLD_ID_API_BASE;
  // Staging app ids verify against the staging deployment.
  if (APP_ID.startsWith("app_staging_")) {
    return "https://staging-developer.worldcoin.org";
  }
  return "https://developer.world.org";
}

// Worldcoin hashToField: keccak256(bytes) >> 8, hex-encoded to 32 bytes.
// Mirrors @worldcoin/idkit-core hashSignal exactly: a 0x-prefixed even-length
// hex string (e.g. a wallet address) is hashed as raw bytes, anything else as
// UTF-8 text.
function hashSignal(signal) {
  const isHex =
    /^0x[0-9a-fA-F]+$/.test(signal) && (signal.length - 2) % 2 === 0;
  const bytes = isHex ? getBytes(signal) : toUtf8Bytes(signal);
  const hash = BigInt(keccak256(bytes)) >> 8n;
  return "0x" + hash.toString(16).padStart(64, "0");
}

function isLegacyResult(p) {
  return !!(p && p.proof && p.merkle_root && p.nullifier_hash);
}

/**
 * Verify a World ID proof bound to `signal` (the wallet address being
 * verified) for a given `action` (rater or owner). Returns
 * { success, nullifierHash, verificationLevel, raw } or throws with a
 * human-readable message on verification failure.
 */
async function verifyWorldIdProof(payload, signal, action = RATER_ACTION) {
  if (!APP_ID) {
    throw new Error("WORLD_ID_APP_ID is not configured on the server");
  }

  let url;
  let body;

  if (isLegacyResult(payload)) {
    // Legacy 3.0 cloud verify
    url = `${apiBase()}/api/v2/verify/${APP_ID}`;
    body = {
      nullifier_hash: payload.nullifier_hash,
      merkle_root: payload.merkle_root,
      proof: payload.proof,
      verification_level: payload.verification_level || "orb",
      action,
      signal_hash: hashSignal(signal),
    };
  } else {
    // 4.0 (or 3.0-shaped) IDKitResult — forward as-is, enforce our action.
    // The proof itself commits to the signal hash, so before trusting the
    // verification we require every credential response to be bound to OUR
    // signal (the rater's wallet). Without this check a valid proof generated
    // for one wallet could be replayed to verify a different one.
    const expected = hashSignal(signal);
    const responses = Array.isArray(payload.responses) ? payload.responses : [];
    if (responses.length === 0) {
      throw new Error("Proof payload has no credential responses");
    }
    for (const r of responses) {
      if (!r.signal_hash || r.signal_hash.toLowerCase() !== expected.toLowerCase()) {
        const err = new Error(
          "Proof signal does not match the wallet being verified"
        );
        err.code = "signal_mismatch";
        throw err;
      }
    }
    url = `${apiBase()}/api/v4/verify/${APP_ID}`;
    body = { ...payload, action };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.success !== true) {
    const detail = data.detail || data.code || `HTTP ${res.status}`;
    const err = new Error(`World ID verification failed: ${detail}`);
    err.code = data.code || "verification_failed";
    throw err;
  }

  return {
    success: true,
    nullifierHash: data.nullifier_hash || data.nullifier || payload.nullifier_hash,
    verificationLevel:
      payload.verification_level || data.verification_level || null,
    raw: data,
  };
}

module.exports = {
  verifyWorldIdProof,
  hashSignal,
  ACTION,
  RATER_ACTION,
  OWNER_ACTION,
  AGENT_ACTION,
};
