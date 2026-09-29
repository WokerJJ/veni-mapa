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

## 2026-09-30 · Bloque 2: estilos, demo y verificación

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
