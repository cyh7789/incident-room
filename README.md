# Incident Room

Incident Room is a WebMCP-powered recovery rehearsal for a dedicated Cloudflare lab. A browser agent inspects the incident and fills the Recovery Plan visible on the page. The operator edits the recovery scope and manually submits the form before any checkout deployment changes.

## Live demo

1. Open [incident-room.fongse.workers.dev](https://incident-room.fongse.workers.dev/) in ChatGPT's in-app browser or a WebMCP-capable Chrome browser.
2. Press **Start fresh rehearsal**. Wait until the Controller proves checkout returns 500 while payment remains healthy.
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

## Prepare the dedicated Cloudflare lab

Upload three versions of the same allowlisted checkout Worker and one payment version. Each command prints the immutable version ID that belongs in the Incident Room configuration.

```bash
npx wrangler versions upload -c lab-workers/checkout/wrangler.jsonc --tag checkout-broken --message "Fixed checkout returns 500" --var CHECKOUT_BEHAVIOR:broken
npx wrangler versions upload -c lab-workers/checkout/wrangler.jsonc --tag checkout-healthy --message "Fixed checkout returns 200" --var CHECKOUT_BEHAVIOR:healthy
npx wrangler versions upload -c lab-workers/checkout/wrangler.jsonc --tag checkout-concurrent --message "Competing version remains at 500" --var CHECKOUT_BEHAVIOR:concurrent
npx wrangler versions upload -c lab-workers/payment/wrangler.jsonc --tag payment-healthy --message "Payment remains healthy"
```

Deploy `checkout-broken` and `payment-healthy` at 100%, then record both public Worker URLs. Configure the four saved version IDs, two URLs, account ID, and fixed Worker names as Incident Room variables. Add `CLOUDFLARE_API_TOKEN` with `wrangler secret put`; never place it in a browser variable or committed file. The token must be limited to a dedicated lab account with Workers Scripts Write permission. Do not run the live recovery if that account contains assets outside this demo boundary.

## Current boundary

- WebMCP exposes two imperative tools and one declarative Recovery Plan form.
- `inspect_current_incident` reads the live incident and focuses the affected service; `show_change_comparison` renders the selected deployment change. Both are annotated read-only and untrusted-content.
- The form intentionally omits `toolautosubmit`; the operator must press Submit.
- The reset control is a normal human page action, not a WebMCP tool. It writes only the allowlisted broken checkout version and verifies checkout 500 before reporting READY.
- `POST /api/lab/competing-deployment` is a demo-only scenario control, not a WebMCP tool or Recovery Plan write. It writes only the allowlisted concurrent checkout version used to prove `PLAN_STALE` without rollback.
- Only manual submission of the visible Recovery Plan can enter the healthy recovery write path.
- The server can read and write only `incident-room-checkout` and read `incident-room-payment`.
- Cloudflare Service Bindings carry health and fixed checkout probes between the three dedicated Workers; the server-side API token is used only for allowlisted deployment reads and writes.
- Workers Logs are secondary evidence. Health, deployment responses, and the fixed checkout request are primary evidence.
- No production account, production data, remote MCP server, generic connector, or multi-user platform is supported.
