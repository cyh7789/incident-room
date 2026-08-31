import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  BookOpen,
  CheckCircle2,
  CircleDot,
  Cloud,
  GitCompareArrows,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  IncidentSummary,
  RecoveryPlan,
  RecoveryResult,
  ScopeMode,
  ServiceId,
} from "./domain";
import { useIncidentRoom } from "./useIncidentRoom";
import { useWebMcpTools } from "./webmcp";
import type { WebMcpStatus } from "./webmcp";

interface AgentSubmitEvent extends SubmitEvent {
  agentInvoked?: boolean;
  respondWith?: (result: Promise<RecoveryResult>) => void;
}

interface ToolWindowEvent extends Event {
  toolName?: string;
}

const formToolAttributes = {
  toolname: "prepare_recovery_rehearsal",
  tooldescription:
    "Prepare a recovery rehearsal in the visible page for a human to review, edit, and submit.",
} as Record<string, string>;

const scopeToolAttributes = {
  toolparamdescription:
    "Choose checkout and payment for the initial proposal, or checkout for the smallest recovery scope.",
} as Record<string, string>;

const targetToolAttributes = {
  toolparamdescription: "Choose the allowlisted healthy checkout version.",
} as Record<string, string>;

const reasonToolAttributes = {
  toolparamdescription: "Explain why this recovery scope is appropriate.",
} as Record<string, string>;

function StatePill({ state }: { state: RecoveryPlan["state"] }) {
  return <span className={`state-pill state-${state.toLowerCase()}`}>{state.replace("_", " ")}</span>;
}

function HealthPill({ status }: { status: "HEALTHY" | "DEGRADED" | "UNKNOWN" }) {
  return (
    <span className={`health-pill health-${status.toLowerCase()}`}>
      <CircleDot aria-hidden="true" size={14} />
      {status}
    </span>
  );
}

function ServiceButton({
  serviceId,
  selected,
  status,
  deployment,
  onSelect,
}: {
  serviceId: ServiceId;
  selected: boolean;
  status: "HEALTHY" | "DEGRADED" | "UNKNOWN";
  deployment: string;
  onSelect: (serviceId: ServiceId) => void;
}) {
  return (
    <button
      type="button"
      className={`service-node ${selected ? "is-selected" : ""}`}
      aria-label={`${serviceId} ${deployment} ${status}`}
      aria-pressed={selected}
      onClick={() => onSelect(serviceId)}
    >
      <span>
        <strong>{serviceId}</strong>
        <small>{deployment}</small>
      </span>
      <HealthPill status={status} />
    </button>
  );
}

type GuidedStep = 1 | 2 | 3 | 4;
type GettingStartedTab = "use" | "install";

interface GuidedHumanAction {
  title: string;
  detail: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}

const guidedSteps: Array<{
  id: GuidedStep;
  label: string;
  detail: string;
  icon: ReactNode;
  surfaceCue: string;
  surfaceName: string;
  surfaceKind: string;
  surfaceDetail: string;
}> = [
  {
    id: 1,
    label: "Observe",
    detail: "Live 500",
    icon: <Activity aria-hidden="true" size={18} />,
    surfaceCue: "Next agent call",
    surfaceName: "inspect_current_incident",
    surfaceKind: "Read only",
    surfaceDetail: "Reads live health and deployment IDs, then focuses checkout on this page.",
  },
  {
    id: 2,
    label: "Diagnose",
    detail: "Compare change",
    icon: <GitCompareArrows aria-hidden="true" size={18} />,
    surfaceCue: "Next agent call",
    surfaceName: "show_change_comparison",
    surfaceKind: "Read only",
    surfaceDetail: "Uses the suspected change ID and renders the deployment comparison here.",
  },
  {
    id: 3,
    label: "Approve",
    detail: "Human decides",
    icon: <UserRound aria-hidden="true" size={18} />,
    surfaceCue: "Shared page handoff",
    surfaceName: "prepare_recovery_rehearsal",
    surfaceKind: "Declarative form · human submit",
    surfaceDetail: "The agent fills the mounted plan. The human changes scope and personally submits it.",
  },
  {
    id: 4,
    label: "Verify",
    detail: "Prove 500 → 200",
    icon: <ShieldCheck aria-hidden="true" size={18} />,
    surfaceCue: "Synchronous proof",
    surfaceName: "Controller response",
    surfaceKind: "No agent write tool",
    surfaceDetail: "The form response proves PLAN_STALE with no write, or the same request changing from 500 to 200.",
  },
];

