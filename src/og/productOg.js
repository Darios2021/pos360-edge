/**
 * src/og/productOg.js
 * ✅ COPY-PASTE FINAL
 * - Elige precio válido (>0) evitando "0.00"
 * - Formatea ARS para og:title cuando OG_TITLE_INCLUDE_PRICE=1
 */

const {
  API_ORIGIN,
  API_BASE,
  OG_BRANCH_ID,
  OG_SITE_NAME,
  OG_DESCRIPTION_DEFAULT,
  OG_IMAGE_DEFAULT,
  OG_TITLE_INCLUDE_PRICE,
  OG_PRICE_CURRENCY_DEFAULT,
  PUBLIC_BASE_URL,
  removeTrailingSlash,
  ensureSlashStart,
} = require("../config");

function absolutizeUrl(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

function pickFirstImage(obj) {
  if (!obj) return "";
  const candidates = [
    obj.og_image,
    obj.image,
    obj.image_url,
    obj.imageUrl,
    obj.cover,
    obj.cover_url,
    obj.thumbnail,
    obj.thumbnail_url,
    obj.photo,
    obj.photo_url,
    obj.main_image,
    obj.main_image_url,
  ];
  for (const c of candidates) if (c && String(c).trim()) return String(c).trim();

  const imgs = obj.images || obj.gallery || obj.pictures;
  if (Array.isArray(imgs) && imgs.length) {
    const first = imgs[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      return first.url || first.secure_url || first.src || first.path || first.location || first.public_url || "";
    }
  }
  return "";
}

function deriveImageVersion(imageUrl, productId, branchId) {
  const u = String(imageUrl || "");
  const m = u.match(/\/(\d{10,})-[^\/]+\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (m && m[1]) return m[1];
  const m2 = u.match(/\/(\d{10,})\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (m2 && m2[1]) return m2[1];
  return `p${String(productId || "").trim() || "x"}-b${String(branchId || "").trim() || "x"}`;
}

function addVersionParam(url, key, version) {
  if (!url) return url;
  const s = String(url);
  if (!version) return s;
  const re = new RegExp(`[?&]${key}=`, "i");
  if (re.test(s)) return s;
  return s.includes("?")
    ? `${s}&${key}=${encodeURIComponent(version)}`
    : `${s}?${key}=${encodeURIComponent(version)}`;
}

/**
 * Convierte strings tipo:
 * - "14.100,00" -> 14100
 * - "14100.00"  -> 14100
 * - 14100       -> 14100
 */
function moneyToNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;

  const s0 = String(v).trim();
  if (!s0) return 0;

  // limpia espacios
  let s = s0.replace(/\s/g, "");

  // Si tiene coma decimal (latam): "14.100,00"
  // -> sacamos miles "." y cambiamos "," por "."
  if (s.includes(",") && !s.includes(".")) {
    // "14100,00" => "14100.00"
    s = s.replace(",", ".");
  } else if (s.includes(",") && s.includes(".")) {
    // "14.100,00" => "14100.00"
    s = s.replace(/\./g, "").replace(",", ".");
  }

  // ahora parse float
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function formatMoneyForTitle(n, currency) {
  const num = typeof n === "number" ? n : moneyToNumber(n);
  if (!(num > 0)) return "";

  // Para ARS: sin decimales, miles con punto (es-AR)
  if ((currency || "").toUpperCase() === "ARS") {
    try {
      return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(num);
    } catch (_) {
      // fallback simple
      return String(Math.round(num));
    }
  }

  // para otras monedas: 2 decimales
  try {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  } catch (_) {
    return String(num);
  }
}

function pickFirstValidPrice(item) {
  // Prioridad: descuento/final > price > list > amount
  const candidates = [
    item.price_discount,
    item.price_final,
    item.price,
    item.price_list,
    item.amount,
    item.total,
  ];

  for (const c of candidates) {
    const n = moneyToNumber(c);
    if (n > 0) return n;
  }

  // si viene en un objeto tipo { value: ... }
  if (item && typeof item === "object") {
    const extra = [
      item.final_price,
      item.sale_price,
      item.list_price,
      item.precio,
      item.precio_final,
      item.precio_lista,
      item.precio_descuento,
    ];
    for (const c of extra) {
      const n = moneyToNumber(c);
      if (n > 0) return n;
    }
  }

  return 0;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, status: resp.status, data: null, text };
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { ok: false, status: resp.status, data: null, text };
    }
    return { ok: true, status: resp.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: "" };
  } finally {
    clearTimeout(t);
  }
}

