import type {
  IncidentSummary,
  LabResetResult,
  RecoveryResult,
  RecoverySubmission,
} from "../src/domain";

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS?: AssetsBinding;
  CHECKOUT_SERVICE?: ServiceBinding;
  PAYMENT_SERVICE?: ServiceBinding;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CHECKOUT_WORKER_NAME?: string;
  PAYMENT_WORKER_NAME?: string;
  CHECKOUT_BASE_URL?: string;
  PAYMENT_BASE_URL?: string;
  CHECKOUT_BROKEN_VERSION_ID?: string;
  CHECKOUT_HEALTHY_VERSION_ID?: string;
  CHECKOUT_CONCURRENT_VERSION_ID?: string;
  PAYMENT_HEALTHY_VERSION_ID?: string;
}

interface HealthResponse {
  serviceId: "checkout" | "payment";
  status: "HEALTHY" | "DEGRADED" | "UNKNOWN";
  versionId: string;
  versionTag: string;
  checkedAt: string;
}

interface Deployment {
  id: string;
  created_on: string;
  versions: Array<{ percentage: number; version_id: string }>;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message: string }>;
}

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const inFlightRecoveries = new Map<string, Promise<RecoveryResult>>();
let inFlightLabReset: Promise<LabResetResult> | undefined;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function required(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing server configuration: ${String(key)}`);
  }
  return value;
}

async function cloudflareFetch<T>(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const cloudflareCredential = required(env, "CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${cloudflareCredential}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    },
  );
  const payload = (await response.json()) as CloudflareResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.errors?.[0]?.message ?? `Cloudflare API failed with ${response.status}`);
  }
  return payload.result;
}

async function listDeployments(env: Env, workerName: string): Promise<Deployment[]> {
  const result = await cloudflareFetch<{ deployments: Deployment[] }>(
    env,
    `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  );
  return [...result.deployments].sort(
    (left, right) => Date.parse(right.created_on) - Date.parse(left.created_on),
  );
}

function activeDeployment(deployments: Deployment[]): Deployment {
  const deployment = deployments[0];
  if (!deployment) throw new Error("No active deployment was found.");
  return deployment;
}

function activeVersion(deployment: Deployment): string {
  const version = deployment.versions.find((candidate) => candidate.percentage === 100);
  if (!version) throw new Error("No active 100% deployment was found.");
  return version.version_id;
}

async function createDeployment(
  env: Env,
  workerName: string,
  versionId: string,
  message: string,
): Promise<Deployment> {
  return cloudflareFetch<Deployment>(
    env,
    `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
    {
      method: "POST",
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
        annotations: {
          "workers/message": message,
        },
      }),
    },
  );
}

async function labFetch(
  env: Env,
  serviceId: "checkout" | "payment",
  url: URL,
  init: RequestInit,
): Promise<Response> {
  const binding = serviceId === "checkout" ? env.CHECKOUT_SERVICE : env.PAYMENT_SERVICE;
  return binding ? binding.fetch(new Request(url, init)) : fetch(url, init);
}

async function readHealth(
  env: Env,
  serviceId: "checkout" | "payment",
  baseUrl: string,
): Promise<HealthResponse> {
  const response = await labFetch(env, serviceId, new URL("/health", baseUrl), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Health endpoint returned ${response.status}`);
  return (await response.json()) as HealthResponse;
}

async function probeCheckout(env: Env, baseUrl: string): Promise<number> {
  const response = await labFetch(env, "checkout", new URL("/checkout", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cartId: "incident-room-fixed-cart", total: 42 }),
  });
  return response.status;
}

