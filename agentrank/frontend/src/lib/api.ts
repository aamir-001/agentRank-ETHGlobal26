const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface AgentService {
  name: string;
  endpoint: string;
  version?: string;
}

export interface TrustScore {
  score: number;
  identityScore: number;
  reputationScore: number;
  naiveReputationScore: number;
  verifiedFeedbackCount: number;
  verifiedHumanCount: number;
  paymentScore: number;
  ensScore: number;
  ownerScore: number;
  ownerVerified: boolean;
  agentKitScore: number;
  humanBacked: boolean;
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
  computedAt: string;
}

export interface EnsInfo {
  declaredEnsName: string | null;
  ownerEnsName: string | null;
  resolvedAddress: string | null;
  linked: boolean;
  verified: boolean;
  ensip25Verified: boolean;
  ensip25Key: string | null;
  score: number;
  textRecords: Record<string, string>;
  reasons: string[];
  checkedAt: string;
}

export interface EnsPassportCheck {
  key: string;
  ok: boolean;
  expected?: string | null;
  actual?: string | null;
  reason?: string;
}

export interface EnsPassportVerification {
  score: number;
  checks: EnsPassportCheck[];
}

export interface EnsPassport {
  ensName: string;
  label: string;
  parentName: string | null;
  status: "generated" | "published" | "verified" | "failed";
  records: Record<string, string>;
  verification: EnsPassportVerification | null;
  publishedAt: string | null;
  verifiedAt: string | null;
}

export interface Agent {
  agentId: string;
  name: string | null;
  description: string | null;
  image: string | null;
  ownerAddress: string | null;
  identityRegistryAddress?: string | null;
  agentUri: string | null;
  active: boolean | null;
  x402Support: boolean;
  ensName: string | null;
  webEndpoint: string | null;
  mcpEndpoint: string | null;
  a2aEndpoint: string | null;
  services: AgentService[];
  supportedTrust: string[];
  registeredAt: string | null;
  registeredTxHash: string | null;
  registeredBlockNumber: string | null;
  feedbackCount: number;
  trustScore: TrustScore | null;
  ens: EnsInfo | null;
  ensPassport: EnsPassport | null;
}

export interface FeedbackEvent {
  feedbackIndex: string | null;
  clientAddress: string | null;
  verifiedHuman: boolean;
  value: number | null;
  valueRaw: string | null;
  valueDecimals: number | null;
  tag1: string | null;
  tag2: string | null;
  isRevoked: boolean;
  blockTimestamp: string | null;
  txHash: string | null;
}

export interface AgentDetail extends Agent {
  feedbackEvents: FeedbackEvent[];
}

export interface RiskReport {
  agentId: string;
  safe: boolean;
  riskLevel: "low" | "medium" | "high";
  trustScore: number;
  identity: {
    registered: boolean;
    agentUriValid: boolean;
    metadataFetched: boolean;
    active: boolean;
    servicesFound: boolean;
  };
  payment: { x402Support: boolean };
  reputation: {
    feedbackCount: number;
    averageFeedback: number | null;
    verifiedHumanCount: number;
    verifiedFeedbackCount: number;
    humanBackedRaterCount: number;
    humanWeightedAverage: number | null;
    sybilRiskFlag: boolean;
    breakdown?: {
      quality: number;
      accountableRaters: number;
      independentSources: number;
      recency: number;
      integrity: number;
    };
  };
  ens: { declaredEnsName: string | null; ownerEnsName: string | null; verified: boolean };
  owner: { ownerAddress: string | null; verifiedHuman: boolean };
  agentKit: { humanBacked: boolean };
  scores: {
    identity: number;
    reputation: number;
    naiveReputation: number;
    ens: number;
    owner: number;
    agentKit: number;
    total: number;
  } | null;
  reasons: string[];
  recommendation: "proceed" | "review_before_calling" | "do_not_call";
}

export interface AgentsResponse {
  total: number;
  page: number;
  limit: number;
  agents: Agent[];
}

export async function fetchAgents(params: {
  q?: string;
  x402Support?: boolean;
  active?: boolean;
  ensLinked?: boolean;
  minScore?: number;
  sort?: string;
  page?: number;
  limit?: number;
}): Promise<AgentsResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.x402Support) qs.set("x402Support", "true");
  if (params.active) qs.set("active", "true");
  if (params.ensLinked) qs.set("ensLinked", "true");
  if (params.minScore !== undefined) qs.set("minScore", String(params.minScore));
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));

  const res = await fetch(`${API}/agents?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function fetchAgent(agentId: string): Promise<AgentDetail> {
  const res = await fetch(`${API}/agents/${agentId}`);
  if (!res.ok) throw new Error("Agent not found");
  return res.json();
}

export async function fetchRisk(agentId: string): Promise<RiskReport> {
  const res = await fetch(`${API}/agents/${agentId}/risk`);
  if (!res.ok) throw new Error("Failed to fetch risk report");
  return res.json();
}

export async function triggerIngest(type: "identity" | "reputation", full = false) {
  const res = await fetch(`${API}/ingest/${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full }),
  });
  if (!res.ok) throw new Error("Ingest failed");
  return res.json();
}

