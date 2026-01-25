/**
 * ✅ pos360-edge/server.js — FIX DEFINITIVO 301 LOOP
 * CAUSA: Express (strict routing OFF) hacía que "/shop" matchee también "/shop/"
 *
 * Solución:
 * - app.enable("strict routing")  => "/shop" != "/shop/"
 * - Proxy vive en "/shop/" (con slash)
 * - Redirect SOLO para "/shop" (sin slash)
 * - "/" redirige a "/shop/"
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ✅ CLAVE: hace que /shop y /shop/ sean distintos
app.enable("strict routing");
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
const APP_UPSTREAM  = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN    = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

// ---- Health
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_STRICT_ROUTING_FIX_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_STRICT_ROUTING_FIX_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ✅ SHOP PROXY (con slash)
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    // IMPORTANTE: NO tocar path. El frontend YA sirve /shop/
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "shop-proxy";
    },
    onError(err, req, res) {
      console.error("❌ SHOP proxy error", err?.message || err);
      res.status(502).type("text/plain").send("edge: shop proxy error");
    },
  })
);

// ✅ API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "api-proxy";
    },
  })
);

// ✅ APP (si tu admin vive en otro upstream)
app.use(
  "/app/",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "app-proxy";
    },
  })
);

// ✅ Redirects (ahora NO matchea /shop/)
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// Fallback
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge FIX strict routing en :${PORT}`));
