# Avisos de terceros

Componentes de terceros que usa o redistribuye este repositorio. Cada uno conserva su licencia. Los textos completos están en [`licenses/`](licenses/). Los archivos se descargan en el pipeline, fijados por commit y SHA-256 en [`config/assets.lock`](config/assets.lock); ninguno se versiona en git.

## Datos

| Componente | Uso | Licencia |
| --- | --- | --- |
| Datos de OpenStreetMap | Fuente del extracto PMTiles | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) · © colaboradores de OpenStreetMap |
| Build diaria de Protomaps | Origen del extracto (`build.protomaps.com`) | Datos ODbL (derivados de OSM) |

## Recursos redistribuidos en las releases

| Componente | Uso | Origen | Licencia |
| --- | --- | --- | --- |
| Figtree | Glyphs `Figtree Regular`, `Figtree SemiBold`, `Figtree Italic` | [erikdkennedy/figtree](https://github.com/erikdkennedy/figtree) | SIL OFL 1.1 · [texto](licenses/Figtree-OFL.txt) |
| Bricolage Grotesque | Glyphs `Bricolage Grotesque Bold` | [ateliertriay/bricolage](https://github.com/ateliertriay/bricolage) | SIL OFL 1.1 · [texto](licenses/BricolageGrotesque-OFL.txt) |
| Noto Sans | Respaldo dentro de cada fontstack (griego, cirílico, Latin extendido) | [notofonts](https://github.com/notofonts/notofonts.github.io) | SIL OFL 1.1 · [texto](licenses/NotoSans-OFL.txt) |
| Sprites de Protomaps (v4) | Íconos del mapa, claro y oscuro | [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets), derivados de [tangrams/icons](https://github.com/tangrams/icons) | MIT · [texto](licenses/protomaps-sprites-MIT.txt) |

Los glyphs PBF son una conversión de las fuentes: se distribuyen bajo la misma OFL, con sus nombres originales, y no se venden por separado.

## Herramientas (no se redistribuyen)

| Componente | Uso | Licencia |
| --- | --- | --- |
| [go-pmtiles](https://github.com/protomaps/go-pmtiles) | Extracción y metadatos del PMTiles | BSD-3-Clause |
| [font-maker](https://github.com/maplibre/font-maker) | Conversión de TTF a glyphs SDF | BSD-3-Clause |
