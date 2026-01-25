/**
 * ✅ pos360-edge/server.js — FIX DEFINITIVO (ANTI 301 LOOP)
 *
 * Causa real del loop:
 * - Algún Nginx/Proxy delante “normaliza” /shop/ -> /shop (quita slash)
 * - Si vos redirigís /shop -> /shop/ => loop infinito
 *
 * Solución:
 * - NO redirigir /shop
 * - PROXY en /shop (sin slash) para agarrar /shop y /shop/
 * - Reconstruir path hacia upstream como /shop + path
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

const BUILD = env("X_EDGE_BUILD", "EDGE_SHOP_PROXY_NO_REDIRECT_01");

// trace simple (para que veas en curl qué pegó)
app.use((req, res, next) => {
  res.setHeader("X-EDGE-BUILD", BUILD);
  next();
});

// ---- Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    build: BUILD,
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ✅ Root -> /shop/ (está perfecto)
app.get("/", (req, res) => res.redirect(301, "/shop/"));

/**
 * ✅ SHOP PROXY en "/shop" (sin slash)
 * Express cuando montás "/shop":
 * - request /shop        => req.url = "" o "/"
 * - request /shop/       => req.url = "/"
 * - request /shop/x/y    => req.url = "/x/y"
 *
 * Y nosotros lo mandamos al upstream como:
 *   /shop + req.url
 */
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,

    // 🔧 reconstruye la ruta para que el frontend reciba /shop/...
    pathRewrite: (path, req) => {
      // path acá es lo que queda DESPUÉS del mount "/shop"
      // normalmente: "/" o "/product/303"
      if (!path || path === "") return "/shop/";
      if (path === "/") return "/shop/";
      return "/shop" + path; // => /shop/product/303
    },

    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "shop-proxy";
    },

    onError(err, req, res) {
      console.error("❌ SHOP proxy error:", err?.message || err);
      res.setHeader("X-EDGE-HIT", "shop-proxy-error");
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

// ✅ APP
app.use(
  "/app",
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

// Fallback
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge RUN ${BUILD} en :${PORT}`));