async function fetchProductOg(productId, branchId) {
  const id = String(productId || "").trim();
  const br = String(branchId || "").trim() || OG_BRANCH_ID;
  if (!id) return null;

  const base = removeTrailingSlash(API_ORIGIN) + ensureSlashStart(API_BASE);
  const branch = encodeURIComponent(br);

  const tries = [
    `${base}/public/products/${encodeURIComponent(id)}?branch_id=${branch}`,
    `${base}/public/product/${encodeURIComponent(id)}?branch_id=${branch}`,
    `${base}/public/products/${encodeURIComponent(id)}`,
    `${base}/public/product/${encodeURIComponent(id)}`,
    `${base}/public/catalog?branch_id=${branch}&product_id=${encodeURIComponent(id)}&page=1&limit=1`,
    `${base}/public/catalog?branch_id=${branch}&id=${encodeURIComponent(id)}&page=1&limit=1`,
  ];

  for (const url of tries) {
    const r = await fetchJson(url, 5000);
    if (!r.ok || !r.data) continue;

    const d = r.data;
    const item =
      d.item ||
      d.product ||
      (Array.isArray(d.items) && d.items[0]) ||
      (Array.isArray(d.data) && d.data[0]) ||
      d;

    if (!item || typeof item !== "object") continue;

    const name =
      item.name ||
      item.title ||
      item.product_name ||
      item.productTitle ||
      item.nombre ||
      "";

    const img = pickFirstImage(item);
    const imageAbs = img ? absolutizeUrl(img) : "";

    const safeName = String(name || "").trim();
    if (!safeName) continue;

    // ✅ Moneda
    const currency =
      (item.currency || item.price_currency || item.currency_code || "").toString().trim() ||
      OG_PRICE_CURRENCY_DEFAULT;

    // ✅ Precio “usable”
    const priceNumber = pickFirstValidPrice(item);
    const priceForTitle = formatMoneyForTitle(priceNumber, currency);

    // ✅ Title/desc
    let titleBase = `${safeName} | ${OG_SITE_NAME}`;
    if (OG_TITLE_INCLUDE_PRICE && priceNumber > 0 && priceForTitle) {
      titleBase = `${safeName} - $${priceForTitle} | ${OG_SITE_NAME}`;
    }

    // ✅ Description CORTA estilo ML: solo marca + condición.
    // No usamos la descripción larga del producto porque ocupa
    // 3 renglones en WhatsApp y se ve mal. El precio ya está en
    // el title.
    const brand = String(item.brand || item.brand_name || item.marca || "").trim();
    const condRaw = String(item.condition || item.condicion || "Nuevo").trim();
    const cond = /usado/i.test(condRaw) ? "Usado" : "Nuevo";
    const descParts = [];
    if (brand) descParts.push(brand);
    descParts.push(cond);
    const desc = descParts.join(" · ");

    // ✅ Versionado imagen (v=...)
    const baseImg = imageAbs || OG_IMAGE_DEFAULT;
    const v = deriveImageVersion(baseImg, id, br);
    const versionedImage = addVersionParam(baseImg, "v", v);

    return {
      ogTitle: titleBase,
      ogDescription: desc,
      ogImage: versionedImage,
      ogVersion: v,
      // guardamos raw también
      price: priceNumber > 0 ? String(priceNumber) : "",
      currency: currency,
    };
  }

  return null;
}

module.exports = {
  fetchProductOg,
  addVersionParam,
  absolutizeUrl,
  pickFirstImage,
  deriveImageVersion,
};
