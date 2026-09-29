# Vení · Mapa de Roldanillo

Pipeline reproducible que recorta Roldanillo (Valle del Cauca, Colombia) de OpenStreetMap, lo empaqueta como [PMTiles](https://docs.protomaps.com/pmtiles/) y genera un estilo [MapLibre](https://maplibre.org/) con la marca **Vení**. Cada versión se publica como release para que la app [veni-roldanillo](https://github.com/WokerJJ/veni-roldanillo) la consuma sin depender de la API de Google Maps.

> 🚧 En construcción: milestone **v0.1.0 · Primer mapa**. El avance está en [docs/BITACORA.md](docs/BITACORA.md).

## Uso

El único requisito es Docker. Todas las herramientas (make, pmtiles, font-maker, yq, jq y Node 24) vienen en la imagen de [`docker/tools`](docker/tools/Dockerfile), la misma que usa la CI:

```bash
docker compose run --rm tools make help      # lista los objetivos
docker compose run --rm tools make extract   # build/roldanillo.pmtiles
```

| Objetivo | Qué hace |
| --- | --- |
| `extract` | Resuelve la build diaria más reciente de Protomaps, corre `pmtiles extract --dry-run` (reporte en `build/extract-report.txt`) y extrae la región a `build/<región>.pmtiles`. Deja la procedencia (build, bbox, tamaño, SHA-256) en `build/build.json`. |
| `assets` | Descarga las fuentes y los sprites de [`config/assets.lock`](config/assets.lock) (fijados por commit y verificados por SHA-256) y genera en `build/assets` los glyphs de [`config/fontstacks.yml`](config/fontstacks.yml) con [font-maker](https://github.com/maplibre/font-maker). |
| `style` | Genera `build/style/veni-{claro,oscuro}-{es,en}.json` con la marca Vení. `STYLE_BASE_URL` fija dónde se publican PMTiles, glyphs y sprites (por defecto `http://localhost:8080`). |
| `check` | Verificación de tipos (TypeScript), pruebas de Node (estilos, `build.ts`, servidor) y que `licenses/vendor-deps.txt` esté al día. |
| `verify` | Valida los estilos con el validador oficial de MapLibre y el extracto: tiles vectoriales, caja dentro de la región, zoom máximo = mín(pedido, build), capas esperadas y tamaño (`PMTILES_MAX_MB`, 50 por defecto). |
| `licenses` | Regenera `licenses/vendor-deps.txt` con los avisos de lo que MapLibre GL y PMTiles empaquetan (`make check` falla si quedó desactualizado). |
| `site` | Arma `build/site`, el árbol que se publica: demo, PMTiles, recursos, estilos y licencias. |
| `serve` | Sirve `build/site` en <http://localhost:8080> con rangos HTTP. Necesita el puerto: `docker compose run --rm --service-ports tools make serve`. |
| `release` | Arma `dist/` con lo que se adjunta a una release (ver [Releases](#releases)). Exige `RELEASE_VERSION=X.Y.Z` y estilos generados con `STYLE_VERSION` igual. |
| `all` | `extract`, `assets`, `style` y `site`. |

Para reproducir una versión exacta, fijá la build (funciona igual en bash y en PowerShell):

```bash
docker compose run --rm tools make extract BUILD_DATE=20260928
```

La misma build produce siempre el mismo archivo (mismo SHA-256 en `build/build.json`).

En Linux, el contenedor corre con tu usuario para que `build/` no quede de root: exportá `HOST_UID=$(id -u)` y `HOST_GID=$(id -g)` si tu uid no es 1000.

Si tu `build/` lo creó una versión anterior de la imagen (que corría como root) y ves `Permission denied`, borralo una vez con `docker compose run --rm --user 0:0 tools rm -rf build`.

La extracción no descarga el planeta: `pmtiles` pide por rangos HTTP solo los tiles de la región (unos 1,6 MB hoy).

## Demo

<https://wokerjj.github.io/veni-mapa/> · la publica [`pages.yml`](.github/workflows/pages.yml) en cada cambio en `main`.

MapLibre GL y PMTiles autohospedados (sin CDN), botones para tema claro u oscuro y etiquetas en español o inglés, con la interfaz traducida. Lo que elegís queda en la URL (`?tema=oscuro&idioma=en`) y la vista en el fragmento (`#vista=zoom/lat/lon`); sin tema elegido, la demo sigue la preferencia del sistema, también si cambia. Los controles de MapLibre también se traducen.

La cámara no sale de la región: el extracto guarda tiles enteros y en zooms bajos un tile cubre medio continente (en el zoom 0, el planeta), así que el estilo publica la caja de `config/region.yml` en `metadata["veni:bounds"]` y la demo la usa como `maxBounds`. La app hace lo mismo. Detalles de publicación y rangos HTTP en [docs/PUBLICACION.md](docs/PUBLICACION.md).

## Estilos

Cuatro estilos MapLibre generados con [`@protomaps/basemaps`](https://github.com/protomaps/basemaps) y la paleta de la marca ([`scripts/style/flavors.ts`](scripts/style/flavors.ts)):

| | Claro | Oscuro |
| --- | --- | --- |
| Tierra | lila `#F3ECF6` | ciruela profunda `#1C0F26` |
| Vías principales | tinte de mango | mango mezclado con ciruela |
| Autopistas | tinte de arrebol | arrebol mezclado con ciruela |
| Etiquetas | ciruela `#2A1638` | lila |
| Lugares (municipio, barrios, departamentos, países) | Bricolage Grotesque Bold | Bricolage Grotesque Bold |

- Los tintes se calculan desde los tokens de la marca (`mix()`), así un cambio de marca se propaga.
- Etiquetas en español (`name:es`) o inglés (`name:en`), con el nombre local como respaldo.
- Toda capa con texto llega a 4.5:1 de contraste contra su halo, medido sobre el estilo generado; arrebol nunca es color de texto sobre fondo claro. Lo verifican las pruebas (`make check`).

### Dónde se publican

El estilo escribe URLs absolutas a partir de `STYLE_BASE_URL` y espera este árbol bajo esa base:

```text
<STYLE_BASE_URL>/
├── <región>.pmtiles          build/roldanillo.pmtiles
├── fonts/<fontstack>/…pbf    build/assets/fonts/
└── sprites/{light,dark}…     build/assets/sprites/
```

```bash
docker compose run --rm tools make style STYLE_BASE_URL=https://tiles.veniroldanillo.co/v0.1.0 STYLE_VERSION=0.1.0
```

`STYLE_BASE_URL` debe ser `http(s)`, sin usuario, contraseña, query ni fragmento (por defecto `http://localhost:8080`); `STYLE_VERSION` queda en los metadatos (por defecto `dev`), junto con la base y la build de Protomaps del extracto.

### Node dentro del contenedor

El generador es TypeScript que Node 24 ejecuta directamente, sin paso de compilación; `tsc` solo verifica tipos. `make` instala las dependencias con `npm ci`, que respeta el `package-lock.json` exacto. Dentro del contenedor, `node_modules` vive en un volumen de Docker propio: TypeScript 7 trae un binario nativo por plataforma y las dependencias de Linux no pueden compartirse con las que instales en tu sistema para el editor. En Linux, creá la carpeta antes de la primera corrida (`mkdir -p node_modules`) para que el punto de montaje no quede de root.

## Tipografías y sprites

El estilo usa las tipografías de la marca Vení, servidas desde el mismo lugar que el mapa (sin CDNs de terceros):

| Fontstack | Uso | Respaldo incluido |
| --- | --- | --- |
| `Figtree Regular` | Etiquetas generales | Noto Sans Regular |
| `Figtree SemiBold` | Números de vías en sus escudos | Noto Sans SemiBold |
| `Figtree Italic` | Agua | Noto Sans Italic |
| `Bricolage Grotesque Bold` | Lugares: municipio, barrios y veredas, departamentos y países | Noto Sans Bold |

Un hosting estático no puede combinar fuentes al vuelo, así que font-maker mete el respaldo de Noto Sans dentro de cada fontstack: lo que Figtree o Bricolage no cubren (griego, cirílico, Latin extendido) sale de Noto. Los sprites son los de [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) (v4, claro y oscuro). Licencias en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Actualizar recursos de terceros

Las fuentes y los sprites están fijados en [`config/assets.lock`](config/assets.lock) por commit y SHA-256. Para subir de versión uno de ellos:

1. Cambiá el commit en su URL (de `raw.githubusercontent.com/<repo>/<commit>/…`).
2. Calculá el hash del archivo nuevo y reemplazalo en la misma línea:
   ```bash
   curl -fsSL <url> | sha256sum
   ```
3. Si cambia la licencia, actualizá su texto en [`licenses/`](licenses/) y [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
4. Corré `docker compose run --rm tools make assets` y las pruebas.

font-maker se fija en `FONT_MAKER_COMMIT` del [Dockerfile](docker/tools/Dockerfile). Dependabot no vigila ninguno de los dos: se revisan a mano. `build/assets/assets.json` registra con qué lock, fontstacks, commit de font-maker y versión de FreeType se generó cada juego de glyphs.

## Releases

[release-please](https://github.com/googleapis/release-please) lee los commits convencionales de `main` y mantiene abierto un PR `chore(release): publicar X.Y.Z` con la versión y el [CHANGELOG.md](CHANGELOG.md). Al fusionarlo se crean el tag `vX.Y.Z` y la release, y [`release.yml`](.github/workflows/release.yml) construye el mapa de esa versión y le adjunta:

| Archivo | Contenido |
| --- | --- |
| `roldanillo.pmtiles` | El extracto (ODbL, © colaboradores de OpenStreetMap). |
| `veni-{claro,oscuro}-{es,en}.json` | Los cuatro estilos, con URLs a `<TILES_BASE_URL>/vX.Y.Z` (por defecto `https://tiles.veniroldanillo.co`, ver [docs/PUBLICACION.md](docs/PUBLICACION.md)). |
| `assets.tar.gz` | `fonts/`, `sprites/`, `licenses/` y `assets.json`; reproducible (mismos recursos, mismo SHA-256). |
| `manifest.json` | Versión, build de Protomaps, bbox, zoom máximo, base de los estilos, atribución y cada archivo con tamaño y SHA-256. |
| `SHA256SUMS` | Sumas de todo lo anterior: `sha256sum -c SHA256SUMS`. |

Si existen los secrets de R2, la release también se publica en `https://tiles.veniroldanillo.co/vX.Y.Z/` y `/latest/`; hoy está preparado y desactivado (ver [docs/PUBLICACION.md](docs/PUBLICACION.md#cloudflare-r2-producción)).

Para la app, `manifest.json` es la entrada: dice qué build de OpenStreetMap trae la versión y cómo verificar cada archivo.

### Numeración de versiones

Antes de 1.0:

- Cualquier commit que aparece en el CHANGELOG (`feat`, `fix`, `perf`, `docs`, `ci`, `deps`) sube el **parche**: 0.1.0 → 0.1.1.
- Un cambio incompatible (`feat!` o el pie `BREAKING CHANGE:`) sube la **menor**.
- Los tipos ocultos (`chore`, `refactor`, `test`, `build`) no abren una release por sí solos.

La versión menor corresponde a un milestone (0.2.0 = rutas, #29) y se fuerza **al cerrarlo**, no al empezarlo: `Release-As` fija la versión de todas las releases siguientes hasta que se publique, así que ponerla antes dejaría el milestone sin versiones 0.1.x intermedias. Para forzarla:

1. En el último PR del milestone (o en uno corto `chore(release): versión 0.2.0`), escribir como **última línea del cuerpo del PR**, después del checklist y separada por una línea en blanco:

   ```text
   Release-As: 0.2.0
   ```

   Con squash merge el cuerpo del PR es el del commit, y release-please solo lee la línea si está en el bloque final del cuerpo; en cualquier otro lugar la ignora sin avisar.
2. Al fusionarlo, el PR de release pasa a proponer 0.2.0; revisarlo antes de fusionarlo.

Si la línea se olvidó o quedó mal ubicada, se edita el cuerpo del PR ya fusionado y se agrega al final un bloque que release-please sí lee:

```text
BEGIN_COMMIT_OVERRIDE
<título del commit, igual que en main>

Release-As: 0.2.0
END_COMMIT_OVERRIDE
```

Requisito del repositorio: *Settings → Actions → General → Workflow permissions →* **Allow GitHub Actions to create and approve pull requests**. Sin eso release-please falla al abrir el PR de release.

### PR del bot y la CI

Los PR que abre `GITHUB_TOKEN` (el de release y el de la actualización mensual) no corren la CI solos: sus workflows quedan en *action_required*. Sin el check `ci-ok`, la protección de `main` no deja fusionarlos. Hay dos formas de resolverlo:

- **Sin configurar nada:** en el PR, *Checks* (o *Actions*, en el run pendiente) → **Approve and run**. Después de aprobarlos corren como cualquier PR y `ci-ok` aparece.
- **Con una GitHub App (recomendado):** release-please y la actualización mensual abren el PR con la identidad de la App y la CI corre sola.
  1. Crear una GitHub App en la cuenta (*Settings → Developer settings → GitHub Apps*), sin webhook, con permisos de repositorio **Contents: read and write**, **Pull requests: read and write** e **Issues: read and write**, e instalarla solo en este repositorio.
  2. Generar una clave privada de la App.
  3. En el repositorio: variable `RELEASE_APP_CLIENT_ID` con el *Client ID* de la App (página de la App, *General*) y secret `RELEASE_APP_PRIVATE_KEY` con la clave privada (*Settings → Secrets and variables → Actions*).
  4. Comprobar: *Actions → Actualizar extracto → Run workflow* con una `build_date` distinta de la de `data/build.json`; la CI del PR que se abra tiene que arrancar sin *Approve and run*. Si era solo de prueba, cerrar ese PR.

  Con la App, el PR de release, el tag, la release y el commit de datos quedan a nombre de la App (`<nombre>[bot]`). Mientras la variable no exista, los workflows usan `GITHUB_TOKEN` y siguen funcionando; solo falta aprobar la CI a mano. Si existe la variable pero falta el secret, el workflow falla con un error visible en vez de caer en `GITHUB_TOKEN`.

Si la subida de artefactos falla, *Actions → Release → Run workflow* con el tag los vuelve a construir y adjuntar. Si la release ya tiene `manifest.json`, se reconstruye con la misma build de Protomaps y falla si el extracto no da el mismo SHA-256: una versión publicada no cambia de datos.

## Actualización mensual

[`update.yml`](.github/workflows/update.yml) regenera el extracto el día 3 de cada mes, o a mano con *Actions → Actualizar extracto → Run workflow* (entrada opcional `build_date`, AAAAMMDD). Lo verifica con `make verify`, lo compara con la última release y, si cambió, abre o actualiza el PR `chore(datos): actualizar extracto de OSM a AAAA-MM-DD` en la rama `chore/actualizar-extracto`. El PR solo cambia [`data/build.json`](data/build.json) (build de Protomaps, tamaño, SHA-256 y tiles por zoom) y trae en el cuerpo el reporte: build, tamaño, tiles totales y por zoom, antes y después.

`data/build.json` es la build aprobada: al publicar una release, `release.yml` extrae esa misma build y falla si el PMTiles no da ese SHA-256. Así una release trae exactamente los datos revisados en el PR. Los tiles por zoom los cuenta [`scripts/tile-stats.ts`](scripts/tile-stats.ts) leyendo los directorios del PMTiles (go-pmtiles no los reporta).

El PR lo abre la GitHub App si está configurada; si no, `GITHUB_TOKEN`, y sus workflows esperan *Approve and run* (ver [PR del bot y la CI](#pr-del-bot-y-la-ci)). La rama `chore/actualizar-extracto` es del workflow: cada corrida la rehace desde `main` y pisa lo que se haya empujado a mano.

El PR es `chore(datos)`, así que por sí solo no crea una release: la build aprobada se usa en la siguiente `feat` o `fix`. Las builds diarias de Protomaps no se guardan para siempre, y la CI de cada PR avisa (*data/build.json sigue siendo reproducible*) si la build de `data/build.json` ya no se puede extraer o ya no da su SHA-256, por ejemplo porque el PR cambia la región o go-pmtiles. Si una release llega a fallar por eso, *Actions → Release → Run workflow* con el tag y `build_date` la construye con otra build.

## Región

La región se define en un solo archivo, [`config/region.yml`](config/region.yml): la caja delimitadora (oeste, sur, este, norte, en WGS84) que cubre el casco urbano de Roldanillo y sus veredas, el zoom máximo y la vista inicial de la demo. `scripts/region.sh` valida el archivo y lo expone como variables de `make`, así ningún otro archivo repite esos valores.

Las builds diarias de Protomaps llegan hasta z15: el extracto se recorta a ese zoom y MapLibre sobreescala (overzoom) los tiles para mostrar z16 o más.

## Pruebas

| Qué | Cómo | Dónde corre |
| --- | --- | --- |
| Scripts del pipeline (región, extracción, recursos, sitio, verificación, release, publicación en R2) | `docker compose run --rm tools bash tests/<x>_test.sh` | Imagen de herramientas, sin red |
| Generador de estilos, `build.ts`, servidor, conteo de tiles, reporte de actualización y licencias | `docker compose run --rm tools make check` | Imagen de herramientas |
| Estilos y extracto reales | `docker compose run --rm tools make verify` | Imagen de herramientas |
| Render de la demo en Chromium sin interfaz: se dibuja al abrir en los 4 estilos, sin errores, arranca en la región, cambia de tema sin mover la cámara, no sale de la región, móvil sin scroll y botones de 44 px | `npm ci`, `npx playwright install --only-shell chromium` y `npm run test:render` (después de `make all`) | Host: Playwright no corre en Alpine |

El render sirve `build/site` en la base con la que se generaron los estilos (por defecto `http://localhost:8080`; si ya corre `make serve`, lo reutiliza). Para usar otro puerto, generá el sitio con esa base: `docker compose run --rm tools make style site STYLE_BASE_URL=http://localhost:8095` y después `npm run test:render`.

La CI corre todo lo anterior en cada PR; las suites no pueden quedar omitidas, una prueba de render que solo pasa al reintentar cuenta como fallo, y el render sube sus capturas como artefacto. Pages corre `make verify` antes de publicar.

## Documentación

- [docs/BITACORA.md](docs/BITACORA.md): diario de avance.
- [docs/PUBLICACION.md](docs/PUBLICACION.md): dónde se publica el mapa (Pages, R2), requisitos de rangos HTTP y cómo activar R2.
- [CONTRIBUTING.md](CONTRIBUTING.md): flujo de trabajo, ramas y commits.

## Licencia y atribución

- Código: todos los derechos reservados, ver [LICENSE](LICENSE).
- Datos del mapa: © colaboradores de OpenStreetMap, bajo [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Componentes de terceros: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
