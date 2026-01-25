/**
 * ✅ pos360-edge/server.js — FINAL ESTABLE
 * - /shop/  -> PROXY al frontend (shop)
 * - /api/*  -> PROXY a API
 * - /app/*  -> PROXY a Admin
 * - "/" y "/shop" -> redirect a "/shop/"
 * - FIX: strict routing para que "/shop" != "/shop/"
 * - FIX: archivos especiales: /shop/favicon.ico, /robots.txt, /sitemap.xml
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

const BUILD = env("X_EDGE_BUILD", "EDGE_SHOP_PROXY_NO_REDIRECT_01");

// ====== TRACE (opcional) ======
const TRACE = String(env("EDGE_TRACE", "0")).trim() === "1";
if (TRACE) {
  app.use((req, res, next) => {
    console.log("🧭 REQ", JSON.stringify({
      method: req.method,
      originalUrl: req.originalUrl,
      host: req.headers.host,
      xfp: req.headers["x-forwarded-proto"],
      proto: req.protocol,
    }));
    next();
  });
}

// ---- Health
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", BUILD);
  res.json({
    ok: true,
    service: "pos360-edge",
    build: BUILD,
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// =====================================================
// ✅ Archivos especiales (para browsers/bots)
// =====================================================

// Browser a veces pide /shop/favicon.ico aunque el asset real esté en /favicon.ico
app.get("/shop/favicon.ico", (req, res, next) => {
  req.url = "/favicon.ico";
  next();
});

// robots/sitemap normalmente viven en root del dominio público
app.get("/robots.txt", (req, res, next) => {
  req.url = "/robots.txt";
  next();
});
app.get("/sitemap.xml", (req, res, next) => {
  req.url = "/sitemap.xml";
  next();
});

// =====================================================
// ✅ SHOP PROXY (con slash)
// =====================================================
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-BUILD"] = BUILD;
      proxyRes.headers["X-EDGE-HIT"] = "shop-proxy";
    },
    onError(err, req, res) {
      console.error("❌ SHOP proxy error", err?.message || err);
      res.setHeader("X-EDGE-BUILD", BUILD);
      res.status(502).type("text/plain").send("edge: shop proxy error");
    },
  })
);

// =====================================================
// ✅ API PROXY
// =====================================================
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-BUILD"] = BUILD;
      proxyRes.headers["X-EDGE-HIT"] = "api-proxy";
    },
  })
);

// =====================================================
// ✅ APP PROXY
// =====================================================
app.use(
  "/app/",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-BUILD"] = BUILD;
      proxyRes.headers["X-EDGE-HIT"] = "app-proxy";
    },
  })
);

// ✅ Redirects (NO matchea /shop/ gracias a strict routing)
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// Fallback
app.use((req, res) => {
  res.setHeader("X-EDGE-BUILD", BUILD);
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge listo en :${PORT}`));
