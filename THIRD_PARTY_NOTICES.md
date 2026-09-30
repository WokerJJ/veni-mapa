# Avisos de terceros

Componentes de terceros que usa o redistribuye este repositorio. Cada uno conserva su licencia. Los textos completos están en [`licenses/`](licenses/). Los archivos se descargan en el pipeline, fijados por commit y SHA-256 en [`config/assets.lock`](config/assets.lock); ninguno se versiona en git.

## Datos

| Componente | Uso | Licencia |
| --- | --- | --- |
| Datos de OpenStreetMap | Fuente del extracto PMTiles y del grafo de rutas | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) · © colaboradores de OpenStreetMap |
| Build diaria de Protomaps | Origen del extracto (`build.protomaps.com`) | Datos ODbL (derivados de OSM) |
| Extracto de Colombia de Geofabrik | Origen del grafo de rutas (`download.geofabrik.de`, `.osm.pbf` fechado) | Datos ODbL (copia de OSM) |

## Recursos redistribuidos en las releases

| Componente | Uso | Origen | Licencia |
| --- | --- | --- | --- |
| Figtree | Glyphs `Figtree Regular`, `Figtree SemiBold`, `Figtree Italic` | [erikdkennedy/figtree](https://github.com/erikdkennedy/figtree) | SIL OFL 1.1 · [texto](licenses/Figtree-OFL.txt) |
| Bricolage Grotesque | Glyphs `Bricolage Grotesque Bold` | [ateliertriay/bricolage](https://github.com/ateliertriay/bricolage) | SIL OFL 1.1 · [texto](licenses/BricolageGrotesque-OFL.txt) |
| Noto Sans | Respaldo dentro de cada fontstack (griego, cirílico, Latin extendido) | [notofonts/latin-greek-cyrillic](https://github.com/notofonts/latin-greek-cyrillic) (TTF de [notofonts.github.io](https://github.com/notofonts/notofonts.github.io)) | SIL OFL 1.1 · [texto](licenses/NotoSans-OFL.txt) |
| Capas de estilo de Protomaps | Base de los estilos Vení (`@protomaps/basemaps`, capas y expresiones; colores y fuentes reemplazados) | [protomaps/basemaps](https://github.com/protomaps/basemaps) | BSD-3-Clause (código) y CC0 (diseño visual) · [texto](licenses/protomaps-basemaps-BSD-3.txt), de `LICENSE.md` en el commit `42ffaaa` (el paquete npm 5.7.2 no lo incluye) |
| MapLibre GL JS 6.11.2 | Motor del mapa en la demo (`vendor/`) | [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | BSD-3-Clause · [texto](licenses/maplibre-gl-BSD-3.txt) |
| PMTiles JS 4.5.0 | Lectura del PMTiles por rangos en la demo (`vendor/`) | [protomaps/PMTiles](https://github.com/protomaps/PMTiles) | BSD-3-Clause · [texto](licenses/pmtiles-BSD-3.txt), de `LICENSE` en el commit `aec8fa1` (el paquete npm no lo incluye) |
| Dependencias empaquetadas en `vendor/` | Código de terceros dentro de MapLibre GL y PMTiles (fflate, earcut, pbf, kdbush y otros 20) | npm, según `package-lock.json` | MIT, ISC, BSD-2/3-Clause, MIT o Apache-2.0 · [avisos](licenses/vendor-deps.txt), generados con `make licenses` |
| Sprites de Protomaps (v4) | Íconos del mapa, claro y oscuro | [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets), derivados de [tangrams/icons](https://github.com/tangrams/icons) | MIT · [texto](licenses/protomaps-sprites-MIT.txt) |

Cada fontstack combina la fuente de marca con Noto Sans: según la OFL es una **versión modificada**, y se distribuye bajo la misma OFL. Ninguna de las tres fuentes declara un Reserved Font Name, por eso los fontstacks conservan el nombre de la fuente de marca. Los textos de licencia viajan con los recursos (`build/assets/licenses/`) y `build/assets/assets.json` registra qué fuentes combina cada fontstack.

## Herramientas (no se redistribuyen)

| Componente | Uso | Licencia |
| --- | --- | --- |
| [go-pmtiles](https://github.com/protomaps/go-pmtiles) | Extracción y metadatos del PMTiles | BSD-3-Clause |
| [font-maker](https://github.com/maplibre/font-maker) | Conversión de TTF a glyphs SDF | BSD-3-Clause |
| [osmium-tool](https://github.com/osmcode/osmium-tool) (y libosmium) | Recorte de la región y de las vías para el grafo de rutas | GPL-3.0 (herramienta) y BSL-1.0 (libosmium); solo corre en la imagen, sus salidas son datos ODbL |
| [@maplibre/maplibre-gl-style-spec](https://github.com/maplibre/maplibre-style-spec) | Tipos y validación de los estilos | ISC |
| [TypeScript](https://github.com/microsoft/TypeScript) | Verificación de tipos del generador | Apache-2.0 |
| [Playwright](https://github.com/microsoft/playwright) | Prueba de render de la demo en Chromium sin interfaz | Apache-2.0 |
