/**
 * ✅ pos360-edge/server.js — FIX DEFINITIVO (ANTI LOOP)
 * Idea:
 * - /shop (exacto)   -> 301 a /shop/
 * - /shop/*          -> proxy a frontend (sin tocar path)
 * - /               -> 301 a /shop/
 *
 * Clave: NO usar app.get("/shop") porque puede matchear /shop/
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
  const build = env("X_EDGE_BUILD", "EDGE_FIX_EXACT_SHOP_01");
  res.setHeader("X-EDGE-BUILD", build);
  res.json({
    ok: true,
    service: "pos360-edge",
    build,
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ✅ 0) EXACT MATCH /shop  (solo sin slash)
app.use((req, res, next) => {
  // ojo: req.path no incluye querystring
  if (req.path === "/shop") {
    res.setHeader("X-EDGE-HIT", "shop-exact-redirect");
    return res.redirect(301, "/shop/");
  }
  return next();
});

// ✅ 1) SHOP PROXY para TODO lo que empiece con /shop/
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,

    // NO cambies el path: el frontend YA sirve /shop/*
    // /shop/... => upstream /shop/...
    pathRewrite: undefined,

    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "shop-proxy";
      proxyRes.headers["X-EDGE-BUILD"] = env("X_EDGE_BUILD", "EDGE_FIX_EXACT_SHOP_01");
    },
    onError(err, req, res) {
      console.error("❌ SHOP proxy error:", err?.message || err);
      res.status(502).type("text/plain").send("edge: shop proxy error");
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
      proxyRes.headers["X-EDGE-HIT"] = "api-proxy";
      proxyRes.headers["X-EDGE-BUILD"] = env("X_EDGE_BUILD", "EDGE_FIX_EXACT_SHOP_01");
    },
  })
);

// ✅ 3) APP
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "app-proxy";
      proxyRes.headers["X-EDGE-BUILD"] = env("X_EDGE_BUILD", "EDGE_FIX_EXACT_SHOP_01");
    },
  })
);

// ✅ 4) ROOT -> /shop/
app.get("/", (req, res) => {
  res.setHeader("X-EDGE-HIT", "root-redirect");
  res.redirect(301, "/shop/");
});

// Fallback
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge en :${PORT}`));
