/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL (FIX redirects loop)
 *
 * Qué corrige:
 * - NO manda Host interno al upstream (evita Location: http://srv-captain--...)
 * - Fuerza X-Forwarded-Proto en base a PUBLIC_BASE_URL (evita http->https loops)
 * - APP_UPSTREAM real (admin), /app strip + Location/Cookie rewrite
 *
 * Reverse proxy por PATH:
 * - /        -> /shop/
 * - /shop*   -> TIENDA
 * - /api/v1* -> API
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

// PUBLIC (para proto/host correctos)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "");
const PUBLIC = PUBLIC_BASE_URL ? asUrl("PUBLIC_BASE_URL", PUBLIC_BASE_URL) : null;
const PUBLIC_PROTO = PUBLIC ? PUBLIC.protocol.replace(":", "") : "https";

// Targets
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

// ---------------- helpers ----------------
function clientHost(req) {
  return String(req.headers.host || "");
}

// Fuerza proto público (evita http redirects)
function forwardedProto(req) {
  // si tenés PUBLIC_BASE_URL, ese manda
  if (PUBLIC_PROTO) return PUBLIC_PROTO;
  // fallback
  const xfp = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (xfp) return xfp;
  return req.secure ? "https" : "http";
}

function setForwardedHeaders(proxyReq, req, extra = {}) {
  const host = clientHost(req);
  const proto = forwardedProto(req);

  proxyReq.setHeader("X-Forwarded-Host", host);
  proxyReq.setHeader("X-Forwarded-Proto", proto);
  proxyReq.setHeader("X-Forwarded-Port", proto === "https" ? "443" : "80");
  proxyReq.setHeader("X-Real-IP", req.headers["x-real-ip"] || req.ip || "");
  proxyReq.setHeader("X-Forwarded-For", req.headers["x-forwarded-for"] || req.ip || "");

  Object.entries(extra).forEach(([k, v]) => proxyReq.setHeader(k, v));

  // ✅ CRÍTICO: mantené el Host PUBLICO, NO el interno (evita Location a srv-captain)
  if (host) proxyReq.setHeader("Host", host);
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

// Reescribe Location absoluto si algún upstream insiste
function rewriteAbsoluteLocationToPublic(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;

  // si ya es relativo, listo
  if (loc.startsWith("/")) return;

  // Si viene con host interno srv-captain, lo pasamos a host público
  const host = clientHost(req);
  const proto = forwardedProto(req);

  try {
    const u = new URL(loc);
    // si apunta a srv-captain--*, lo reescribimos
    if (/^srv-captain--/i.test(u.hostname)) {
      proxyRes.headers.location = `${proto}://${host}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    // ignore
  }
}

function rewriteLocationToApp(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;

  // Solo tocamos relativos
  if (!loc.startsWith("/")) return;

  if (loc.startsWith("/app/") || loc === "/app") return;
  proxyRes.headers.location = "/app" + loc;
}

function rewriteSetCookiePathToApp(proxyRes) {
  const sc = proxyRes.headers["set-cookie"];
  if (!sc) return;

  const fix = (cookie) => cookie.replace(/;\s*Path=\/(\s*;|$)/i, "; Path=/app$1");

  if (Array.isArray(sc)) proxyRes.headers["set-cookie"] = sc.map(fix);
  else if (typeof sc === "string") proxyRes.headers["set-cookie"] = fix(sc);
}

// ---------------- health ----------------
app.get("/health", (req, res) =>
  res.status(200).json({
    ok: true,
    service: "pos360-edge",
    shop: SHOP_UPSTREAM.href,
    app: APP_UPSTREAM.href,
    api: API_V1_TARGET.href,
    publicBase: PUBLIC_BASE_URL || `${forwardedProto(req)}://${clientHost(req)}`,
  })
);

// root
app.get("/", (_req, res) => res.redirect(301, "/shop/"));

// ---------------- /api/v1 passthrough ----------------
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true, // API puede quedar así
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
      // Para API está OK que Host sea el público, igual la API suele bancarlo.
      // Si tu API exige Host interno, descomentá:
      // proxyReq.setHeader("Host", API_ORIGIN.host);
    },
    onProxyRes(proxyRes, req) {
      rewriteAbsoluteLocationToPublic(proxyRes, req);
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
      // idem comentario API
      // proxyReq.setHeader("Host", API_ORIGIN.host);
    },
    onProxyRes(proxyRes, req) {
      rewriteAbsoluteLocationToPublic(proxyRes, req);
    },
    onError: proxyError("api"),
  })
);

// ---------------- /app -> admin ----------------
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: false, // ✅ no cambies origin => evita redirects raros
    xfwd: true,
    logLevel: LOG_LEVEL,
    pathRewrite: (p) => p.replace(/^\/app/, "") || "/",
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
    },
    onProxyRes(proxyRes, req) {
      rewriteLocationToApp(proxyRes);
      rewriteSetCookiePathToApp(proxyRes);
      rewriteAbsoluteLocationToPublic(proxyRes, req);
    },
    onError: proxyError("app"),
  })
);

// ---------------- /shop -> frontend ----------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: false, // ✅ no cambies origin => evita Location srv-captain
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/shop" });
    },
    onProxyRes(proxyRes, req) {
      normalizeShopLocation(proxyRes);
      rewriteAbsoluteLocationToPublic(proxyRes, req);
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
  console.log(`public -> ${PUBLIC_BASE_URL || "(auto)"}`);
});
