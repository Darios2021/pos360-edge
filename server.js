/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL DEFINITIVO)
 *
 * Routing:
 * - /            -> 301 -> /shop/
 * - /shop/*      -> FRONTEND
 * - /app/*       -> FRONTEND
 * - /api/*       -> API (PASSTHROUGH)
 *
 * Fixes:
 * - trust proxy
 * - X-Forwarded-Proto correcto
 * - Location rewrite (si algún upstream manda host interno)
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

const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com").replace(/\/+$/, "");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM = env("APP_UPSTREAM", SHOP_UPSTREAM).replace(/\/+$/, "");

// ✅ ORIGEN API (HOST+PUERTO, SIN /api/v1)
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function firstHeaderValue(v) {
  return (v || "").toString().split(",")[0].trim();
}

function isHttps(req) {
  const xfProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

function forceForwardProto(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

function rewriteLocationToPublic(proxyRes, req) {
  const loc = proxyRes.headers["location"];
  if (!loc) return;

  const host = req.headers.host;
  if (!host) return;

  let newLoc = loc;

  // si viene host interno => host público
  newLoc = newLoc.replace(/^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^http:\/\/127\.0\.0\.1(?=\/|$)/i, `https://${host}`);

  // upgrade http://host -> https://host
  newLoc = newLoc.replace(
    new RegExp(`^http:\\/\\/${host.replace(/\./g, "\\.")}(?=\\/|$)`, "i"),
    `https://${host}`
  );

  // si el request original fue https, subimos todo a https
  if (isHttps(req)) newLoc = newLoc.replace(/^http:\/\//i, "https://");

  if (newLoc !== loc) proxyRes.headers["location"] = newLoc;
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    shop: `${SHOP_UPSTREAM}/`,
    app: `${APP_UPSTREAM}/`,
    apiOrigin: API_ORIGIN,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ =====
app.get("/", (req, res) => res.redirect(301, "/shop/"));

// ===== /api -> API (PASSTHROUGH) =====
// /api/health => API_ORIGIN + /api/health ✅
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    // NO reescribimos: dejamos /api tal cual
  })
);

// ===== /shop -> FRONTEND =====
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    // NO reescribimos: el frontend ya vive bajo /shop
  })
);

// ===== /app -> FRONTEND =====
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/shop/`);
  console.log(`app  -> ${APP_UPSTREAM}/app/`);
  console.log(`api  -> ${API_ORIGIN}/api/* (passthrough)`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
