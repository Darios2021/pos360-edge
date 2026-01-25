/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL DEFINITIVO)
 *
 * Routing:
 * - /            -> redirect to /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice en el mismo frontend)
 * - /api/*       -> API (/api/v1)
 *
 * Fix CRÍTICO:
 * - http-proxy-middleware (versiones nuevas) => usar "on: { proxyReq, proxyRes }"
 * - ✅ fuerza Host público al upstream (evita redirects a srv-captain--)
 * - ✅ reescribe Location: http://srv-captain--... -> https://sanjuantecnologia.com/...
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
const PUBLIC_HOST = (() => {
  try {
    return new URL(PUBLIC_BASE_URL).host;
  } catch {
    return "sanjuantecnologia.com";
  }
})();

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM  = env("APP_UPSTREAM",  "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const API_UPSTREAM  = env("API_UPSTREAM",  "http://srv-captain--pos360-commerce-api:3000/api/v1").replace(/\/+$/, "");

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

function setForwardHeaders(proxyReq, req) {
  const https = isHttps(req);
  const host = (req.headers.host || PUBLIC_HOST || "").toString();

  // ✅ CLAVE: upstream arma redirect con Host, así que lo pisamos
  proxyReq.setHeader("Host", host);

  proxyReq.setHeader("X-Forwarded-Proto", https ? "https" : "http");
  proxyReq.setHeader("X-Forwarded-Host", host);

  const xfPort = (req.headers["x-forwarded-port"] || "").toString().trim();
  if (!xfPort) proxyReq.setHeader("X-Forwarded-Port", https ? "443" : "80");
}

function rewriteLocation(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc) return;

  const host = (req.headers.host || PUBLIC_HOST || "").toString();
  if (!host) return;

  let newLoc = String(loc);

  // ✅ host interno -> host público
  newLoc = newLoc.replace(/^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^https:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);

  // ✅ si request original era https, upgrade cualquier http
  if (isHttps(req)) {
    newLoc = newLoc.replace(/^http:\/\//i, "https://");
  }

  if (newLoc !== loc) proxyRes.headers.location = newLoc;
}

function makeProxy(target, { stripPrefix } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,

    // ✅ API NUEVA (http-proxy-middleware)
    on: {
      proxyReq: (proxyReq, req) => setForwardHeaders(proxyReq, req),
      proxyRes: (proxyRes, req) => rewriteLocation(proxyRes, req),
    },

    pathRewrite: stripPrefix
      ? (path) => path.replace(stripPrefix, "")
      : undefined,
  });
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    shop: `${SHOP_UPSTREAM}/`,
    app: `${APP_UPSTREAM}/`,
    api: API_UPSTREAM,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ =====
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=/shop/" />
  <title>pos360-edge</title>
</head>
<body>
  <script>location.replace('/shop/');</script>
  <noscript><a href="/shop/">/shop/</a></noscript>
</body>
</html>`);
});

// ===== /api -> API (/api/v1) =====
app.use("/api", makeProxy(API_UPSTREAM, { stripPrefix: /^\/api/ }));

// ===== /shop -> FRONTEND =====
app.use("/shop", makeProxy(SHOP_UPSTREAM));

// ===== /app -> FRONTEND =====
app.use("/app", makeProxy(APP_UPSTREAM));

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/`);
  console.log(`app  -> ${APP_UPSTREAM}/`);
  console.log(`api  -> ${API_UPSTREAM}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
