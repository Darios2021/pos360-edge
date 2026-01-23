/**
 * pos360-edge (FINAL PRO - PRODUCT OG FIX + /app FIX)
 * - / -> /shop
 * - ✅ /api/v1/* -> commerce-api (evita "me devuelve HTML")
 * - Inyecta OG/Favicon en HTML
 *   - ✅ /shop/product/:id => OG por producto (title/desc/image)
 *   - resto => OG branding
 * - ✅ /app y /app/* => proxy directo al frontend (admin)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

// node-fetch lazy (compat)
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/shop").replace(/\/+$/, "");

const API_BASE = String(process.env.API_BASE || "https://sanjuantecnologia.com/api/v1").replace(/\/+$/, "");

// Branding público (tu backend lo sirve en /public/shop/branding o similar)
// Ajustá SOLO esto si tu endpoint cambió:
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/public/shop/branding").trim();

// Producto público (para OG por producto):
const PRODUCT_PUBLIC_ENDPOINT = String(process.env.PRODUCT_PUBLIC_ENDPOINT || "/public/products").trim();

const CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);

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

function wantsHtml(req) {
  const a = String(req.headers.accept || "");
  return a.includes("text/html") || a.includes("*/*") || a === "";
}

function isAssetPath(p) {
  return (
    p.startsWith("/assets/") ||
    p.startsWith("/favicon") ||
    p.startsWith("/robots.txt") ||
    p.startsWith("/sitemap") ||
    p.startsWith("/.well-known/") ||
    /\.[a-z0-9]{2,6}$/i.test(p)
  );
}

function isShopProductPath(p) {
  // /shop/product/303
  return /^\/shop\/product\/(\d+)(\/)?$/i.test(p);
}
function getProductIdFromPath(p) {
  const m = p.match(/^\/shop\/product\/(\d+)(\/)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* =========================
   BRANDING CACHE
   ========================= */
let cachedBranding = null;
let cachedAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedAt < CACHE_SECONDS * 1000) return cachedBranding;

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
    cachedAt = now;
    return cachedBranding;
  } catch {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedAt = now;
    return cachedBranding;
  }
}

/* =========================
   PRODUCT (OG) helper
   ========================= */
function pickImageFromProduct(p) {
  // intentos típicos (adaptable sin romper)
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

  // arrays típicos
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
  try {
    const r = await fetch(`${API_BASE}${PRODUCT_PUBLIC_ENDPOINT}/${productId}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`product http ${r.status}`);
    const j = await r.json();

    // tolerar envoltorios
    const p = j?.item || j?.product || j?.data || j;

    const name = String(p?.name || p?.title || "").trim();
    const desc = pickDescFromProduct(p);
    const img = pickImageFromProduct(p);

    return {
      name,
      desc,
      image: absUrl(img),
    };
  } catch {
    return null;
  }
}

/* =========================
   0) HOME
   ========================= */
app.get("/", (req, res) => res.redirect(301, "/shop"));

/* =========================
   0.1) /app (admin)
   ========================= */
app.get("/app", (req, res, next) => next()); // lo maneja el proxy al frontend
app.get("/app/*", (req, res, next) => next()); // idem

/* =========================
   1) ✅ API PROXY
   /api/v1/* -> commerce-api
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

/* =========================
   2) HTML INJECTION
   - Solo para navegación HTML
   - ✅ SOLO para shop (no /app)
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    if (req.path.startsWith("/api/v1/") || isAssetPath(req.path) || !wantsHtml(req)) return next();

    // ✅ Admin (/app) NO se inyecta con og de shop
    if (req.path === "/app" || req.path.startsWith("/app/")) return next();

    const [branding, indexRes] = await Promise.all([
      loadBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    // base
    let title = `${branding.name} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    let favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;
    let ogImage = branding.ogImage || favicon;

    // ✅ PRODUCT OG (mejora WhatsApp/Facebook)
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
   3) favicon.ico tipo WordPress
   ========================= */
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

/* =========================
   4) Proxy resto al frontend
   ========================= */
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,

    // ✅ evita Location: http://srv-captain--pos360-frontend/...
    autoRewrite: true,
    protocolRewrite: "https",

    onProxyReq(proxyReq, req) {
      // ayudar a upstream a entender el host real
      try {
        const host = new URL(PUBLIC_BASE_URL).host;
        proxyReq.setHeader("X-Forwarded-Host", host);
        proxyReq.setHeader("X-Forwarded-Proto", "https");
      } catch {}
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
