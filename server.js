/**
 * ✅ pos360-edge/server.js — PROD FINAL (NO LOOP)
 * - /shop/  -> PROXY al frontend (PRIMERO)
 * - /shop   -> 301 a /shop/ (solo este)
 * - /       -> 301 a /shop/
 * - /api    -> PROXY a API
 * - /app/   -> PROXY a Admin
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
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM  = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN    = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

app.set("trust proxy", true);

// ---- Health
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_PROD_FINAL_NO_LOOP_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_PROD_FINAL_NO_LOOP_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ✅ 1) SHOP PROXY PRIMERO: /shop/ JAMÁS debe redirigir
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    // importante: NO pathRewrite acá
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "shop";
    },
  })
);

// ✅ 2) API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "api";
    },
  })
);

// ✅ 3) APP
app.use(
  "/app/",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "app";
    },
  })
);

// ✅ 4) Redirects SOLO para / y /shop (sin slash)
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ 5) Fallback
app.use((req, res) => {
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge PROD FINAL en :${PORT}`));
