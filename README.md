# Incident Room

Incident Room is a WebMCP-powered recovery rehearsal for a dedicated Cloudflare lab. A browser agent inspects the incident and fills the Recovery Plan visible on the page. The operator edits the recovery scope and manually submits the form before any checkout deployment changes.

## Live demo

1. Open [incident-room.fongse.workers.dev](https://incident-room.fongse.workers.dev/) in ChatGPT's in-app browser or a WebMCP-capable Chrome browser.
2. Press **Start 100-second demo**. Wait until the Controller proves checkout returns 500 while payment remains healthy.
3. Ask the agent: **Inspect the current incident, compare the suspected deployment change, then prepare a Recovery Plan for me to review.** The agent calls the incident and comparison tools, then fills the visible Recovery Plan.
4. Inspect the proposed operation: stale precheck, checkout-only deployment of `checkout-healthy`, no payment write, then the same fixed request must change from 500 to 200.
5. Change **Recovery scope** to **Checkout only**, edit the reason if needed, then personally press **Submit**.
6. If the Controller returns `PLAN_STALE`, refresh the evidence, revise the plan, and submit again. Recovery succeeds only when the same fixed checkout request changes from 500 to 200.
7. After 200 is verified, the page immediately shows a fix-forward baseline plus hold-rollback and emergency-hotfix alternatives. The agent can call `propose_remediation_options` to replace that baseline with its evidence-backed diagnosis, recommendation, and rationale. A human records the final choice, then the page produces the matching simulated issue and acceptance steps.

The public site uses one shared dedicated lab, so a later rehearsal can make an older Recovery Plan stale by design.

ChatGPT's built-in browser lists the three imperative tools as Site tools. Chrome WebMCP also discovers the declarative Recovery Plan form. In ChatGPT, the agent can fill that visible form through regular browser interaction; in both browsers, the operator personally submits recovery and personally chooses the permanent-fix path.

## Run locally

```bash
git clone https://github.com/cyh7789/incident-room.git
cd incident-room
npm install
npm run dev
```

The Vite view uses a clearly labelled local fixture until the Cloudflare Worker API is configured. It never reports a real recovery from fixture data.

For the full Worker runtime, copy `.dev.vars.example` to `.dev.vars`, fill only the dedicated lab values, then run:

```bash
npm run dev:worker
```

Open the printed URL in ChatGPT's in-app browser or Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled.

## Verify

```bash
npm run check
npm run check:lab
```

The required path covers WebMCP discovery, shared visible state, human-only lab reset, declarative manual submit, lifecycle cleanup, server allowlists, stale rejection without rollback, the real broken-to-recovered flow, and a visible remediation decision with optional agent refinement after recovery.

## Connect your own Cloudflare Workers

Incident Room is not tied to the public rehearsal names. A self-hosted deployment can connect another checkout and payment pair by adding the narrow endpoint contract and changing Cloudflare deployment configuration. The Controller, WebMCP tools, Recovery Plan, stale gate, and rollback code do not change.

The actual connection path is:

```text
checkout + payment Workers
  → Cloudflare Service Bindings for private health/probe reads
  → Incident Room Controller
  → Cloudflare Workers Deployments API for allowlisted checkout rollback
  → Recovery Plan in the browser for agent preparation and human Submit
```

### 1. Add the endpoint contract to your Workers

The connected Workers must provide this narrow contract:

- Checkout and payment expose `GET /health`. The JSON response contains `serviceId`, `status`, `versionId`, `versionTag`, and `checkedAt`. The reported `versionId` must match the active deployment returned by the Cloudflare Workers Deployments API.
- Checkout exposes `POST /checkout` for the deterministic probe `{ "cartId": "incident-room-fixed-cart", "total": 42 }`. Its real HTTP status is the before-and-after recovery proof.

Use `CF_VERSION_METADATA.id` in the health response so the Controller can prove that application health and the active deployment refer to the same immutable Worker version. The included [`lab-workers/checkout/index.ts`](lab-workers/checkout/index.ts) and [`lab-workers/payment/index.ts`](lab-workers/payment/index.ts) are executable reference implementations, not fixture-only pseudocode.

### 2. Bind the same Workers to the Controller

Change only the two `service` values in `wrangler.jsonc`:

```jsonc
"services": [
  { "binding": "CHECKOUT_SERVICE", "service": "your-checkout-worker" },
  { "binding": "PAYMENT_SERVICE", "service": "your-payment-worker" }
]
```

`CHECKOUT_SERVICE` and `PAYMENT_SERVICE` are required Cloudflare Service Bindings. The Controller returns 503 rather than silently switching transports when either binding is missing.

### 3. Configure names, URLs, and the version allowlist

Copy `.dev.vars.example` and fill these server-side values:

```bash
cp .dev.vars.example .dev.vars
```

- `CHECKOUT_WORKER_NAME` and `PAYMENT_WORKER_NAME` identify the same two bound Workers to the Workers Deployments API. They must be different. The Controller never writes to the configured payment Worker.
- `CHECKOUT_BASE_URL` and `PAYMENT_BASE_URL` provide the request origins used with the Service Bindings.
- `CHECKOUT_BROKEN_VERSION_ID`, `CHECKOUT_HEALTHY_VERSION_ID`, and `CHECKOUT_CONCURRENT_VERSION_ID` form the checkout allowlist for the recovery rehearsal.
- `PAYMENT_HEALTHY_VERSION_ID` pins the read-only payment evidence.
- `EVIDENCE_SOURCE_MODE=SELF_HOSTED` and `EVIDENCE_SOURCE_LABEL` make the connected source visible on the page.

The three checkout versions are deliberate rehearsal controls, not a generic production rollout model. Recovery can deploy only `CHECKOUT_HEALTHY_VERSION_ID`; reset and stale-plan proof use the other two allowlisted checkout versions.

### 4. Add the server-only Cloudflare credential and deploy

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
npm run deploy
```

Optionally change `INCIDENT_ID` and `INCIDENT_TITLE`. Keep `CLOUDFLARE_API_TOKEN` server-only. It needs account-level Workers Scripts Write permission because the same API reads deployment IDs and performs the guarded rollback. Use a dedicated account for this recovery boundary; Controller code still permits deployment writes only to `CHECKOUT_WORKER_NAME` and its allowlisted version IDs.

Verify the connection by opening `/api/incident/current`. Success is HTTP 200 with your `EVIDENCE_SOURCE_LABEL`, Worker names, health, and active deployment IDs. Then run the demo and confirm the page shows the exact rollback operation before Submit.

This contract proves the integration boundary without introducing a generic connector, SDK package, log server, or remote MCP server. The synchronous evidence path is Service Bindings, health and fixed probe responses, deployment IDs, and the Controller response. Workers Logs remain secondary evidence.

## Recovery versus permanent fix

The 100-second path performs the emergency treatment that is safe to demonstrate: an allowlisted checkout rollback followed by same-request verification. A code fix is a separate engineering decision after service recovery.

After a verified rollback, the page immediately places three paths on the live page: fix forward through a reviewed PR, hold the rollback while investigating, or prepare an emergency hotfix. `propose_remediation_options` can replace the baseline diagnosis and recommendation with the agent's evidence-backed proposal. A person can choose any path. The page then displays a matching simulated issue draft containing the regressed deployment, the 500 → 200 proof, the payment exclusion, and acceptance steps. It does not call GitHub or claim that an issue, PR, or deployment exists.

## Prepare the included rehearsal Workers

Upload three versions of the same allowlisted checkout Worker and one payment version. Each command prints the immutable version ID that belongs in the Incident Room configuration.

```bash
npx wrangler versions upload -c lab-workers/checkout/wrangler.jsonc --tag checkout-broken --message "Fixed checkout returns 500" --var CHECKOUT_BEHAVIOR:broken
npx wrangler versions upload -c lab-workers/checkout/wrangler.jsonc --tag checkout-healthy --message "Fixed checkout returns 200" --var CHECKOUT_BEHAVIOR:healthy
npx wrangler versions upload -c lab-workers/checkout/wrangler.jsonc --tag checkout-concurrent --message "Competing version remains at 500" --var CHECKOUT_BEHAVIOR:concurrent
npx wrangler versions upload -c lab-workers/payment/wrangler.jsonc --tag payment-healthy --message "Payment remains healthy"
```

Deploy `checkout-broken` and `payment-healthy` at 100%, then record both public Worker URLs. Configure the four saved version IDs, two URLs, account ID, and Worker names as Incident Room variables. Add `CLOUDFLARE_API_TOKEN` with `wrangler secret put`; never place it in a browser variable or committed file. The token must be limited to a dedicated lab account with Workers Scripts Write permission. Do not run the live recovery if that account contains assets outside this demo boundary.

## Current boundary

- WebMCP exposes three imperative tools and one declarative Recovery Plan form.
- The Live incident track previews the next tool or form handoff at each recovery step.
- `inspect_current_incident` reads the live incident and focuses the affected service; `show_change_comparison` renders the selected deployment change; `propose_remediation_options` places a recommendation and three alternatives on the recovered page. All three are annotated read-only and untrusted-content because none performs an external write.
- The form intentionally omits `toolautosubmit`; the operator must press Submit.
- The reset control is a normal human page action, not a WebMCP tool. It writes only the allowlisted broken checkout version and verifies checkout 500 before reporting READY.
- `POST /api/lab/competing-deployment` is a demo-only scenario control, not a WebMCP tool or Recovery Plan write. It requires the same-origin `X-Incident-Room-Action: make-plan-stale` header and writes only the allowlisted concurrent checkout version used to prove `PLAN_STALE` without rollback.
- Only manual submission of the visible Recovery Plan can enter the healthy recovery write path.
- The public deployment can read and write only its configured checkout Worker and read its configured payment Worker. Self-hosted deployments can replace those names and bindings, but cannot widen the write path beyond the configured checkout Worker.
- Cloudflare Service Bindings carry health and fixed checkout probes between the three dedicated Workers; the server-side API token is used only for allowlisted deployment reads and writes.
- Workers Logs are secondary evidence. Health, deployment responses, and the fixed checkout request are primary evidence.
- No production account, production data, remote MCP server, generic connector, or multi-user platform is supported.
