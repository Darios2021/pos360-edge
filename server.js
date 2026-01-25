/**
 * ✅ pos360-edge/server.js — TRACE FINAL
 * Objetivo: saber EXACTAMENTE qué URL ve Express y por qué termina en 301.
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

// ✅ TRACE global (PRIMER middleware)
app.use((req, res, next) => {
  const u = req.originalUrl || req.url || "";
  if (u.startsWith("/shop")) {
    console.log("🧭 REQ", JSON.stringify({
      method: req.method,
      originalUrl: req.originalUrl,
      url: req.url,
      baseUrl: req.baseUrl,
      path: req.path,
      host: req.headers.host,
      xfp: req.headers["x-forwarded-proto"],
      xfh: req.headers["x-forwarded-host"],
      proto: req.protocol,
    }));
  }

  // Hook para ver si alguien llama redirect
  const _redirect = res.redirect.bind(res);
  res.redirect = (a, b) => {
    let status = 302, loc = a;
    if (typeof a === "number") { status = a; loc = b; }
    console.log("➡️ res.redirect()", JSON.stringify({ status, from: req.originalUrl, to: loc }));
    return _redirect(a, b);
  };

  next();
});

// Health
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_TRACE_RUNTIME_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_TRACE_RUNTIME_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ✅ 1) SHOP proxy primero
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq(proxyReq, req, res) {
      res.setHeader("X-EDGE-HIT", "shop-proxy");
    },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "shop";
    },
  })
);

// API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyReq(proxyReq, req, res) {
      res.setHeader("X-EDGE-HIT", "api-proxy");
    },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "api";
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
    onProxyReq(proxyReq, req, res) {
      res.setHeader("X-EDGE-HIT", "app-proxy");
    },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "app";
    },
  })
);

// Redirects
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// Fallback
app.use((req, res) => {
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge TRACE en :${PORT}`));
