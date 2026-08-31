import { useEffect, useState } from "react";
import type { ChangeComparison, IncidentSummary } from "./domain";

export type WebMcpStatus = "REGISTERING" | "READY" | "UNSUPPORTED" | "ERROR";

interface ToolExecutionOptions {
  signal?: AbortSignal;
}

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: ToolExecutionOptions,
  ) => unknown | Promise<unknown>;
}

interface ModelContext {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

interface WebMcpActions {
  inspectCurrentIncident: (
    sinceMinutes?: number,
    source?: "AGENT" | "HUMAN",
  ) => Promise<IncidentSummary>;
  showChangeComparison: (
    changeId: string,
    source?: "AGENT" | "HUMAN",
  ) => Promise<ChangeComparison>;
}

export function useWebMcpTools(actions: WebMcpActions): WebMcpStatus {
  const [status, setStatus] = useState<WebMcpStatus>("REGISTERING");

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) {
      setStatus("UNSUPPORTED");
      return;
    }

    const controller = new AbortController();
    setStatus("REGISTERING");

    const registrations = [
      modelContext.registerTool(
        {
          name: "inspect_current_incident",
          description:
            "Inspect the incident open in this tab and visibly focus the affected service. If checkout is healthy, stop and ask the human to start the 100-second demo. If checkout is degraded and payment is healthy, continue with show_change_comparison.",
          inputSchema: {
            type: "object",
            properties: {
              sinceMinutes: {
                type: "integer",
                minimum: 1,
                maximum: 30,
                description: "Optional incident lookback window from 1 to 30 minutes.",
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (input) => {
            const value = input.sinceMinutes;
            const sinceMinutes = typeof value === "number" ? value : undefined;
            const incident = await actions.inspectCurrentIncident(sinceMinutes, "AGENT");
            const recoveryReady =
              incident.health.checkout === "DEGRADED" && incident.health.payment === "HEALTHY";
            return {
              ...incident,
              recoveryReady,
              nextAction: recoveryReady
                ? "Call show_change_comparison with the suspected change ID. The result will open the visible rollback proposal for review."
                : "Stop. Ask the human to press Start 100-second demo in this page, then inspect the incident again.",
            };
          },
        },
        { signal: controller.signal },
      ),
      modelContext.registerTool(
        {
          name: "show_change_comparison",
          description:
            "Open the visible comparison for a suspected change already listed in the current incident. The result advances this same page to the mounted Recovery Plan and exact checkout rollback proposal.",
          inputSchema: {
            type: "object",
            properties: {
              changeId: {
                type: "string",
                maxLength: 128,
                description: "A change ID returned by inspect_current_incident.",
              },
            },
            required: ["changeId"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (input) => {
            if (typeof input.changeId !== "string") {
              throw new Error("changeId is required");
            }
            const comparison = await actions.showChangeComparison(input.changeId, "AGENT");
            return {
              ...comparison,
              nextAction:
                "The Recovery Plan and exact checkout rollback operation are now visible in this tab. Fill its visible fields for human review, but do not submit it.",
            };
          },
        },
        { signal: controller.signal },
      ),
    ];

    Promise.all(registrations.map((registration) => Promise.resolve(registration)))
      .then(() => {
        if (!controller.signal.aborted) setStatus("READY");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("ERROR");
      });

    return () => controller.abort();
  }, [actions]);

  return status;
}
