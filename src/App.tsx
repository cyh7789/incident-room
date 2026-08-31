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
  GitPullRequest,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  IncidentSummary,
  RecoveryPlan,
  RecoveryResult,
  RemediationPath,
  RemediationProposal,
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

type GuidedStep = 1 | 2 | 3 | 4 | 5 | 6;
type GettingStartedTab = "use" | "install" | "connect";

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
    label: "Plan",
    detail: "Propose rollback",
    icon: <LockKeyhole aria-hidden="true" size={18} />,
    surfaceCue: "Agent prepares",
    surfaceName: "prepare_recovery_rehearsal",
    surfaceKind: "Declarative form · no write",
    surfaceDetail: "The agent fills the mounted plan with the exact precheck, checkout rollback, and verification path.",
  },
  {
    id: 4,
    label: "Approve",
    detail: "Human submits",
    icon: <UserRound aria-hidden="true" size={18} />,
    surfaceCue: "Required person action",
    surfaceName: "Human Submit",
    surfaceKind: "Only write entry point",
    surfaceDetail: "The human reviews the proposed operation, narrows scope, and personally submits this page state.",
  },
  {
    id: 5,
    label: "Verify",
    detail: "Prove 500 → 200",
    icon: <ShieldCheck aria-hidden="true" size={18} />,
    surfaceCue: "Synchronous proof",
    surfaceName: "Controller response",
    surfaceKind: "No agent write tool",
    surfaceDetail: "The form response proves PLAN_STALE with no write, or the same request changing from 500 to 200.",
  },
  {
    id: 6,
    label: "Remediate",
    detail: "Choose root fix",
    icon: <Wrench aria-hidden="true" size={18} />,
    surfaceCue: "Next agent call",
    surfaceName: "propose_remediation_options",
    surfaceKind: "Page-only proposal · no external write",
    surfaceDetail: "After 200 is verified, the agent compares three permanent-fix paths and leaves the final choice to the human.",
  },
];

const remediationOptions: Record<RemediationPath, {
  title: string;
  summary: string;
  issueTitle: string;
  steps: string[];
}> = {
  FIX_FORWARD_PR: {
    title: "Fix forward through a reviewed PR",
    summary: "Keep the healthy rollback active while engineering fixes the regressed checkout version, proves it with a regression test, and canary deploys a new version.",
    issueTitle: "Fix checkout regression and canary a reviewed version",
    steps: [
      "Reproduce the fixed-cart 500 from the regressed deployment and add a failing regression test.",
      "Patch checkout only, review the PR, and keep payment unchanged.",
      "Canary the new checkout version, require the same request to stay 200, then complete rollout and observe.",
    ],
  },
  HOLD_ROLLBACK: {
    title: "Hold the rollback and investigate",
    summary: "Keep the recovered version serving traffic, preserve the evidence, and delay any new deployment until the producing change is confirmed.",
    issueTitle: "Investigate checkout regression while rollback stays active",
    steps: [
      "Preserve deployment IDs, the 500 → 200 proof, and the exact regressed diff in the issue.",
      "Correlate checkout logs and configuration with the failure without changing payment.",
      "Return with a tested fix-forward proposal before scheduling another checkout deployment.",
    ],
  },
  EMERGENCY_HOTFIX: {
    title: "Prepare an emergency hotfix",
    summary: "Use only when a business-critical change cannot remain rolled back. Patch the smallest checkout surface and keep an immediate rollback ready.",
    issueTitle: "Prepare guarded checkout hotfix after rollback",
    steps: [
      "Limit the patch to the failing fixed-cart path and add a targeted regression test.",
      "Require human review, then canary only the checkout Worker.",
      "Verify the same request at 200 and roll back immediately if health or payment evidence changes.",
    ],
  },
};

