/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL DEFINITIVO
 *
 * FIX CRÍTICO:
 * - "/" responde 200 OK para CapRover (healthcheck implícito)
 * - Navegadores siguen redirigidos a /shop/
 * - Evita SIGTERM + 502 Bad Gateway
 *
 * Reverse proxy por PATH:
 * - /        -> 200 OK (health) | navegador -> /shop/
 * - /shop*   -> TIENDA
 * - /api/v1* -> API
 * - /api*    -> alias => /api/v1/*
 * - /app*    -> ADMIN (strip /app)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

// ---------------- utils ----------------
function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

function normalizeHttpUrl(name, value, fallback) {
  const v = env(name, value ?? fallback ?? "");
  if (!v) throw new Error(`Missing env ${name}`);
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

// ---------------- config ----------------
const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "");
const PUBLIC = PUBLIC_BASE_URL ? asUrl("PUBLIC_BASE_URL", PUBLIC_BASE_URL) : null;
const PUBLIC_PROTO = PUBLIC ? PUBLIC.protocol.replace(":", "") : "https";

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

function forwardedProto(req) {
  if (PUBLIC_PROTO) return PUBLIC_PROTO;
  const xfp = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (xfp) return xfp;
  return req.secure ? "https" : "http";
}

function setForwardedHeaders(proxyReq, req, extra = {}) {
  const host = clientHost(req);
  const proto = forwardedProto(req);

  proxyReq.setHeader("Host", host);
  proxyReq.setHeader("X-Forwarded-Host", host);
  proxyReq.setHeader("X-Forwarded-Proto", proto);
  proxyReq.setHeader("X-Forwarded-Port", proto === "https" ? "443" : "80");
  proxyReq.setHeader("X-Real-IP", req.ip || "");
  proxyReq.setHeader("X-Forwarded-For", req.headers["x-forwarded-for"] || req.ip || "");

  Object.entries(extra).forEach(([k, v]) => proxyReq.setHeader(k, v));
}

function proxyError(where) {
  return (err, req, res) => {
    console.error(`[${where}]`, err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end(`Bad gateway (${where})`);
  };
}

function rewriteAbsoluteLocationToPublic(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;
  if (loc.startsWith("/")) return;

  try {
    const u = new URL(loc);
    if (/^srv-captain--/i.test(u.hostname)) {
      proxyRes.headers.location =
        `${forwardedProto(req)}://${clientHost(req)}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {}
}

// ---------------- HEALTH ----------------
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

// ---------------- ROOT (FIX CRÍTICO) ----------------
app.get("/", (req, res) => {
  const accept = String(req.headers.accept || "");

  // Navegador
  if (accept.includes("text/html")) {
    return res.redirect(302, "/shop/");
  }

  // Healthcheck / curl / nginx
  return res.status(200).send("ok");
});

// ---------------- API ----------------
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },
    onProxyRes(proxyRes, req) {
      rewriteAbsoluteLocationToPublic(proxyRes, req);
    },
    onError: proxyError("api-v1"),
  })
);

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
    },
    onProxyRes(proxyRes, req) {
      rewriteAbsoluteLocationToPublic(proxyRes, req);
    },
    onError: proxyError("api"),
  })
);

// ---------------- ADMIN ----------------
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: false,
    xfwd: true,
    logLevel: LOG_LEVEL,
    pathRewrite: (p) => p.replace(/^\/app/, "") || "/",
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
    },
    onProxyRes(proxyRes, req) {
      rewriteAbsoluteLocationToPublic(proxyRes, req);
    },
    onError: proxyError("app"),
  })
);

// ---------------- SHOP ----------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: false,
    xfwd: true,
    logLevel: LOG_LEVEL,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/shop" });
    },
    onProxyRes(proxyRes, req) {
      rewriteAbsoluteLocationToPublic(proxyRes, req);
    },
    onError: proxyError("shop"),
  })
);

// ---------------- FALLBACK ----------------
app.use((_req, res) => res.redirect(302, "/shop/"));

// ---------------- LISTEN ----------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM.href}`);
  console.log(`app  -> ${APP_UPSTREAM.href}`);
  console.log(`api  -> ${API_V1_TARGET.href}`);
  console.log(`public -> ${PUBLIC_BASE_URL || "(auto)"}`);
});
