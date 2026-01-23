// server.js
// ✅ COPY-PASTE FINAL (POS360-EDGE) — FIX API HTML HIJACK + /public compat
//
// FIX:
// ✅ No trata "*/*" como HTML (evita que XHR/axios reciba index.html)
// ✅ /public/* NO se inyecta: se proxya a /api/v1/public/*
// ✅ /api/v1/* proxya normal a commerce-api
// ✅ OG de producto en /shop/product/:id (si endpoint devuelve JSON usable)
//
// Requiere deps:
//   npm i http-proxy-middleware node-fetch

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ===== ENV =====
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");

const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH_RAW = String(process.env.FRONTEND_INDEX_PATH || "/shop/");

const FRONTEND_INDEX_PATH = FRONTEND_INDEX_PATH_RAW.startsWith("/")
  ? FRONTEND_INDEX_PATH_RAW
  : `/${FRONTEND_INDEX_PATH_RAW}`;

const API_INTERNAL = String(process.env.API_INTERNAL || "").trim().replace(/\/+$/, ""); // ej: http://srv-captain--pos360-commerce-api:3000
const API_BASE = String(process.env.API_BASE || "https://pos360-commerce-api.cingulado.org/api/v1").replace(/\/+$/, "");

const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/public/shop/branding");
const PRODUCT_ENDPOINT = String(process.env.PRODUCT_ENDPOINT || "/public/products");

const BRANDING_CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);
const PRODUCT_CACHE_SECONDS = Math.max(5, parseInt(process.env.PRODUCT_CACHE_SECONDS || "60", 10) || 60);

// ===== utils =====
function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

// ✅ FIX CLAVE: SOLO HTML si Accept contiene text/html
function wantsHtml(req) {
  const a = String(req.headers.accept || "");
  return a.includes("text/html");
}

function isAssetPath(p) {
  return (
    p.startsWith("/assets/") ||
    p.startsWith("/favicon") ||
    p === "/robots.txt" ||
    p.startsWith("/sitemap") ||
    p.startsWith("/.well-known/") ||
    /\.(css|js|mjs|map|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|eot|txt|xml)$/i.test(p)
  );
}

function detectProductId(pathname) {
  const m = String(pathname || "").match(/^\/shop\/product\/(\d+)(\/|$)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickProductImage(prod) {
  const candidates = [
    prod?.og_image_url,
    prod?.image_url,
    prod?.cover_url,
    prod?.thumbnail_url,
    prod?.thumb_url,
    prod?.main_image_url,
    prod?.primary_image_url,
    prod?.image,
    prod?.thumbnail,
    prod?.thumb,
    Array.isArray(prod?.images) ? (prod.images[0]?.url || prod.images[0]) : null,
    Array.isArray(prod?.product_images) ? (prod.product_images[0]?.url || prod.product_images[0]) : null,
  ];

  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return absUrl(v);
  }
  return "";
}

// ===== caches =====
let cachedBranding = null;
let cachedBrandingAt = 0;

const productCache = new Map(); // id -> { at, data }
function getCachedProduct(id) {
  const it = productCache.get(String(id));
  if (!it) return null;
  if (Date.now() - it.at > PRODUCT_CACHE_SECONDS * 1000) return null;
  return it.data;
}
function setCachedProduct(id, data) {
  productCache.set(String(id), { at: Date.now(), data });
  if (productCache.size > 500) {
    const firstKey = productCache.keys().next().value;
    productCache.delete(firstKey);
  }
}

async function apiFetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedBrandingAt < BRANDING_CACHE_SECONDS * 1000) return cachedBranding;

  try {
    const j = await apiFetchJson(`${API_BASE}${BRANDING_ENDPOINT}`);

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url || "");
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url || "");

    cachedBranding = { name, favicon, ogImage };
    cachedBrandingAt = now;
    return cachedBranding;
  } catch {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedBrandingAt = now;
    return cachedBranding;
  }
}

async function loadProduct(id) {
  const cached = getCachedProduct(id);
  if (cached) return cached;

  try {
    const j = await apiFetchJson(`${API_BASE}${PRODUCT_ENDPOINT}/${id}`);
    const prod = j?.item || j?.product || j;

    const data = {
      id,
      name: String(prod?.name || prod?.title || "").trim(),
      description: String(prod?.description || prod?.short_description || "").trim(),
      image: pickProductImage(prod),
    };

    setCachedProduct(id, data);
    return data;
  } catch {
    const data = { id, name: "", description: "", image: "" };
    setCachedProduct(id, data);
    return data;
  }
}

// =========================
// 0) HOME -> /shop
// =========================
app.get("/", (req, res) => res.redirect(301, "/shop/"));

// =========================
// 1) ✅ COMPAT: /public/* -> /api/v1/public/*
// (Porque tu frontend está pegando /public/catalog y hoy rompe)
// =========================
app.use(
  "/public",
  createProxyMiddleware({
    target: API_INTERNAL || "https://pos360-commerce-api.cingulado.org",
    changeOrigin: false,
    secure: true,
    ws: true,
    // /public/catalog  => /api/v1/public/catalog
    pathRewrite: (pathReq) => `/api/v1${pathReq}`,
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Proto", "https");
    },
  })
);

// =========================
// 2) /api/v1/* -> commerce-api
// =========================
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_INTERNAL || "https://pos360-commerce-api.cingulado.org",
    changeOrigin: false,
    secure: true,
    ws: true,
    pathRewrite: { "^/api/v1": "/api/v1" },
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Proto", "https");
    },
  })
);

// =========================
// 3) favicon.ico dinámico
// =========================
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

// =========================
// 4) HTML Injection (solo navegación HTML real)
// =========================
app.get("*", async (req, res, next) => {
  try {
    // ✅ NO interceptar API ni compat
    if (req.path.startsWith("/api/")) return next();
    if (req.path.startsWith("/public/")) return next();
    if (isAssetPath(req.path)) return next();

    // ✅ Solo HTML real (Accept: text/html)
    if (!wantsHtml(req)) return next();

    const productId = detectProductId(req.path);

    const indexUrl = `${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`;
    const [branding, indexRes, product] = await Promise.all([
      loadBranding(),
      fetch(indexUrl, { headers: { Accept: "text/html" }, redirect: "follow" }),
      productId ? loadProduct(productId) : Promise.resolve(null),
    ]);

    let html = await indexRes.text();

    const siteName = branding.name || "San Juan Tecnología";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/"}`;

    let title = `${siteName} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    let ogImage = branding.ogImage || branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;

    if (productId) {
      const pName = product?.name || `Producto #${productId}`;
      title = `${pName} | ${siteName}`;
      if (product?.description) desc = product.description.slice(0, 200);
      if (product?.image) ogImage = product.image;
    }

    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;

    // limpiar duplicados
    html = html.replace(/<title>.*?<\/title>/is, "");
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']icon["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>/gi, "");
    html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "");
    html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");

    const inject = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />

<link rel="icon" type="image/png" href="${esc(favicon)}" />
<link rel="apple-touch-icon" href="${esc(favicon)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(siteName)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />
<meta property="og:image:alt" content="${esc(title)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
`;

    html = html.replace(/<\/head>/i, `${inject}\n</head>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    return res.status(200).send(html);
  } catch (e) {
    return next(e);
  }
});

// =========================
// 5) Proxy resto al frontend
// =========================
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: false,
    ws: true,
    secure: true,
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader("Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Proto", "https");
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