export async function fetchIngestStatus() {
  const res = await fetch(`${API}/ingest/status`);
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export interface ResolvedAgentProfile {
  ensName: string;
  source: string;
  agent: {
    agentId: string;
    name: string | null;
    description: string | null;
    ownerAddress: string | null;
    agentUri: string | null;
    x402Support: boolean;
    services: AgentService[];
  };
  trust: {
    trustScore: number;
    riskLevel: "low" | "medium" | "high";
    identityScore: number;
    reputationScore: number;
    paymentScore: number;
    ensScore: number;
  } | null;
  ensPassport: {
    status: string | null;
    verified: boolean;
    records: Record<string, string>;
  };
}

export interface AnalyticsResponse {
  totalAgents: number;
  totalFeedbackEvents: number;
  feedbackOverTime: { date: string; count: number; avgValue: number | null }[];
  topAgentsByReputation: {
    agentId: string;
    name: string | null;
    reputationScore: number;
    trustScore: number;
    feedbackCount: number;
    avgFeedback: number | null;
  }[];
  serviceTypes: { name: string; count: number }[];
  topOwners: {
    ownerAddress: string;
    ownerEnsName: string | null;
    verifiedHuman: boolean;
    agentCount: number;
    avgTrustScore: number;
    agentIds: string[];
  }[];
}

export async function fetchAnalytics(): Promise<AnalyticsResponse> {
  const res = await fetch(`${API}/analytics`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

export interface NetworkAnalyticsResponse {
  registryGrowth: { week: string; registrations: number }[];
  feedbackVolumeTrend: { week: string; feedbackCount: number }[];
  mostRatedAgents: { agentId: number; feedbackCount: number; name: string | null }[];
  topRatedAgents: { agentId: number; feedbackCount: number; avgScore: number; name: string | null }[];
  mostActiveRaters: {
    clientAddress: string;
    agentsRated: number;
    totalFeedbacks: number;
    firstRatingAt: string | null;
    lastRatingAt: string | null;
    verifiedHuman: boolean;
    humanBacked: boolean;
  }[];
  freshWalletPressureTrend: {
    week: string;
    totalFeedback: number;
    freshWalletFeedback: number;
    freshWalletPct: number;
  }[];
  networkHealth: {
    totalAgents: number;
    uniqueOwners: number;
    agents30d: number;
    totalFeedback: number;
    agentsWithFeedback: number;
    uniqueRaters: number;
    feedback30d: number;
    coveragePct: number;
    feedbackPerRatedAgent: number;
  } | null;
  ownerConcentration: {
    entityName: string;
    eventName: string;
    entities: number;
    totalEvents: number;
    top1SharePct: number;
    top5SharePct: number;
    top10SharePct: number;
  } | null;
  raterConcentration: {
    entityName: string;
    eventName: string;
    entities: number;
    totalEvents: number;
    top1SharePct: number;
    top5SharePct: number;
    top10SharePct: number;
  } | null;
  feedbackScoreBands: { band: string; count: number }[];
  fetchedAt: string;
  degraded?: boolean;
  reason?: string | null;
}

export async function fetchNetworkAnalytics(refresh = false): Promise<NetworkAnalyticsResponse> {
  const res = await fetch(`${API}/analytics/network${refresh ? "?refresh=1" : ""}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch network analytics");
  }
  return res.json();
}

export async function resolveEnsName(ensName: string): Promise<ResolvedAgentProfile> {
  const res = await fetch(`${API}/resolve/${encodeURIComponent(ensName)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to resolve ENS name");
  }
  return res.json();
}

// --- World ID personhood (Sybil-resistant reputation) ---

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export async function fetchRpContext(): Promise<RpContext> {
  const res = await fetch(`${API}/raters/rp-context`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch RP context");
  }
  return res.json();
}

export interface VerifyRaterResult {
  verified: boolean;
  walletAddress: string;
  nullifierHash: string;
  verificationLevel: string | null;
  action: string;
  agentsRescored: number;
}

export async function fetchRaterChallenge(walletAddress: string): Promise<string> {
  const res = await fetch(`${API}/raters/challenge/${walletAddress}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to fetch challenge");
  return body.message as string;
}

export async function verifyRater(
  walletAddress: string,
  proof: unknown,
  signature: string
): Promise<VerifyRaterResult> {
  const res = await fetch(`${API}/raters/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, proof, signature }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Verification failed");
  return body;
}

export interface RaterStatus {
  walletAddress: string;
  verifiedHuman: boolean;
  verifiedAt: string | null;
  verificationLevel: string | null;
}

export async function fetchRaterStatus(walletAddress: string): Promise<RaterStatus> {
  const res = await fetch(`${API}/raters/${walletAddress}`);
  if (!res.ok) throw new Error("Failed to fetch rater status");
  return res.json();
}

// --- World ID personhood for agent OWNERS (operator accountability axis) ---

export async function fetchOwnerRpContext(): Promise<RpContext> {
  const res = await fetch(`${API}/owners/rp-context`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch RP context");
  }
  return res.json();
}

export interface OwnerAgentDelta {
  agentId: string;
  name: string | null;
  before: number;
  after: number;
  beforeRisk: "low" | "medium" | "high";
  afterRisk: "low" | "medium" | "high";
}

export interface VerifyOwnerResult {
  verified: boolean;
  walletAddress: string;
  nullifierHash: string;
  verificationLevel: string | null;
  action: string;
  agentsRescored: number;
  agents: OwnerAgentDelta[];
}

// Fetch the one-time message the owner must sign to prove wallet control.
export async function fetchOwnerChallenge(walletAddress: string): Promise<string> {
  const res = await fetch(`${API}/owners/challenge/${walletAddress}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to fetch ownership challenge");
  return body.message as string;
}

export async function verifyOwner(
  walletAddress: string,
  proof: unknown,
  signature: string
): Promise<VerifyOwnerResult> {
  const res = await fetch(`${API}/owners/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, proof, signature }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Verification failed");
  return body;
}

export interface OwnerStatus {
  walletAddress: string;
  verifiedHuman: boolean;
  verifiedAt: string | null;
  verificationLevel: string | null;
  ownedAgentCount: number;
  agents: {
    agentId: string;
    name: string | null;
    trustScore: number;
    riskLevel: "low" | "medium" | "high";
  }[];
}

export async function fetchOwnerStatus(walletAddress: string): Promise<OwnerStatus> {
  const res = await fetch(`${API}/owners/${walletAddress}`);
  if (!res.ok) throw new Error("Failed to fetch owner status");
  return res.json();
}

// --- AgentKit: human-backed agents (Delegated World ID, one human → many agents) ---

export async function fetchAgentKitRpContext(): Promise<RpContext> {
  const res = await fetch(`${API}/agentkit/rp-context`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch RP context");
  }
  return res.json();
}

export async function fetchAgentKitChallenge(walletAddress: string): Promise<string> {
  const res = await fetch(`${API}/agentkit/challenge/${walletAddress}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to fetch challenge");
  return body.message as string;
}

export interface AgentKitAgentDelta {
  agentId: string;
  before: number;
  after: number;
  beforeRisk?: "low" | "medium" | "high";
  afterRisk: "low" | "medium" | "high";
  isSelf: boolean;
}

export interface VerifyAgentKitResult {
  verified: boolean;
  walletAddress: string;
  backingHuman: string;
  verificationLevel: string | null;
  action: string;
  agentsRescored: number;
  agents: AgentKitAgentDelta[];
}

export async function verifyAgentKit(
  walletAddress: string,
  proof: unknown,
  signature: string
): Promise<VerifyAgentKitResult> {
  const res = await fetch(`${API}/agentkit/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, proof, signature }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Verification failed");
  return body;
}

export interface AgentKitStatus {
  walletAddress: string;
  humanBacked: boolean;
  source: string | null;
  backingHuman: string | null;
  verificationLevel: string | null;
  verifiedAt: string | null;
  fleetSize: number;
}

export async function fetchAgentKitStatus(walletAddress: string): Promise<AgentKitStatus> {
  const res = await fetch(`${API}/agentkit/${walletAddress}`);
  if (!res.ok) throw new Error("Failed to fetch AgentKit status");
  return res.json();
}

// Real AgentKit: resolve the wallet against World's on-chain AgentBook via the SDK.
export interface AgentBookCheckResult {
  walletAddress: string;
  humanBacked: boolean;
  source: string;
  backingHuman?: string;
  message?: string;
  agentsRescored?: number;
  agents?: AgentKitAgentDelta[];
}

export async function checkAgentBook(walletAddress: string): Promise<AgentBookCheckResult> {
  const res = await fetch(`${API}/agentkit/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "AgentBook check failed");
  return body;
}
