/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO
 *
 * Qué corrige:
 * - OG placeholders "__OG_TITLE__" etc: el EDGE los reemplaza para BOTS (Facebook/WhatsApp/Twitter/Telegram/Discord)
 * - Warning de Facebook: inyecta fb:app_id si hay FB_APP_ID
 * - Bug de assets: si el HTML viene con "/app/assets/" lo reescribe a "/shop/assets/" para rutas /shop/*
 * - Mantiene tus proxys existentes: /shop, /shop/assets, /assets, /api, /api/v1, /public, /app (transparente a /shop/app)
 * - ✅ FIX OG IMAGE: /og-default.png SIEMPRE responde image/png y tamaño >= 200x200 (genera 1200x630 si no hay archivo)
 *
 * Resultado:
 * - Facebook debugger deja de ver __OG_TITLE__ y te muestra OG reales (por lo menos default)
 * - og:image ahora apunta a una URL que EXISTE, devuelve image/png, y NO es “demasiado pequeña”
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

function ensureSlashStart(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function removeTrailingSlash(p) {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}
function joinPrefix(prefix, path) {
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const pth = ensureSlashStart(path);
  if (pth === "/") return `${pfx}/`;
  return `${pfx}${pth}`;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1");

// Base pública
const PUBLIC_BASE_URL = removeTrailingSlash(
  env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com")
);

// Paths
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/");
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/");

// OG defaults (mínimo)
const OG_SITE_NAME = env("OG_SITE_NAME", "San Juan Tecnología");
const OG_TITLE_DEFAULT = env("OG_TITLE_DEFAULT", "San Juan Tecnología | Tienda");
const OG_DESCRIPTION_DEFAULT = env(
  "OG_DESCRIPTION_DEFAULT",
  "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas."
);
const OG_IMAGE_DEFAULT = env("OG_IMAGE_DEFAULT", `${PUBLIC_BASE_URL}/og-default.png`);
const FB_APP_ID = env("FB_APP_ID", ""); // opcional: si lo ponés, desaparece el warning

// ✅ Ruta local del PNG (si la tenés, se usa)
// pos360-edge/public/og-default.png
const OG_DEFAULT_FILE = path.join(__dirname, "public", "og-default.png");

// ====== Core settings ======
app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_OG_INJECT_BOTS_ASSETFIX_03_OGPNG_1200x630");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ====== PNG generator (sin deps) ======
let __crcTable = null;
function crc32(buf) {
  if (!__crcTable) {
    __crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      __crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = __crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createSolidPng(width, height, rgba = [245, 245, 245, 255]) {
  const [r, g, b, a] = rgba;

  // Raw scanlines: each row starts with filter byte 0, then RGBA pixels
  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(rowLen * height);

  const row = Buffer.alloc(rowLen);
  row[0] = 0; // filter type 0
  for (let x = 0; x < width; x++) {
    const o = 1 + x * 4;
    row[o] = r;
    row[o + 1] = g;
    row[o + 2] = b;
    row[o + 3] = a;
  }
  for (let y = 0; y < height; y++) row.copy(raw, y * rowLen);

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ✅ buffer generado 1200x630 (cumple mínimo 200x200 y formato OG recomendado)
const OG_DEFAULT_PNG_BUFFER = createSolidPng(1200, 630, [245, 245, 245, 255]);

// ====== ✅ OG DEFAULT PNG (ANTES DE TODO) ======
// - Si existe public/og-default.png => lo sirve
// - Si NO existe => intenta upstream
// - Si no hay upstream => genera 1200x630 (NO “demasiado pequeña”)
app.get("/og-default.png", async (req, res) => {
  try {
    // 1) archivo local
    if (fs.existsSync(OG_DEFAULT_FILE)) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-EDGE-HIT", "og-default-local");
      return res.sendFile(OG_DEFAULT_FILE);
    }

    // 2) upstream (si el FE lo tiene)
    const upstreamUrl = `${removeTrailingSlash(SHOP_UPSTREAM)}/og-default.png`;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(upstreamUrl, { method: "GET", signal: controller.signal }).finally(
        () => clearTimeout(t)
      );

      const ct = String(resp.headers.get("content-type") || "").toLowerCase();
      if (resp.ok && ct.includes("image/")) {
        const buf = Buffer.from(await resp.arrayBuffer());
        res.status(200);
        res.setHeader("Content-Type", ct || "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-EDGE-HIT", "og-default-upstream");
        return res.send(buf);
      }
    } catch (_) {
      // ignore y caemos al generado
    }

    // 3) generado 1200x630
    res.status(200);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-EDGE-HIT", "og-default-generated");
    return res.send(OG_DEFAULT_PNG_BUFFER);
  } catch (e) {
    res.status(200);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-EDGE-HIT", "og-default-generated");
    return res.send(OG_DEFAULT_PNG_BUFFER);
  }
});

// ====== Helpers: proxy builder ======
function makeProxy(target, opts = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    secure: false,
    ...opts,
    onProxyReq(proxyReq, req, res) {
      // ✅ Importante: preserva Host público para que el upstream no genere URLs raras
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
    onError(err, req, res) {
      console.error(
        "❌ proxy error:",
        req.method,
        req.originalUrl,
        err && err.message ? err.message : err
      );
      if (res.headersSent) return;
      res.status(502).json({
        ok: false,
        error: "Bad Gateway",
        path: req.originalUrl,
        message: String(err && err.message ? err.message : err),
      });
    },
  });
}

// ====== BOT detection + HTML injector ======
function isBot(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  if (!ua) return false;
  return (
    ua.includes("facebookexternalhit") ||
    ua.includes("facebot") ||
    ua.includes("whatsapp") ||
    ua.includes("twitterbot") ||
    ua.includes("telegrambot") ||
    ua.includes("discordbot") ||
    ua.includes("linkedinbot") ||
    ua.includes("slackbot") ||
    ua.includes("pinterest") ||
    ua.includes("googlebot")
  );
}

function wantsHtml(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

function injectFbAppId(html) {
  if (!FB_APP_ID) return html;
  if (html.includes('property="fb:app_id"') || html.includes("property='fb:app_id'")) {
    return html;
  }
  const meta = `\n    <meta property="fb:app_id" content="${FB_APP_ID}" />\n`;
  if (html.includes('property="og:type"')) {
    return html.replace(
      'property="og:type"',
      `property="fb:app_id" content="${FB_APP_ID}" />\n    <meta property="og:type"`
    );
  }
  return html.replace("</head>", `${meta}</head>`);
}

function replaceTokens(html, req) {
  const fullUrl = `${PUBLIC_BASE_URL}${req.originalUrl}`;
  const canonical = fullUrl;

  let out = html
    .replaceAll("__TITLE__", OG_TITLE_DEFAULT)
    .replaceAll("__DESCRIPTION__", OG_DESCRIPTION_DEFAULT)
    .replaceAll("__CANONICAL__", canonical)

    .replaceAll("__SITE_NAME__", OG_SITE_NAME)
    .replaceAll("__OG_TITLE__", OG_TITLE_DEFAULT)
    .replaceAll("__OG_DESCRIPTION__", OG_DESCRIPTION_DEFAULT)
    .replaceAll("__OG_URL__", fullUrl)
    .replaceAll("__OG_IMAGE__", OG_IMAGE_DEFAULT)
    .replaceAll("__OG_IMAGE_ALT__", OG_TITLE_DEFAULT);

  if (req.originalUrl.startsWith("/shop/")) {
    out = out
      .replaceAll('src="/app/assets/', 'src="/shop/assets/')
      .replaceAll("src='/app/assets/", "src='/shop/assets/")
      .replaceAll('href="/app/assets/', 'href="/shop/assets/')
      .replaceAll("href='/app/assets/", "href='/shop/assets/");
  }

  out = injectFbAppId(out);
  return out;
}

async function fetchUpstreamHtml(pathname) {
  const url = `${removeTrailingSlash(SHOP_UPSTREAM)}${pathname}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/html,*/*;q=0.8" },
    signal: controller.signal,
  }).finally(() => clearTimeout(t));

  const ct = String(resp.headers.get("content-type") || "");
  const text = await resp.text();

  return { status: resp.status, contentType: ct, body: text };
}

