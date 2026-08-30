import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Cloud,
  GitCompareArrows,
  RefreshCw,
  ShieldCheck,
  UserRound,
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
          <p className="eyebrow">Guided incident · 4 steps</p>
          <h2 id="guided-title">Recover checkout with the agent in this tab</h2>
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

      <div className="evidence-source-grid">
        <article>
          <Cloud aria-hidden="true" size={19} />
          <div>
            <small>Data owner</small>
            <strong>App-owned sandbox</strong>
            <p>Visitors never enter a Cloudflare API token.</p>
          </div>
        </article>
        <article>
          <Activity aria-hidden="true" size={19} />
          <div>
            <small>Live read paths</small>
            <strong>Health + deployments</strong>
            <p>Service Bindings read health; the Controller reads active deployment IDs.</p>
          </div>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" size={19} />
          <div>
            <small>Write boundary</small>
            <strong>Checkout Worker only</strong>
            <p>Human reset or submit can write; payment remains read-only.</p>
          </div>
        </article>
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
  const [activeStep, setActiveStep] = useState<GuidedStep>(1);
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

  const goToStep = useCallback((step: GuidedStep) => {
    setActiveStep(step);
    requestAnimationFrame(() => {
      document.getElementById(`stage-title-${step}`)?.focus();
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
          </span>
        </div>
      </header>

      <main id="main-content" className="workspace" data-active-step={activeStep}>
        <GuidedProgress
          activeStep={activeStep}
          availableStep={availableStep}
          state={plan.state}
          onStepChange={goToStep}
        />

        <section className="incident-banner step-pane step-1" aria-labelledby="stage-title-1">
          <div className="incident-icon"><AlertTriangle aria-hidden="true" size={24} /></div>
          <div>
            <p className="eyebrow">Active incident · {incident.incidentId}</p>
            <h1 id="stage-title-1" tabIndex={-1}>{incident.title}</h1>
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

        <div className="workspace-grid guided-stage">
          <div className="evidence-column">
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
              <div className="handoff-strip" aria-label="Agent evidence handoff">
                <span><Bot aria-hidden="true" size={18} /><strong>Agent</strong><small>Calls read tool</small></span>
                <ArrowRight aria-hidden="true" size={18} />
                <span><Activity aria-hidden="true" size={18} /><strong>WebMCP</strong><small>Returns change</small></span>
                <ArrowRight aria-hidden="true" size={18} />
                <span><GitCompareArrows aria-hidden="true" size={18} /><strong>Live page</strong><small>Shows evidence</small></span>
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
            <div className="stage-title-block recovery-stage-title">
              <span className="stage-number">{activeStep === 4 ? "04" : "03"}</span>
              <div>
                <p className="eyebrow">{activeStep === 4 ? "Controller verifies" : "Agent drafts · Human decides"}</p>
                <h2 id={`stage-title-${activeStep === 4 ? 4 : 3}`} tabIndex={-1}>
                  {activeStep === 4 ? "Verify the guarded recovery" : "Approve the smallest safe plan"}
                </h2>
                <p>
                  {activeStep === 4
                    ? "The visible receipt distinguishes a refused stale plan from a verified rollback."
                    : "The agent prepares this live form, then stops for your edit and explicit Submit."}
                </p>
              </div>
            </div>
            <div className="panel-heading plan-heading">
              <div>
                <p className="eyebrow">WebMCP shared page object</p>
                <h2 id="plan-title">Recovery Plan</h2>
              </div>
              <StatePill state={plan.state} />
            </div>

            <div className="plan-interface-strip step-3-only" aria-label="Recovery Plan interface">
              <span className="interface-chip chip-agent"><Bot aria-hidden="true" size={15} /> Agent drafts</span>
              <span className="interface-chip chip-shared">Declarative form · Live DOM</span>
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
                  <span className="decision-badge">Human decision required</span>
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
                <label htmlFor="targetVersion">Target version</label>
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
                <label htmlFor="reason">Reason</label>
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

              {error && <p className="form-error" role="alert">{error}</p>}

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
                  ? "The agent can fill this live form. Submit is the only path to the Controller Worker write gate."
                  : "Checkout is healthy. Start a fresh rehearsal before preparing another rollback."}
              </p>
            </form>

            <div className="verification-path step-4-only" aria-label="Verification path">
              <span><UserRound aria-hidden="true" size={18} /><strong>Approved page</strong><small>Exact scope</small></span>
              <ArrowRight aria-hidden="true" size={18} />
              <span><ShieldCheck aria-hidden="true" size={18} /><strong>Stale gate</strong><small>Before write</small></span>
              <ArrowRight aria-hidden="true" size={18} />
              <span><CheckCircle2 aria-hidden="true" size={18} /><strong>Health proof</strong><small>Same request</small></span>
            </div>

            <div className="result-area step-4-only" aria-live="polite">
              {plan.result ? (
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
    </div>
  );
}
