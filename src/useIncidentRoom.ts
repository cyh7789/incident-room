import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCurrentIncident,
  fetchIncidentWithFixture,
  startFreshRehearsal as requestFreshRehearsal,
  submitRecovery,
} from "./api";
import {
  FIXTURE_INCIDENT,
  changeForIncident,
  planStateForResult,
  type ChangeComparison,
  type IncidentSummary,
  type PlanActivity,
  type RecoveryPlan,
  type RecoveryResult,
  type RecoverySubmission,
  type RemediationPath,
  type RemediationProposal,
  type ServiceId,
} from "./domain";

function createInitialPlan(
  observedDeploymentId = FIXTURE_INCIDENT.activeDeployments.checkout,
): RecoveryPlan {
  return {
    scopeMode: "checkout_and_payment",
    targetVersion: "checkout-healthy",
    reason: "Rehearse the smallest rollback that restores the fixed checkout request.",
    observedDeploymentId,
    state: "EMPTY",
    activities: [],
  };
}

type ActionSource = "AGENT" | "HUMAN";

function upsertActivity(activities: PlanActivity[], activity: PlanActivity): PlanActivity[] {
  const index = activities.findIndex((candidate) => candidate.id === activity.id);
  if (index === -1) return [...activities, activity];
  return activities.map((candidate, candidateIndex) =>
    candidateIndex === index ? activity : candidate,
  );
}

function scopeDetail(scopeMode: RecoveryPlan["scopeMode"]): string {
  return scopeMode === "checkout"
    ? "Scope narrowed to checkout only; healthy payment is excluded."
    : "Initial scope includes checkout and payment for human review.";
}

