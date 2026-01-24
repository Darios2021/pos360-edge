/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL (SHOP OK + API OK + APP OK)
 * - /shop*   -> frontend
 * - /api/v1* -> API passthrough
 * - /api*    -> alias => /api/v1
 * - /app*    -> admin (strip /app) + Location rewrite + Cookie Path rewrite
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}
function mustEnv(name) {
  const v = env(name, "");
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const APP_UPSTREAM = env("APP_UPSTREAM", "");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_V1_TARGET = `${API_ORIGIN.replace(/\/$/, "")}/api/v1`;

app.disable("x-powered-by");

// ---------------- helpers ----------------
function setForwardedHeaders(proxyReq, req, extra = {}) {
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
  proxyReq.setHeader(
    "X-Forwarded-Proto",
    req.headers["x-forwarded-proto"] || req.protocol || "https"
  );
  proxyReq.setHeader("X-Real-IP", req.headers["x-real-ip"] || req.ip || "");
  proxyReq.setHeader("X-Forwarded-For", req.headers["x-forwarded-for"] || req.ip || "");
  Object.entries(extra).forEach(([k, v]) => proxyReq.setHeader(k, v));
}

function proxyError(where) {
  return (err, _req, res) => {
    console.error(`[${where}] proxy error:`, err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end(`Bad gateway (${where})`);
  };
}

function normalizeShopLocation(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;
  if (loc === "/shop") proxyRes.headers.location = "/shop/";
  if (loc === "/shop//") proxyRes.headers.location = "/shop/";
}

function rewriteLocationToApp(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;

  // no tocar si ya viene con /app
  if (loc.startsWith("/app/") || loc === "/app") return;

  // reescribe redirects relativos al host
  if (loc.startsWith("/")) proxyRes.headers.location = "/app" + loc;
}

function rewriteSetCookiePathToApp(proxyRes) {
  const sc = proxyRes.headers["set-cookie"];
  if (!sc) return;

  const fix = (cookie) => {
    // si no trae Path, dejamos (pero en la práctica suele traer)
    // si trae Path=/ lo cambiamos a /app
    return cookie.replace(/;\s*Path=\/(\s*;|$)/i, "; Path=/app$1");
  };

  if (Array.isArray(sc)) {
    proxyRes.headers["set-cookie"] = sc.map(fix);
  } else if (typeof sc === "string") {
    proxyRes.headers["set-cookie"] = fix(sc);
  }
}

// ---------------- health ----------------
app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    service: "pos360-edge",
    shop: SHOP_UPSTREAM,
    app: APP_UPSTREAM || "(missing)",
    api: API_V1_TARGET,
  })
);

// root
app.get("/", (_req, res) => res.redirect(301, "/shop/"));

// ---------------- /api/v1 passthrough ----------------
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },
    onError: proxyError("api-v1"),
  })
);

// ---------------- /api alias -> /api/v1 ----------------
app.use(
  "/api",
  createProxyMiddleware({
    target: API_V1_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,
    pathRewrite: (path) => path.replace(/^\/api/, "") || "/",
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },
    onError: proxyError("api"),
  })
);

// ---------------- /app -> admin ----------------
app.use("/app", (req, res, next) => {
  if (!APP_UPSTREAM) {
    return res.status(500).send("EDGE misconfig: missing APP_UPSTREAM env (needed for /app*)");
  }
  return next();
});

app.use(
  "/app",
  createProxyMiddleware({
    target: () => mustEnv("APP_UPSTREAM"),
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,

    // ✅ STRIP /app hacia upstream
    pathRewrite: (path) => path.replace(/^\/app/, "") || "/",

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
    },

    onProxyRes(proxyRes) {
      rewriteLocationToApp(proxyRes);
      rewriteSetCookiePathToApp(proxyRes);
    },

    onError: proxyError("app"),
  })
);

// ---------------- /shop -> frontend ----------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/shop" });
    },
    onProxyRes(proxyRes) {
      normalizeShopLocation(proxyRes);
    },
    onError: proxyError("shop"),
  })
);

// fallback
app.use((req, res) => res.redirect(301, "/shop/"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop -> ${SHOP_UPSTREAM}`);
  console.log(`   app  -> ${APP_UPSTREAM || "(missing)"}`);
  console.log(`   api  -> ${API_V1_TARGET}`);
});
