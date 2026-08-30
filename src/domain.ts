export type ServiceId = "checkout" | "payment";
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNKNOWN";
export type EvidenceMode = "LIVE" | "FIXTURE";
export type ScopeMode = "checkout" | "checkout_and_payment";
export type PlanState =
  | "EMPTY"
  | "EVIDENCE_READY"
  | "DRAFTED"
  | "HUMAN_EDITED"
  | "SUBMITTING"
  | "STALE"
  | "RECOVERED"
  | "FAILED";

export type PlanActivityActor = "AGENT" | "HUMAN" | "SYSTEM";

export interface PlanActivity {
  id: string;
  actor: PlanActivityActor;
  title: string;
  detail: string;
}

export interface IncidentSummary {
  incidentId: string;
  title: string;
  startedAt: string;
  checkedAt: string;
  affectedServices: ServiceId[];
  health: Record<ServiceId, HealthStatus>;
  activeDeployments: Record<ServiceId, string>;
  suspectedChangeIds: string[];
  evidenceGaps: string[];
  evidenceMode: EvidenceMode;
}

export interface LabResetResult {
  status: "READY";
  resetDeploymentId: string;
  checkoutVersionId: string;
  checkoutStatus: 500;
  paymentVersionId: string;
  paymentHealth: "HEALTHY";
  checkedAt: string;
  message: string;
}

export interface ChangeComparison {
  changeId: string;
  serviceId: ServiceId;
  currentVersion: string;
  targetVersion: "checkout-healthy";
  summary: string;
  changedFields: string[];
}

export interface RecoverySubmission {
  incidentId: string;
  scopeMode: ScopeMode;
  targetVersion: "checkout-healthy";
  observedDeploymentId: string;
  reason: string;
}

export type RecoveryStatus =
  | "RECOVERED"
  | "PLAN_STALE"
  | "INVALID_SCOPE"
  | "EXECUTION_FAILED"
  | "ROLLBACK_UNVERIFIED";

export interface RecoveryResult {
  status: RecoveryStatus;
  currentDeploymentId: string;
  executionDeploymentId?: string;
  healthBefore: number;
  healthAfter?: number;
  message: string;
}

export interface RecoveryPlan {
  scopeMode: ScopeMode;
  targetVersion: "checkout-healthy";
  reason: string;
  observedDeploymentId: string;
  state: PlanState;
  result?: RecoveryResult;
  activities: PlanActivity[];
}

export const FIXTURE_INCIDENT: IncidentSummary = {
  incidentId: "INC-WEBMCP-001",
  title: "Checkout requests failing after deployment",
  startedAt: "2026-08-30T18:42:00+08:00",
  checkedAt: "2026-08-30T18:42:00+08:00",
  affectedServices: ["checkout"],
  health: {
    checkout: "DEGRADED",
    payment: "HEALTHY",
  },
  activeDeployments: {
    checkout: "fixture-checkout-broken",
    payment: "fixture-payment-healthy",
  },
  suspectedChangeIds: ["change-checkout-broken"],
  evidenceGaps: ["Live Cloudflare lab is not configured in this environment."],
  evidenceMode: "FIXTURE",
};

export function changeForIncident(incident: IncidentSummary): ChangeComparison {
  return {
    changeId: incident.suspectedChangeIds[0] ?? "change-checkout-broken",
    serviceId: "checkout",
    currentVersion: incident.activeDeployments.checkout,
    targetVersion: "checkout-healthy",
    summary: "The checkout deployment changed the fixed cart response from 200 to 500.",
    changedFields: ["response status: 200 → 500", "version tag: healthy → broken"],
  };
}

export function planStateForResult(status: RecoveryStatus): PlanState {
  if (status === "RECOVERED") return "RECOVERED";
  if (status === "PLAN_STALE") return "STALE";
  return "FAILED";
}