function GuidedProgress({
  activeStep,
  availableStep,
  state,
  webMcpStatus,
  humanAction,
  onStepChange,
}: {
  activeStep: GuidedStep;
  availableStep: GuidedStep;
  state: RecoveryPlan["state"];
  webMcpStatus: WebMcpStatus;
  humanAction: GuidedHumanAction;
  onStepChange: (step: GuidedStep) => void;
}) {
  const activeSurface = guidedSteps[activeStep - 1];
  const status = state === "STALE"
    ? {
        mode: "blocked",
        title: "Stopped before rollback write",
        detail: "PLAN_STALE protected the changed deployment. Refresh the evidence, revise the same page, then submit again.",
      }
    : state === "RECOVERED"
      ? {
          mode: "success",
          title: "Recovery proved by the same checkout request",
          detail: "The Controller wrote the rollback only after approval, then verified the fixed request changed from 500 to 200.",
        }
      : state === "FAILED"
        ? {
            mode: "blocked",
            title: "Recovery request failed before verification",
            detail: "The Controller did not return verified recovery proof. No successful rollback is claimed.",
          }
        : state === "SUBMITTING"
          ? {
              mode: "active",
              title: "Controller is checking the approved page state",
              detail: "The deployment stale gate runs before any rollback write.",
            }
          : state === "DRAFTED"
            ? {
                mode: "active",
                title: "Agent draft is visible in this tab",
                detail: "The shared Recovery Plan stays mounted for the human decision.",
              }
            : state === "HUMAN_EDITED"
              ? {
                  mode: "active",
                  title: "Human changed the shared page state",
                  detail: "Only the scope and reason visible here can cross the write gate.",
                }
              : {
                  mode: "idle",
                  title: "Follow one causal path",
                  detail: "Observe the live failure, diagnose the change, approve the smallest plan, then verify the same request.",
                };

  return (
    <section
      id="live-incident-track"
      className={`guided-progress guided-${status.mode}`}
      aria-labelledby="guided-title"
    >
      <div className="guided-progress-heading">
        <div>
          <p className="eyebrow">Live incident track</p>
          <h2 id="guided-title">500 observed → change found → human approval → 200 verified</h2>
        </div>
        <div className="guided-heading-status">
          <span className={`guided-webmcp-status webmcp-${webMcpStatus.toLowerCase()}`}>
            <CircleDot aria-hidden="true" size={12} /> WebMCP {webMcpStatus.toLowerCase()}
          </span>
          <span className="guided-count">Step {activeStep} of 4</span>
        </div>
      </div>
      <ol className="guided-stepper" aria-label="Recovery rehearsal steps">
        {guidedSteps.map((step) => {
          const isCurrent = activeStep === step.id;
          const isComplete = step.id < activeStep || state === "RECOVERED";
          const isAvailable = step.id <= availableStep;
          return (
            <li key={step.id} className={`${isCurrent ? "is-current" : ""} ${isComplete ? "is-complete" : ""}`}>
              <button
                type="button"
                onClick={() => onStepChange(step.id)}
                disabled={!isAvailable}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Step ${step.id}: ${step.label}. ${step.detail}. ${step.surfaceCue}: ${step.surfaceName}`}
              >
                <span className="guided-step-icon">
                  {isComplete ? <CheckCircle2 aria-hidden="true" size={18} /> : step.icon}
                </span>
                <span className="guided-step-copy">
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                  <code>{step.surfaceName}</code>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="guided-human-action" aria-label="Human next action">
        <div className="guided-action-copy" role="status" aria-live="polite" aria-atomic="true">
          <span><UserRound aria-hidden="true" size={14} /> Human next action</span>
          <strong>{humanAction.title}</strong>
          <p>{humanAction.detail}</p>
        </div>
        <button
          type="button"
          className="primary-button guided-action-button"
          onClick={() => {
            if (!humanAction.busy) humanAction.onClick();
          }}
          disabled={humanAction.disabled}
          aria-disabled={humanAction.busy || undefined}
        >
          {humanAction.icon}
          {humanAction.label}
          {!humanAction.disabled && !humanAction.busy && <ArrowRight aria-hidden="true" size={17} />}
        </button>
      </div>
      <div className="guided-handoff-grid">
        <div className="guided-surface-handoff" aria-label="Current WebMCP handoff">
          <div className="guided-surface-heading">
            <span>{activeSurface.surfaceCue}</span>
            <small>{activeSurface.surfaceKind}</small>
          </div>
          <div className="guided-surface-name">
            {activeStep < 4 ? <Bot aria-hidden="true" size={16} /> : <ShieldCheck aria-hidden="true" size={16} />}
            <code>{activeSurface.surfaceName}</code>
          </div>
          <p>{activeSurface.surfaceDetail}</p>
        </div>
        <div className="guided-live-status" role="status" aria-live="polite">
          <span aria-hidden="true" />
          <div><strong>{status.title}</strong><p>{status.detail}</p></div>
        </div>
      </div>
    </section>
  );
}

function formatCheckedAt(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function EvidenceConnection({
  incident,
  planState,
  isLoading,
  isResetting,
  resetError,
}: {
  incident: IncidentSummary;
  planState: RecoveryPlan["state"];
  isLoading: boolean;
  isResetting: boolean;
  resetError: string | null;
}) {
  const isRecovered = planState === "RECOVERED";
  const isFixture = incident.evidenceMode === "FIXTURE";
  const isSelfHosted = !isFixture && incident.evidenceSource.mode === "SELF_HOSTED";
  const isReady =
    !isRecovered && incident.evidenceMode === "LIVE" && incident.health.checkout === "DEGRADED";
  const status = isLoading
    ? "Connecting"
    : isResetting
      ? "Preparing checkout 500"
      : isRecovered
        ? "Recovered · restart to replay"
        : isReady
        ? "Ready · checkout 500"
        : incident.evidenceMode === "LIVE"
          ? "Recovered · restart to replay"
          : "Local fixture only";

  return (
    <section className="evidence-source" aria-labelledby="evidence-source-title">
      <div className="evidence-source-heading">
        <div>
          <p className="eyebrow">Connected evidence</p>
          <h2 id="evidence-source-title">{incident.evidenceSource.label}</h2>
        </div>
        <span className={`source-state ${isReady ? "is-ready" : ""}`}>
          <CircleDot aria-hidden="true" size={14} /> {status}
        </span>
      </div>

      <div className="evidence-source-facts">
        <div>
          <Cloud aria-hidden="true" size={19} />
          <div>
            <small>Data owner</small>
            <strong>
              {isFixture
                ? "Browser-only sample"
                : isSelfHosted
                  ? "Configured Cloudflare account"
                  : "App-owned sandbox"}
            </strong>
            <p>
              <span>
                {isFixture
                  ? "No account connection"
                  : `${incident.evidenceSource.services.checkout} + ${incident.evidenceSource.services.payment}`}
              </span>
              {!isSelfHosted && <span>No visitor token</span>}
            </p>
          </div>
        </div>
        <div>
          <Activity aria-hidden="true" size={19} />
          <div>
            <small>{isFixture ? "Sample evidence" : "Live reads"}</small>
            <strong>{isFixture ? "No live reads" : "Health + fixed probe"}</strong>
            <p>{incident.evidenceSource.readTransport}</p>
          </div>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" size={19} />
          <div>
            <small>Write boundary</small>
            <strong>{isFixture ? "No writes available" : "Checkout Worker only"}</strong>
            <p>{isFixture ? "Fixture cannot report recovery" : "Payment stays read-only"}</p>
          </div>
        </div>
      </div>

      {isFixture ? (
        <div className="evidence-path fixture-path" aria-label="Local fixture boundary">
          <small>Local-only fallback</small>
          <p>No Cloudflare read or deployment write occurred. Configure the Worker bindings to run the live proof.</p>
        </div>
      ) : (
        <div className="evidence-path" aria-label="Synchronous evidence path">
          <small>Synchronous proof path</small>
          <ol>
            <li><strong>Bound Workers</strong><span>checkout + payment</span></li>
            <ArrowRight aria-hidden="true" size={14} />
            <li><strong>GET /health + POST /checkout</strong><span>live status + fixed probe</span></li>
            <ArrowRight aria-hidden="true" size={14} />
            <li><strong>Workers Deployments API</strong><span>version evidence + guarded write</span></li>
            <ArrowRight aria-hidden="true" size={14} />
            <li><strong>Recovery Plan</strong><span>one shared page object</span></li>
          </ol>
          <p>No log server is required for this synchronous proof. Workers Logs stay secondary evidence.</p>
        </div>
      )}

      <div className="evidence-source-footer">
        <div className="shared-lab-note">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>
            {isFixture
              ? "Local fixture. No live Cloudflare read or deployment write occurred."
              : isSelfHosted
                ? "Self-hosted source. A newer checkout deployment can make your plan stale; the write gate will refuse it."
                : "Shared public lab. A later rehearsal can make your plan stale; the write gate will refuse it."}
            {!isLoading && (
              <> Last checked <time dateTime={incident.checkedAt}>{formatCheckedAt(incident.checkedAt)} Asia/Taipei</time>.</>
            )}
          </span>
        </div>
      </div>
      {resetError && <p className="source-error" role="alert">{resetError}</p>}
    </section>
  );
}

export default function App() {
  const {
    incident,
    selectedService,
    selectedChange,
    plan,
    error,
    labResetError,
    isIncidentLoading,
    isLabResetting,
    actions,
  } = useIncidentRoom();
  const webMcpActions = useMemo(
    () => ({
      inspectCurrentIncident: actions.inspectCurrentIncident,
      showChangeComparison: actions.showChangeComparison,
    }),
    [actions.inspectCurrentIncident, actions.showChangeComparison],
  );
  const webMcpStatus = useWebMcpTools(webMcpActions);
  const formRef = useRef<HTMLFormElement>(null);
  const explainerOpenerRef = useRef<HTMLButtonElement | null>(null);
  const explainerCloseRef = useRef<HTMLButtonElement>(null);
  const explainerDialogRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState<GuidedStep>(1);
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);
  const [gettingStartedTab, setGettingStartedTab] = useState<GettingStartedTab>("use");
  const isRecoveryDisabled =
    isIncidentLoading ||
    isLabResetting ||
    plan.state === "SUBMITTING" ||
    plan.state === "RECOVERED" ||
    incident.health.checkout !== "DEGRADED";
  const availableStep: GuidedStep =
    plan.state === "SUBMITTING" ||
    plan.state === "STALE" ||
    plan.state === "RECOVERED" ||
    plan.state === "FAILED"
      ? 4
      : plan.state === "DRAFTED" || plan.state === "HUMAN_EDITED" || selectedChange
        ? 3
        : isIncidentLoading
          ? 1
          : 2;
  const hasPreparedPlan = plan.state !== "EMPTY" && plan.state !== "EVIDENCE_READY";
  const comparisonActor = [...plan.activities]
    .reverse()
    .find((activity) => activity.id.endsWith("-opened-change"))?.actor;
  const agentPreparedPlan = plan.activities.some(
    (activity) => activity.id === "agent-prepared-plan",
  );
  const agentInspectedIncident = plan.activities.some(
    (activity) => activity.id === "agent-inspected",
  );
  useEffect(() => {
    if (!isExplainerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => explainerCloseRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsExplainerOpen(false);
      } else if (event.key === "Tab") {
        const focusable = Array.from(
          explainerDialogRef.current?.querySelectorAll<HTMLElement>(
            'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !explainerDialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !explainerDialogRef.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      explainerOpenerRef.current?.focus();
    };
  }, [isExplainerOpen]);

  const goToStep = useCallback((step: GuidedStep) => {
    setActiveStep(step);
  }, []);

  const reviewRecoveryPlan = useCallback(() => {
    setActiveStep(3);
    requestAnimationFrame(() => {
      const scopeMode = document.getElementById("scopeMode") as HTMLSelectElement | null;
      if (scopeMode && !scopeMode.disabled) scopeMode.focus();
      else document.getElementById("plan-title")?.focus();
    });
  }, []);

  const syncDraftFromForm = useCallback(
    (state: "DRAFTED" | "HUMAN_EDITED") => {
      if (!formRef.current) return;
      const form = new FormData(formRef.current);
      const patch: Partial<RecoveryPlan> = {
        scopeMode: form.get("scopeMode") as ScopeMode,
        targetVersion: "checkout-healthy",
        reason: String(form.get("reason") ?? ""),
      };
      if (state === "DRAFTED") actions.markDraftedByAgent(patch);
      else actions.updateRecoveryDraft({ ...patch, state });
    },
    [actions],
  );

  useEffect(() => {
    const handleToolActivated = (event: Event) => {
      const toolEvent = event as ToolWindowEvent;
      if (toolEvent.toolName === "prepare_recovery_rehearsal") {
        setActiveStep(3);
        queueMicrotask(() => syncDraftFromForm("DRAFTED"));
      }
    };
    const handleToolCancelled = (event: Event) => {
      const toolEvent = event as ToolWindowEvent;
      if (toolEvent.toolName === "prepare_recovery_rehearsal") {
        actions.markDraftCancelledByAgent();
      }
    };
    window.addEventListener("toolactivated", handleToolActivated);
    window.addEventListener("toolcancel", handleToolCancelled);
    return () => {
      window.removeEventListener("toolactivated", handleToolActivated);
      window.removeEventListener("toolcancel", handleToolCancelled);
    };
  }, [actions, syncDraftFromForm]);

  useEffect(() => {
    if (plan.state === "DRAFTED" || plan.state === "HUMAN_EDITED") {
      setActiveStep(3);
    } else if (
      plan.state === "SUBMITTING" ||
      plan.state === "STALE" ||
      plan.state === "RECOVERED" ||
      plan.state === "FAILED"
    ) {
      setActiveStep(4);
    }
  }, [plan.state]);

  useEffect(() => {
    if (agentInspectedIncident && !selectedChange) {
      setActiveStep((current) => current < 2 ? 2 : current);
    }
  }, [agentInspectedIncident, selectedChange]);

  useEffect(() => {
    if (selectedChange) reviewRecoveryPlan();
  }, [reviewRecoveryPlan, selectedChange]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nativeEvent = event.nativeEvent as AgentSubmitEvent;
    const formData = new FormData(event.currentTarget);
    const request = actions.submitRecoveryRehearsal({
      incidentId: incident.incidentId,
      scopeMode: formData.get("scopeMode") as ScopeMode,
      targetVersion: "checkout-healthy",
      observedDeploymentId: plan.observedDeploymentId,
      reason: String(formData.get("reason") ?? ""),
    });

    if (nativeEvent.agentInvoked && nativeEvent.respondWith) {
      nativeEvent.respondWith(request);
    }
    void request.catch(() => undefined);
  };

  const openSuspectedChange = () => {
    const changeId = incident.suspectedChangeIds[0];
    if (changeId) void actions.showChangeComparison(changeId);
  };

  const startFreshRehearsal = () => {
    if (isLabResetting) return;
    void actions.startFreshRehearsal()
      .then(() => {
        formRef.current?.reset();
        setActiveStep(1);
      })
      .catch(() => undefined);
  };

  const refreshAndRevise = () => {
    void actions.inspectCurrentIncident()
      .then(reviewRecoveryPlan)
      .catch(() => undefined);
  };

  const humanAction: GuidedHumanAction = (() => {
    if (activeStep < 4 && ["SUBMITTING", "STALE", "RECOVERED", "FAILED"].includes(plan.state)) {
      return {
        title: "A recovery result is already available",
        detail: "Return to the guarded Controller response without searching through the page.",
        label: "Return to result",
        icon: <ShieldCheck aria-hidden="true" size={17} />,
        onClick: () => goToStep(4),
      };
    }

    if (
      !isIncidentLoading &&
      incident.health.checkout !== "DEGRADED" &&
      plan.state !== "RECOVERED" &&
      plan.state !== "SUBMITTING"
    ) {
      return {
        title: "Checkout is healthy; begin from a visible 500",
        detail: "Reset only the checkout rehearsal Worker, then follow the same guarded recovery path again.",
        label: isLabResetting ? "Starting demo…" : "Restart from checkout 500",
        icon: <RefreshCw className={isLabResetting ? "spin" : undefined} aria-hidden="true" size={17} />,
        busy: isLabResetting,
        onClick: startFreshRehearsal,
      };
    }

    if (activeStep === 1) {
      if (hasPreparedPlan) {
        return {
          title: "Continue with the prepared Recovery Plan",
          detail: "Continue to the shared page object without losing the visible draft.",
          label: "Review Recovery Plan",
          icon: <UserRound aria-hidden="true" size={17} />,
          onClick: reviewRecoveryPlan,
        };
      }
      if (plan.state === "EMPTY") {
        return {
          title: "Create a clean checkout 500 starting point",
          detail: "Reset the public rehearsal lab, then verify checkout is degraded while payment stays healthy.",
          label: isLabResetting ? "Starting demo…" : "Start 100-second demo",
          icon: <RefreshCw className={isLabResetting ? "spin" : undefined} aria-hidden="true" size={17} />,
          disabled: isIncidentLoading,
          busy: isLabResetting,
          onClick: startFreshRehearsal,
        };
      }
      return {
        title: "Live failure evidence is ready",
        detail: "Continue to the read-only deployment comparison. No recovery write occurs.",
        label: "Diagnose the change",
        icon: <GitCompareArrows aria-hidden="true" size={17} />,
        disabled: isIncidentLoading || isLabResetting,
        onClick: () => goToStep(2),
      };
    }

    if (activeStep === 2) {
      if (selectedChange) {
        return {
          title: "Deployment evidence is visible",
          detail: "Move to the shared Recovery Plan and inspect every proposed value before approval.",
          label: "Review Recovery Plan",
          icon: <UserRound aria-hidden="true" size={17} />,
          onClick: reviewRecoveryPlan,
        };
      }
      return {
        title: "Open the suspected checkout change",
        detail: "Render the 200 → 500 comparison in this live page. The tool remains read-only.",
        label: "Show change comparison",
        icon: <GitCompareArrows aria-hidden="true" size={17} />,
        disabled: isIncidentLoading || isLabResetting,
        onClick: openSuspectedChange,
      };
    }

    if (activeStep === 3) {
      return {
        title: "Human review happens on the shared page",
        detail: "Inspect the visible values, change scopeMode, then personally Submit inside the form.",
        label: "Review Recovery Plan",
        icon: <UserRound aria-hidden="true" size={17} />,
        onClick: reviewRecoveryPlan,
      };
    }

    if (plan.state === "STALE") {
      return {
        title: "The stale gate refused the rollback",
        detail: "Refresh the deployment baseline, revise the mounted plan, then submit again.",
        label: "Refresh and revise plan",
        icon: <RefreshCw aria-hidden="true" size={17} />,
        onClick: refreshAndRevise,
      };
    }
    if (plan.state === "RECOVERED") {
      return {
        title: "The same checkout request now returns 200",
        detail: "The proof is complete. Reset checkout to 500 only when you want another rehearsal.",
        label: isLabResetting ? "Starting demo…" : "Replay from checkout 500",
        icon: <RefreshCw className={isLabResetting ? "spin" : undefined} aria-hidden="true" size={17} />,
        busy: isLabResetting,
        onClick: startFreshRehearsal,
      };
    }
    if (plan.state === "SUBMITTING") {
      return {
        title: "Controller is checking the approved page state",
        detail: "The stale gate runs before any rollback write, then verifies the same checkout request.",
        label: "Checking approval…",
        icon: <RefreshCw className="spin" aria-hidden="true" size={17} />,
        disabled: true,
        onClick: () => undefined,
      };
    }
    return {
      title: "Recovery was not verified",
      detail: "Return to the mounted plan, inspect the visible values, and decide whether to try again.",
      label: "Return to Recovery Plan",
      icon: <UserRound aria-hidden="true" size={17} />,
      onClick: reviewRecoveryPlan,
    };
  })();

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Incident Room home">
          <span className="brand-mark"><Activity aria-hidden="true" size={20} /></span>
          <span>Incident Room</span>
        </a>
        <div className="topbar-actions">
          <button
            type="button"
            className="explainer-trigger"
            aria-haspopup="dialog"
            aria-expanded={isExplainerOpen}
            onClick={(event) => {
              explainerOpenerRef.current = event.currentTarget;
              setGettingStartedTab("use");
              setIsExplainerOpen(true);
            }}
          >
            <BookOpen aria-hidden="true" size={16} /> Get started
          </button>
          <div className="topbar-status" aria-label="Runtime status">
            <span className={`runtime-badge ${isIncidentLoading ? "mode-loading" : `mode-${incident.evidenceMode.toLowerCase()}`}`}>
              <Cloud aria-hidden="true" size={14} />
              {isIncidentLoading
                ? "Connecting lab"
                : incident.evidenceMode === "LIVE"
                  ? "Cloudflare lab"
                  : "Local fixture"}
            </span>
          </div>
        </div>
      </header>

      <main id="main-content" className="workspace" data-active-step={activeStep}>
        <section className="product-intro" aria-labelledby="product-title">
          <div className="product-intro-copy">
            <p className="eyebrow">Human + agent incident recovery</p>
            <h1 id="product-title">One live Recovery Plan. Agent prepares it. Human decides.</h1>
            <p className="product-summary">
              Incident Room uses WebMCP so a person and an agent can inspect the same failure,
              edit the same page object, and verify the same checkout request after a guarded rollback.
            </p>
            <div className="product-actions">
              <button
                type="button"
                className="text-button hero-secondary"
                onClick={(event) => {
                  explainerOpenerRef.current = event.currentTarget;
                  setGettingStartedTab("use");
                  setIsExplainerOpen(true);
                }}
              >
                See the 3 steps <ArrowRight aria-hidden="true" size={16} />
              </button>
            </div>
          </div>
          <aside className="product-proof" aria-label="100-second proof chain">
            <p className="eyebrow">What the judge will see</p>
            <div className="proof-chain">
              <span><small>01</small><strong>500 observed</strong></span>
              <ArrowRight aria-hidden="true" size={15} />
              <span><small>02</small><strong>PLAN_STALE if superseded · no write</strong></span>
              <ArrowRight aria-hidden="true" size={15} />
              <span><small>03</small><strong>200 verified</strong></span>
            </div>
            <p>The base path proves 500 → 200. A superseded plan proves <code>PLAN_STALE</code> with no write.</p>
          </aside>
        </section>

        <GuidedProgress
          activeStep={activeStep}
          availableStep={availableStep}
          state={plan.state}
          webMcpStatus={webMcpStatus}
          humanAction={humanAction}
          onStepChange={goToStep}
        />

        <div className="workspace-grid guided-stage">
          <div className="evidence-column">
            <section className="incident-banner step-pane step-1" aria-labelledby="stage-title-1">
              <div className="incident-icon"><AlertTriangle aria-hidden="true" size={24} /></div>
              <div>
                <p className="eyebrow">Active incident · {incident.incidentId}</p>
                <h2 id="stage-title-1" tabIndex={-1}>{incident.title}</h2>
                <p>
                  {isIncidentLoading
                    ? "Reading dedicated lab health and active deployments…"
                    : incident.health.checkout === "DEGRADED"
                      ? "Fixed checkout request returns 500. Payment remains healthy."
                      : "Checkout is recovered. Start a fresh rehearsal to replay the guarded rollback."}
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void actions.inspectCurrentIncident()}
                disabled={isIncidentLoading || isLabResetting}
              >
                <RefreshCw aria-hidden="true" size={16} />
                Refresh evidence
              </button>
            </section>

            <div className="step-pane step-1 step-observe-source">
              <EvidenceConnection
                incident={incident}
                planState={plan.state}
                isLoading={isIncidentLoading}
                isResetting={isLabResetting}
                resetError={labResetError}
              />
            </div>

            <section className="panel step-pane step-1" aria-labelledby="services-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">WebMCP read path</p>
                  <h2 id="services-title">Live system evidence</h2>
                </div>
                <div className="heading-trail">
                  <span className="interface-chip chip-read">Agent tool · Read only</span>
                  <span className="selection-note">Focused: {selectedService}</span>
                </div>
              </div>
              <div className="service-list">
                {(["checkout", "payment"] as const).map((serviceId) => (
                  <ServiceButton
                    key={serviceId}
                    serviceId={serviceId}
                    selected={selectedService === serviceId}
                    status={isIncidentLoading ? "UNKNOWN" : incident.health[serviceId]}
                    deployment={
                      isIncidentLoading
                        ? "Loading lab evidence…"
                        : incident.activeDeployments[serviceId]
                    }
                    onSelect={actions.selectService}
                  />
                ))}
              </div>
            </section>

            <section className="panel evidence-panel step-pane step-2" aria-labelledby="evidence-title">
              <div className="stage-title-block">
                <span className="stage-number">02</span>
                <div>
                  <p className="eyebrow">Agent reads · Everyone sees</p>
                  <h2 id="stage-title-2" tabIndex={-1}>Diagnose the deployment change</h2>
                  <p>WebMCP returns structured evidence into this same page, not a hidden agent transcript.</p>
                </div>
              </div>
              <div className={`inline-tool-activity ${selectedChange ? "is-complete" : ""}`} role="status">
                <Bot aria-hidden="true" size={17} />
                <span>
                  <strong>
                    {selectedChange
                      ? comparisonActor === "AGENT"
                        ? "Agent called show_change_comparison"
                        : "Human opened deployment evidence"
                      : "Waiting for show_change_comparison"}
                  </strong>
                  <small>{selectedChange ? "Live page updated with deployment evidence" : "The result will appear in this shared canvas"}</small>
                </span>
              </div>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Suspected change</p>
                  <h2 id="evidence-title">Why checkout failed</h2>
                </div>
                <span className="interface-chip chip-read">
                  <GitCompareArrows aria-hidden="true" size={15} /> Agent tool · Read only
                </span>
              </div>
              {selectedChange ? (
                <div className="diff-card">
                  <div className="version-row">
                    <span><small>Current</small>{selectedChange.currentVersion}</span>
                    <ArrowRight aria-hidden="true" size={18} />
                    <span><small>Target</small>{selectedChange.targetVersion}</span>
                  </div>
                  <p>{selectedChange.summary}</p>
                  <ul>
                    {selectedChange.changedFields.map((field) => <li key={field}>{field}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="empty-evidence">
                  <p>Open the suspected checkout deployment to compare the failing and healthy versions.</p>
                </div>
              )}
              {!isIncidentLoading && incident.evidenceGaps.length > 0 && (
                <div className="evidence-gap" role="status">
                  <AlertTriangle aria-hidden="true" size={16} />
                  <span>{incident.evidenceGaps.join(" ")}</span>
                </div>
              )}
            </section>
          </div>

          <section className="recovery-plan step-pane step-shared" aria-labelledby="plan-title">
            <div className="plan-accent" />
            <div className="panel-heading plan-heading">
              <div>
                <p className="eyebrow">Shared live page object</p>
                <h2 id="plan-title" tabIndex={-1}>Recovery Plan</h2>
              </div>
              <StatePill state={plan.state} />
            </div>

            <div className="canvas-context" aria-live="polite">
              <span>{String(activeStep).padStart(2, "0")}</span>
              <div>
                <strong>
                  {activeStep <= 2 && hasPreparedPlan
                    ? "Recovery Plan already prepared"
                    : activeStep === 1
                    ? "Observe before drafting"
                    : activeStep === 2
                      ? "Attach the verified change"
                      : activeStep === 3
                        ? agentPreparedPlan
                          ? "Agent draft, human decision"
                          : "Visible defaults, human decision"
                        : "Controller returns visible proof"}
                </strong>
                <p>
                  {activeStep <= 2 && hasPreparedPlan
                    ? "Use the step track to return to the current approval or verification state."
                    : activeStep === 1
                    ? "The plan stays empty until live incident evidence is visible."
                    : activeStep === 2
                      ? "The deployment comparison becomes the context for this same plan."
                      : activeStep === 3
                        ? agentPreparedPlan
                          ? "Review the agent draft, edit scopeMode, and personally Submit the final state."
                          : "Review the visible defaults, edit scopeMode, and personally Submit the final state."
                        : "A stale refusal and a verified rollback remain attached to this plan."}
                </p>
              </div>
            </div>

            {!hasPreparedPlan && (
              <div className="plan-awaiting plan-setup-only">
                <Bot aria-hidden="true" size={22} />
                <div>
                  <strong>
                    {activeStep === 1
                      ? "Recovery Plan not drafted yet"
                      : selectedChange
                        ? "Change context ready for the plan"
                        : "Waiting for deployment comparison"}
                  </strong>
                  <p>
                    {activeStep === 1
                      ? "Inspect the live 500 and healthy payment service first."
                      : selectedChange
                        ? "The verified comparison is attached. Review the visible defaults or let the agent prepare them through WebMCP."
                        : "Open the suspected change, then review the visible defaults or let the agent prepare them through WebMCP."}
                  </p>
                </div>
                <dl>
                  <div><dt>Scope</dt><dd>Visible defaults await review</dd></div>
                  <div><dt>Target</dt><dd>Allowlisted checkout version</dd></div>
                  <div><dt>Submit</dt><dd>Human only</dd></div>
                </dl>
              </div>
            )}

            <div className="plan-collaboration-note step-3-only" aria-label="Recovery Plan interface">
              {agentPreparedPlan ? <Bot aria-hidden="true" size={17} /> : <BookOpen aria-hidden="true" size={17} />}
              <span>
                <strong>{agentPreparedPlan ? "Agent prepared this live form" : "Default plan values are ready for human review"}</strong>
                <small>You can see every value, change the scope, and decide whether to Submit.</small>
              </span>
            </div>

            <form
              ref={formRef}
              {...formToolAttributes}
              className="recovery-form step-3-only"
              onSubmit={handleSubmit}
              onChange={() => syncDraftFromForm("HUMAN_EDITED")}
            >
              <div className="form-group">
                <div className="field-label-line">
                  <label htmlFor="scopeMode">Recovery scope</label>
                  <span className="field-activity">
                    {agentPreparedPlan ? <Bot aria-hidden="true" size={13} /> : <BookOpen aria-hidden="true" size={13} />}
                    {agentPreparedPlan ? "Agent proposed" : "Default scope"} · <strong>Human decides</strong>
                  </span>
                </div>
                <select
                  id="scopeMode"
                  name="scopeMode"
                  defaultValue="checkout_and_payment"
                  {...scopeToolAttributes}
                  disabled={isRecoveryDisabled}
                >
                  <option value="checkout_and_payment">Checkout and payment</option>
                  <option value="checkout">Checkout only</option>
                </select>
                <p className="field-help">Payment is healthy. Remove it before submitting the smallest plan.</p>
              </div>

              <div className="form-group">
                <div className="field-label-line">
                  <label htmlFor="targetVersion">Target version</label>
                  <span className="field-activity"><ShieldCheck aria-hidden="true" size={13} /> Controller allowlist</span>
                </div>
                <select
                  id="targetVersion"
                  name="targetVersion"
                  defaultValue="checkout-healthy"
                  {...targetToolAttributes}
                  disabled={isRecoveryDisabled}
                >
                  <option value="checkout-healthy">checkout-healthy</option>
                </select>
              </div>

              <div className="form-group">
                <div className="field-label-line">
                  <label htmlFor="reason">Reason</label>
                  <span className="field-activity">
                    {agentPreparedPlan ? <Bot aria-hidden="true" size={13} /> : <BookOpen aria-hidden="true" size={13} />}
                    {agentPreparedPlan ? "Agent drafted" : "Default rationale"}
                  </span>
                </div>
                <textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  defaultValue={plan.reason}
                  {...reasonToolAttributes}
                  disabled={isRecoveryDisabled}
                />
              </div>

              <div className="baseline-row">
                <span>Observed deployment ID</span>
                <code>{isIncidentLoading ? "Loading…" : plan.observedDeploymentId}</code>
              </div>

              <button
                type="submit"
                className="primary-button"
                disabled={isRecoveryDisabled}
              >
                {plan.state === "SUBMITTING" ? (
                  <><RefreshCw className="spin" aria-hidden="true" size={17} /> Running rehearsal…</>
                ) : plan.state === "RECOVERED" || incident.health.checkout !== "DEGRADED" ? (
                  <><RefreshCw aria-hidden="true" size={17} /> Start 100-second demo first</>
                ) : (
                  <><ShieldCheck aria-hidden="true" size={17} /> Human approval · Run recovery rehearsal</>
                )}
              </button>
              <p className="submit-note">
                {incident.health.checkout === "DEGRADED"
                  ? "The agent can fill this live form. Submit is the only path to the Controller Worker recovery write gate."
                  : "Checkout is healthy. Start a fresh rehearsal before preparing another rollback."}
              </p>
            </form>

            <div className="inline-controller-activity step-4-only" aria-label="Verification path">
              <ShieldCheck aria-hidden="true" size={17} />
              <span><strong>Approved page → stale gate → rollback write → same request</strong><small>The Controller checks current deployment before any write.</small></span>
            </div>

            <div className="result-area step-4-only" aria-live="polite">
              {plan.state === "FAILED" ? (
                <div className="result-card result-execution_failed" role="alert">
                  <AlertTriangle aria-hidden="true" size={20} />
                  <div>
                    <strong>Recovery request failed</strong>
                    <p>{error ?? "The Controller did not return recovery proof."}</p>
                  </div>
                </div>
              ) : plan.result ? (
                <div className="result-stack">
                  <div className={`result-card result-${plan.result.status.toLowerCase()}`}>
                    {plan.result.status === "RECOVERED" ? (
                      <CheckCircle2 aria-hidden="true" size={20} />
                    ) : (
                      <AlertTriangle aria-hidden="true" size={20} />
                    )}
                    <div>
                      <strong>{plan.result.status}</strong>
                      <p>{plan.result.message}</p>
                      {plan.result.executionDeploymentId && (
                        <code>{plan.result.executionDeploymentId}</code>
                      )}
                    </div>
                  </div>
                  {plan.result.status === "RECOVERED" && (
                    <button
                      type="button"
                      className="text-button replay-button"
                      onClick={startFreshRehearsal}
                      disabled={isLabResetting}
                    >
                      <RefreshCw aria-hidden="true" size={15} /> Start another clean rehearsal
                    </button>
                  )}
                </div>
              ) : (
                <div className="pending-result">
                  <ShieldCheck aria-hidden="true" size={18} />
                  <span>No write occurs until the human submits this exact page state.</span>
                </div>
              )}
            </div>

            <div className="plan-activity step-4-only" aria-live="polite">
              <div className="activity-heading">
                <p className="eyebrow">Visible decision history</p>
                <h3>Plan activity</h3>
              </div>
              {plan.activities.length > 0 ? (
                <ol>
                  {plan.activities.map((activity) => (
                    <li key={activity.id} className={`activity-${activity.actor.toLowerCase()}`}>
                      <span className="activity-marker" aria-hidden="true" />
                      <div>
                        <small>{activity.actor}</small>
                        <strong>{activity.title}</strong>
                        <p>{activity.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="activity-empty">
                  Agent preparation, human edits, refusals, and verified recovery will remain visible here.
                </p>
              )}
            </div>
          </section>
        </div>
      </main>

      {isExplainerOpen && (
        <div
          className="explainer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsExplainerOpen(false);
          }}
        >
          <section
            ref={explainerDialogRef}
            className="explainer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="explainer-title"
            aria-describedby="explainer-summary"
          >
            <header className="explainer-header">
              <div>
                <p className="eyebrow">Use it, run it, understand it</p>
                <h2 id="explainer-title">Get started with Incident Room</h2>
              </div>
              <button
                ref={explainerCloseRef}
                type="button"
                className="explainer-close"
                aria-label="Close Get started"
                onClick={() => setIsExplainerOpen(false)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>

            <p id="explainer-summary" className="explainer-summary">
              Run the live proof or clone the project. Tool calls stay visible in the Live incident track.
            </p>

            <div
              className="explainer-tabs"
              role="tablist"
              aria-label="Getting started options"
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const tabs: GettingStartedTab[] = ["use", "install"];
                const currentIndex = tabs.indexOf(gettingStartedTab);
                const offset = event.key === "ArrowRight" ? 1 : -1;
                const nextTab = tabs[(currentIndex + offset + tabs.length) % tabs.length];
                setGettingStartedTab(nextTab);
                requestAnimationFrame(() => {
                  explainerDialogRef.current?.scrollTo?.({ top: 0 });
                  document.getElementById(`getting-started-tab-${nextTab}`)?.focus();
                });
              }}
            >
              {([
                ["use", "Try live demo"],
                ["install", "Run your own"],
              ] as Array<[GettingStartedTab, string]>).map(([tab, label]) => (
                <button
                  key={tab}
                  id={`getting-started-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={gettingStartedTab === tab}
                  aria-controls={`getting-started-panel-${tab}`}
                  tabIndex={gettingStartedTab === tab ? 0 : -1}
                  onClick={() => {
                    setGettingStartedTab(tab);
                    requestAnimationFrame(() => explainerDialogRef.current?.scrollTo?.({ top: 0 }));
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {gettingStartedTab === "use" && (
              <div
                id="getting-started-panel-use"
                className="explainer-panel"
                role="tabpanel"
                aria-labelledby="getting-started-tab-use"
              >
                <div className="onboarding-callout">
                  <Cloud aria-hidden="true" size={21} />
                  <div>
                    <strong>You’re on the live demo.</strong>
                    <p>No account, setup, or visitor token is required. The public rehearsal lab is shared, so another run can make an older plan stale by design.</p>
                  </div>
                </div>
                <ol className="onboarding-steps" aria-label="100-second recovery walkthrough">
                  <li><span>1</span><div><strong>Start with a verified 500</strong><p>Press <b>Start 100-second demo</b>. The lab proves checkout is degraded while payment remains healthy.</p></div></li>
                  <li><span>2</span><div><strong>Ask the agent</strong><p>In ChatGPT’s in-app browser or WebMCP-enabled Chrome, ask: “Inspect the current incident, compare the suspected deployment change, then prepare a Recovery Plan for me to review.” The two read tools update this page.</p></div></li>
                  <li><span>3</span><div><strong>Make the human decision</strong><p>Change Recovery scope to Checkout only, review the reason, and personally press Submit.</p></div></li>
                </ol>
                <div className="proof-result">
                  <ShieldCheck aria-hidden="true" size={18} />
                  <p><strong>Expected proof</strong><span>Base: 500 → rollback → 200. If the deployment changes first: PLAN_STALE → no write.</span></p>
                </div>
                <div className="browser-compatibility">
                  <Bot aria-hidden="true" size={19} />
                  <div>
                    <strong>Browser compatibility</strong>
                    <p>ChatGPT Site tools currently lists the two imperative tools. Chrome WebMCP also discovers the declarative form. In ChatGPT, the agent can fill the visible form through regular browser interaction; the human still submits it.</p>
                  </div>
                </div>
              </div>
            )}

            {gettingStartedTab === "install" && (
              <div
                id="getting-started-panel-install"
                className="explainer-panel"
                role="tabpanel"
                aria-labelledby="getting-started-tab-install"
              >
                <div className="install-heading">
                  <div>
                    <p className="eyebrow">Open source and runnable</p>
                    <h3>Start locally in four commands</h3>
                  </div>
                  <a href="https://github.com/cyh7789/incident-room" target="_blank" rel="noreferrer">
                    Open source on GitHub <ArrowRight aria-hidden="true" size={16} />
                  </a>
                </div>
                <div className="install-grid">
                  <section aria-labelledby="local-install-title">
                    <small>Interface + local evidence</small>
                    <h4 id="local-install-title">Run the app</h4>
                    <pre><code>{`git clone https://github.com/cyh7789/incident-room.git
cd incident-room
npm install
npm run dev`}</code></pre>
                    <p>This starts a labelled local fixture until the Worker variables are configured. Fixture mode never claims a real rollback.</p>
                  </section>
                  <section aria-labelledby="worker-install-title">
                    <small>Full Worker runtime</small>
                    <h4 id="worker-install-title">Connect your Workers</h4>
                    <pre><code>{`cp .dev.vars.example .dev.vars
npm run dev:worker`}</code></pre>
                    <p>Bind your own checkout and payment Workers, then provide their names, allowlisted version IDs, and a server-side Workers Scripts Write token.</p>
                  </section>
                </div>
                <div className="connection-contract">
                  <div>
                    <p className="eyebrow">Connection contract</p>
                    <strong>Deployment configuration only. No Incident Room core code changes.</strong>
                  </div>
                  <ul>
                    <li><code>GET /health</code> on checkout and payment returns service status plus the active version ID.</li>
                    <li><code>POST /checkout</code> runs the deterministic checkout probe and returns its real HTTP status.</li>
                    <li>Cloudflare Deployments API reads both deployment IDs and can write only the configured checkout Worker.</li>
                  </ul>
                </div>
                <div className="install-note">
                  <LockKeyhole aria-hidden="true" size={19} />
                  <p>Never expose the Cloudflare token to the browser. Use a dedicated account for this recovery boundary; Controller code writes only the configured checkout Worker. Follow the <a href="https://github.com/cyh7789/incident-room#connect-your-own-cloudflare-workers" target="_blank" rel="noreferrer">connection guide</a> for bindings, variables, and version allowlists.</p>
                </div>
              </div>
            )}

          </section>
        </div>
      )}
    </div>
  );
}