async function currentIncident(env: Env): Promise<IncidentSummary> {
  const checkoutWorker = required(env, "CHECKOUT_WORKER_NAME");
  const paymentWorker = required(env, "PAYMENT_WORKER_NAME");
  const checkoutUrl = required(env, "CHECKOUT_BASE_URL");
  const paymentUrl = required(env, "PAYMENT_BASE_URL");

  if (checkoutWorker !== "incident-room-checkout" || paymentWorker !== "incident-room-payment") {
    throw new Error("Worker allowlist mismatch.");
  }

  const [checkoutHealth, paymentHealth, checkoutDeployments, paymentDeployments] =
    await Promise.all([
      readHealth(env, "checkout", checkoutUrl),
      readHealth(env, "payment", paymentUrl),
      listDeployments(env, checkoutWorker),
      listDeployments(env, paymentWorker),
    ]);
  const checkoutDeployment = activeDeployment(checkoutDeployments);
  const paymentDeployment = activeDeployment(paymentDeployments);
  const checkoutVersion = activeVersion(checkoutDeployment);
  const paymentVersion = activeVersion(paymentDeployment);
  const allowlistedCheckoutVersions = new Set([
    required(env, "CHECKOUT_BROKEN_VERSION_ID"),
    required(env, "CHECKOUT_HEALTHY_VERSION_ID"),
    required(env, "CHECKOUT_CONCURRENT_VERSION_ID"),
  ]);
  const paymentHealthyVersion = required(env, "PAYMENT_HEALTHY_VERSION_ID");

  if (
    !allowlistedCheckoutVersions.has(checkoutVersion) ||
    checkoutHealth.versionId !== checkoutVersion
  ) {
    throw new Error("Checkout health and deployment evidence do not match the allowlist.");
  }
  if (
    paymentVersion !== paymentHealthyVersion ||
    paymentHealth.versionId !== paymentVersion
  ) {
    throw new Error("Payment health and deployment evidence do not match payment-healthy.");
  }

  return {
    incidentId: "INC-WEBMCP-001",
    title: "Checkout requests failing after deployment",
    startedAt: checkoutDeployment.created_on,
    checkedAt: new Date().toISOString(),
    affectedServices: ["checkout"],
    health: {
      checkout: checkoutHealth.status,
      payment: paymentHealth.status,
    },
    activeDeployments: {
      checkout: checkoutDeployment.id,
      payment: paymentDeployment.id,
    },
    suspectedChangeIds: [`change-${checkoutDeployment.id}`],
    evidenceGaps: ["Workers Logs are secondary evidence and are not required for this response."],
    evidenceMode: "LIVE",
  };
}

function validateSubmission(submission: RecoverySubmission): RecoveryResult | null {
  if (
    submission.incidentId !== "INC-WEBMCP-001" ||
    !["checkout", "checkout_and_payment"].includes(submission.scopeMode) ||
    submission.targetVersion !== "checkout-healthy" ||
    typeof submission.observedDeploymentId !== "string" ||
    submission.observedDeploymentId.length === 0
  ) {
    return {
      status: "INVALID_SCOPE",
      currentDeploymentId: "unknown",
      healthBefore: 0,
      message: "The submitted incident, scope, target, or observed deployment is not allowlisted.",
    };
  }
  return null;
}

