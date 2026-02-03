# actions-gateway-worker

Cloudflare Worker: exposes HTTP API (`/v1/dispatch`), validates requests, then forwards to GitHub `repository_dispatch` so the target repo’s Actions run.

## Repo structure

| File | Description |
|------|-------------|
| `worker.js` | Cloudflare Worker entry (Phase 1): `/health`, POST `/v1/dispatch` |
| `.github/workflows/worker.yml` | Workflow that runs in Actions when this repo receives a dispatch |
| `worker/run.py` | Actions-side script invoked by the workflow |

## Protocol (Phase 1)

- **Request**: `POST /v1/dispatch`, Header `x-api-key`, Body `{ action, args, request_id? }`
- **action**: `deploy` \| `rollback` \| `scan` \| `report`
- **args**: validated per action (e.g. deploy needs `env` + `version`, rollback needs `env` + `to`)
- After validation, the Worker calls GitHub `repos/{GH_OWNER}/{GH_REPO}/dispatches`

## Step 3 | Cloudflare Secrets / Vars (required, not in repo)

Configure under **Cloudflare Dashboard → Workers & Pages → your Worker → Settings → Variables**:

**Secrets (encrypted)**

| Variable | Description |
|----------|-------------|
| `API_KEY` | Your secret; request header `x-api-key` must match this |
| `GH_TOKEN` | GitHub Fine-grained PAT with repo access to trigger dispatch on the target repo |

**Variables (plain)**

| Variable | Value |
|----------|-------|
| `GH_OWNER` | `jw-build` |
| `GH_REPO` | `cloudflare-worker-actions-gateway` |

After saving, the Worker sends dispatches to the `jw-build/cloudflare-worker-actions-gateway` repo.

## Local run (Actions side)

```bash
ACTION=ping ENV=dev REQUEST_ID=req-001 python3 worker/run.py
```
