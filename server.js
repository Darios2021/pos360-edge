/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL (FIX redirects to internal host)
 * Reverse proxy por PATH:
 * - /        -> /shop/
 * - /shop*   -> TIENDA (sin strip)   ✅ NO fuerza Host interno (evita Location srv-captain)
 * - /api/v1* -> API passthrough      (Host interno OK)
 * - /api*    -> alias => /api/v1/*
 * - /app*    -> ADMIN (strip /app) + Location rewrite + Cookie Path=/app
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

function normalizeHttpUrl(name, value, fallback) {
  const v = env(name, value ?? fallback ?? "");
  if (!v) throw new Error(`Missing required env: ${name}`);
  if (/^https?:\/\//i.test(v)) return v;
  return `http://${v}`;
}

function asUrl(name, raw) {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL: "${raw}"`);
  }
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// ✅ PUBLIC_BASE_URL: se usa para reescritura de Location absoluto
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "");

// ✅ Targets
const SHOP_UPSTREAM_RAW = normalizeHttpUrl(
  "SHOP_UPSTREAM",
  env("SHOP_UPSTREAM"),
  "http://srv-captain--pos360-frontend"
);
const APP_UPSTREAM_RAW = normalizeHttpUrl(
  "APP_UPSTREAM",
  env("APP_UPSTREAM"),
  "http://srv-captain--pos360-admin:80"
);
const API_ORIGIN_RAW = normalizeHttpUrl(
  "API_ORIGIN",
  env("API_ORIGIN"),
  "http://srv-captain--pos360-commerce-api:3000"
);

const SHOP_UPSTREAM = asUrl("SHOP_UPSTREAM", SHOP_UPSTREAM_RAW);
const APP_UPSTREAM = asUrl("APP_UPSTREAM", APP_UPSTREAM_RAW);
const API_ORIGIN = asUrl("API_ORIGIN", API_ORIGIN_RAW);

const API_V1_TARGET = new URL("/api/v1", API_ORIGIN);

// ---------------- helpers ----------------
function setForwardedHeaders(proxyReq, req, extra = {}) {
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
  proxyReq.setHeader("X-Forwarded-Proto", req.headers["x-forwarded-proto"] || "https");
  proxyReq.setHeader("X-Real-IP", req.headers["x-real-ip"] || req.ip || "");
  proxyReq.setHeader("X-Forwarded-For", req.headers["x-forwarded-for"] || req.ip || "");
  Object.entries(extra).forEach(([k, v]) => proxyReq.setHeader(k, v));
}

function proxyError(where) {
  return (err, req, res) => {
    console.error(`[${where}] proxy error:`, err?.message || err);
    console.error(`[${where}] request:`, req?.method, req?.originalUrl);
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

/**
 * ✅ Reescribe Location absolutos internos => PUBLIC_BASE_URL
 * Ej: http://srv-captain--pos360-frontend/shop/  -> https://sanjuantecnologia.com/shop/
 */
function rewriteAbsoluteLocation(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;
  if (!PUBLIC_BASE_URL) return;

  // Reescribe si viene con host interno del shop/app
  const candidates = [
    SHOP_UPSTREAM.origin,
    APP_UPSTREAM.origin,
    API_ORIGIN.origin,
  ];

  for (const origin of candidates) {
    if (loc.startsWith(origin)) {
      proxyRes.headers.location = PUBLIC_BASE_URL.replace(/\/+$/, "") + loc.slice(origin.length);
      return;
    }
  }
}

function rewriteLocationToApp(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;
  if (loc.startsWith("/app/") || loc === "/app") return;
  if (loc.startsWith("/")) proxyRes.headers.location = "/app" + loc;
}

function rewriteSetCookiePathToApp(proxyRes) {
  const sc = proxyRes.headers["set-cookie"];
  if (!sc) return;

  const fix = (cookie) =>
    cookie.replace(/;\s*Path=\/(\s*;|$)/i, "; Path=/app$1");

  if (Array.isArray(sc)) proxyRes.headers["set-cookie"] = sc.map(fix);
  else if (typeof sc === "string") proxyRes.headers["set-cookie"] = fix(sc);
}

// ---------------- health ----------------
app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    service: "pos360-edge",
    shop: SHOP_UPSTREAM.href,
    app: APP_UPSTREAM.href,
    api: API_V1_TARGET.href,
    publicBase: PUBLIC_BASE_URL || null,
  })
);

// root
app.get("/", (_req, res) => res.redirect(301, "/shop/"));

// ---------------- /api/v1 passthrough ----------------
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true, // ✅ acá OK
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
      proxyReq.setHeader("Host", API_ORIGIN.host); // ✅ API puede quedar interno
    },
    onProxyRes(proxyRes) {
      rewriteAbsoluteLocation(proxyRes);
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
    logLevel: LOG_LEVEL,
    pathRewrite: (p) => p.replace(/^\/api/, "") || "/",
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
      proxyReq.setHeader("Host", API_ORIGIN.host);
    },
    onProxyRes(proxyRes) {
      rewriteAbsoluteLocation(proxyRes);
    },
    onError: proxyError("api"),
  })
);

// ---------------- /app -> admin ----------------
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,

    // ✅ CLAVE: no fuerces host interno => evita Location srv-captain en redirects
    changeOrigin: false,
    xfwd: true,
    logLevel: LOG_LEVEL,

    pathRewrite: (p) => p.replace(/^\/app/, "") || "/",

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });

      // ✅ CLAVE: mantener host público
      if (req.headers.host) proxyReq.setHeader("Host", req.headers.host);
    },

    onProxyRes(proxyRes) {
      rewriteLocationToApp(proxyRes);
      rewriteSetCookiePathToApp(proxyRes);
      rewriteAbsoluteLocation(proxyRes);
    },

    onError: proxyError("app"),
  })
);

// ---------------- /shop -> frontend ----------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,

    // ✅ CLAVE: no fuerces host interno => evita Location srv-captain en redirects
    changeOrigin: false,
    xfwd: true,
    logLevel: LOG_LEVEL,

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/shop" });

      // ✅ CLAVE: mantener host público
      if (req.headers.host) proxyReq.setHeader("Host", req.headers.host);
    },

    onProxyRes(proxyRes) {
      normalizeShopLocation(proxyRes);
      rewriteAbsoluteLocation(proxyRes);
    },

    onError: proxyError("shop"),
  })
);

// fallback
app.use((req, res) => res.redirect(301, "/shop/"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM.href}`);
  console.log(`app  -> ${APP_UPSTREAM.href}`);
  console.log(`api  -> ${API_V1_TARGET.href}`);
  console.log(`public -> ${PUBLIC_BASE_URL || "(not set)"}`);
});