async function waitForCheckoutState(
  env: Env,
  expectedVersionId: string,
  expectedStatus: 200 | 500,
): Promise<HealthResponse> {
  const checkoutUrl = required(env, "CHECKOUT_BASE_URL");
  const deadline = Date.now() + 60_000;
  let lastHealth: HealthResponse | undefined;
  while (Date.now() < deadline) {
    lastHealth = await readHealth(env, "checkout", checkoutUrl);
    const status = await probeCheckout(env, checkoutUrl);
    if (lastHealth.versionId === expectedVersionId && status === expectedStatus) return lastHealth;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(
    `Checkout state ${expectedStatus} was not verified within 60 seconds. Last version: ${lastHealth?.versionId ?? "unknown"}`,
  );
}

async function performRecovery(
  env: Env,
  submission: RecoverySubmission,
): Promise<RecoveryResult> {
  const checkoutWorker = required(env, "CHECKOUT_WORKER_NAME");
  if (checkoutWorker !== "incident-room-checkout") {
    return {
      status: "INVALID_SCOPE",
      currentDeploymentId: "unknown",
      healthBefore: 0,
      message: "Only incident-room-checkout may receive a deployment write.",
    };
  }

  const checkoutUrl = required(env, "CHECKOUT_BASE_URL");
  const healthyVersion = required(env, "CHECKOUT_HEALTHY_VERSION_ID");
  const beforeStatus = await probeCheckout(env, checkoutUrl);
  const beforeDeployments = await listDeployments(env, checkoutWorker);
  const currentDeploymentId = activeDeployment(beforeDeployments).id;

  if (currentDeploymentId !== submission.observedDeploymentId) {
    return {
      status: "PLAN_STALE",
      currentDeploymentId,
      healthBefore: beforeStatus,
      message: "The checkout deployment changed after this Recovery Plan was prepared. No rollback was written.",
    };
  }

  if (beforeStatus !== 500) {
    return {
      status: "EXECUTION_FAILED",
      currentDeploymentId,
      healthBefore: beforeStatus,
      message: "Checkout already returns 200. Start a fresh rehearsal before submitting a Recovery Plan.",
    };
  }

  const deployment = await createDeployment(
    env,
    checkoutWorker,
    healthyVersion,
    `Recovery rehearsal for ${submission.incidentId}`,
  );

  try {
    await waitForCheckoutState(env, healthyVersion, 200);
    return {
      status: "RECOVERED",
      currentDeploymentId,
      executionDeploymentId: deployment.id,
      healthBefore: beforeStatus,
      healthAfter: 200,
      message: "Checkout recovered. The fixed request changed from 500 to 200.",
    };
  } catch (error) {
    return {
      status: "ROLLBACK_UNVERIFIED",
      currentDeploymentId,
      executionDeploymentId: deployment.id,
      healthBefore: beforeStatus,
      message: error instanceof Error ? error.message : "Rollback could not be verified.",
    };
  }
}

async function performLabReset(env: Env): Promise<LabResetResult> {
  const checkoutWorker = required(env, "CHECKOUT_WORKER_NAME");
  const paymentWorker = required(env, "PAYMENT_WORKER_NAME");
  if (checkoutWorker !== "incident-room-checkout" || paymentWorker !== "incident-room-payment") {
    throw new Error("Worker allowlist mismatch.");
  }

  const brokenVersion = required(env, "CHECKOUT_BROKEN_VERSION_ID");
  const deployment = await createDeployment(
    env,
    checkoutWorker,
    brokenVersion,
    "Start fresh Incident Room rehearsal",
  );
  await waitForCheckoutState(env, brokenVersion, 500);

  const incident = await currentIncident(env);
  if (incident.health.checkout !== "DEGRADED" || incident.health.payment !== "HEALTHY") {
    throw new Error("Fresh rehearsal was not verified as checkout 500 with healthy payment.");
  }

  return {
    status: "READY",
    resetDeploymentId: deployment.id,
    checkoutVersionId: brokenVersion,
    checkoutStatus: 500,
    paymentVersionId: required(env, "PAYMENT_HEALTHY_VERSION_ID"),
    paymentHealth: "HEALTHY",
    checkedAt: incident.checkedAt,
    message: "Fresh rehearsal ready. Checkout returns 500 while payment remains healthy.",
  };
}

async function resetLab(env: Env): Promise<LabResetResult> {
  if (inFlightLabReset) return inFlightLabReset;
  inFlightLabReset = performLabReset(env);
  try {
    return await inFlightLabReset;
  } finally {
    inFlightLabReset = undefined;
  }
}

async function runRecovery(
  env: Env,
  submission: RecoverySubmission,
): Promise<RecoveryResult> {
  const invalid = validateSubmission(submission);
  if (invalid) return invalid;

  const requestKey = `${submission.incidentId}:${submission.observedDeploymentId}`;
  const existing = inFlightRecoveries.get(requestKey);
  if (existing) return existing;

  const recovery = performRecovery(env, submission);
  inFlightRecoveries.set(requestKey, recovery);
  try {
    return await recovery;
  } finally {
    if (inFlightRecoveries.get(requestKey) === recovery) {
      inFlightRecoveries.delete(requestKey);
    }
  }
}

async function createCompetingDeployment(env: Env): Promise<Response> {
  const checkoutWorker = required(env, "CHECKOUT_WORKER_NAME");
  const concurrentVersion = required(env, "CHECKOUT_CONCURRENT_VERSION_ID");
  if (checkoutWorker !== "incident-room-checkout") {
    return json({ message: "Worker allowlist mismatch." }, 403);
  }
  const deployment = await createDeployment(
    env,
    checkoutWorker,
    concurrentVersion,
    "Competing deployment for PLAN_STALE rehearsal",
  );
  return json({ deploymentId: deployment.id, versionId: concurrentVersion });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/incident/current") {
      return json(await currentIncident(env));
    }
    if (request.method === "POST" && url.pathname === "/api/recovery/rehearsal") {
      const submission = (await request.json()) as RecoverySubmission;
      return json(await runRecovery(env, submission));
    }
    if (request.method === "POST" && url.pathname === "/api/lab/reset") {
      if (request.headers.get("X-Incident-Room-Action") !== "start-rehearsal") {
        return json({ message: "Fresh rehearsal requires the same-origin human action header." }, 403);
      }
      return json(await resetLab(env));
    }
    if (request.method === "POST" && url.pathname === "/api/lab/competing-deployment") {
      return await createCompetingDeployment(env);
    }
    return json({ message: "API endpoint not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const status = message.startsWith("Missing server configuration") ? 503 : 500;
    return json({ message }, status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ message: "Static assets are not configured." }, 404);
  },
};