async function botOgMiddleware(req, res, next) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isBot(req)) return next();
    if (!wantsHtml(req)) return next();

    if (
      req.originalUrl.startsWith("/shop/assets/") ||
      req.originalUrl.startsWith("/assets/") ||
      req.originalUrl.startsWith("/api/") ||
      req.originalUrl.startsWith("/public/") ||
      req.originalUrl.startsWith("/app/") ||
      req.originalUrl === "/og-default.png"
    ) {
      return next();
    }

    const upstreamPath = joinPrefix(FRONTEND_INDEX_PATH, req.path);
    const { status, contentType, body } = await fetchUpstreamHtml(upstreamPath);

    if (!String(contentType).toLowerCase().includes("text/html")) {
      res.status(status).send(body);
      return;
    }

    const patched = replaceTokens(body, req);

    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-EDGE-HIT", "bot-og-inject");
    res.send(patched);
  } catch (e) {
    console.error("❌ botOgMiddleware error:", e && e.message ? e.message : e);
    next();
  }
}

// ====== Proxys ======

const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path),
});

const appProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(APP_INDEX_PATH, path),
});

const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (path) => {
    const base = ensureSlashStart(API_BASE);
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${ensureSlashStart(path)}`;
  },
});

const apiV1CompatProxy = makeProxy(API_ORIGIN);
const publicCompatProxy = makeProxy(API_ORIGIN);

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));
app.get("/app", (req, res) => res.redirect(301, "/app/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======
app.use("/shop/", botOgMiddleware);

app.use("/shop/assets/", shopAssetsFirstProxy);

app.use("/assets/", rootAssetsProxy);

app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

app.use("/app/", appProxy);

app.use("/shop/", shopProxy);

app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

app.use("/api/", apiProxy);

// ====== 404 edge ======
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api -> ${API_ORIGIN}${API_BASE}`);
  console.log(`app -> ${SHOP_UPSTREAM} (transparent /app -> ${APP_INDEX_PATH})`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
  console.log(`FB_APP_ID -> ${FB_APP_ID ? "SET" : "NOT_SET"}`);
  console.log(`OG_DEFAULT_FILE -> ${OG_DEFAULT_FILE}`);
});
