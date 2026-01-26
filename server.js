/**
 * ✅ pos360-edge/server.js
 * Reverse proxy por PATH (SIN loops)
 *
 * /            -> 301 /shop/
 * /shop        -> 301 /shop/
 * /shop/*      -> proxy SHOP_UPSTREAM (sin redirects)
 * /api/*       -> proxy API_UPSTREAM
 * /app/*       -> proxy APP_UPSTREAM (+ reescritura Location /auth -> /app/auth)
 * /health      -> ok
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ✅ Imprescindible detrás de Nginx/CapRover (respeta X-Forwarded-Proto)
app.set("trust proxy", true);

// ✅ Diferenciar /shop de /shop/ (evita normalizaciones raras)
app.enable("strict routing");

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const API_UPSTREAM = env("API_UPSTREAM", "http://srv-captain--pos360-commerce-api:3000/api/v1");
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin");

// ---- Health ----
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_FIX_NO_LOOP_SHOP_02");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ---- Debug rápido (podés apagarlo después) ----
app.use((req, res, next) => {
  if (PROXY_LOG_LEVEL === "debug") {
    console.log(
      `[EDGE] ${req.method} ${req.originalUrl} host=${req.headers.host} xfproto=${req.headers["x-forwarded-proto"]} proto=${req.protocol}`
    );
  }
  next();
});

// ✅ Redirects EXACTOS (sin tocar /shop/)
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ===== SHOP PROXY (NUNCA REDIRECT) =====
const shopProxy = createProxyMiddleware({
  target: SHOP_UPSTREAM,
  changeOrigin: true,
  logLevel: PROXY_LOG_LEVEL,
  // ✅ mantiene /shop/... tal cual
  onProxyReq: (proxyReq, req, res) => {
    // Asegurar headers forward correctos
    proxyReq.setHeader("X-Forwarded-Proto", req.headers["x-forwarded-proto"] || req.protocol);
    proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
  },
  onProxyRes: (proxyRes, req, res) => {
    // ✅ Nunca permitir que se "auto-redirija" /shop/ -> /shop/
    const loc = proxyRes.headers["location"];
    if (loc && (loc === "/shop/" || loc === `${req.protocol}://${req.headers.host}/shop/`)) {
      delete proxyRes.headers["location"];
      // No cambiamos status; pero esto evita el loop si algún upstream mete loc igual
    }
  },
});

app.use("/shop/", shopProxy);

// ===== API PROXY =====
app.use(
  "/api/",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    pathRewrite: (path) => path.replace(/^\/api\//, "/"),
  })
);

// ===== APP PROXY =====
app.use(
  "/app/",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    pathRewrite: (path) => path.replace(/^\/app\//, "/"),
    onProxyRes: (proxyRes) => {
      // Reescribe Location: /auth -> /app/auth (y similares)
      const loc = proxyRes.headers["location"];
      if (!loc) return;

      // Solo para redirects relativos
      if (loc.startsWith("/")) {
        // si redirige a /auth o /login, lo metemos bajo /app
        proxyRes.headers["location"] = "/app" + loc;
      }
    },
  })
);

// ---- Favicon fallback (evita 404 raros) ----
app.get("/favicon.ico", (req, res) => res.redirect(302, "/shop/favicon.ico"));

// ---- 404 explícito ----
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

app.listen(PORT, () => {
  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api  -> ${API_UPSTREAM}`);
  console.log(`app  -> ${APP_UPSTREAM}`);
});
