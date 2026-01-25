/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL)
 *
 * Routing:
 * - /            -> redirect HTML a /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice vive en el mismo frontend)
 * - /api/*       -> API
 *
 * Fixes:
 * - trust proxy => detecta https correctamente (CapRover Nginx)
 * - fuerza X-Forwarded-Proto según request original
 * - reescribe redirects Location a https://<host>/... y NUNCA deja srv-captain--*
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

function stripSlashEnd(s) {
  return String(s || "").replace(/\/+$/, "");
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

const PUBLIC_BASE_URL = stripSlashEnd(env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com"));

const SHOP_UPSTREAM = stripSlashEnd(env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend"));
const APP_UPSTREAM  = stripSlashEnd(env("APP_UPSTREAM",  "http://srv-captain--pos360-frontend"));
const API_UPSTREAM  = stripSlashEnd(env("API_UPSTREAM",  "http://srv-captain--pos360-commerce-api:3000/api/v1"));

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (xfProto) return xfProto === "https";
  return String(req.protocol).toLowerCase() === "https";
}

function forceForwardProto(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

function rewriteLocation(proxyRes, req) {
  const host = req.headers.host;
  if (!host) return;

  const loc = proxyRes.headers && proxyRes.headers["location"];
  if (!loc) return;

  const wantHttps = isHttps(req);
  const pubHost = `${wantHttps ? "https" : "http"}://${host}`;
  const pubHostHttps = `https://${host}`;

  let newLoc = String(loc);

  // 1) //srv-captain--... -> https://host/...
  newLoc = newLoc.replace(/^\/\/srv-captain--pos360-frontend(?=\/|$)/i, pubHostHttps);

  // 2) http://srv-captain--... -> https://host/...
  newLoc = newLoc.replace(/^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i, pubHostHttps);

  // 3) http://127.0.0.1 -> https://host
  newLoc = newLoc.replace(/^http:\/\/127\.0\.0\.1(?=\/|$)/i, pubHostHttps);

  // 4) http://<host> -> https://<host> si el request original fue https
  if (wantHttps) {
    const hostEsc = host.replace(/\./g, "\\.");
    newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${hostEsc}(?=\\/|$)`, "i"), pubHostHttps);
    newLoc = newLoc.replace(/^http:\/\//i, "https://");
  } else {
    // si entró http, al menos evitamos que quede srv-captain--*
    newLoc = newLoc.replace(/^https?:\/\/srv-captain--pos360-frontend(?=\/|$)/i, pubHost);
  }

  if (newLoc !== loc) {
    proxyRes.headers["location"] = newLoc;
  }
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

// ===== Proxy base options =====
function proxyBase() {
  return {
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocation,

    // ayuda extra para redirects (Location):
    autoRewrite: true,
    protocolRewrite: "https",
  };
}

// ===== /api -> API =====
app.use(
  "/api",
  createProxyMiddleware({
    ...proxyBase(),
    target: API_UPSTREAM,
    pathRewrite: (p) => p.replace(/^\/api/, ""),
  })
);

// ===== /shop -> FRONTEND =====
app.use(
  "/shop",
  createProxyMiddleware({
    ...proxyBase(),
    target: SHOP_UPSTREAM,
    // no reescribe path: el frontend vive bajo /shop
  })
);

// ===== /app -> FRONTEND =====
app.use(
  "/app",
  createProxyMiddleware({
    ...proxyBase(),
    target: APP_UPSTREAM,
    // si tu backoffice realmente vive bajo /app en el mismo frontend: OK
    // si vive en /shop/app o /admin, ahí sí habría que reescribir.
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/`);
  console.log(`app  -> ${APP_UPSTREAM}/`);
  console.log(`api  -> ${API_UPSTREAM}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
