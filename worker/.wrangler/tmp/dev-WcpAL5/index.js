var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Secret"
};
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true }, { headers: CORS });
    }
    if (url.pathname === "/ingest" && request.method === "POST") {
      if (request.headers.get("X-Secret") !== env.WORKER_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        return await handleIngest(request, env);
      } catch (e) {
        return Response.json({ error: e.message, stack: e.stack }, { status: 500 });
      }
    }
    if (url.pathname === "/listings" && request.method === "GET") {
      return handleListings(request, env);
    }
    if (url.pathname === "/listing" && request.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id required" }, { status: 400, headers: CORS });
      const row = await env.DB.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first();
      if (!row) return Response.json({ error: "not found" }, { status: 404, headers: CORS });
      return Response.json({ listing: row }, { headers: CORS });
    }
    if (url.pathname === "/snapshots" && request.method === "GET") {
      return handleSnapshots(request, env);
    }
    return new Response("Not found", { status: 404 });
  }
};
async function handleIngest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { listings } = body;
  if (!Array.isArray(listings)) {
    return Response.json({ error: "listings must be an array" }, { status: 400 });
  }
  let inserted = 0;
  let updated = 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const today = now.split("T")[0];
  for (const l of listings) {
    const existing = await env.DB.prepare(
      "SELECT id FROM listings WHERE source = ? AND url = ?"
    ).bind(l.source, l.url).first();
    if (!existing) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO listings (id, model_id, source, url, title, year, km, price, price_financed, image_url, province, dealer_name, is_professional, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        l.id,
        l.model_id,
        l.source,
        l.url,
        l.title ?? null,
        l.year ?? null,
        l.km ?? null,
        l.price ?? null,
        l.price_financed ?? null,
        l.image_url ?? null,
        l.province ?? null,
        l.dealer_name ?? null,
        l.is_professional ?? 1,
        today,
        today
      ).run();
      inserted++;
    } else {
      await env.DB.prepare(
        "UPDATE listings SET last_seen = ?, km = ?, price = ?, price_financed = ?, image_url = ?, title = ? WHERE id = ?"
      ).bind(today, l.km ?? null, l.price ?? null, l.price_financed ?? null, l.image_url ?? null, l.title ?? null, existing.id).run();
      updated++;
    }
    if (l.price) {
      const listingId = existing ? existing.id : l.id;
      await env.DB.prepare(
        "INSERT INTO price_snapshots (listing_id, price, km, scraped_at) VALUES (?, ?, ?, ?)"
      ).bind(listingId, l.price, l.km ?? null, now).run();
    }
  }
  return Response.json({ inserted, updated }, { headers: CORS });
}
__name(handleIngest, "handleIngest");
async function handleListings(request, env) {
  const url = new URL(request.url);
  const modelId = url.searchParams.get("model_id");
  const query = modelId ? "SELECT * FROM listings WHERE model_id = ? ORDER BY price ASC" : "SELECT * FROM listings ORDER BY model_id, price ASC";
  const { results } = modelId ? await env.DB.prepare(query).bind(modelId).all() : await env.DB.prepare(query).all();
  return Response.json({ listings: results }, { headers: CORS });
}
__name(handleListings, "handleListings");
async function handleSnapshots(request, env) {
  const url = new URL(request.url);
  const listingId = url.searchParams.get("listing_id");
  if (!listingId) {
    return Response.json({ error: "listing_id required" }, { status: 400, headers: CORS });
  }
  const { results } = await env.DB.prepare(
    "SELECT * FROM price_snapshots WHERE listing_id = ? ORDER BY scraped_at ASC"
  ).bind(listingId).all();
  return Response.json({ snapshots: results }, { headers: CORS });
}
__name(handleSnapshots, "handleSnapshots");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ZoAUYV/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ZoAUYV/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
