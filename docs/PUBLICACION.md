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
- La demo usa la build más reciente de Protomaps y el extracto de OSM de Geofabrik más reciente para las rutas en cada despliegue; la versión fijada de cada release la publica `release.yml` (issue #8).
- Configuración del repositorio: *Settings → Pages → Source: GitHub Actions*.

**Rangos HTTP y CORS:** el último paso del workflow pide `bytes=0-15` del `.pmtiles` publicado (con reintentos, mientras el CDN propaga) y falla si la respuesta no es `206`, si falta `Content-Range: bytes 0-15/…` o si falta `Access-Control-Allow-Origin: *`.

Resultado del primer despliegue (2026-09-29, run [36603785443](https://github.com/WokerJJ/veni-mapa/actions/runs/36603785443), commit `3264aea`), en el primer intento:

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

Para producción el mapa se sirve desde Cloudflare R2 en `https://tiles.veniroldanillo.co`: responde rangos, no cobra el tráfico de salida y admite dominio propio. La publicación está **preparada y desactivada**: el job *Publicación en R2* de [`release.yml`](../.github/workflows/release.yml) corre en cada release, pero si falta alguno de los cuatro secrets avisa (`::notice::`) y termina bien.

### Qué se publica

[`scripts/r2-publish.sh`](../scripts/r2-publish.sh) toma la release que armó `make release` (verifica `SHA256SUMS`), desempaqueta `assets.tar.gz` y sube el árbol dos veces:

| Prefijo | Contenido | `Cache-Control` |
| --- | --- | --- |
| `/vX.Y.Z/` | Lo que usan los estilos de esa versión: `roldanillo.pmtiles`, `roldanillo-rutas.json`, `veni-*.json`, `fonts/`, `sprites/`, `licenses/`, `manifest.json`, `SHA256SUMS` y `assets.tar.gz`. | `public, max-age=31536000, immutable`: una versión no cambia nunca. |
| `/latest/` | Lo mismo, de la release más nueva. Se sube después de la versión (nunca apunta a una a medio subir), nunca retrocede (re-adjuntar una versión vieja solo republica su `/vX.Y.Z/`) y después se borra de `latest/` lo que esa versión ya no trae. | `public, max-age=300` |

Los estilos de una release apuntan a `<TILES_BASE_URL>/vX.Y.Z` (variable de repositorio `TILES_BASE_URL`, por defecto `https://tiles.veniroldanillo.co`), también los copiados en `/latest/`. La app lee `/latest/manifest.json` para saber qué versión hay y carga sus estilos. Tipos de contenido: `application/vnd.pmtiles`, `application/x-protobuf` (glyphs), `application/json`, `image/png`, `application/gzip` y `text/plain`.

### Activarla

1. **Bucket.** En el panel de Cloudflare: *R2 → Create bucket*, por ejemplo `veni-tiles`, sin acceso público por `r2.dev`.
2. **Dominio.** *Bucket → Settings → Custom Domains → Connect Domain*: `tiles.veniroldanillo.co` (la zona `veniroldanillo.co` tiene que estar en la misma cuenta). Cloudflare crea el DNS y el certificado.
3. **CORS.** Limitado a la app, con [`config/r2-cors.json`](../config/r2-cors.json): orígenes `https://veniroldanillo.co` y `https://www.veniroldanillo.co`, métodos `GET` y `HEAD`, cabecera `Range`, y expone `ETag`, `Content-Length` y `Content-Range` (PMTiles los lee). Se aplica una vez, con una sesión propia de Wrangler (no con el token de CI):

   ```bash
   npx wrangler r2 bucket cors set veni-tiles --file config/r2-cors.json
   npx wrangler r2 bucket cors list veni-tiles
   ```

   **Un solo origen para la app.** R2 responde `Access-Control-Allow-Origin` con el origen de cada petición, y la caché de Cloudflare en el dominio propio no separa las respuestas por `Origin`: la primera que se guarda (por un año en `/vX.Y.Z/`) vale para todos. Si la app abre en los dos orígenes, quien llegue por el otro recibe un `Access-Control-Allow-Origin` ajeno y el navegador bloquea el mapa. Por eso `www.veniroldanillo.co` tiene que redirigir a `https://veniroldanillo.co` (*Rules → Redirect Rules*, 301 conservando ruta y consulta) y el segundo origen del CORS queda solo como respaldo.

4. **Token con permisos mínimos.** *R2 → Manage R2 API Tokens → Create API token*: permiso **Object Read & Write**, aplicado **solo al bucket** `veni-tiles`, sin fecha de expiración larga (renovarlo, por ejemplo, cada año). Cloudflare muestra una vez el *Access Key ID* y el *Secret Access Key* del cliente S3.
5. **Secrets del repositorio** (*Settings → Secrets and variables → Actions → New repository secret*):

   | Secret | Valor |
   | --- | --- |
   | `R2_ACCOUNT_ID` | ID de la cuenta de Cloudflare (32 caracteres hex, en la portada de R2). |
   | `R2_ACCESS_KEY_ID` | *Access Key ID* del token. |
   | `R2_SECRET_ACCESS_KEY` | *Secret Access Key* del token. |
   | `R2_BUCKET` | Nombre del bucket (`veni-tiles`). |

6. **Primera publicación.** *Actions → Release → Run workflow* con el tag de la última release: vuelve a adjuntar los artefactos (con la misma build) y los sube a R2.

Con los cuatro secrets, cada release nueva se publica sola. Si falta alguno, el job lo nombra en una advertencia y no sube nada. Ninguna clave va en el repositorio.

### Verificación

```bash
curl -s -o /dev/null -D - -r 0-15 -H 'Origin: https://veniroldanillo.co' \
  https://tiles.veniroldanillo.co/latest/roldanillo.pmtiles
# 206, Content-Range: bytes 0-15/…, Access-Control-Allow-Origin: https://veniroldanillo.co
curl -s https://tiles.veniroldanillo.co/latest/manifest.json | jq .version
# Con la caché ya llena por el apex, www tiene que redirigir (301) y nunca pedir tiles:
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.veniroldanillo.co/
```

Desde otro origen la respuesta no trae `Access-Control-Allow-Origin` y el navegador la bloquea; la demo sigue en Pages, con CORS abierto.
