// worker.js
// Cloudflare Worker: Actions Gateway (v1)
// - Auth via x-api-key against env.API_KEY / env.WRANGLER_API_KEY / env.API_KEYS (comma-separated)
// - POST /v1/dispatch accepts { action, args, request_id? }
// - Validates action + args schema
// - Dispatches to GitHub repository_dispatch with event_type="dispatch" (fixed)
// - Places { request_id, action, args } under client_payload

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- health ----
    if (url.pathname === "/health") {
      return json(200, { ok: true });
    }

    // ---- debug env ----
    if (url.pathname === "/debug-env") {
      const keys = getAcceptedKeys(env);
      return json(200, {
        API_KEY_set: !!env.API_KEY,
        WRANGLER_API_KEY_set: !!env.WRANGLER_API_KEY,
        API_KEYS_set: !!env.API_KEYS,
        accepted_keys_count: keys.length,
        GH_OWNER_set: !!env.GH_OWNER,
        GH_REPO_set: !!env.GH_REPO,
        GH_TOKEN_set: !!env.GH_TOKEN,
      });
    }

    // ---- routing ----
    if (url.pathname !== "/v1/dispatch") {
      return json(404, { ok: false, error: "not_found" });
    }
    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    // ---- auth ----
    const acceptedKeys = getAcceptedKeys(env);
    if (acceptedKeys.length === 0) {
      return json(500, { ok: false, error: "missing_api_key_config" });
    }
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey || !acceptedKeys.includes(apiKey)) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    // ---- parse body ----
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: "invalid_json" });
    }

    const action = body?.action;
    const args = body?.args;
    const requestId = isNonEmptyString(body?.request_id)
      ? body.request_id
      : crypto.randomUUID();

    if (!isNonEmptyString(action)) {
      return json(400, { ok: false, error: "invalid_action" });
    }
    if (!isPlainObject(args)) {
      return json(400, { ok: false, error: "invalid_args" });
    }

    // ---- action policy + validation ----
    const ACTIONS = {
      deploy: { validateArgs: validateDeployArgs },
      rollback: { validateArgs: validateRollbackArgs },
      scan: { validateArgs: () => null },
      report: { validateArgs: () => null },
      ping: { validateArgs: () => null }, // optional: allow ping end-to-end
    };

    const spec = ACTIONS[action];
    if (!spec) {
      return json(400, {
        ok: false,
        error: "action_not_allowed",
        allowed: Object.keys(ACTIONS),
      });
    }

    const err = spec.validateArgs(args);
    if (err) {
      return json(400, { ok: false, error: "args_not_valid", detail: err });
    }

    // ---- github config ----
    if (!env.GH_OWNER || !env.GH_REPO || !env.GH_TOKEN) {
      return json(500, {
        ok: false,
        error: "missing_github_config",
        detail: {
          GH_OWNER: !!env.GH_OWNER,
          GH_REPO: !!env.GH_REPO,
          GH_TOKEN: !!env.GH_TOKEN,
        },
      });
    }

    // ---- github dispatch payload ----
    // IMPORTANT: event_type is fixed to "dispatch"
    // Workflow should use:
    //   on:
    //     repository_dispatch:
    //       types: [dispatch]
    const payload = {
      event_type: "dispatch",
      client_payload: {
        request_id: requestId,
        action,
        args,
      },
    };

    const ghUrl = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`;

    let res;
    try {
      res = await fetch(ghUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "actions-gateway-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json(502, {
        ok: false,
        error: "github_dispatch_failed",
        detail: String(e),
      });
    }

    // GitHub returns 204 No Content on success
    if (res.status === 204) {
      return json(200, { ok: true, dispatched: true, request_id: requestId });
    }

    const responseBody = await res.text();
    return json(502, {
      ok: false,
      error: "github_dispatch_failed",
      status: res.status,
      response: responseBody,
    });
  },
};

// ---------- helpers ----------

function getAcceptedKeys(env) {
  const keys = [];
  if (env.API_KEY) keys.push(String(env.API_KEY));
  if (env.WRANGLER_API_KEY) keys.push(String(env.WRANGLER_API_KEY));
  if (env.API_KEYS) {
    const extra = String(env.API_KEYS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    keys.push(...extra);
  }
  return Array.from(new Set(keys));
}

function validateDeployArgs(args) {
  if (!["dev", "staging", "prod"].includes(args.env)) {
    return "env must be dev|staging|prod";
  }
  if (typeof args.version !== "string") {
    return "version must be string";
  }
  return null;
}

function validateRollbackArgs(args) {
  if (!["dev", "staging", "prod"].includes(args.env)) {
    return "env must be dev|staging|prod";
  }
  if (typeof args.to !== "string") {
    return "to must be string";
  }
  return null;
}

function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim() !== "";
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
