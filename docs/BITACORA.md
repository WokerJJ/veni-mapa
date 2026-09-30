# Bitácora

Diario de avance por bloques (máximo 3 issues por bloque).

## 2026-09-29 · Arranque

- Repositorio creado y configurado: plantillas, etiquetas, milestone **v0.1.0 · Primer mapa**, tablero y protección de `main`.
- Backlog del milestone creado como issues.
- Sigue: primer bloque (configuración de la región, extracción y recursos).

## 2026-09-29 · Bloque 1: región, extracción y recursos

**Issues cerrados:** #2 región (PR #14), #3 extracción (PR #15), #17 correcciones de la revisión de #3 (PR #18), #4 glyphs y sprites (PR #19).

**Qué quedó funcionando**

- `config/region.yml` como única fuente de la región, validado por tipo y con pruebas en busybox awk, mawk y gawk, también con locale `es_CO`.
- `docker compose run --rm tools make extract`: extracto de Roldanillo de ~1,6 MB desde la build diaria de Protomaps, reproducible con `BUILD_DATE` (mismo SHA-256) y con su procedencia en `build/build.json`.
- `make assets`: 4 fontstacks de marca (Figtree Regular/SemiBold/Italic, Bricolage Grotesque Bold) con Noto Sans combinado dentro, sprites claro y oscuro, licencias y `assets.json` de procedencia.
- CI: actionlint, bit de ejecución de los scripts, región en tres awk, pipeline completo en la imagen de herramientas con caché y verificaciones de contenido.

**Decisiones**

