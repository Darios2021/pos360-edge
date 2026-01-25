/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL)
 *
 * Routing:
 * - /            -> redirect to /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice en mismo frontend)
 * - /api/*       -> API
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

const FRONTEND_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const API_UPSTREAM = env("API_UPSTREAM", "http://srv-captain--pos360-commerce-api:3000/api/v1").replace(/\/+$/, "");

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

function onProxyReq(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

function rewriteLocation(proxyRes, req) {
  const loc = proxyRes.headers["location"];
  if (!loc) return;

  const host = req.headers.host;
  if (!host) return;

  let newLoc = loc;

  // internos -> público
  newLoc = newLoc.replace(/^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^http:\/\/127\.0\.0\.1(?=\/|$)/i, `https://${host}`);

  // http público -> https público
  newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${host.replace(/\./g, "\\.")}(?=\\/|$)`, "i"), `https://${host}`);

  // si request original fue https, upgrade todo
  if (isHttps(req)) newLoc = newLoc.replace(/^http:\/\//i, "https://");

  if (newLoc !== loc) proxyRes.headers["location"] = newLoc;
}

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    shop: FRONTEND_UPSTREAM + "/",
    app: FRONTEND_UPSTREAM + "/",
    api: API_UPSTREAM,
    publicBase: PUBLIC_BASE_URL,
  });
});

// / -> /shop/
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html><head><meta charset="utf-8" />
<meta http-equiv="refresh" content="0; url=/shop/" />
<title>pos360-edge</title></head>
<body><script>location.replace('/shop/');</script>
<noscript><a href="/shop/">/shop/</a></noscript></body></html>`);
});

// API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq,
    onProxyRes: rewriteLocation,
    pathRewrite: (p) => p.replace(/^\/api/, ""),
  })
);

// SHOP
app.use(
  "/shop",
  createProxyMiddleware({
    target: FRONTEND_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq,
    onProxyRes: rewriteLocation,
  })
);

// APP (mismo frontend)
app.use(
  "/app",
  createProxyMiddleware({
    target: FRONTEND_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq,
    onProxyRes: rewriteLocation,
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop/app -> ${FRONTEND_UPSTREAM}/`);
  console.log(`api -> ${API_UPSTREAM}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
