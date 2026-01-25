/**
 * ✅ pos360-edge/server.js — FINAL DEFINITIVO (FIX 301 /shop/->/shop/)
 * POS360 / sanjuantecnologia.com
 *
 * Clave:
 * - NO pathRewrite en SHOP
 * - NO onProxyReq / NO forwarded headers hacia el FRONTEND (evita canonical self-redirect)
 * - API sí mantiene forwarded headers
 * - / redirige 301 a /shop/ (único redirect permitido)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.set("trust proxy", true);

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN   = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

const EDGE_BUILD = env("EDGE_BUILD", "EDGE_FINAL_FIX_SHOP_NO_FORWARDED_2026-01-25_03");

// -------- helpers (solo para API / app si hiciera falta)
function getHost(req) {
  return (req.headers["x-forwarded-host"] || req.headers.host || "")
    .toString()
    .split(",")[0]
    .trim();
}

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim()
    .toLowerCase();
  return xfProto === "https" || req.protocol === "https" || req.secure === true;
}

function forceForwardHeaders(proxyReq, req) {
  const host = getHost(req);
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  if (host) proxyReq.setHeader("X-Forwarded-Host", host);
}

function rewriteLocationFactory({ publicPrefix }) {
  return function rewriteLocation(proxyRes, req) {
    const loc = proxyRes.headers?.location;
    if (!loc) return;

    let newLoc = String(loc);

    // si upstream devuelve "/algo" lo mantenemos bajo /shop o /app
    if (newLoc.startsWith("/")) {
      if (
        publicPrefix &&
        !newLoc.startsWith(publicPrefix + "/") &&
        newLoc !== publicPrefix
      ) {
        newLoc = publicPrefix + newLoc;
      }
      proxyRes.headers.location = newLoc;
      return;
    }
  };
}

// ---------- Health (confirma build)
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", EDGE_BUILD);
  res.json({
    ok: true,
    service: "pos360-edge",
    build: EDGE_BUILD,
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ✅ único redirect permitido
app.get("/", (req, res) => res.redirect(301, "/shop/"));

// ---------- API proxy (con forwarded)
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyReq: forceForwardHeaders,
  })
);

// ---------- APP proxy (opcional: con rewrite Location si hace falta)
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocationFactory({ publicPrefix: "/app" }),
  })
);

/**
 * 🔥 SHOP proxy (FIX REAL):
 * - SIN pathRewrite
 * - SIN onProxyReq
 * - xfwd: false (no mandar x-forwarded-* al frontend)
 *
 * Esto evita que el FRONTEND genere canonical redirects basados en X-Forwarded-Host/Proto.
 */
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: false,              // ✅ CLAVE
    // ❌ NO onProxyReq
    // ❌ NO pathRewrite
    onProxyRes: rewriteLocationFactory({ publicPrefix: "/shop" }), // por si el upstream tira Location "/login"
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge LISTEN ${PORT} build=${EDGE_BUILD}`);
});
