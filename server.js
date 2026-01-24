/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL
 * Reverse proxy por PATH:
 * - /        -> /shop/
 * - /shop*   -> TIENDA (sin strip)
 * - /api/v1* -> API passthrough
 * - /api*    -> alias => /api/v1/*
 * - /app*    -> ADMIN (strip /app) + Location rewrite + Cookie Path=/app
 *
 * Fixes:
 * - ✅ APP_UPSTREAM se usa de verdad (no apuntar al frontend)
 * - ✅ Reescribe Location absoluto del shop si viene con host interno srv-captain--*
 * - ✅ Fuerza https/host público en redirects del shop
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

// ✅ Si falta http(s), lo agrega
function normalizeHttpUrl(name, value, fallback) {
  const v = env(name, value ?? fallback ?? "");
  if (!v) throw new Error(`Missing required env: ${name}`);
  if (/^https?:\/\//i.test(v)) return v;
  return `http://${v}`;
}

// ✅ parsea y garantiza protocol/host
function asUrl(name, raw) {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL: "${raw}"`);
  }
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// ✅ Dominio público (para reescrituras de redirects absolutos)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com").replace(/\/+$/, "");

// ✅ Targets (normalizados + parseados)
const SHOP_UPSTREAM_RAW = normalizeHttpUrl(
  "SHOP_UPSTREAM",
  env("SHOP_UPSTREAM"),
  "http://srv-captain--pos360-frontend"
);

const APP_UPSTREAM_RAW = normalizeHttpUrl(
  "APP_UPSTREAM",
  env("APP_UPSTREAM"),
  "http://srv-captain--pos360-admin"
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

/**
 * ✅ Reescribe Location ABSOLUTO del upstream (srv-captain--) hacia dominio público.
 * Ej: Location: http://srv-captain--pos360-frontend/shop/  -> https://sanjuantecnologia.com/shop/
 */
function rewriteLocationToPublic(proxyRes, publicBaseUrl, upstreamUrl) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;

  // si es relativo, no tocamos
  if (loc.startsWith("/")) return;

  // si es absolute al upstream interno, lo pasamos a público
  if (loc.startsWith(upstreamUrl.origin)) {
    proxyRes.headers.location =
      publicBaseUrl + loc.slice(upstreamUrl.origin.length);
    return;
  }

  // si vino http al host público, lo forzamos a https
  if (loc.startsWith("http://")) {
    try {
      const u = new URL(loc);
      const pub = new URL(publicBaseUrl);
      if (u.host === pub.host) {
        u.protocol = "https:";
        proxyRes.headers.location = u.toString();
      }
    } catch {
      // ignore
    }
  }
}

// ---------------- health ----------------
app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    service: "pos360-edge",
    shop: SHOP_UPSTREAM.href,
    app: APP_UPSTREAM.href,
    api: API_V1_TARGET.href,
    publicBase: PUBLIC_BASE_URL,
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
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
      proxyReq.setHeader("Host", API_ORIGIN.host);
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
    onError: proxyError("api"),
  })
);

// ---------------- /app -> admin ----------------
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    logLevel: LOG_LEVEL,

    // strip /app al upstream
    pathRewrite: (p) => p.replace(/^\/app/, "") || "/",

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
      proxyReq.setHeader("Host", APP_UPSTREAM.host);
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
    logLevel: LOG_LEVEL,

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/shop" });
      proxyReq.setHeader("Host", SHOP_UPSTREAM.host);
    },

    onProxyRes(proxyRes) {
      normalizeShopLocation(proxyRes);
      rewriteLocationToPublic(proxyRes, PUBLIC_BASE_URL, SHOP_UPSTREAM);
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
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
