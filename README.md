# Incident Room

Incident Room is a WebMCP-powered recovery rehearsal for a dedicated Cloudflare lab. A browser agent inspects the incident and fills the Recovery Plan visible on the page. The operator edits the recovery scope and manually submits the form before any checkout deployment changes.

## Live demo

1. Open [incident-room.fongse.workers.dev](https://incident-room.fongse.workers.dev/) in ChatGPT's in-app browser or a WebMCP-capable Chrome browser.
2. Press **Start 100-second demo**. Wait until the Controller proves checkout returns 500 while payment remains healthy.
3. Ask the agent: **Inspect the current incident, compare the suspected deployment change, then prepare a Recovery Plan for me to review.** The agent calls two read tools, then fills the visible Recovery Plan.
4. Review the mounted form, change **Recovery scope** to **Checkout only**, edit the reason if needed, then personally press **Submit**.
5. If the Controller returns `PLAN_STALE`, refresh the evidence, revise the plan, and submit again. Recovery succeeds only when the same fixed checkout request changes from 500 to 200.

The public site uses one shared dedicated lab, so a later rehearsal can make an older Recovery Plan stale by design.

ChatGPT's built-in browser currently lists the two imperative tools as Site tools. Chrome WebMCP also discovers the declarative Recovery Plan form. In ChatGPT, the agent can fill that visible form through regular browser interaction; in both browsers, the operator personally submits it.

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

The required path covers WebMCP discovery, shared visible state, human-only lab reset, declarative manual submit, lifecycle cleanup, server allowlists, stale rejection without rollback, and the real broken-to-recovered flow.

## Connect your own Cloudflare Workers

Incident Room is not tied to the public rehearsal names. A self-hosted deployment can connect another checkout and payment pair through Cloudflare configuration without changing the Incident Room application code.

The connected Workers must provide this narrow contract:

- Checkout and payment expose `GET /health`. The JSON response contains `serviceId`, `status`, `versionId`, `versionTag`, and `checkedAt`. The reported `versionId` must match the active deployment returned by the Cloudflare Workers Deployments API.
- Checkout exposes `POST /checkout` for the deterministic probe `{ "cartId": "incident-room-fixed-cart", "total": 42 }`. Its real HTTP status is the before-and-after recovery proof.
- `CHECKOUT_SERVICE` and `PAYMENT_SERVICE` are required Cloudflare Service Bindings to those Workers. The Controller returns 503 rather than silently switching transports when either binding is missing. Change the two `service` values in `wrangler.jsonc` when deploying against your own names.
- `CHECKOUT_WORKER_NAME` and `PAYMENT_WORKER_NAME` identify the same two Workers to the Workers Deployments API. They must be different. The Controller never writes to the configured payment Worker.
- The three checkout version IDs and the payment version ID are an immutable server-side allowlist. A recovery can deploy only `CHECKOUT_HEALTHY_VERSION_ID`; reset and stale-rehearsal controls use the other two checkout IDs.

Set `EVIDENCE_SOURCE_MODE=SELF_HOSTED`, give the source a visible `EVIDENCE_SOURCE_LABEL`, and optionally change `INCIDENT_ID` and `INCIDENT_TITLE`. Keep `CLOUDFLARE_API_TOKEN` server-only. It needs account-level Workers Scripts Write permission because the same API reads deployment IDs and performs the guarded rollback. Use a dedicated account for this recovery boundary; Controller code still permits deployment writes only to `CHECKOUT_WORKER_NAME` and its allowlisted version IDs.

This contract proves the integration boundary without introducing a generic connector or remote MCP server. The synchronous evidence path is Service Bindings, health and fixed probe responses, deployment IDs, and the Controller response. Workers Logs remain secondary evidence.

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

- WebMCP exposes two imperative tools and one declarative Recovery Plan form.
- The Live incident track previews the next tool or form handoff at each recovery step.
- `inspect_current_incident` reads the live incident and focuses the affected service; `show_change_comparison` renders the selected deployment change. Both are annotated read-only and untrusted-content.
- The form intentionally omits `toolautosubmit`; the operator must press Submit.
- The reset control is a normal human page action, not a WebMCP tool. It writes only the allowlisted broken checkout version and verifies checkout 500 before reporting READY.
- `POST /api/lab/competing-deployment` is a demo-only scenario control, not a WebMCP tool or Recovery Plan write. It requires the same-origin `X-Incident-Room-Action: make-plan-stale` header and writes only the allowlisted concurrent checkout version used to prove `PLAN_STALE` without rollback.
- Only manual submission of the visible Recovery Plan can enter the healthy recovery write path.
- The public deployment can read and write only its configured checkout Worker and read its configured payment Worker. Self-hosted deployments can replace those names and bindings, but cannot widen the write path beyond the configured checkout Worker.
- Cloudflare Service Bindings carry health and fixed checkout probes between the three dedicated Workers; the server-side API token is used only for allowlisted deployment reads and writes.
- Workers Logs are secondary evidence. Health, deployment responses, and the fixed checkout request are primary evidence.
- No production account, production data, remote MCP server, generic connector, or multi-user platform is supported.
