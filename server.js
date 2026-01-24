/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL
 * Reverse proxy por PATH:
 * - /        -> /shop/
 * - /shop*   -> TIENDA (sin strip)
 * - /api/v1* -> API passthrough
 * - /api*    -> alias => /api/v1/*
 * - /app*    -> ADMIN (strip /app) + Location rewrite + Cookie Path=/app
 *
 * FIX CRÍTICO:
 * - NO forzar Host interno en /shop y /app (evita Location: http://srv-captain--... / loops)
 * - /shop y /app usan changeOrigin:false para preservar el Host público
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

const SHOP_UPSTREAM = asUrl(
  "SHOP_UPSTREAM",
  normalizeHttpUrl("SHOP_UPSTREAM", env("SHOP_UPSTREAM"), "http://srv-captain--pos360-frontend")
);

const APP_UPSTREAM = asUrl(
  "APP_UPSTREAM",
  normalizeHttpUrl("APP_UPSTREAM", env("APP_UPSTREAM"), "http://srv-captain--pos360-admin")
);

const API_ORIGIN = asUrl(
  "API_ORIGIN",
  normalizeHttpUrl("API_ORIGIN", env("API_ORIGIN"), "http://srv-captain--pos360-commerce-api:3000")
);

const API_V1_TARGET = new URL("/api/v1", API_ORIGIN);

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

  // Si el upstream devuelve /shop -> /shop/ normalizamos
  if (loc === "/shop") proxyRes.headers.location = "/shop/";
  if (loc === "/shop//") proxyRes.headers.location = "/shop/";
}

function rewriteLocationToApp(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;

  // Si el upstream responde Location relativo, lo prefijamos con /app
  if (loc.startsWith("/app/") || loc === "/app") return;
  if (loc.startsWith("/")) proxyRes.headers.location = "/app" + loc;
}

function rewriteSetCookiePathToApp(proxyRes) {
  const sc = proxyRes.headers["set-cookie"];
  if (!sc) return;

  const fix = (cookie) => cookie.replace(/;\s*Path=\/(\s*;|$)/i, "; Path=/app$1");
  if (Array.isArray(sc)) proxyRes.headers["set-cookie"] = sc.map(fix);
  else if (typeof sc === "string") proxyRes.headers["set-cookie"] = fix(sc);
}

// health
app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    service: "pos360-edge",
    shop: SHOP_UPSTREAM.href,
    app: APP_UPSTREAM.href,
    api: API_V1_TARGET.href,
    publicBase: env("PUBLIC_BASE_URL", ""),
  })
);

// root -> /shop/
app.get("/", (_req, res) => res.redirect(301, "/shop/"));

// /api/v1 passthrough (acá sí changeOrigin true)
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
      // Host interno OK para API
      proxyReq.setHeader("Host", API_ORIGIN.host);
    },
    onError: proxyError("api-v1"),
  })
);

// /api alias -> /api/v1
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

// /app -> admin  (PRESERVA HOST PUBLICO)
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: false, // ✅ CRÍTICO: preserva Host (sanjuantecnologia.com)
    xfwd: true,
    logLevel: LOG_LEVEL,
    pathRewrite: (p) => p.replace(/^\/app/, "") || "/",
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
      // ✅ NO pisar Host con srv-captain...
      if (req.headers.host) proxyReq.setHeader("Host", req.headers.host);
    },
    onProxyRes(proxyRes) {
      rewriteLocationToApp(proxyRes);
      rewriteSetCookiePathToApp(proxyRes);
    },
    onError: proxyError("app"),
  })
);

// /shop -> frontend (PRESERVA HOST PUBLICO)
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: false, // ✅ CRÍTICO: preserva Host (sanjuantecnologia.com)
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/shop" });
      // ✅ NO pisar Host con srv-captain...
      if (req.headers.host) proxyReq.setHeader("Host", req.headers.host);
    },
    onProxyRes(proxyRes) {
      normalizeShopLocation(proxyRes);
    },
    onError: proxyError("shop"),
  })
);

// fallback
app.use((_req, res) => res.redirect(301, "/shop/"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM.href}`);
  console.log(`app  -> ${APP_UPSTREAM.href}`);
  console.log(`api  -> ${API_V1_TARGET.href}`);
});