- Las builds de Protomaps llegan hasta z15: el `maxzoom: 16` pedido se recorta y MapLibre sobreescala. El criterio de CI (#6) compara contra el mínimo de ambos.
- Todo el pipeline corre en una imagen Docker propia (Alpine + pmtiles + font-maker compilado): el único requisito local es Docker, también en Windows sin `make`. El contenedor usa el uid del host.
- Respaldo de Noto **dentro** de cada fontstack: un hosting estático no puede combinar fuentes al vuelo. Ajustado en el criterio del issue #4.
- Recursos de terceros fijados por commit y SHA-256 en `config/assets.lock`; `title` de la región no pasa por make (evita inyección).

**Aprendizajes**

- En Windows git no registra el bit de ejecución: la CI ahora falla si un script queda en `100644`.
- Contar archivos no prueba contenido: font-maker escribe los 256 rangos aunque estén vacíos. Las pruebas se validaron con mutaciones.
- El PR #15 se fusionó antes de incorporar su revisión; las correcciones entraron por #17/#18.

**Sigue:** bloque 2 — #5 estilo claro/oscuro ES/EN, #6 validación y render en CI, #7 demo en GitHub Pages.

## 2026-09-29 · Bloque 2: estilos, demo y verificación

**Issues cerrados:** #5 estilos (PR #23), #7 demo en GitHub Pages (PR #26 y #28), #6 validación y render (PR #30). Además, #21 documentación del bloque 1 (PR #22).

**Qué quedó funcionando**

- `make style`: cuatro estilos MapLibre (claro/oscuro × ES/EN) con `@protomaps/basemaps` y la paleta Vení; contraste WCAG ≥ 4.5:1 medido sobre el estilo generado; metadatos con base, versión, build de Protomaps y caja de la región.
- Demo pública en <https://wokerjj.github.io/veni-mapa/>, desplegada desde artefacto: MapLibre y PMTiles autohospedados, interfaz y controles en ES/EN, cámara limitada a la región. Pages sirve rangos (`206`, `Content-Range`, CORS abierto).
- `make site`, `make serve` (servidor con rangos, probado contra traversal, archivos vacíos y descargas abortadas), `make verify` y render con Playwright en CI, con capturas como artefacto.
- Licencias de todo lo empaquetado en `vendor/` generadas con `make licenses`.

**Decisiones**

- TypeScript ejecutado directamente por Node 24; `tsc` solo verifica. `node_modules` del contenedor en un volumen propio (TypeScript 7 trae binario por plataforma).
- La demo crea el mapa con el centro y el zoom del estilo: sin eso quedaba vacía hasta mover la cámara (reportado al probarla). Cambio de tema con `setStyle` sin diff.
- La caja de la región viaja en `veni:bounds` y los visores la usan como `maxBounds`: el extracto guarda tiles enteros y en zooms bajos cubren medio continente.
- El render corre en el runner (Playwright no funciona en Alpine) y sirve el sitio en la misma base con la que se generaron los estilos.
- Para la app (decisión del usuario): ubicación del usuario en el dispositivo, rutas calculadas en el navegador con un grafo que generará este repositorio (#29, v0.2.0) y mapa sin botones de tema o idioma.

**Aprendizajes**

- Probar en el navegador encontró un error que ninguna revisión vio (mapa vacío al abrir). Chromium sin interfaz no lo reproduce: la prueba verifica su síntoma determinista, el arranque en `#vista=0/0/0`.
- Las mutaciones mostraron pruebas que no probaban nada (traversal normalizado por `fetch`, contar features en vez de mirar píxeles, botones sin buscar).
- `--retry` de curl no reintenta cortes SSL: hace falta `--retry-all-errors`.

**Sigue:** bloque 3 — #8 release v0.1.0, #9 publicación en R2 preparada y desactivada, #10 actualización mensual del extracto.

## 2026-09-29 · Bloque 3: releases, R2 y actualización mensual

**Issues cerrados:** #8 releases (PR #34 y release PR #35), #9 publicación en R2 (PR #36), #10 actualización mensual (PR #39). Nuevo: #37.

**Qué quedó funcionando**

- **Release [v0.1.0](https://github.com/WokerJJ/veni-mapa/releases/tag/v0.1.0)** publicada por release-please, con `roldanillo.pmtiles`, los 4 estilos, `assets.tar.gz` reproducible, `manifest.json` y `SHA256SUMS`. Se verificó descargándola: las sumas cuadran y los estilos apuntan a `https://tiles.veniroldanillo.co/v0.1.0`.
- `make release` y `release.yml`: una release nueva extrae la build de `data/build.json` y exige su SHA-256; un re-adjunto usa la del `manifest.json` publicado, o `build_date` a mano si no lo hay.
- Publicación en Cloudflare R2 preparada y desactivada: sin los 4 secrets `R2_*` avisa y termina en verde. Sube `/vX.Y.Z/` (inmutable) y `/latest/` (5 min), que nunca retrocede y se limpia. La guía de bucket, dominio, token mínimo, secrets y CORS está en `docs/PUBLICACION.md`.
- `update.yml` (día 3 de cada mes o a mano): se probó con dos corridas reales. Con la build del día terminó en "Sin cambios". Con `build_date=20260928` abrió el PR #40 con el reporte (tamaño −0,3 %, 961 tiles), que se cerró sin fusionar porque era solo una prueba.
- `scripts/tile-stats.ts` cuenta tiles por zoom. Da los mismos 961 que `addressed_tiles` del encabezado y que la librería `pmtiles`, y la CI lo comprueba con el extracto real.
- CI: `make release` con datos reales en cada PR, y un aviso si `data/build.json` ya no es reproducible. Hoy lo es: la build 20260929 da el mismo SHA-256 en la CI.

**Decisiones**

- Versionado con release-please (`simple`) y `initial-version: 0.1.0`: con `0.0.0` en el manifest, la primera versión habría sido 1.0.0.
- Los estilos de una release apuntan a `<TILES_BASE_URL>/vX.Y.Z` (variable de repositorio, por defecto `tiles.veniroldanillo.co`).
- `data/build.json` es la build aprobada. El aviso de reproducibilidad no bloquea la CI: bloquearla impediría fusionar un cambio de región antes de que exista el PR de datos que le corresponde.
- R2: CORS con los dos orígenes pedidos, pero `www` tiene que redirigir al apex. La caché del dominio no separa por `Origin`.
- Se agregaron `tar` y `gzip` de GNU a la imagen de herramientas.

**Aprendizajes**

- Los PR que abre `GITHUB_TOKEN` sí crean sus workflows de `pull_request`, pero en *action_required*. El `ci-ok` de un `workflow_dispatch` no cuenta para la protección de `main`, y hubo que aprobar a mano las ejecuciones del PR de release. Además, el paso de dispatch falla al crear la release (`fromJSON('')`). Queda en #37 (prioridad alta).
- La revisión encontró defectos en los tres PR antes de fusionar. Los más graves: v1.0.0 en lugar de 0.1.0, un `latest` que podía retroceder y un workflow mensual bloqueado por una release sin archivos. Las pruebas nuevas se validaron con mutaciones.
- Esta sesión corrió en un contenedor en la nube: sin GraphQL (el tablero no se pudo mover a *Hecho*) y sin red hacia Alpine ni Protomaps. El pipeline completo se validó en la CI.

**Sigue:** #37 (PR de release y de datos sin aprobación manual), #11 README y guía para contribuir a OSM, #27 Dependabot. El PR de release #38 (0.2.0) está abierto y espera tu decisión. Después, v0.2.0 · Rutas (#29).

## 2026-09-29 · Bloque 4: PR del bot, versiones y Dependabot

**Issues cerrados:** #37 PR del bot (PR #43), #42 versiones 0.1.x (PR #44), #27 Dependabot y alineación de la imagen (PR #45).

**Qué quedó**

- `release.yml` sin el paso de dispatch que rompía cada release; el job `release-please` vuelve a terminar en verde. release-please y la actualización mensual pueden usar una GitHub App opcional (`RELEASE_APP_CLIENT_ID` y `RELEASE_APP_PRIVATE_KEY`) para que la CI de sus PR corra sola; sin ella, *Approve and run* a mano (README).
- Antes de 1.0 cualquier commit visible sube el parche: el PR de release pasó de 0.2.0 a **0.1.1**. La 0.2.0 se fuerza con `Release-As` al cerrar el milestone de rutas.
- La imagen declara `ALPINE_VERSION` y `NODE_MAJOR` una sola vez; Dependabot no propone `alpine` ni `node` ni mayores de `@types/node`.

**Revisión del trabajo de la sesión online (bloque 3)**

- Se limpiaron los pies de "generado por" en issues, PR y comentarios; el commit `7fcc925` de `main` conserva los suyos (no se reescribe `main`).
- Tablero al día (#8, #9 y #10 en *Hecho*) y rama de prueba `chore/actualizar-extracto` borrada.
- Verificación completa en local: pipeline, 212 pruebas de Node, 8 suites de shell, `make verify` y render (8/8). La release v0.1.0 pasa `sha256sum -c`.

**Sigue:** #47 subir la imagen a una Alpine con parches de Node (alta), #46 el PR mensual de datos no dispara release, #11 README y guía de OSM, y publicar 0.1.1 (PR #38).

## 2026-09-29 · Bloque 5: imagen con parches, release de datos y documentación

**Issues cerrados:** #47 imagen sobre Alpine con parches de Node (PR #49), #46 el PR mensual de datos abre una release (PR #50), #11 README completo y guía de OpenStreetMap (PR #51). El milestone **v0.1.0 · Primer mapa** quedó sin issues abiertos.

**Qué quedó**

- La imagen de herramientas pasó a Alpine 3.24, con Node 24.21.0 y FreeType 2.14.3. Los glyphs salen idénticos (mismo `glyphs_sha256`).
- `scripts/node-tag-age.sh` corre en la actualización mensual y avisa (`::warning::`, también en el resumen de la corrida) en tres casos: la etiqueta de Node de la imagen lleva más de 30 días congelada frente a `node:<mayor>-alpine`, la mayor de Node lleva más de 90 días sin push, o no se pudo comprobar. Con la imagen anterior habría avisado: 119 días.
- El PR mensual se titula `deps(datos)`, un tipo visible, así que al fusionarlo release-please prepara una versión de parche. Una prueba lee `release-please-config.json` y exige que el tipo no esté oculto.
- README:
  - badges, capturas generadas por la prueba de render (`RENDER_CAPTURE_DIR`) y un diagrama del pipeline;
  - requisitos;
  - la sección *Usar el mapa en la app* (`VITE_MAP_STYLE_URL`). Su ejemplo vive en `docs/ejemplos/mapa-app.ts`, `make check` lo compila con resolución `bundler` y una prueba exige que el README muestre ese archivo.
- `docs/CONTRIBUIR-OSM.md`:
  - qué mapear en Roldanillo y cuándo usar `name:en`;
  - los editores iD, StreetComplete y Every Door;
  - las reglas de OSM;
  - cuánto tarda un cambio en llegar al mapa.

**Decisiones**

- Se eligió Alpine 3.24 en vez de 3.23 porque es la vigente más nueva y recibe parches por más tiempo.
- Se eligió `deps(datos)` en vez de `fix(datos)`: el extracto es un insumo externo que se actualiza, no un error, y el CHANGELOG lo muestra en *Dependencias*.
- El aviso de la imagen no frena la actualización de datos (`continue-on-error`). Un fallo al comprobar también avisa, para que "sin aviso" nunca signifique "no se comprobó".

**Aprendizajes**

- La revisión encontró que el primer ejemplo para la app no compilaba: maplibre-gl 6 no tiene export por defecto. Además, repetía el fallo del mapa vacío al abrir. Un ejemplo en la documentación también necesita prueba.
- `date -d` de GNU interpreta texto relativo después de una fecha (`… +400 days`), y bash lee `08` como octal. Los datos externos se validan con el formato exacto antes de convertirlos.
- actionlint 1.7.12 trae metadatos viejos de `create-github-app-token@v3` y marca `client-id` como inválido. Es un falso positivo: v3 lo define y marca `app-id` como obsoleto.

**Sigue:** publicar 0.1.1 fusionando el PR de release #38 (sus workflows pueden necesitar *Approve and run*). Después, v0.2.0 · Rutas (#29) o la app veni-roldanillo.

## 2026-09-30 · Bloque 6: rutas y posición (v0.2.0)

**Issues cerrados:** #29 grafo de calles y router para el navegador (PR #53), #54 posición del usuario y ruta en la demo (PR #57). Se publicaron **v0.1.1** y **v0.2.0**; la v0.2.0 trae `roldanillo-rutas.json` (OSM del 2026-09-29, ~215 KB con gzip).

**Qué quedó**

- `make routing`:
  - toma el extracto de Colombia de Geofabrik (verificado con MD5 y en caché);
  - osmium, compilado en la imagen, recorta las vías de la región;
  - `build.ts` arma el grafo `veni-rutas` v1, con perfiles a pie y en carro, sentidos únicos y las reglas de acceso.
- `scripts/routing/router.ts`:
  - A* con el tiempo como costo;
  - ajuste solo a la red principal de cada perfil (mayor componente fuertemente conexa);
  - sin APIs de Node, así que la demo lo usa tal cual (`vendor/rutas/`, generado sin compilador).
- `make verify` revisa el grafo:
  - formato, caja y procedencia;
  - tamaño con gzip;
  - al menos el 90 % de la red conectada;
  - rutas conocidas de Roldanillo (Alcaldía → Museo Rayo, un sentido único real).
- Al volver a adjuntar una release se reutiliza el grafo publicado, verificado con su SHA-256.
- La demo:
  - «¿Dónde estoy?» muestra la posición;
  - al tocar el mapa dibuja la ruta a pie o en carro, con distancia y tiempo;
  - el grafo se baja recién al pedir la primera ruta;
  - la posición no queda en la URL.

**Prueba de funcionamiento** (Chromium con la geolocalización simulada, 23 casos, 69/69 en tres repeticiones):
- Alcaldía → Museo Rayo: 260 m · 4 min a pie.
- Sentido único real: 172 m a pie; en carro rodea (570 m).
- Montaña: "sin ruta". Bogotá: "fuera de Roldanillo".
- Apagar la ubicación borra la posición.
- La ruta se conserva al cambiar de tema.

**Decisiones**

- JSON de enteros con codificación delta en vez de un binario propio o de formatos de servidor (OSRM, GraphHopper).
- `ROUTING_PREFER_CACHE=1` en CI, Pages y la actualización mensual, para no bajar 330 MB por corrida. La release arma con el OSM más reciente. Aprobar el grafo en el PR mensual queda en #55.

**Aprendizajes**

- Las revisiones encontraron fallos reales antes de publicar:
  - la posición exacta quedaba en la URL;
  - un re-adjunto podía cambiar los datos de una versión;
  - las glorietas con una sola entrada desaparecían del grafo;
  - los tiempos agotados del GPS borraban la ruta.
- Una prueba que dice "la ruta se dibuja" tiene que mirar la geometría, no solo que exista la capa.

**Sigue:** #55 (aprobar el grafo en la actualización mensual) y la etapa 2, la app veni-roldanillo.
