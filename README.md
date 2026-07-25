# pos360-edge

Proxy y servidor de Open Graph que está **delante de todo** `sanjuantecnologia.com`.

> **Este código estuvo sin versionar hasta el 2026-07-25.** Existía únicamente
> dentro del contenedor en ejecución (`/usr/src/app`). Si ese contenedor se
> hubiera perdido, no había forma de reconstruir el servicio y se caía el
> dominio entero. Se rescató con `docker exec ... tar` desde el contenedor de
> producción.

## Qué hace

Es el único servicio con dominio propio: `pos360-frontend` y
`pos360-commerce-api` no se exponen directo. El edge:

1. **Rutea por path** (`src/routes/mounts.js`, el orden importa):
   - `/shop/` → tienda pública
   - `/app/` → backoffice POS
   - `/api/`, `/api/v1/` → API
   - `/assets/`, `/robots.txt`, `/manifest.*` → estáticos del frontend
   - `/favicon.ico`, `/apple-touch-icon.png` → servidos same-origin
2. **Inyecta Open Graph para bots** (`src/og/`). El frontend es una SPA: sin
   esto, WhatsApp, Facebook y Google no ven título ni imagen. `index.html`
   trae placeholders (`__TITLE__`, `__OG_IMAGE__`, `__FAVICON__`…) que el edge
   reemplaza al vuelo cuando detecta un bot, leyendo el producto desde la API.
3. **Redirects** de base (`/` → `/shop/`).

## Advertencias

- **`/shop/`, `/app/` y `/assets/` comparten `SHOP_UPSTREAM`.** No hay upstream
  separado para el backoffice. Para servir la tienda desde otro servicio hay
  que partir eso en `src/proxy/proxies.js` primero.
- **Los placeholders sólo se reemplazan en rutas de la tienda.** En `/app/` el
  título lo pone el router del frontend en tiempo de ejecución.
- El orden de los `app.use()` en `mounts.js` es significativo: mover un mount
  puede hacer que un path caiga en el proxy equivocado.

## Deploy

Mismo mecanismo que el resto de POS 360: rsync al VPS, build y actualización
del servicio de Swarm.

```bash
rsync -az --delete --exclude node_modules --exclude .git \
  ./ root@85.31.61.5:/root/deploy/pos360-edge/

ssh root@85.31.61.5 'cd /root/deploy/pos360-edge \
  && docker build -t img-captain-pos360-edge:<tag> . \
  && docker service update --image img-captain-pos360-edge:<tag> \
       --update-order start-first srv-captain--pos360-edge'
```

Imagen en producción al momento del rescate: `img-captain-pos360-edge:130`.

Salud del servicio: `https://sanjuantecnologia.com/health`.

## Configuración

Ver `.env.example`. En producción las variables se cargan desde el panel de
CapRover, no desde un archivo.
