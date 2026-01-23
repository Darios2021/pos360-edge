/**
 * ✅ pos360-edge/server.js
 * Reverse proxy por PATH (SIN REDIRECTS):
 * - /shop/* -> frontend (tienda)
 * - /app/*  -> frontend (internamente como /shop/*)
 * - /api/*  -> api
 * - /       -> frontend (como /shop/*)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

// 🔗 Upstreams reales
// Tienda (frontend público)
const SHOP_UPSTREAM = env(
  "SHOP_UPSTREAM",
  "http://srv-captain--pos360-frontend"
);

// API (backend) OJO: SIN /api acá, para no duplicar paths
const API_UPSTREAM = env(
  "API_UPSTREAM",
  "http://srv-captain--pos360-commerce-api:3000"
);

app.disable("x-powered-by");

// ------------------------------------------------------
// HEALTH
// ------------------------------------------------------
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, service: "pos360-edge" })
);

// Helpers: middlewares instanciados UNA sola vez (no por request)
function setForwardedHost(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

// ------------------------------------------------------
// 🔥 /app/* → frontend COMO /shop/* (SIN redirect)
// ------------------------------------------------------
const appToShopProxy = createProxyMiddleware({
  target: SHOP_UPSTREAM,
  changeOrigin: true,
  xfwd: true,
  ws: true,

  pathRewrite: (path) => {
    // /app/cart -> /shop/cart
    // /app      -> /shop/
    const rest = path.replace(/^\/app/, "");
    return rest ? `/shop${rest}` : "/shop/";
  },

  onProxyReq: setForwardedHost,

  onError(err, _req, res) {
    console.error("[app-proxy] error:", err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end("Bad gateway (app)");
  },
});

app.use("/app", appToShopProxy);

// ------------------------------------------------------
// /shop/* → frontend normal
// ------------------------------------------------------
const shopProxy = createProxyMiddleware({
  target: SHOP_UPSTREAM,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  onProxyReq: setForwardedHost,
  onError(err, _req, res) {
    console.error("[shop-proxy] error:", err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end("Bad gateway (shop)");
  },
});

app.use("/shop", shopProxy);

// ------------------------------------------------------
// /api/* → api
// ------------------------------------------------------
const apiProxy = createProxyMiddleware({
  target: API_UPSTREAM,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  onProxyReq: setForwardedHost,
  onError(err, _req, res) {
    console.error("[api-proxy] error:", err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end("Bad gateway (api)");
  },
});

app.use("/api", apiProxy);

// ------------------------------------------------------
// root → frontend /shop (SIN redirect)
// ------------------------------------------------------
const rootToShopProxy = createProxyMiddleware({
  target: SHOP_UPSTREAM,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  onProxyReq: setForwardedHost,
  pathRewrite: (path) => {
    // "/" -> "/shop/"
    // "/c/2" -> "/shop/c/2"
    if (path === "/") return "/shop/";
    return `/shop${path}`;
  },
  onError(err, _req, res) {
    console.error("[root-proxy] error:", err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end("Bad gateway (root)");
  },
});

app.use("/", rootToShopProxy);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop/app -> ${SHOP_UPSTREAM}`);
  console.log(`   api      -> ${API_UPSTREAM}`);
});
