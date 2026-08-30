import { useEffect, useState } from "react";
import type { IncidentSummary } from "./domain";

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
  ) => Promise<unknown>;
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
            "Inspect the incident open in this tab and visibly focus the affected service. Use before preparing or refreshing a recovery plan.",
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
            return actions.inspectCurrentIncident(sinceMinutes, "AGENT");
          },
        },
        { signal: controller.signal },
      ),
      modelContext.registerTool(
        {
          name: "show_change_comparison",
          description:
            "Open the visible comparison for a suspected change already listed in the current incident.",
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
            return actions.showChangeComparison(input.changeId, "AGENT");
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
