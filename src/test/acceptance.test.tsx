import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "../App";
import type { IncidentSummary, LabResetResult, RecoveryResult } from "../domain";
import worker, { type Env } from "../../worker/index";

interface RegisteredTool {
  name: string;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
}

function modelContextHarness() {
  const tools: RegisteredTool[] = [];
  const signals: AbortSignal[] = [];
  document.modelContext = {
    registerTool: vi.fn((tool, options) => {
      tools.push(tool);
      if (options?.signal) signals.push(options.signal);
      return Promise.resolve();
    }),
  };
  return { tools, signals };
}

function renderApp(): ReturnType<typeof render> {
  return render(<App /> as ReactElement);
}

const liveIncident: IncidentSummary = {
  incidentId: "INC-WEBMCP-001",
  title: "Checkout requests failing after deployment",
  startedAt: "2026-08-30T10:42:00Z",
  checkedAt: "2026-08-30T11:00:00Z",
  affectedServices: ["checkout"],
  health: { checkout: "DEGRADED", payment: "HEALTHY" },
  activeDeployments: { checkout: "broken-version-id", payment: "payment-version-id" },
  suspectedChangeIds: ["change-broken-version-id"],
  evidenceGaps: ["Telemetry unavailable"],
  evidenceMode: "LIVE",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(liveIncident)));
});

