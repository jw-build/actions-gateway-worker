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

## Next steps after deploy

1. **Set Cloudflare Variables** (if not done): Worker → Settings → Variables → add `API_KEY`, `GH_TOKEN` (Secrets), `GH_OWNER`, `GH_REPO` (Variables). Redeploy or use “Save and deploy” so the Worker picks them up.

2. **Target repo**: Ensure `jw-build/cloudflare-worker-actions-gateway` exists and has a workflow that listens for `repository_dispatch` with event types `deploy`, `rollback`, `scan`, `report` (and uses `client_payload.action` / `client_payload.args`).

3. **Test health**:  
   `curl https://actions-gateway-worker.<your-subdomain>.workers.dev/health`  
   Expect: `{"ok":true}`.

4. **Test dispatch** (replace `<API_KEY>` and base URL):
   ```bash
   curl -X POST https://actions-gateway-worker.<your-subdomain>.workers.dev/v1/dispatch \
     -H "x-api-key: <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"action":"scan","args":{},"request_id":"test-001"}'
   ```
   Expect: `{"ok":true,"dispatched":true,"request_id":"test-001"}` if GitHub returns 204.

## Troubleshooting errors

| Error | Meaning | Fix |
|-------|---------|-----|
| `missing_api_key_config` | Worker has no `API_KEY` secret set. | Add `API_KEY` in Cloudflare → Worker → Settings → Variables, then redeploy. |
| `missing_github_config` | `GH_OWNER`, `GH_REPO`, or `GH_TOKEN` is missing. | Add the missing variable/secret and redeploy. |
| `github_dispatch_failed` | GitHub rejected the dispatch. | Check `status`/`response` for details; verify token scopes, repo name, and workflow `repository_dispatch` config. |

## Local run (Actions side)

```bash
ACTION=ping ENV=dev REQUEST_ID=req-001 python3 worker/run.py
```
