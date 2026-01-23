/**
 * pos360-edge (FINAL DEFINITIVO)
 * - / -> /shop
 * - ✅ /api/v1/* -> commerce-api
 * - ✅ COMPAT: /public/* -> /api/v1/public/*   (evita HTML en fetch de catálogo)
 * - ✅ Inyecta OG/Favicon SOLO para navegación HTML real (Accept: text/html)
 *   - /shop/product/:id => OG por producto
 *   - resto => OG branding
 * - ✅ /app y /app/* => proxy directo al frontend (admin) + fix Location interno
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = Number(process.env.PORT || 3000);

const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const PUBLIC_HOST = (() => {
  try {
    return new URL(PUBLIC_BASE_URL).host;
  } catch {
    return "sanjuantecnologia.com";
  }
})();

const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/shop").replace(/\/+$/, "");

const API_BASE = String(process.env.API_BASE || "https://pos360-commerce-api.cingulado.org/api/v1").replace(/\/+$/, "");
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/public/shop/branding").trim();
const PRODUCT_PUBLIC_ENDPOINT = String(process.env.PRODUCT_PUBLIC_ENDPOINT || "/public/products").trim();

const CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);
const PRODUCT_CACHE_SECONDS = Math.max(5, parseInt(process.env.PRODUCT_CACHE_SECONDS || "60", 10) || 60);

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

// ✅ FIX CLAVE: SOLO navegación HTML real
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

function isShopProductPath(p) {
  return /^\/shop\/product\/(\d+)(\/)?$/i.test(p);
}
function getProductIdFromPath(p) {
  const m = String(p || "").match(/^\/shop\/product\/(\d+)(\/)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* =========================
   BRANDING CACHE
   ========================= */
let cachedBranding = null;
let cachedBrandingAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedBrandingAt < CACHE_SECONDS * 1000) return cachedBranding;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url);
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url);

    cachedBranding = { name, favicon, ogImage };
    cachedBrandingAt = now;
    return cachedBranding;
  } catch {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedBrandingAt = now;
    return cachedBranding;
  }
}

/* =========================
   PRODUCT OG CACHE
   ========================= */
const productCache = new Map(); // id -> { at, data }
function getCachedProduct(id) {
  const k = String(id);
  const it = productCache.get(k);
  if (!it) return null;
  if (Date.now() - it.at > PRODUCT_CACHE_SECONDS * 1000) return null;
  return it.data;
}
function setCachedProduct(id, data) {
  const k = String(id);
  productCache.set(k, { at: Date.now(), data });
  if (productCache.size > 500) {
    const firstKey = productCache.keys().next().value;
    productCache.delete(firstKey);
  }
}

function pickImageFromProduct(p) {
  const tryKeys = [
    "og_image_url",
    "image_url",
    "image",
    "thumbnail",
    "thumb",
    "cover",
    "main_image",
    "primary_image",
    "photo_url",
  ];
  for (const k of tryKeys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const arrs = [p?.images, p?.product_images, p?.gallery, p?.photos];
  for (const a of arrs) {
    if (Array.isArray(a) && a.length) {
      const first = a[0];
      const u =
        (typeof first === "string" && first) ||
        first?.url ||
        first?.image_url ||
        first?.src ||
        first?.path ||
        "";
      if (u) return String(u);
    }
  }
  return "";
}

function pickDescFromProduct(p) {
  const keys = ["short_description", "description", "desc", "summary"];
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function loadProductForOg(productId) {
  const cached = getCachedProduct(productId);
  if (cached) return cached;

  try {
    const r = await fetch(`${API_BASE}${PRODUCT_PUBLIC_ENDPOINT}/${productId}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`product http ${r.status}`);
    const j = await r.json();

    const p = j?.item || j?.product || j?.data || j;

    const data = {
      name: String(p?.name || p?.title || "").trim(),
      desc: pickDescFromProduct(p),
      image: absUrl(pickImageFromProduct(p)),
    };

    setCachedProduct(productId, data);
    return data;
  } catch {
    const data = null;
    setCachedProduct(productId, data);
    return data;
  }
}

/* =========================
   0) HOME
   ========================= */
app.get("/", (req, res) => res.redirect(301, "/shop"));

/* =========================
   1) ✅ API PROXY /api/v1/*
   ========================= */
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: "https://pos360-commerce-api.cingulado.org",
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: { "^/api/v1": "/api/v1" },
  })
);

/* =========================================================
   2) ✅ COMPAT: /public/* -> /api/v1/public/*
   (esto arregla tu explosión actual sin tocar frontend)
   ========================================================= */
app.use(
  "/public",
  createProxyMiddleware({
    target: "https://pos360-commerce-api.cingulado.org",
    changeOrigin: true,
    secure: true,
    ws: true,
    // /public/catalog?... -> /api/v1/public/catalog?...
    pathRewrite: (p) => `/api/v1${p}`,
  })
);

/* =========================
   3) favicon.ico tipo WP
   ========================= */
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

/* =========================
   4) HTML INJECTION (SOLO HTML REAL)
   - NO /api, NO /public, NO assets, NO /app
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    if (req.path.startsWith("/api/")) return next();
    if (req.path.startsWith("/public/")) return next();
    if (isAssetPath(req.path)) return next();

    // ✅ Admin NO se inyecta
    if (req.path === "/app" || req.path.startsWith("/app/")) return next();

    // ✅ SOLO navegación HTML real
    if (!wantsHtml(req)) return next();

    const [branding, indexRes] = await Promise.all([
      loadBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    let title = `${branding.name} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;
    let ogImage = branding.ogImage || favicon;

    // ✅ PRODUCT OG (WhatsApp/FB)
    if (isShopProductPath(req.path)) {
      const productId = getProductIdFromPath(req.path);
      if (productId) {
        const p = await loadProductForOg(productId);
        if (p?.name) title = `${p.name} | ${branding.name}`;
        if (p?.desc) desc = p.desc.slice(0, 300);
        if (p?.image) ogImage = p.image;
      }
    }

    // Evitar duplicados
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
<meta property="og:site_name" content="${esc(branding.name)}" />
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

/* =========================
   5) Proxy resto al frontend (incluye /shop y /app)
   + FIX Location interno
   ========================= */
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
    secure: false,

    autoRewrite: true,
    protocolRewrite: "https",

    onProxyReq(proxyReq) {
      proxyReq.setHeader("X-Forwarded-Host", PUBLIC_HOST);
      proxyReq.setHeader("X-Forwarded-Proto", "https");
    },

    onProxyRes(proxyRes) {
      const loc = proxyRes.headers?.location;
      if (loc && typeof loc === "string") {
        // si upstream devuelve Location con host interno, lo reescribimos
        const fixed = loc
          .replace(/^http:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL)
          .replace(/^https?:\/\/pos360-frontend\.cingulado\.org/i, PUBLIC_BASE_URL);
        proxyRes.headers.location = fixed;
      }
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
