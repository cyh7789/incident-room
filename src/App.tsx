import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  BookOpen,
  CheckCircle2,
  CircleDot,
  Cloud,
  Database,
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

const guidedSteps: Array<{
  id: GuidedStep;
  label: string;
  detail: string;
  icon: ReactNode;
}> = [
  { id: 1, label: "Observe", detail: "Live 500", icon: <Activity aria-hidden="true" size={18} /> },
  { id: 2, label: "Diagnose", detail: "Compare change", icon: <GitCompareArrows aria-hidden="true" size={18} /> },
  { id: 3, label: "Approve", detail: "Human decides", icon: <UserRound aria-hidden="true" size={18} /> },
  { id: 4, label: "Verify", detail: "Prove 500 → 200", icon: <ShieldCheck aria-hidden="true" size={18} /> },
];

function GuidedProgress({
  activeStep,
  availableStep,
  state,
  onStepChange,
}: {
  activeStep: GuidedStep;
  availableStep: GuidedStep;
  state: RecoveryPlan["state"];
  onStepChange: (step: GuidedStep) => void;
}) {
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
    <section className={`guided-progress guided-${status.mode}`} aria-labelledby="guided-title">
      <div className="guided-progress-heading">
        <div>
          <p className="eyebrow">Live incident track</p>
          <h2 id="guided-title">500 observed → change found → human approval → 200 verified</h2>
        </div>
        <span className="guided-count">Step {activeStep} of 4</span>
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
                aria-label={`Step ${step.id}: ${step.label}. ${step.detail}`}
              >
                <span className="guided-step-icon">
                  {isComplete ? <CheckCircle2 aria-hidden="true" size={18} /> : step.icon}
                </span>
                <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="guided-live-status" role="status" aria-live="polite">
        <span aria-hidden="true" />
        <div><strong>{status.title}</strong><p>{status.detail}</p></div>
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
  onStartFresh,
}: {
  incident: IncidentSummary;
  planState: RecoveryPlan["state"];
  isLoading: boolean;
  isResetting: boolean;
  resetError: string | null;
  onStartFresh: () => void;
}) {
  const isRecovered = planState === "RECOVERED";
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
          <h2 id="evidence-source-title">Dedicated Cloudflare rehearsal lab</h2>
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
            <strong>App-owned sandbox</strong>
            <p>No visitor token</p>
          </div>
        </div>
        <div>
          <Activity aria-hidden="true" size={19} />
          <div>
            <small>Live reads</small>
            <strong>Health + deployment IDs</strong>
            <p>Service Bindings + Controller</p>
          </div>
        </div>
        <div>
          <ShieldCheck aria-hidden="true" size={19} />
          <div>
            <small>Write boundary</small>
            <strong>Checkout Worker only</strong>
            <p>Payment stays read-only</p>
          </div>
        </div>
      </div>

      <div className="evidence-source-footer">
        <div className="shared-lab-note">
          <AlertTriangle aria-hidden="true" size={16} />
          <span>
            Shared public lab. A later rehearsal can make your plan stale; the write gate will refuse it.
            {!isLoading && (
              <> Last checked <time dateTime={incident.checkedAt}>{formatCheckedAt(incident.checkedAt)} Asia/Taipei</time>.</>
            )}
          </span>
        </div>
        <button
          type="button"
          className="secondary-button start-rehearsal-button"
          onClick={onStartFresh}
          disabled={isLoading || isResetting}
        >
          <RefreshCw className={isResetting ? "spin" : undefined} aria-hidden="true" size={16} />
          {isResetting ? "Preparing clean rehearsal…" : "Start fresh rehearsal"}
        </button>
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
  const explainerTriggerRef = useRef<HTMLButtonElement>(null);
  const explainerCloseRef = useRef<HTMLButtonElement>(null);
  const [activeStep, setActiveStep] = useState<GuidedStep>(1);
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);
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
  const showsRegisteredWebMcpSurface =
    webMcpStatus === "REGISTERING" || webMcpStatus === "READY";

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
        event.preventDefault();
        explainerCloseRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      explainerTriggerRef.current?.focus();
    };
  }, [isExplainerOpen]);

  const goToStep = useCallback((step: GuidedStep) => {
    setActiveStep(step);
    requestAnimationFrame(() => {
      document.getElementById(step >= 3 ? "plan-title" : `stage-title-${step}`)?.focus();
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
    if (selectedChange) setActiveStep((current) => current < 2 ? 2 : current);
  }, [selectedChange]);

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
    void actions.startFreshRehearsal()
      .then(() => {
        formRef.current?.reset();
        setActiveStep(1);
      })
      .catch(() => undefined);
  };

  const refreshAndRevise = () => {
    void actions.inspectCurrentIncident()
      .then(() => setActiveStep(3))
      .catch(() => undefined);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Incident Room home">
          <span className="brand-mark"><Activity aria-hidden="true" size={20} /></span>
          <span>Incident Room</span>
        </a>
        <div className="topbar-actions">
          <button
            ref={explainerTriggerRef}
            type="button"
            className="explainer-trigger"
            aria-haspopup="dialog"
            aria-expanded={isExplainerOpen}
            onClick={() => setIsExplainerOpen(true)}
          >
            <BookOpen aria-hidden="true" size={16} /> How it works
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
            <span className={`runtime-badge webmcp-${webMcpStatus.toLowerCase()}`}>
              <Bot aria-hidden="true" size={14} />
              WebMCP {webMcpStatus.toLowerCase()}
              {showsRegisteredWebMcpSurface ? " · 2 tools + 1 form" : ""}
            </span>
          </div>
        </div>
      </header>

      <main id="main-content" className="workspace" data-active-step={activeStep}>
        <section className="product-intro" aria-labelledby="product-title">
          <div className="product-intro-copy">
            <p className="eyebrow">Human + agent incident recovery</p>
            <h1 id="product-title">One live Recovery Plan. Agent prepares it. Human decides.</h1>
            <p>
              Incident Room uses WebMCP so a person and an agent can inspect the same failure,
              edit the same page object, and verify the same checkout request after a guarded rollback.
            </p>
          </div>
          <aside className="product-principle" aria-label="Why WebMCP matters here">
            <strong>The shared page is the handoff.</strong>
            <p>No hidden agent-only plan. No autonomous rollback. The visible Recovery Plan is the only shared object.</p>
          </aside>
          <div className="product-causal-chain" aria-label="Incident Room responsibility chain">
            <span><Bot aria-hidden="true" size={18} /><small>Agent</small><strong>Reads evidence</strong></span>
            <ArrowRight aria-hidden="true" size={16} />
            <span><BookOpen aria-hidden="true" size={18} /><small>Shared page</small><strong>Carries the live plan</strong></span>
            <ArrowRight aria-hidden="true" size={16} />
            <span><UserRound aria-hidden="true" size={18} /><small>Human</small><strong>Edits + submits</strong></span>
            <ArrowRight aria-hidden="true" size={16} />
            <span><ShieldCheck aria-hidden="true" size={18} /><small>Controller</small><strong>Checks, writes + verifies</strong></span>
          </div>
        </section>

        <GuidedProgress
          activeStep={activeStep}
          availableStep={availableStep}
          state={plan.state}
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
                onStartFresh={startFreshRehearsal}
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
              <div className="stage-actions stage-actions-forward">
                <span>Next, let the agent compare the deployment that introduced the 500.</span>
                <button
                  type="button"
                  className="primary-button compact-primary"
                  onClick={() => goToStep(2)}
                  disabled={isIncidentLoading || isLabResetting}
                >
                  Diagnose the change <ArrowRight aria-hidden="true" size={17} />
                </button>
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
              <div className="stage-actions">
                <button type="button" className="secondary-button" onClick={() => goToStep(1)}>
                  <ArrowLeft aria-hidden="true" size={17} /> Back to evidence
                </button>
                {selectedChange ? (
                  <button type="button" className="primary-button compact-primary" onClick={() => goToStep(3)}>
                    Review Recovery Plan <ArrowRight aria-hidden="true" size={17} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button compact-primary"
                    onClick={openSuspectedChange}
                    disabled={isIncidentLoading || isLabResetting}
                  >
                    Show change comparison <ArrowRight aria-hidden="true" size={17} />
                  </button>
                )}
              </div>
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
                  <><RefreshCw aria-hidden="true" size={17} /> Start fresh rehearsal first</>
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
            <div className="stage-actions step-4-only">
              {plan.state === "STALE" ? (
                <button type="button" className="primary-button compact-primary" onClick={refreshAndRevise}>
                  Refresh evidence and revise plan <ArrowRight aria-hidden="true" size={17} />
                </button>
              ) : plan.state === "RECOVERED" ? (
                <button
                  type="button"
                  className="primary-button compact-primary"
                  onClick={startFreshRehearsal}
                  disabled={isLabResetting}
                >
                  <RefreshCw aria-hidden="true" size={17} /> Replay from checkout 500
                </button>
              ) : (
                <button type="button" className="secondary-button" onClick={() => goToStep(3)}>
                  <ArrowLeft aria-hidden="true" size={17} /> Return to plan
                </button>
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
            className="explainer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="explainer-title"
            aria-describedby="explainer-summary"
          >
            <header className="explainer-header">
              <div>
                <p className="eyebrow">About this live rehearsal</p>
                <h2 id="explainer-title">How Incident Room works</h2>
              </div>
              <button
                ref={explainerCloseRef}
                type="button"
                className="explainer-close"
                aria-label="Close How Incident Room works"
                onClick={() => setIsExplainerOpen(false)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>

            <p id="explainer-summary" className="explainer-summary">
              This is a live, app-owned Cloudflare rehearsal lab. It demonstrates a guarded recovery handoff,
              not a general production connector and not an agent acting alone.
            </p>

            <div className="explainer-responsibilities">
              <article>
                <Bot aria-hidden="true" size={21} />
                <div><small>Agent</small><h3>Reads and prepares</h3></div>
                <p>Two imperative WebMCP tools inspect live evidence and compare the suspected deployment. The agent then fills the visible Declarative Recovery Plan form.</p>
              </article>
              <article>
                <UserRound aria-hidden="true" size={21} />
                <div><small>Human</small><h3>Changes and approves</h3></div>
                <p>The human personally submits after reviewing every proposed value and narrowing <code>scopeMode</code>. There is no <code>toolautosubmit</code>.</p>
              </article>
              <article>
                <LockKeyhole aria-hidden="true" size={21} />
                <div><small>Controller</small><h3>Guards and proves</h3></div>
                <p>The Worker checks the deployment baseline and allowlist before any write. It returns <code>PLAN_STALE</code> without rollback, or verifies the same request changed from 500 to 200.</p>
              </article>
            </div>

            <div className="explainer-faq">
              <div>
                <Database aria-hidden="true" size={19} />
                <span><strong>Where does the data come from?</strong><p>Dedicated checkout and payment Cloudflare Workers owned by this app. Visitors provide no token; payment stays read-only.</p></span>
              </div>
              <div>
                <ShieldCheck aria-hidden="true" size={19} />
                <span><strong>Why use WebMCP here?</strong><p>The agent and person operate the same mounted Recovery Plan on the live page, so preparation, edits, refusal, and proof stay visible in one place.</p></span>
              </div>
              <div>
                <LockKeyhole aria-hidden="true" size={19} />
                <span><strong>What else can write to the lab?</strong><p>Scenario controls can prepare only allowlisted lab failures, including the competing deployment used to prove <code>PLAN_STALE</code>. Only a human-submitted Recovery Plan can write the healthy recovery target.</p></span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
