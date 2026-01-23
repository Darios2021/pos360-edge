/**
 * ✅ pos360-edge/server.js
 * Reverse proxy por PATH:
 * - /shop/*  -> pos360-commerce-frontend (nginx)
 * - /api/*   -> pos360-commerce-api (express)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

// ✅ Nombres reales (CapRover)
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-commerce-frontend");
const API_UPSTREAM = env("API_UPSTREAM", "http://srv-captain--pos360-commerce-api");

app.disable("x-powered-by");

// health
app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "pos360-edge" }));

// ------------------------------------------------------
// ✅ PROXY SHOP
// ------------------------------------------------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: env("PROXY_LOG_LEVEL", "warn"),
    onProxyReq(proxyReq, req) {
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
    },
    onError(err, req, res) {
      console.error("[shop-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (shop)");
    },
  })
);

// ------------------------------------------------------
// ✅ PROXY API
// ------------------------------------------------------
// IMPORTANTE:
// - Montamos en /api
// - NO hacemos pathRewrite
// Resultado: /api/v1/... -> API_UPSTREAM/api/v1/...
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: env("PROXY_LOG_LEVEL", "warn"),
    onProxyReq(proxyReq, req) {
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
    },
    onError(err, req, res) {
      console.error("[api-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (api)");
    },
  })
);

// root -> /shop/
app.get("/", (_req, res) => res.redirect(302, "/shop/"));

// 404 final
app.use((_req, res) => res.status(404).type("text/plain").send("Not found"));

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop -> ${SHOP_UPSTREAM}`);
  console.log(`   api  -> ${API_UPSTREAM}`);
});