describe("Incident Room acceptance", () => {
  test("loads live incident evidence on first open", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(liveIncident));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    expect(screen.getByText("Connecting lab")).toBeTruthy();
    expect(screen.getAllByText("Loading lab evidence…")).toHaveLength(2);

    await waitFor(() => expect(screen.getByText("Cloudflare lab")).toBeTruthy());
    expect(screen.getAllByText("broken-version-id")).toHaveLength(2);
    expect(screen.queryByText(/fixture-checkout-broken/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/incident/current", {
      headers: { Accept: "application/json" },
    });
    expect(
      screen.getByRole("heading", { name: "Dedicated Cloudflare rehearsal lab" }),
    ).toBeTruthy();
    expect(screen.getByText("App-owned sandbox")).toBeTruthy();
    expect(screen.getByText("No visitor token")).toBeTruthy();
    expect(screen.getByText("Ready · checkout 500")).toBeTruthy();
  });

  test("human starts a fresh verified rehearsal outside WebMCP", async () => {
    const reset: LabResetResult = {
      status: "READY",
      resetDeploymentId: "fresh-deployment-id",
      checkoutVersionId: "broken-version-id",
      checkoutStatus: 500,
      paymentVersionId: "payment-version-id",
      paymentHealth: "HEALTHY",
      checkedAt: "2026-08-30T11:01:00Z",
      message: "Fresh rehearsal ready. Checkout returns 500 while payment remains healthy.",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/lab/reset") return jsonResponse(reset);
      return jsonResponse({
        ...liveIncident,
        activeDeployments: {
          ...liveIncident.activeDeployments,
          checkout: "fresh-deployment-id",
        },
        suspectedChangeIds: ["change-fresh-deployment-id"],
        checkedAt: reset.checkedAt,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const harness = modelContextHarness();
    const view = renderApp();
    await waitFor(() => expect(screen.getByText("Ready · checkout 500")).toBeTruthy());

    const startButton = screen.getByRole("button", { name: "Start fresh rehearsal" });
    expect(startButton.closest("[toolname]")).toBeNull();
    fireEvent.click(startButton);

    await waitFor(() => expect(screen.getByText("Fresh rehearsal verified")).toBeTruthy());
    expect(screen.getAllByText("fresh-deployment-id").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/checkout returned 500; payment remained healthy/i)).toBeTruthy();
    expect(harness.tools).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/lab/reset", {
      method: "POST",
      headers: { "X-Incident-Room-Action": "start-rehearsal" },
    });
    expect(
      view.container.querySelector('form[toolname="prepare_recovery_rehearsal"]'),
    ).not.toBeNull();
  });

  test("webmcp/tool-discovery", async () => {
    const harness = modelContextHarness();
    const view = renderApp();

    await waitFor(() => expect(harness.tools).toHaveLength(2));
    expect(harness.tools.map((tool) => tool.name)).toEqual([
      "inspect_current_incident",
      "show_change_comparison",
    ]);
    expect(
      view.container.querySelector('form[toolname="prepare_recovery_rehearsal"]'),
    ).not.toBeNull();
  });

  test("webmcp/shared-visible-state", async () => {
    const harness = modelContextHarness();
    const fetchMock = vi.fn(async () => jsonResponse(liveIncident));
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await waitFor(() => expect(harness.tools).toHaveLength(2));
    const inspect = harness.tools.find((tool) => tool.name === "inspect_current_incident")!;
    await act(async () => {
      await inspect.execute({ sinceMinutes: 10 });
    });
    expect(
      screen.getByRole("button", { name: /checkout broken-version-id degraded/i }),
    ).toBeTruthy();
    expect(screen.getByText("Cloudflare lab")).toBeTruthy();

    const compare = harness.tools.find((tool) => tool.name === "show_change_comparison")!;
    await act(async () => {
      await compare.execute({ changeId: "change-broken-version-id" });
    });
    expect(screen.getByText("response status: 200 → 500")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /payment payment-version-id/i }));
    expect(screen.getByText("Focused: payment")).toBeTruthy();
  });

  test("guides one visible recovery step while keeping the shared form mounted", async () => {
    const view = renderApp();
    await waitFor(() => expect(screen.getByText("Cloudflare lab")).toBeTruthy());

    const main = screen.getByRole("main");
    const form = view.container.querySelector(
      'form[toolname="prepare_recovery_rehearsal"]',
    ) as HTMLFormElement;
    expect(screen.getByRole("heading", {
      name: "500 observed → change found → human approval → 200 verified",
    })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recovery Plan" })).toBeTruthy();
    expect(screen.getByText("Recovery Plan not drafted yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /step 1: observe/i }).getAttribute("aria-current")).toBe("step");
    expect(main.getAttribute("data-active-step")).toBe("1");
    expect(view.container.contains(form)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Diagnose the change" }));
    expect(main.getAttribute("data-active-step")).toBe("2");
    expect(screen.getByRole("button", { name: /step 2: diagnose/i }).getAttribute("aria-current")).toBe("step");
    expect(view.container.contains(form)).toBe(true);

    const toolActivated = new Event("toolactivated");
    Object.defineProperty(toolActivated, "toolName", {
      value: "prepare_recovery_rehearsal",
    });
    await act(async () => {
      window.dispatchEvent(toolActivated);
      await Promise.resolve();
    });
    expect(main.getAttribute("data-active-step")).toBe("3");
    expect(screen.getByRole("button", { name: /step 3: approve/i }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Agent draft is visible in this tab")).toBeTruthy();
    expect(view.container.contains(form)).toBe(true);

    fireEvent.change(screen.getByLabelText("Recovery scope"), {
      target: { value: "checkout" },
    });
    expect(screen.getByText("Human changed the shared page state")).toBeTruthy();
  });

  test("webmcp/declarative-manual-submit", async () => {
    let submittedBody = "";
    const stale: RecoveryResult = {
      status: "PLAN_STALE",
      currentDeploymentId: "concurrent-version-id",
      healthBefore: 500,
      message: "Deployment changed. No rollback was written.",
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return jsonResponse(liveIncident);
      submittedBody = String(init?.body ?? "");
      return jsonResponse(stale);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderApp();
    await waitFor(() => expect(screen.getByText("Cloudflare lab")).toBeTruthy());
    const form = view.container.querySelector(
      'form[toolname="prepare_recovery_rehearsal"]',
    ) as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.hasAttribute("toolautosubmit")).toBe(false);

    fireEvent.change(screen.getByLabelText("Recovery scope"), {
      target: { value: "checkout" },
    });

    const respondWith = vi.fn();
    const submitEvent = new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: screen.getByRole("button", { name: /run recovery rehearsal/i }),
    });
    Object.defineProperty(submitEvent, "agentInvoked", { value: true });
    Object.defineProperty(submitEvent, "respondWith", { value: respondWith });

    fireEvent(form, submitEvent);
    expect(respondWith).toHaveBeenCalledTimes(1);
    expect(view.container.contains(form)).toBe(true);

    await act(async () => {
      await respondWith.mock.calls[0][0];
    });
    expect(JSON.parse(submittedBody).scopeMode).toBe("checkout");
    expect(view.container.contains(form)).toBe(true);
    expect(screen.getAllByText("PLAN_STALE").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Stopped before rollback write")).toBeTruthy();
    expect(screen.getByText("Human edited the Recovery Plan")).toBeTruthy();
    expect(screen.getByText("Human submitted this page state")).toBeTruthy();
  });

  test("keeps stale refusal visible after refresh and verified recovery", async () => {
    const concurrentIncident: IncidentSummary = {
      ...liveIncident,
      activeDeployments: {
        ...liveIncident.activeDeployments,
        checkout: "concurrent-version-id",
      },
      suspectedChangeIds: ["change-concurrent-version-id"],
    };
    const stale: RecoveryResult = {
      status: "PLAN_STALE",
      currentDeploymentId: "concurrent-version-id",
      healthBefore: 500,
      message: "Deployment changed. No rollback was written.",
    };
    const recovered: RecoveryResult = {
      status: "RECOVERED",
      currentDeploymentId: "concurrent-version-id",
      executionDeploymentId: "rollback-deployment-id",
      healthBefore: 500,
      healthAfter: 200,
      message: "Checkout recovered. The fixed request changed from 500 to 200.",
    };
    let incidentReads = 0;
    let submissions = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        incidentReads += 1;
        return jsonResponse(incidentReads === 1 ? liveIncident : concurrentIncident);
      }
      submissions += 1;
      return jsonResponse(submissions === 1 ? stale : recovered);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderApp();
    await waitFor(() => expect(screen.getByText("Cloudflare lab")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Recovery scope"), {
      target: { value: "checkout" },
    });
    const form = view.container.querySelector(
      'form[toolname="prepare_recovery_rehearsal"]',
    ) as HTMLFormElement;

    const firstRespondWith = vi.fn();
    const firstSubmit = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(firstSubmit, "agentInvoked", { value: true });
    Object.defineProperty(firstSubmit, "respondWith", { value: firstRespondWith });
    fireEvent(form, firstSubmit);
    await act(async () => firstRespondWith.mock.calls[0][0]);
    expect(screen.getAllByText("PLAN_STALE").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: "Refresh evidence" }));
    await waitFor(() =>
      expect(screen.getAllByText("concurrent-version-id").length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getAllByText("PLAN_STALE").length).toBeGreaterThanOrEqual(1);

    const secondRespondWith = vi.fn();
    const secondSubmit = new SubmitEvent("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(secondSubmit, "agentInvoked", { value: true });
    Object.defineProperty(secondSubmit, "respondWith", { value: secondRespondWith });
    fireEvent(form, secondSubmit);
    await act(async () => secondRespondWith.mock.calls[0][0]);

    expect(screen.getByText("Recovery verified")).toBeTruthy();
    expect(screen.getByText(/changed from 500 to 200; deployment rollback-deployment-id/i)).toBeTruthy();
    expect(screen.getByText("PLAN_STALE")).toBeTruthy();
    expect(screen.getByText("Recovery proved by the same checkout request")).toBeTruthy();
    expect(screen.getByText("Recovered · restart to replay")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Start fresh rehearsal first",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(incidentReads).toBe(3);
  });

  test("shows declarative tool cancellation without submitting", async () => {
    renderApp();
    const cancelEvent = new Event("toolcancel");
    Object.defineProperty(cancelEvent, "toolName", {
      value: "prepare_recovery_rehearsal",
    });

    act(() => window.dispatchEvent(cancelEvent));

    expect(screen.getByText("Agent cancelled the prepared draft")).toBeTruthy();
    expect(
      screen.getByText("No recovery request was submitted and no deployment write occurred."),
    ).toBeTruthy();
  });

  test("webmcp/tool-lifecycle-cleanup", async () => {
    const harness = modelContextHarness();
    const view = renderApp();
    await waitFor(() => expect(harness.signals).toHaveLength(2));
    expect(harness.signals.every((signal) => !signal.aborted)).toBe(true);

    view.unmount();
    expect(harness.signals.every((signal) => signal.aborted)).toBe(true);
  });

  test("server/allowlisted-target-only", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://incident-room.test/api/recovery/rehearsal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentId: "INC-WEBMCP-001",
        scopeMode: "checkout",
        targetVersion: "payment-healthy",
        observedDeploymentId: "broken-version-id",
        reason: "Invalid target",
      }),
    });
    const response = await worker.fetch(request, {});
    const result = (await response.json()) as RecoveryResult;
    expect(result.status).toBe("INVALID_SCOPE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("server/fresh-rehearsal-requires-human-action-header", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      new Request("https://incident-room.test/api/lab/reset", { method: "POST" }),
      {},
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Fresh rehearsal requires the same-origin human action header.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("server/fresh-rehearsal-proves-checkout-500-and-healthy-payment", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/checkout")) return new Response("broken", { status: 500 });
      if (url === "https://checkout.test/health") {
        return jsonResponse({
          serviceId: "checkout",
          status: "DEGRADED",
          versionId: "broken-version-id",
          versionTag: "checkout-broken",
          checkedAt: "2026-08-30T11:01:00Z",
        });
      }
      if (url === "https://payment.test/health") {
        return jsonResponse({
          serviceId: "payment",
          status: "HEALTHY",
          versionId: "payment-version-id",
          versionTag: "payment-healthy",
          checkedAt: "2026-08-30T11:01:00Z",
        });
      }
      if (url.includes("incident-room-checkout/deployments") && init?.method === "POST") {
        return jsonResponse({
          success: true,
          result: {
            id: "fresh-deployment-id",
            created_on: "2026-08-30T11:01:00Z",
            versions: [{ percentage: 100, version_id: "broken-version-id" }],
          },
        });
      }
      if (url.includes("incident-room-checkout/deployments")) {
        return jsonResponse({
          success: true,
          result: {
            deployments: [
              {
                id: "fresh-deployment-id",
                created_on: "2026-08-30T11:01:00Z",
                versions: [{ percentage: 100, version_id: "broken-version-id" }],
              },
            ],
          },
        });
      }
      if (url.includes("incident-room-payment/deployments")) {
        return jsonResponse({
          success: true,
          result: {
            deployments: [
              {
                id: "payment-deployment-id",
                created_on: "2026-08-30T10:00:00Z",
                versions: [{ percentage: 100, version_id: "payment-version-id" }],
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env: Env = {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "test-token",
      CHECKOUT_WORKER_NAME: "incident-room-checkout",
      PAYMENT_WORKER_NAME: "incident-room-payment",
      CHECKOUT_BASE_URL: "https://checkout.test",
      PAYMENT_BASE_URL: "https://payment.test",
      CHECKOUT_BROKEN_VERSION_ID: "broken-version-id",
      CHECKOUT_HEALTHY_VERSION_ID: "healthy-version-id",
      CHECKOUT_CONCURRENT_VERSION_ID: "concurrent-version-id",
      PAYMENT_HEALTHY_VERSION_ID: "payment-version-id",
    };
    const response = await worker.fetch(
      new Request("https://incident-room.test/api/lab/reset", {
        method: "POST",
        headers: { "X-Incident-Room-Action": "start-rehearsal" },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "READY",
      resetDeploymentId: "fresh-deployment-id",
      checkoutVersionId: "broken-version-id",
      checkoutStatus: 500,
      paymentVersionId: "payment-version-id",
      paymentHealth: "HEALTHY",
    });
    const deploymentWrite = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).includes("incident-room-checkout/deployments") && init?.method === "POST",
    );
    expect(JSON.parse(String(deploymentWrite?.[1]?.body))).toMatchObject({
      versions: [{ percentage: 100, version_id: "broken-version-id" }],
      annotations: { "workers/message": "Start fresh Incident Room rehearsal" },
    });
  });

  test("server/stale-rejected-without-write", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/checkout")) return new Response("broken", { status: 500 });
      if (url.includes("/deployments") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          success: true,
          result: {
            deployments: [
              {
                id: "competing-deployment",
                created_on: "2026-08-30T11:00:00Z",
                versions: [{ percentage: 100, version_id: "concurrent-version-id" }],
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env: Env = {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "test-token",
      CHECKOUT_WORKER_NAME: "incident-room-checkout",
      CHECKOUT_BASE_URL: "https://checkout.test",
      CHECKOUT_HEALTHY_VERSION_ID: "healthy-version-id",
    };
    const response = await worker.fetch(
      recoveryRequest({ observedDeploymentId: "broken-deployment" }),
      env,
    );
    const result = (await response.json()) as RecoveryResult;
    expect(result.status).toBe("PLAN_STALE");
    expect(result.currentDeploymentId).toBe("competing-deployment");
    const deploymentWrites = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes("/deployments") && init?.method === "POST",
    );
    expect(deploymentWrites).toHaveLength(0);
  });

  test("server/healthy-checkout-is-rejected-without-write", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/checkout")) return new Response("healthy", { status: 200 });
      if (url.includes("/deployments") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          success: true,
          result: {
            deployments: [
              {
                id: "healthy-deployment",
                created_on: "2026-08-30T11:10:00Z",
                versions: [{ percentage: 100, version_id: "healthy-version-id" }],
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env: Env = {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "test-token",
      CHECKOUT_WORKER_NAME: "incident-room-checkout",
      CHECKOUT_BASE_URL: "https://checkout.test",
      CHECKOUT_HEALTHY_VERSION_ID: "healthy-version-id",
    };
    const response = await worker.fetch(
      recoveryRequest({ observedDeploymentId: "healthy-deployment" }),
      env,
    );
    const result = (await response.json()) as RecoveryResult;
    expect(result).toMatchObject({
      status: "EXECUTION_FAILED",
      currentDeploymentId: "healthy-deployment",
      healthBefore: 200,
      message: "Checkout already returns 200. Start a fresh rehearsal before submitting a Recovery Plan.",
    });
    const deploymentWrites = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).includes("/deployments") && init?.method === "POST",
    );
    expect(deploymentWrites).toHaveLength(0);
  });

  test("e2e/broken-to-recovered", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({
          serviceId: "checkout",
          status: "HEALTHY",
          versionId: "healthy-version-id",
          versionTag: "checkout-healthy",
          checkedAt: "2026-08-30T11:00:04Z",
        });
      }
      if (url.endsWith("/checkout")) {
        const probes = fetchMock.mock.calls.filter(([candidate]) =>
          String(candidate).endsWith("/checkout"),
        ).length;
        return new Response(probes === 1 ? "broken" : "healthy", {
          status: probes === 1 ? 500 : 200,
        });
      }
      if (url.includes("/deployments") && (!init?.method || init.method === "GET")) {
        return jsonResponse({
          success: true,
          result: {
            deployments: [
              {
                id: "broken-deployment",
                created_on: "2026-08-30T10:59:00Z",
                versions: [{ percentage: 100, version_id: "broken-version-id" }],
              },
            ],
          },
        });
      }
      if (url.includes("/deployments") && init?.method === "POST") {
        return jsonResponse({
          success: true,
          result: {
            id: "rollback-deployment-id",
            created_on: "2026-08-30T11:00:02Z",
            versions: [{ percentage: 100, version_id: "healthy-version-id" }],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env: Env = {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "test-token",
      CHECKOUT_WORKER_NAME: "incident-room-checkout",
      CHECKOUT_BASE_URL: "https://checkout.test",
      CHECKOUT_HEALTHY_VERSION_ID: "healthy-version-id",
    };
    const response = await worker.fetch(
      recoveryRequest({ observedDeploymentId: "broken-deployment" }),
      env,
    );
    const result = (await response.json()) as RecoveryResult;
    expect(result).toMatchObject({
      status: "RECOVERED",
      executionDeploymentId: "rollback-deployment-id",
      healthBefore: 500,
      healthAfter: 200,
    });
    const deploymentWrite = fetchMock.mock.calls.find(
      ([input, init]) => String(input).includes("/deployments") && init?.method === "POST",
    );
    const deploymentBody = JSON.parse(String(deploymentWrite?.[1]?.body));
    expect(deploymentBody.annotations).toEqual({
      "workers/message": "Recovery rehearsal for INC-WEBMCP-001",
    });
  });
});

function recoveryRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://incident-room.test/api/recovery/rehearsal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      incidentId: "INC-WEBMCP-001",
      scopeMode: "checkout",
      targetVersion: "checkout-healthy",
      observedDeploymentId: "broken-deployment",
      reason: "Restore the fixed checkout request.",
      ...overrides,
    }),
  });
}
