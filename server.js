/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL)
 *
 * Routing:
 * - /            -> redirect to /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice vive en el mismo frontend)
 * - /api/*       -> API  (API_ORIGIN + API_BASE_PATH)
 *
 * Fixes:
 * - trust proxy => detecta https correctamente
 * - PRESERVA Host público (evita Location: http://srv-captain--...)
 * - reescribe Location a https://<host público>/...
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

function stripTrailingSlashes(s) {
  return String(s || "").replace(/\/+$/, "");
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

const PUBLIC_BASE_URL = stripTrailingSlashes(env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com"));

const FRONTEND_UPSTREAM = stripTrailingSlashes(
  env("FRONTEND_UPSTREAM", env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend"))
);

// API: ORIGIN + BASE PATH
const API_ORIGIN = stripTrailingSlashes(
  env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000")
);
const API_BASE_PATH = env("API_BASE_PATH", "/api/v1").startsWith("/")
  ? env("API_BASE_PATH", "/api/v1")
  : `/${env("API_BASE_PATH", "api/v1")}`;

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function isHttps(req) {
  const xfProtoRaw = req.headers["x-forwarded-proto"];
  const xfProto = (xfProtoRaw ? String(xfProtoRaw) : "").split(",")[0].trim();
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

/**
 * ✅ Importante:
 * - Para FRONTEND: changeOrigin:false + set Host original => evita redirects a srv-captain--
 * - Para API: changeOrigin:true está bien
 */
function setForwardHeaders(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  if (req.headers.host) proxyReq.setHeader("X-Forwarded-Host", req.headers.host);
}

function preservePublicHost(proxyReq, req) {
  // ✅ esto evita que el upstream genere Location con srv-captain--
  if (req.headers.host) proxyReq.setHeader("Host", req.headers.host);
}

function rewriteLocationToPublic(proxyRes, req) {
  const loc = proxyRes.headers["location"];
  if (!loc) return;

  const host = req.headers.host;
  if (!host) return;

  let newLoc = String(loc);

  // 1) si viene con el service interno => lo llevamos al host público
  newLoc = newLoc.replace(
    /^https?:\/\/srv-captain--pos360-frontend(?=\/|$)/i,
    `https://${host}`
  );
  newLoc = newLoc.replace(
    /^https?:\/\/127\.0\.0\.1(?=\/|$)/i,
    `https://${host}`
  );

  // 2) upgrade http://<host> => https://<host>
  const hostRe = host.replace(/\./g, "\\.");
  newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${hostRe}(?=\\/|$)`, "i"), `https://${host}`);

  // 3) si el request original fue https y la location quedó en http, la subimos igual
  if (isHttps(req)) newLoc = newLoc.replace(/^http:\/\//i, "https://");

  if (newLoc !== loc) proxyRes.headers["location"] = newLoc;
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    frontend: FRONTEND_UPSTREAM,
    apiOrigin: API_ORIGIN,
    apiBasePath: API_BASE_PATH,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ =====
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=/shop/" />
  <title>pos360-edge</title>
</head>
<body>
  <script>location.replace('/shop/');</script>
  <noscript><a href="/shop/">/shop/</a></noscript>
</body>
</html>`);
});

// ===== /api -> API =====
// /api/xxx  =>  API_ORIGIN + /api/v1/xxx
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: (proxyReq, req) => {
      setForwardHeaders(proxyReq, req);
      // Host para API no es crítico, pero no molesta mantenerlo
      preservePublicHost(proxyReq, req);
    },
    onProxyRes: rewriteLocationToPublic,
    pathRewrite: (path) => {
      // /api/foo => /api/v1/foo
      const rest = path.replace(/^\/api(\/|$)/, "/");
      return `${API_BASE_PATH}${rest === "/" ? "" : rest}`;
    },
  })
);

// ===== FRONTEND proxies (SHOP + APP) =====
const frontendProxy = createProxyMiddleware({
  target: FRONTEND_UPSTREAM,
  changeOrigin: false, // ✅ CLAVE: NO cambies el Host al del target
  logLevel: PROXY_LOG_LEVEL,
  xfwd: true,
  onProxyReq: (proxyReq, req) => {
    setForwardHeaders(proxyReq, req);
    preservePublicHost(proxyReq, req); // ✅ CLAVE
  },
  onProxyRes: rewriteLocationToPublic,
});

// /shop/* -> frontend
app.use("/shop", frontendProxy);

// /app/* -> frontend (backoffice en el mismo frontend)
app.use("/app", frontendProxy);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`frontend -> ${FRONTEND_UPSTREAM}/`);
  console.log(`api origin -> ${API_ORIGIN}`);
  console.log(`api base -> ${API_BASE_PATH}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