export function useIncidentRoom() {
  const [incident, setIncident] = useState<IncidentSummary>(FIXTURE_INCIDENT);
  const incidentRef = useRef(incident);
  const [selectedService, setSelectedService] = useState<ServiceId>("checkout");
  const [selectedChange, setSelectedChange] = useState<ChangeComparison | null>(null);
  const [plan, setPlan] = useState<RecoveryPlan>(() => createInitialPlan());
  const planRef = useRef(plan);
  const [remediation, setRemediation] = useState<RemediationProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labResetError, setLabResetError] = useState<string | null>(null);
  const [isIncidentLoading, setIsIncidentLoading] = useState(true);
  const [isLabResetting, setIsLabResetting] = useState(false);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    let active = true;
    void fetchIncidentWithFixture().then((nextIncident) => {
      if (!active) return;
      incidentRef.current = nextIncident;
      setIncident(nextIncident);
      setPlan((current) => ({
        ...current,
        observedDeploymentId: nextIncident.activeDeployments.checkout,
      }));
      setIsIncidentLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const inspectCurrentIncident = useCallback(async (
    _sinceMinutes?: number,
    source: ActionSource = "HUMAN",
  ) => {
    setError(null);
    const nextIncident = await fetchIncidentWithFixture();
    incidentRef.current = nextIncident;
    setIncident(nextIncident);
    setSelectedService("checkout");
    setPlan((current) => {
      const preserveVerifiedRecovery =
        current.state === "RECOVERED" && nextIncident.health.checkout === "HEALTHY";
      const nextPlan: RecoveryPlan = {
        ...current,
        observedDeploymentId: preserveVerifiedRecovery
          ? current.observedDeploymentId
          : nextIncident.activeDeployments.checkout,
        state: preserveVerifiedRecovery ? "RECOVERED" : "EVIDENCE_READY",
        result: preserveVerifiedRecovery ? current.result : undefined,
        activities: upsertActivity(current.activities, {
        id: `${source.toLowerCase()}-inspected`,
        actor: source,
        title: `${source === "AGENT" ? "Agent" : "Human"} refreshed incident evidence`,
        detail: `Checkout is ${nextIncident.health.checkout.toLowerCase()} while payment is ${nextIncident.health.payment.toLowerCase()}.`,
        }),
      };
      planRef.current = nextPlan;
      return nextPlan;
    });
    return nextIncident;
  }, []);

  const selectService = useCallback((serviceId: ServiceId) => {
    setSelectedService(serviceId);
  }, []);

  const showChangeComparison = useCallback(async (
    changeId: string,
    source: ActionSource = "HUMAN",
  ) => {
    const currentIncident = incidentRef.current;
    if (!currentIncident.suspectedChangeIds.includes(changeId)) {
      throw new Error("The requested change is not part of this incident.");
    }
    const comparison = changeForIncident(currentIncident);
    setSelectedService(comparison.serviceId);
    setSelectedChange(comparison);
    setPlan((current) => ({
      ...current,
      state: "EVIDENCE_READY",
      activities: upsertActivity(current.activities, {
        id: `${source.toLowerCase()}-opened-change`,
        actor: source,
        title: `${source === "AGENT" ? "Agent" : "Human"} opened deployment evidence`,
        detail: "The fixed checkout response changed from 200 to 500.",
      }),
    }));
    return comparison;
  }, []);

  const updateRecoveryDraft = useCallback((patch: Partial<RecoveryPlan>) => {
    setPlan((current) => {
      const next = { ...current, ...patch };
      if (patch.state !== "HUMAN_EDITED") return next;
      return {
        ...next,
        activities: upsertActivity(current.activities, {
          id: "human-edited-plan",
          actor: "HUMAN",
          title: "Human edited the Recovery Plan",
          detail: scopeDetail(next.scopeMode),
        }),
      };
    });
  }, []);

  const markDraftedByAgent = useCallback((patch: Partial<RecoveryPlan>) => {
    setPlan((current) => {
      const next = { ...current, ...patch, state: "DRAFTED" as const };
      return {
        ...next,
        activities: upsertActivity(current.activities, {
          id: "agent-prepared-plan",
          actor: "AGENT",
          title: "Agent prepared the Recovery Plan",
          detail: scopeDetail(next.scopeMode),
        }),
      };
    });
  }, []);

  const markDraftCancelledByAgent = useCallback(() => {
    setPlan((current) => ({
      ...current,
      state: "EVIDENCE_READY",
      activities: upsertActivity(current.activities, {
        id: "agent-cancelled-plan",
        actor: "AGENT",
        title: "Agent cancelled the prepared draft",
        detail: "No recovery request was submitted and no deployment write occurred.",
      }),
    }));
  }, []);

  const startFreshRehearsal = useCallback(async () => {
    setLabResetError(null);
    setIsLabResetting(true);
    try {
      const reset = await requestFreshRehearsal();
      const nextIncident = await fetchCurrentIncident();
      incidentRef.current = nextIncident;
      setIncident(nextIncident);
      setSelectedService("checkout");
      setSelectedChange(null);
      setRemediation(null);
      setPlan({
        ...createInitialPlan(nextIncident.activeDeployments.checkout),
        state: "EVIDENCE_READY",
        activities: [
          {
            id: `fresh-rehearsal-${reset.resetDeploymentId}`,
            actor: "SYSTEM",
            title: "Fresh rehearsal verified",
            detail: `Checkout returned ${reset.checkoutStatus}; payment remained ${reset.paymentHealth.toLowerCase()}.`,
          },
        ],
      });
      return reset;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Fresh rehearsal could not start.";
      setLabResetError(message);
      throw reason;
    } finally {
      setIsLabResetting(false);
    }
  }, []);

  const submitRecoveryRehearsal = useCallback(
    async (submission: RecoverySubmission): Promise<RecoveryResult> => {
      setError(null);
      setRemediation(null);
      setPlan((current) => ({
        ...current,
        state: "SUBMITTING",
        result: undefined,
        activities: upsertActivity(current.activities, {
          id: `human-submitted-${submission.observedDeploymentId}`,
          actor: "HUMAN",
          title: "Human submitted this page state",
          detail: `${scopeDetail(submission.scopeMode)} Baseline ${submission.observedDeploymentId}.`,
        }),
      }));
      try {
        const result = await submitRecovery(submission);
        setPlan((current) => {
          const nextPlan: RecoveryPlan = {
            ...current,
            state: planStateForResult(result.status),
            result,
            activities: upsertActivity(current.activities, {
            id: `${result.status.toLowerCase()}-${result.executionDeploymentId ?? result.currentDeploymentId}`,
            actor: "SYSTEM",
            title: result.status === "RECOVERED" ? "Recovery verified" : result.status,
            detail:
              result.status === "RECOVERED"
                ? `The fixed checkout request changed from ${result.healthBefore} to ${result.healthAfter}; deployment ${result.executionDeploymentId}.`
                : result.message,
            }),
          };
          planRef.current = nextPlan;
          return nextPlan;
        });
        if (result.status === "RECOVERED") {
          try {
            const nextIncident = await fetchCurrentIncident();
            incidentRef.current = nextIncident;
            setIncident(nextIncident);
          } catch {
            // The verified recovery remains authoritative if the follow-up read is temporarily unavailable.
          }
        }
        return result;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Recovery request failed.";
        setError(message);
        setPlan((current) => ({ ...current, state: "FAILED" }));
        throw reason;
      }
    },
    [],
  );

  const proposeRemediationOptions = useCallback((proposal: Omit<RemediationProposal, "state" | "selectedPath">) => {
    const currentPlan = planRef.current;
    if (currentPlan.state !== "RECOVERED" || currentPlan.result?.status !== "RECOVERED") {
      throw new Error("Recovery must be verified before remediation options can be proposed.");
    }
    if (proposal.regressedDeploymentId !== currentPlan.result.currentDeploymentId) {
      throw new Error("The remediation proposal does not match the verified regressed deployment.");
    }

    const nextProposal: RemediationProposal = {
      ...proposal,
      state: "PROPOSED",
    };
    setRemediation(nextProposal);
    setPlan((current) => ({
      ...current,
      activities: upsertActivity(current.activities, {
        id: `agent-proposed-remediation-${proposal.regressedDeploymentId}`,
        actor: "AGENT",
        title: "Agent proposed permanent-fix options",
        detail: `Recommended ${proposal.recommendedPath.toLowerCase().replaceAll("_", " ")}; no issue, PR, or deployment was created.`,
      }),
    }));
    return nextProposal;
  }, []);

  const getVerifiedRecovery = useCallback(() => {
    const currentPlan = planRef.current;
    return currentPlan.state === "RECOVERED" && currentPlan.result?.status === "RECOVERED"
      ? currentPlan.result
      : undefined;
  }, []);

  const selectRemediationPath = useCallback((selectedPath: RemediationPath) => {
    setRemediation((current) => {
      if (!current) return current;
      return { ...current, selectedPath, state: "SELECTED" };
    });
    setPlan((current) => ({
      ...current,
      activities: upsertActivity(current.activities, {
        id: "human-selected-remediation",
        actor: "HUMAN",
        title: "Human selected the follow-up path",
        detail: `${selectedPath.toLowerCase().replaceAll("_", " ")} was recorded on this page only.`,
      }),
    }));
  }, []);

  const actions = useMemo(
    () => ({
      inspectCurrentIncident,
      selectService,
      showChangeComparison,
      updateRecoveryDraft,
      markDraftedByAgent,
      markDraftCancelledByAgent,
      getVerifiedRecovery,
      proposeRemediationOptions,
      selectRemediationPath,
      startFreshRehearsal,
      submitRecoveryRehearsal,
    }),
    [
      inspectCurrentIncident,
      markDraftCancelledByAgent,
      markDraftedByAgent,
      getVerifiedRecovery,
      proposeRemediationOptions,
      selectService,
      selectRemediationPath,
      showChangeComparison,
      startFreshRehearsal,
      submitRecoveryRehearsal,
      updateRecoveryDraft,
    ],
  );

  return {
    incident,
    selectedService,
    selectedChange,
    plan,
    remediation,
    error,
    labResetError,
    isIncidentLoading,
    isLabResetting,
    actions,
  };
}
