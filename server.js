/**
 * ✅ pos360-edge/server.js — FINAL ANTI-LOOP
 * - NO redirige /shop/ (NUNCA)
 * - Solo redirige:
 *    /      -> /shop/          (ok)
 *    /shop  -> /shop/          (ok)
 * - /shop/  -> PROXY directo al frontend
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
const APP_UPSTREAM  = env("APP_UPSTREAM", "http://srv-captain--pos360-adminer").replace(/\/+$/, "");
const API_ORIGIN    = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

app.set("trust proxy", true);
app.disable("x-powered-by"); // opcional: para no confundir

// --- Health
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_ANTI_LOOP_FINAL"));
  res.json({
    ok: true,
    service: "pos360-edge",
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// --- Solo raíz -> /shop/
app.get("/", (req, res) => res.redirect(301, "/shop/"));

// --- Solo /shop (sin slash) -> /shop/
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// --- API
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

// --- SHOP: /shop/ se proxyea tal cual al frontend (SIN redirects)
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "shop";
    },
  })
);

// --- APP
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

app.listen(PORT, () => {
  console.log(`✅ pos360-edge escuchando en :${PORT}`);
});
