import {
  FIXTURE_INCIDENT,
  type IncidentSummary,
  type LabResetResult,
  type RecoveryResult,
  type RecoverySubmission,
} from "./domain";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | { message?: string }
    | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? payload.message
        : undefined;
    throw new ApiError(message ?? `Request failed with ${response.status}`, response.status);
  }
  return payload as T;
}

export async function fetchCurrentIncident(): Promise<IncidentSummary> {
  const response = await fetch("/api/incident/current", {
    headers: { Accept: "application/json" },
  });
  return readJson<IncidentSummary>(response);
}

export async function fetchIncidentWithFixture(): Promise<IncidentSummary> {
  try {
    return await fetchCurrentIncident();
  } catch {
    return FIXTURE_INCIDENT;
  }
}

export async function submitRecovery(
  submission: RecoverySubmission,
): Promise<RecoveryResult> {
  const response = await fetch("/api/recovery/rehearsal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
  return readJson<RecoveryResult>(response);
}

export async function startFreshRehearsal(): Promise<LabResetResult> {
  const response = await fetch("/api/lab/reset", {
    method: "POST",
    headers: { "X-Incident-Room-Action": "start-rehearsal" },
  });
  return readJson<LabResetResult>(response);
}
