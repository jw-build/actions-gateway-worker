export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json(200, { ok: true });
    }

    if (url.pathname === "/debug-env") {
      const key = env.API_KEY || env.WRANGLER_API_KEY;
      return json(200, { API_KEY_set: !!key });
    }

    if (url.pathname !== "/v1/dispatch") {
      return json(404, { ok: false, error: "not_found" });
    }

    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" });
    }

    const expectedKey = env.API_KEY || env.WRANGLER_API_KEY;
    if (!expectedKey) {
      return json(500, { ok: false, error: "missing_api_key_config" });
    }
    const apiKey = request.headers.get("x-api-key");
    if (!apiKey || apiKey !== expectedKey) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: "invalid_json" });
    }

    const action = body?.action;
    const args = body?.args;
    let requestId = body?.request_id ?? crypto.randomUUID();

    if (!isNonEmptyString(action)) {
      return json(400, { ok: false, error: "invalid_action" });
    }
    if (!isPlainObject(args)) {
      return json(400, { ok: false, error: "invalid_args" });
    }

    const ACTIONS = {
      deploy: { event_type: "deploy", validateArgs: validateDeployArgs },
      rollback: { event_type: "rollback", validateArgs: validateRollbackArgs },
      scan: { event_type: "scan", validateArgs: () => null },
      report: { event_type: "report", validateArgs: () => null },
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

    const payload = {
      event_type: spec.event_type,
      client_payload: {
        request_id: requestId,
        action,
        args,
      },
    };

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
    } catch (error) {
      return json(502, {
        ok: false,
        error: "github_dispatch_failed",
        detail: String(error),
      });
    }

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
