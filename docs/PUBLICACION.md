# Publicación

Dónde y cómo se publica el mapa. Todo destino recibe el mismo árbol, el que arma `make site` (ver README, "Dónde se publican"):

```text
<base>/
├── index.html, demo.js, demo.css, vendor/   demo
├── roldanillo.pmtiles                       extracto (ODbL)
├── fonts/, sprites/                         glyphs y sprites
├── style/veni-{claro,oscuro}-{es,en}.json   estilos, con URLs absolutas a <base>
└── licenses/, build.json, assets.json       licencias y procedencia
```

Los estilos llevan la base escrita: por eso cada destino arma su propio sitio con su `STYLE_BASE_URL`.

## Requisito: rangos HTTP

PMTiles no pide tiles sueltos: pide **rangos de bytes** de un solo archivo (`Range: bytes=…`). El servidor tiene que responder `206 Partial Content` con `Content-Range`, y permitir CORS si la app se sirve desde otro dominio.

## GitHub Pages (demo)

- URL: <https://wokerjj.github.io/veni-mapa/>
- Workflow: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml). En cada push a `main` (y a mano) construye con `make all STYLE_BASE_URL=<url de Pages>`, sube `build/site` con `actions/upload-pages-artifact` y lo publica con `actions/deploy-pages`. En los PR solo construye, para probar el workflow antes de fusionar. El PMTiles no pasa por git.
- La demo usa la build más reciente de Protomaps de cada despliegue; la versión fijada de cada release la publica `release.yml` (issue #8).
- Configuración del repositorio: *Settings → Pages → Source: GitHub Actions*.

**Rangos HTTP y CORS:** el último paso del workflow pide `bytes=0-15` del `.pmtiles` publicado (con reintentos, mientras el CDN propaga) y falla si la respuesta no es `206`, si falta `Content-Range: bytes 0-15/…` o si falta `Access-Control-Allow-Origin: *`.

Resultado del primer despliegue (2026-09-30, run [36603785443](https://github.com/WokerJJ/veni-mapa/actions/runs/36603785443), commit `3264aea`), en el primer intento:

```text
GET https://wokerjj.github.io/veni-mapa/roldanillo.pmtiles   Range: bytes=0-15
HTTP/2 206
content-range: bytes 0-15/1652451
access-control-allow-origin: *
```

Pages sirve rangos y CORS abierto: el PMTiles funciona servido directo desde Pages. La demo publicada abre dibujada, con los estilos apuntando a `https://wokerjj.github.io/veni-mapa` y la cámara limitada a la región.

Límites de Pages que importan aquí: sitio de hasta 1 GB y 100 GB de tráfico al mes (blando). El sitio pesa unos 9 MB, así que sirve para la demo, pero no es un CDN de producción: la app usa Cloudflare R2 (abajo).

## Local (`make serve`)

```bash
docker compose run --rm tools make all
docker compose run --rm --service-ports tools make serve   # http://localhost:8080
```

`scripts/serve.ts` responde rangos (`206`, `416` fuera de rango), `HEAD` y CORS abierto, igual que Pages. Verificación:

```bash
curl -s -o /dev/null -r 0-15 -w '%{http_code}\n' http://localhost:8080/roldanillo.pmtiles   # 206
```

## Cloudflare R2 (producción)

Si Pages dejara de servir rangos, o para producción (`tiles.veniroldanillo.co`, CORS limitado a `veniroldanillo.co`), la alternativa es Cloudflare R2: responde rangos, no cobra por tráfico de salida y admite dominio propio. La publicación en R2 queda preparada y desactivada en el issue #9, que completa esta sección con el bucket, los secrets y la política CORS.
