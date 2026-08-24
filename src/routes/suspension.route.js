/**
 * src/routes/suspension.route.js
 *
 * Corte de acceso al backoffice (/app/) por suspension administrativa.
 *
 * Se monta ANTES del appProxy: cuando esta activo, /app/ nunca llega al
 * upstream. No toca la base ni la tienda publica (/shop/ sigue viva).
 *
 * Se prende de dos maneras, cualquiera alcanza:
 *   - variable de entorno APP_SUSPENDIDO=1  (pide redeploy o restart)
 *   - archivo bandera en APP_SUSPENDIDO_FILE (se prende y apaga en caliente)
 *
 * El texto dice lo que pasa: el servicio esta suspendido y hay que
 * comunicarse para reactivarlo. No simula una falla de infraestructura.
 */

const fs = require("fs");
const {
  APP_SUSPENDIDO,
  APP_SUSPENDIDO_FILE,
  SUSPENSION_TITULO,
  SUSPENSION_MENSAJE,
  SUSPENSION_CONTACTO_TEXTO,
  SUSPENSION_CONTACTO_HREF,
  SUSPENSION_CONTACTO_BOTON,
  SUSPENSION_RETRY_AFTER,
  OG_SITE_NAME,
} = require("../config");

function estaSuspendido() {
  if (APP_SUSPENDIDO) return true;
  if (!APP_SUSPENDIDO_FILE) return false;
  try {
    return fs.existsSync(APP_SUSPENDIDO_FILE);
  } catch {
    return false;
  }
}

function escapar(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml() {
  const marca = escapar(OG_SITE_NAME);
  const titulo = escapar(SUSPENSION_TITULO);
  const mensaje = escapar(SUSPENSION_MENSAJE);
  const contactoTexto = escapar(SUSPENSION_CONTACTO_TEXTO);
  const contactoHref = escapar(SUSPENSION_CONTACTO_HREF);
  const contactoBoton = escapar(SUSPENSION_CONTACTO_BOTON);

  const bloqueContacto = contactoHref
    ? `<a class="accion" href="${contactoHref}">${contactoBoton}</a>`
    : "";

  const bloqueDato = contactoTexto
    ? `<p class="dato">${contactoTexto}</p>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo} | ${marca}</title>
<style>
  :root {
    --navy: #121e47;
    --celeste: #1488d1;
    --texto: #1c2333;
    --tenue: #5b6478;
    --linea: #dfe3ea;
    --fondo: #eef1f5;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--fondo);
    color: var(--texto);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.55;
  }
  .tarjeta {
    width: 100%;
    max-width: 520px;
    background: #fff;
    border: 1px solid var(--linea);
    border-radius: 14px;
    padding: 40px 36px;
    box-shadow: 0 1px 2px rgba(18, 30, 71, .06), 0 12px 32px rgba(18, 30, 71, .08);
  }
  .marca {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--navy);
    margin-bottom: 28px;
  }
  .marca span.punto {
    width: 10px;
    height: 10px;
    border-radius: 10px;
    background: var(--celeste);
    flex: none;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 24px;
    line-height: 1.25;
    font-weight: 650;
    color: var(--navy);
  }
  p {
    margin: 0 0 16px;
    font-size: 15px;
    color: var(--tenue);
  }
  p.dato {
    color: var(--texto);
    font-weight: 550;
  }
  .accion {
    display: inline-block;
    margin-top: 8px;
    padding: 11px 22px;
    border-radius: 10px;
    background: var(--celeste);
    color: #fff;
    text-decoration: none;
    font-size: 15px;
    font-weight: 600;
  }
  .accion:hover { background: #1179ba; }
  .pie {
    margin: 32px 0 0;
    padding-top: 18px;
    border-top: 1px solid var(--linea);
    font-size: 12.5px;
    color: var(--tenue);
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --texto: #e6e7eb;
      --tenue: #a1a4ab;
      --linea: #262a33;
      --fondo: #14171d;
    }
    body { background: var(--fondo); }
    .tarjeta { background: #0d0f13; box-shadow: none; }
    h1, .marca { color: #e6e7eb; }
  }
</style>
</head>
<body>
  <main class="tarjeta">
    <div class="marca"><span class="punto"></span>${marca}</div>
    <h1>${titulo}</h1>
    <p>${mensaje}</p>
    ${bloqueDato}
    ${bloqueContacto}
    <div class="pie">
      <span>Los datos del sistema no se vieron afectados</span>
      <span>503</span>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Middleware. Si el corte no esta activo, sigue de largo al proxy.
 */
function suspensionGate(req, res, next) {
  if (!estaSuspendido()) return next();

  res.setHeader("X-EDGE-HIT", "app-suspendido");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Retry-After", String(SUSPENSION_RETRY_AFTER));
  res.status(503);

  // Las llamadas del SPA esperan JSON: devolverles HTML les rompe el parseo.
  const acepta = String(req.headers.accept || "");
  if (acepta.includes("application/json") && !acepta.includes("text/html")) {
    return res.json({
      ok: false,
      error: "service_suspended",
      mensaje: SUSPENSION_MENSAJE,
    });
  }

  res.type("html").send(renderHtml());
}

module.exports = { suspensionGate, estaSuspendido, renderHtml };
