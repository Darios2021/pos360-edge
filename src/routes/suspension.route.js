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
  SUSPENSION_MARCA,
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
  const marca = escapar(SUSPENSION_MARCA);
  const titulo = escapar(SUSPENSION_TITULO);
  const mensaje = escapar(SUSPENSION_MENSAJE);
  const contactoTexto = escapar(SUSPENSION_CONTACTO_TEXTO);
  const contactoHref = escapar(SUSPENSION_CONTACTO_HREF);
  const contactoBoton = escapar(SUSPENSION_CONTACTO_BOTON);

  // Todo lo opcional sale de la pantalla si no esta configurado. Sin nada
  // seteado queda un 503 pelado: titulo y codigo, sin marca y sin causa.
  const bloqueMarca = marca ? `<p class="marca">${marca}</p>` : "";
  const bloqueMensaje = mensaje ? `<p class="mensaje">${mensaje}</p>` : "";
  const bloqueDato = contactoTexto ? `<p class="dato">${contactoTexto}</p>` : "";
  const bloqueContacto = contactoHref
    ? `<a class="accion" href="${contactoHref}">${contactoBoton}</a>`
    : "";

  const tituloDoc = marca ? `${titulo} | ${marca}` : titulo;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${tituloDoc}</title>
<style>
  :root {
    --texto: #1c2333;
    --tenue: #6b7280;
    --linea: #e2e5ea;
    --fondo: #f4f5f7;
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
    text-align: center;
  }
  main { max-width: 460px; }
  .codigo {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: .12em;
    color: var(--tenue);
    margin: 0 0 14px;
  }
  h1 {
    margin: 0;
    font-size: 21px;
    font-weight: 550;
    line-height: 1.35;
  }
  .marca {
    margin: 0 0 14px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--tenue);
  }
  .mensaje, .dato { margin: 14px 0 0; font-size: 15px; color: var(--tenue); }
  .dato { color: var(--texto); font-weight: 550; }
  .accion {
    display: inline-block;
    margin-top: 20px;
    padding: 11px 22px;
    border-radius: 10px;
    background: #1488d1;
    color: #fff;
    text-decoration: none;
    font-size: 15px;
    font-weight: 600;
  }
  hr {
    width: 40px;
    margin: 26px auto 0;
    border: 0;
    border-top: 1px solid var(--linea);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --texto: #e6e7eb;
      --tenue: #9aa0aa;
      --linea: #2a2e37;
      --fondo: #16181d;
    }
  }
</style>
</head>
<body>
  <main>
    ${bloqueMarca}
    <p class="codigo">503</p>
    <h1>${titulo}</h1>
    ${bloqueMensaje}
    ${bloqueDato}
    ${bloqueContacto}
    <hr>
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
    const cuerpo = { ok: false, error: "service_unavailable" };
    if (SUSPENSION_MENSAJE) cuerpo.mensaje = SUSPENSION_MENSAJE;
    return res.json(cuerpo);
  }

  res.type("html").send(renderHtml());
}

module.exports = { suspensionGate, estaSuspendido, renderHtml };