function GuidedProgress({
  activeStep,
  availableStep,
  state,
  remediation,
  webMcpStatus,
  humanAction,
  onStepChange,
}: {
  activeStep: GuidedStep;
  availableStep: GuidedStep;
  state: RecoveryPlan["state"];
  remediation: RemediationProposal | null;
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
    : state === "RECOVERED" && activeStep === 6 && remediation?.state === "SELECTED"
      ? {
          mode: "success",
          title: "Recovery and the human-selected repair path are recorded",
          detail: "The issue draft is simulated. No PR or deployment was created from this page.",
        }
      : state === "RECOVERED" && activeStep === 6 && remediation
        ? {
            mode: "active",
            title: remediation.source === "AGENT"
              ? "Agent-refined options are visible; the human decides"
              : "A repair baseline is ready; the agent can refine it",
            detail: remediation.source === "AGENT"
              ? "Compare the agent recommendation with the two alternatives, then record one follow-up path on this page."
              : "Review the immediate recommendation now, or ask the agent to refine it from the verified 500 → 200 evidence.",
          }
        : state === "RECOVERED" && activeStep === 6
          ? {
              mode: "active",
              title: "Recovery is verified; permanent remediation is still open",
              detail: "The next agent call must formulate options from the recovered deployment evidence.",
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
                  detail: "Observe the live failure, approve the guarded rollback, verify the same request, then choose a permanent-fix path.",
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
          <h2 id="guided-title">500 observed → rollback approved → 200 verified → repair path chosen</h2>
        </div>
        <div className="guided-heading-status">
          <span className={`guided-webmcp-status webmcp-${webMcpStatus.toLowerCase()}`}>
            <CircleDot aria-hidden="true" size={12} /> WebMCP {webMcpStatus.toLowerCase()}
          </span>
          <span className="guided-count">Step {activeStep} of {guidedSteps.length}</span>
        </div>
      </div>
      <ol className="guided-stepper" aria-label="Recovery rehearsal steps">
        {guidedSteps.map((step) => {
          const isCurrent = activeStep === step.id;
          const isComplete = step.id < activeStep || (state === "RECOVERED" && step.id <= 5);
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
            {activeStep < 4 || activeStep === 6 ? <Bot aria-hidden="true" size={16} /> : activeStep === 4 ? <UserRound aria-hidden="true" size={16} /> : <ShieldCheck aria-hidden="true" size={16} />}
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
    remediation,
    error,
    labResetError,
    isIncidentLoading,
    isLabResetting,
    actions,
  } = useIncidentRoom();
  const webMcpActions = useMemo(
    () => ({
      inspectCurrentIncident: actions.inspectCurrentIncident,
      getVerifiedRecovery: actions.getVerifiedRecovery,
      proposeRemediationOptions: actions.proposeRemediationOptions,
      showChangeComparison: actions.showChangeComparison,
    }),
    [
      actions.inspectCurrentIncident,
      actions.getVerifiedRecovery,
      actions.proposeRemediationOptions,
      actions.showChangeComparison,
    ],
  );
  const webMcpStatus = useWebMcpTools(webMcpActions);
  const formRef = useRef<HTMLFormElement>(null);
  const explainerOpenerRef = useRef<HTMLButtonElement | null>(null);
  const explainerCloseRef = useRef<HTMLButtonElement>(null);
  const explainerDialogRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState<GuidedStep>(1);
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);
  const [gettingStartedTab, setGettingStartedTab] = useState<GettingStartedTab>("use");
  const [remediationChoice, setRemediationChoice] = useState<RemediationPath | null>(null);
  const isRecoveryDisabled =
    isIncidentLoading ||
    isLabResetting ||
    plan.state === "SUBMITTING" ||
    plan.state === "RECOVERED" ||
    incident.health.checkout !== "DEGRADED";
  const availableStep: GuidedStep =
    plan.state === "RECOVERED"
      ? 6
      : plan.state === "SUBMITTING" ||
    plan.state === "STALE" ||
    plan.state === "FAILED"
      ? 5
      : plan.state === "DRAFTED" || plan.state === "HUMAN_EDITED" || selectedChange
        ? 4
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
    if (!remediation) {
      setRemediationChoice(null);
      return;
    }
    if (remediation.state === "PROPOSED") {
      setRemediationChoice(remediation.recommendedPath);
    }
  }, [remediation]);
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

  const focusRecoveryPlan = useCallback((step: 3 | 4) => {
    setActiveStep(step);
    requestAnimationFrame(() => {
      const scopeMode = document.getElementById("scopeMode") as HTMLSelectElement | null;
      if (scopeMode && !scopeMode.disabled) scopeMode.focus();
      else document.getElementById("plan-title")?.focus();
    });
  }, []);

  const reviewRecoveryPlan = useCallback(() => {
    focusRecoveryPlan(hasPreparedPlan ? 4 : 3);
  }, [focusRecoveryPlan, hasPreparedPlan]);

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
      setActiveStep(4);
    } else if (plan.state === "RECOVERED") {
      setActiveStep(6);
    } else if (
      plan.state === "SUBMITTING" ||
      plan.state === "STALE" ||
      plan.state === "FAILED"
    ) {
      setActiveStep(5);
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
    const response = request.then((result) => result.status === "RECOVERED"
      ? {
          ...result,
          nextAction:
            "Call propose_remediation_options with the regressed deployment ID, evidence-backed diagnosis, recommendation, and rationale. The human will choose on the visible page.",
        }
      : result);

    if (nativeEvent.agentInvoked && nativeEvent.respondWith) {
      nativeEvent.respondWith(response);
    }
    void request.catch(() => undefined);
    void response.catch(() => undefined);
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
    if (activeStep < 6 && plan.state === "RECOVERED") {
      return {
        title: "Checkout is back at 200; the permanent fix still needs a decision",
        detail: "Continue to the same live page so the agent can propose repair paths from the verified evidence.",
        label: "Continue to remediation",
        icon: <Wrench aria-hidden="true" size={17} />,
        onClick: () => goToStep(6),
      };
    }

    if (activeStep < 5 && ["SUBMITTING", "STALE", "FAILED"].includes(plan.state)) {
      return {
        title: "A recovery result is already available",
        detail: "Return to the guarded Controller response without searching through the page.",
        label: "Return to result",
        icon: <ShieldCheck aria-hidden="true" size={17} />,
        onClick: () => goToStep(5),
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
          detail: "Build the concrete checkout rollback, stale precheck, and 500 → 200 verification proposal.",
          label: "Build rollback plan",
          icon: <LockKeyhole aria-hidden="true" size={17} />,
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
        title: "The rollback operation is now explicit",
        detail: "Inspect the precheck, checkout-only deployment write, and same-request verification before approval.",
        label: "Continue to human approval",
        icon: <UserRound aria-hidden="true" size={17} />,
        onClick: () => focusRecoveryPlan(4),
      };
    }

    if (activeStep === 4) {
      return {
        title: "Human approval happens on this exact plan",
        detail: "Narrow the scope to checkout, review the proposed rollback, then personally Submit inside the form.",
        label: "Review approval form",
        icon: <UserRound aria-hidden="true" size={17} />,
        onClick: () => focusRecoveryPlan(4),
      };
    }

    if (activeStep === 6) {
      if (!remediation) {
        return {
          title: "Agent must now formulate permanent-fix options",
          detail: "Call propose_remediation_options from the verified 500 → 200 evidence. No issue, PR, or deployment will be created.",
          label: "Agent proposal required",
          icon: <Bot aria-hidden="true" size={17} />,
          disabled: true,
          onClick: () => undefined,
        };
      }
      if (remediation.state === "PROPOSED") {
        return {
          title: remediation.source === "AGENT"
            ? "Review the agent recommendation and choose a repair path"
            : "Review the repair baseline or ask the agent to refine it",
          detail: remediation.source === "AGENT"
            ? "The recommendation is advisory. A person can select either alternative before recording the decision."
            : "Three usable paths are already visible. The WebMCP agent can replace the baseline diagnosis and recommendation before the human decides.",
          label: "Review three options",
          icon: <UserRound aria-hidden="true" size={17} />,
          onClick: () => document.getElementById("remediation-title")?.focus(),
        };
      }
      return {
        title: "The follow-up path is recorded on this page",
        detail: "The generated issue is a draft only. Engineering still owns the PR, review, deployment, and observation window.",
        label: isLabResetting ? "Starting demo…" : "Replay from checkout 500",
        icon: <RefreshCw className={isLabResetting ? "spin" : undefined} aria-hidden="true" size={17} />,
        busy: isLabResetting,
        onClick: startFreshRehearsal,
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
        detail: "Emergency recovery is complete. Continue to formulate the permanent-fix choices.",
        label: "Continue to remediation",
        icon: <Wrench aria-hidden="true" size={17} />,
        onClick: () => goToStep(6),
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
              edit the same page object, verify the same checkout request after a guarded rollback,
              and choose among agent-proposed permanent fixes.
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
                See how it works <ArrowRight aria-hidden="true" size={16} />
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
              <ArrowRight aria-hidden="true" size={15} />
              <span><small>04</small><strong>Human chooses permanent fix</strong></span>
            </div>
            <p>The base path proves 500 → 200, then the agent proposes repair options for a human decision. A superseded plan proves <code>PLAN_STALE</code> with no write.</p>
          </aside>
        </section>

        <GuidedProgress
          activeStep={activeStep}
          availableStep={availableStep}
          state={plan.state}
          remediation={remediation}
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
                          ? "Agent proposed the rollback operation"
                          : "Rollback operation ready for inspection"
                        : activeStep === 4
                          ? "Human approves the exact operation"
                          : activeStep === 5
                            ? "Controller returns visible proof"
                            : remediation
                              ? remediation.source === "AGENT"
                                ? "Agent-refined options are ready for a human decision"
                                : "A repair baseline is ready for a human decision"
                              : "Permanent remediation still needs an agent proposal"}
                </strong>
                <p>
                  {activeStep <= 2 && hasPreparedPlan
                    ? "Use the step track to return to the current approval or verification state."
                    : activeStep === 1
                    ? "The plan stays empty until live incident evidence is visible."
                    : activeStep === 2
                      ? "The deployment comparison becomes the context for this same plan."
                      : activeStep === 3
                        ? "Inspect the stale precheck, checkout deployment write, and same-request verification before approval."
                        : activeStep === 4
                          ? "Edit scopeMode, review the exact rollback, and personally Submit the final page state."
                          : activeStep === 5
                            ? "A stale refusal and a verified rollback remain attached to this plan."
                            : remediation
                              ? remediation.source === "AGENT"
                                ? "Compare the agent-refined paths, then record one human-selected follow-up without creating external work."
                                : "Choose from the three immediate paths, or let the agent refine the diagnosis before recording a follow-up."
                              : "Use the verified 500 → 200 evidence to ask the agent for repair options."}
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
                <strong>{agentPreparedPlan ? "Agent prepared this rollback proposal" : "Default rollback proposal is ready for inspection"}</strong>
                <small>The write operation is visible below. You can change the scope before deciding whether to Submit.</small>
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

              <section className="rollback-preview" aria-labelledby="rollback-preview-title">
                <div className="rollback-preview-heading">
                  <div>
                    <p className="eyebrow">Proposed operation · no write yet</p>
                    <h3 id="rollback-preview-title">Rollback checkout, then prove recovery</h3>
                  </div>
                  <span>Payment: no write</span>
                </div>
                <ol>
                  <li><span>Precheck</span><p>Refuse with <code>PLAN_STALE</code> unless the current checkout deployment still matches <code>{plan.observedDeploymentId}</code>.</p></li>
                  <li><span>Rollback</span><p>Deploy allowlisted <code>checkout-healthy</code> to <code>{incident.evidenceSource.services.checkout}</code> at 100%. Do not deploy payment.</p></li>
                  <li><span>Verify</span><p>Repeat the fixed cart request and require HTTP <code>500 → 200</code> before claiming recovery.</p></li>
                </ol>
              </section>

              <div className="approval-submit">
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
                    <><ShieldCheck aria-hidden="true" size={17} /> Human approval · Execute checkout rollback</>
                  )}
                </button>
                <p className="submit-note">
                  {incident.health.checkout === "DEGRADED"
                    ? "Submit is the only path to the Controller Worker recovery write gate. It executes the operation shown above."
                    : "Checkout is healthy. Start a fresh rehearsal before preparing another rollback."}
                </p>
              </div>
            </form>

            <div className="inline-controller-activity step-5-only" aria-label="Verification path">
              <ShieldCheck aria-hidden="true" size={17} />
              <span><strong>Approved page → stale gate → rollback write → same request</strong><small>The Controller checks current deployment before any write.</small></span>
            </div>

            <div className="result-area step-5-only" aria-live="polite">
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
                      className="primary-button remediation-next-button"
                      onClick={() => goToStep(6)}
                    >
                      <Wrench aria-hidden="true" size={17} /> Continue to permanent remediation
                      <ArrowRight aria-hidden="true" size={17} />
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

            <div className="plan-activity step-5-only" aria-live="polite">
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

            <section className="remediation-workspace step-6-only" aria-labelledby="remediation-title">
              <div className="remediation-proof">
                <CheckCircle2 aria-hidden="true" size={20} />
                <div>
                  <p className="eyebrow">Verified recovery boundary</p>
                  <strong>Checkout is back at 200. The rollback stays active while the permanent fix is decided.</strong>
                  <p>
                    Regressed deployment <code>{plan.result?.currentDeploymentId ?? "Unavailable"}</code> remains attached to this decision. Payment stays unchanged.
                  </p>
                </div>
              </div>

              {!remediation ? (
                <div className="remediation-awaiting" role="status">
                  <Bot aria-hidden="true" size={22} />
                  <div>
                    <p className="eyebrow">Next agent call</p>
                    <h3 id="remediation-title" tabIndex={-1}>Formulate permanent-fix options</h3>
                    <p>
                      Call <code>propose_remediation_options</code> with the regressed deployment, diagnosis, recommended path, and rationale. The result will appear here for a human choice.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="remediation-heading">
                    <div>
                      <p className="eyebrow">
                        {remediation.source === "AGENT" ? "Agent refines · Human decides" : "Recovery baseline · Human decides"}
                      </p>
                      <h3 id="remediation-title" tabIndex={-1}>Choose the permanent-fix path</h3>
                      <p>{remediation.rootCauseSummary}</p>
                    </div>
                    <span className="interface-chip chip-read">
                      <Bot aria-hidden="true" size={14} />
                      {remediation.source === "AGENT" ? "Agent-refined · Page only" : "Ready now · Agent can refine"}
                    </span>
                  </div>

                  <div className="agent-recommendation" role="status">
                    <GitPullRequest aria-hidden="true" size={19} />
                    <div>
                      <small>{remediation.source === "AGENT" ? "Agent recommends" : "Baseline recommendation"}</small>
                      <strong>{remediationOptions[remediation.recommendedPath].title}</strong>
                      <p>{remediation.rationale}</p>
                    </div>
                  </div>

                  <div className="remediation-options" role="radiogroup" aria-label="Permanent-fix options">
                    {(Object.keys(remediationOptions) as RemediationPath[]).map((path) => {
                      const option = remediationOptions[path];
                      const recommended = path === remediation.recommendedPath;
                      return (
                        <label key={path} className={`remediation-option ${remediationChoice === path ? "is-selected" : ""}`}>
                          <input
                            type="radio"
                            name="remediationPath"
                            value={path}
                            checked={remediationChoice === path}
                            onChange={() => setRemediationChoice(path)}
                            disabled={remediation.state === "SELECTED"}
                          />
                          <span className="remediation-option-copy">
                            <span className="remediation-option-title">
                              <strong>{option.title}</strong>
                              {recommended && (
                                <small>{remediation.source === "AGENT" ? "Agent recommended" : "Recommended now"}</small>
                              )}
                            </span>
                            <span>{option.summary}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {remediation.state === "PROPOSED" ? (
                    <div className="remediation-decision">
                      <p><strong>No external write.</strong> This records a page decision only. It does not create an issue, PR, or deployment.</p>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!remediationChoice}
                        onClick={() => remediationChoice && actions.selectRemediationPath(remediationChoice)}
                      >
                        <UserRound aria-hidden="true" size={17} /> Human choice · Record follow-up path
                      </button>
                    </div>
                  ) : remediation.selectedPath ? (
                    <section className="root-fix-handoff" aria-labelledby="root-fix-title">
                      <div>
                        <p className="eyebrow">Selected follow-up · simulated handoff</p>
                        <h3 id="root-fix-title">{remediationOptions[remediation.selectedPath].title}</h3>
                        <p>
                          The human selected this path after reviewing the {remediation.source === "AGENT" ? "agent recommendation" : "recovery baseline"} and alternatives.
                        </p>
                      </div>
                      <span className="issue-draft-status">Simulated issue draft</span>
                      <article className="issue-draft">
                        <small>Title</small>
                        <strong>[{incident.incidentId}] {remediationOptions[remediation.selectedPath].issueTitle}</strong>
                        <p>Regressed deployment <code>{remediation.regressedDeploymentId}</code>. Keep the verified rollback active and payment unchanged until the selected acceptance path is complete.</p>
                      </article>
                      <ol>
                        {remediationOptions[remediation.selectedPath].steps.map((step, index) => (
                          <li key={step}><span>{index + 1}</span>{step}</li>
                        ))}
                      </ol>
                      <p className="simulation-boundary">No GitHub issue, PR, or checkout deployment was created. These are the recorded next actions for engineering.</p>
                    </section>
                  ) : null}
                </>
              )}
            </section>
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
                const tabs: GettingStartedTab[] = ["use", "install", "connect"];
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
                ["install", "Run locally"],
                ["connect", "Connect Workers"],
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
                  <li><span>2</span><div><strong>Ask the agent</strong><p>In ChatGPT’s in-app browser or WebMCP-enabled Chrome, ask: “Inspect the current incident, compare the suspected deployment change, then prepare a Recovery Plan for me to review.” The read tools update this page.</p></div></li>
                  <li><span>3</span><div><strong>Approve recovery, then choose the root fix</strong><p>Review the rollback, change Recovery scope to Checkout only, and personally press Submit. After 200 is verified, the agent proposes three permanent-fix paths and a person chooses one.</p></div></li>
                </ol>
                <div className="proof-result">
                  <ShieldCheck aria-hidden="true" size={18} />
                  <p><strong>Expected proof</strong><span>Base: 500 → approved checkout rollback → 200 → agent repair options → human-selected simulated issue. If the deployment changes first: PLAN_STALE → no write.</span></p>
                </div>
                <div className="browser-compatibility">
                  <Bot aria-hidden="true" size={19} />
                  <div>
                    <strong>Browser compatibility</strong>
                    <p>ChatGPT Site tools lists three imperative tools. Chrome WebMCP also discovers the declarative Recovery Plan form. The recovery form and permanent-fix choice both keep the final decision with the human.</p>
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
                    <h3>Run the interface locally</h3>
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
                    <small>Controller runtime</small>
                    <h4 id="worker-install-title">Run with Worker variables</h4>
                    <pre><code>{`cp .dev.vars.example .dev.vars
npm run dev:worker`}</code></pre>
                    <p>After the connection configuration is filled, this runs the same Controller used by the deployed site.</p>
                  </section>
                </div>
                <div className="install-note">
                  <LockKeyhole aria-hidden="true" size={19} />
                  <p>The local fixture is for interface review only. Open <strong>Connect Workers</strong> to wire real Cloudflare evidence and guarded deployment writes.</p>
                </div>
              </div>
            )}

            {gettingStartedTab === "connect" && (
              <div
                id="getting-started-panel-connect"
                className="explainer-panel"
                role="tabpanel"
                aria-labelledby="getting-started-tab-connect"
              >
                <div className="install-heading">
                  <div>
                    <p className="eyebrow">Real Cloudflare connection</p>
                    <h3>Connect a dedicated recovery environment</h3>
                  </div>
                  <a href="https://github.com/cyh7789/incident-room#connect-your-own-cloudflare-workers" target="_blank" rel="noreferrer">
                    Full connection guide <ArrowRight aria-hidden="true" size={16} />
                  </a>
                </div>

                <div className="wiring-path" aria-label="Cloudflare connection path">
                  <span><small>1</small><strong>Your Workers</strong><em>health + checkout probe</em></span>
                  <ArrowRight aria-hidden="true" size={15} />
                  <span><small>2</small><strong>Service Bindings</strong><em>private live reads</em></span>
                  <ArrowRight aria-hidden="true" size={15} />
                  <span><small>3</small><strong>Controller</strong><em>allowlisted deployment write</em></span>
                  <ArrowRight aria-hidden="true" size={15} />
                  <span><small>4</small><strong>Recovery Plan</strong><em>agent prepares, human submits</em></span>
                </div>

                <ol className="connection-steps" aria-label="Worker connection steps">
                  <li>
                    <div className="connection-step-heading"><span>1</span><div><strong>Add the narrow Worker contract</strong><p>No log server or Incident Room SDK is required.</p></div></div>
                    <pre><code>{"GET /health\n→ { serviceId, status, versionId,\n    versionTag, checkedAt }\n\nPOST /checkout\n← { cartId: incident-room-fixed-cart, total: 42 }\n→ return the real HTTP 200 or 500"}</code></pre>
                  </li>
                  <li>
                    <div className="connection-step-heading"><span>2</span><div><strong>Bind the same Workers once</strong><p>Point the two Service Bindings at your checkout and payment Worker names.</p></div></div>
                    <pre><code>{"\"services\": [\n  { \"binding\": \"CHECKOUT_SERVICE\",\n    \"service\": \"your-checkout\" },\n  { \"binding\": \"PAYMENT_SERVICE\",\n    \"service\": \"your-payment\" }\n]"}</code></pre>
                  </li>
                  <li>
                    <div className="connection-step-heading"><span>3</span><div><strong>Allowlist versions, then deploy</strong><p>Use a dedicated Cloudflare account or recovery boundary.</p></div></div>
                    <pre><code>{"cp .dev.vars.example .dev.vars\n# add Worker names, URLs, and version IDs\nwrangler secret put CLOUDFLARE_API_TOKEN\nnpm run deploy"}</code></pre>
                  </li>
                </ol>

                <div className="connection-contract">
                  <div>
                    <p className="eyebrow">What changes</p>
                    <strong>Your Workers expose the contract. Incident Room changes only deployment configuration.</strong>
                  </div>
                  <ul>
                    <li><code>CF_VERSION_METADATA.id</code> must match the active version returned by the Workers Deployments API.</li>
                    <li>The server token stays outside the browser and can write only through the configured checkout allowlist.</li>
                    <li>Success is visible when <code>/api/incident/current</code> returns 200 and names your evidence source.</li>
                  </ul>
                </div>
                <div className="install-note">
                  <LockKeyhole aria-hidden="true" size={19} />
                  <p>This is a Cloudflare-specific reference integration, not a generic incident platform. The included checkout and payment Workers are working examples you can adapt.</p>
                </div>
              </div>
            )}

          </section>
        </div>
      )}
    </div>
  );
}
