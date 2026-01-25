/**
 * ✅ pos360-edge/server.js — FINAL TRACE + ANTI SELF-301 LOOP
 *
 * Objetivo:
 * - Detectar quién genera el 301 a /shop/ (loop)
 * - Evitar el self-redirect (Location: /shop/) dentro del mismo request
 * - Mantener /api y /app funcionando
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

// =======================
// 1) TRACE MIDDLEWARE
// =======================
app.use((req, res, next) => {
  const p = req.originalUrl || req.url || "";
  if (p.startsWith("/shop")) {
    console.log("🧭 TRACE /shop*",
      JSON.stringify({
        method: req.method,
        originalUrl: req.originalUrl,
        url: req.url,
        baseUrl: req.baseUrl,
        path: req.path,
        host: req.headers.host,
        xfh: req.headers["x-forwarded-host"],
        xfp: req.headers["x-forwarded-proto"],
        xf_for: req.headers["x-forwarded-for"],
        proto: req.protocol,
      })
    );
  }

  // Hook para detectar redirect interno
  const _redirect = res.redirect.bind(res);
  res.redirect = (statusOrUrl, maybeUrl) => {
    let status = 302;
    let url = statusOrUrl;

    if (typeof statusOrUrl === "number") {
      status = statusOrUrl;
      url = maybeUrl;
    }

    // 🔥 ANTI-LOOP: si alguien intenta redirigir a /shop/ desde /shop/
    const from = (req.originalUrl || "").toString();
    const to = (url || "").toString();

    if ((status === 301 || status === 302) && to === "/shop/" && from.startsWith("/shop/")) {
      console.log("🛑 BLOCKED SELF-REDIRECT", { status, from, to });
      // En vez de redirigir, dejamos continuar: proxy
      // Mandamos un header para verlo desde afuera
      res.setHeader("X-EDGE-BLOCKED-REDIRECT", "1");
      return next();
    }

    return _redirect(statusOrUrl, maybeUrl);
  };

  next();
});

// =======================
// 2) HEALTH
// =======================
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_TRACE_ANTI_LOOP_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_TRACE_ANTI_LOOP_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// =======================
// 3) ROOT + /shop (sin slash)
// =======================
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// =======================
// 4) PROXIES
// =======================

// API
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

// SHOP (NO tocar redirects acá)
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

// APP
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

// Fallback (para ver si algo cae acá)
app.use((req, res) => {
  res.status(404).send("edge: not found");
});

app.listen(PORT, () => {
  console.log(`✅ pos360-edge TRACE+ANTI-LOOP en :${PORT}`);
});
