/**
 * ✅ pos360-edge/server.js — FINAL DEFINITIVO (SHOP STRIP PREFIX)
 * - /shop/*  -> proxy al frontend, quitando prefijo /shop
 * - /shop    -> 301 a /shop/
 * - /        -> 301 a /shop/
 * - /api/*   -> proxy a API (quitando /api)
 * - /app/*   -> proxy a admin (quitando /app)
 *
 * IMPORTANTÍSIMO:
 * - Esto fuerza a que el frontend reciba paths como "/", "/product/303", etc.
 * - Evita loops 301 porque no devuelve /shop/ nunca desde edge.
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
const APP_UPSTREAM  = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN    = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

// TRACE
app.use((req, res, next) => {
  console.log("🧭 REQ", req.method, req.originalUrl, {
    host: req.headers.host,
    xfp: req.headers["x-forwarded-proto"],
  });
  next();
});

// Health
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_FINAL_STRIP_SHOP_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_FINAL_STRIP_SHOP_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// Redirects mínimos
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ SHOP proxy: montar en /shop y STRIP del prefijo
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    // /shop/product/303 => /product/303
    pathRewrite: (path) => path.replace(/^\/shop/, "") || "/",
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "shop-proxy";
    },
    onError(err, req, res) {
      console.error("❌ SHOP proxy error", err?.message || err);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("edge: shop proxy error");
    },
  })
);

// ✅ API proxy: strip /api
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: (path) => path.replace(/^\/api/, "") || "/",
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "api-proxy";
    },
  })
);

// ✅ APP proxy: strip /app
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: (path) => path.replace(/^\/app/, "") || "/",
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "app-proxy";
    },
  })
);

// Fallback
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge FINAL STRIP en :${PORT}`));
