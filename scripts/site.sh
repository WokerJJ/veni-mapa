#!/usr/bin/env bash
# `make site`: arma BUILD_DIR/site, el árbol que se publica (Pages, R2, make serve).
#
#   index.html, demo.js, demo.css      demo/
#   vendor/                            MapLibre GL y PMTiles, autohospedados
#   <región>.pmtiles, build.json       make extract
#   fonts/, sprites/, licenses/, assets.json   make assets
#   style/                             make style (con la STYLE_BASE_URL de esta publicación)
#
# Es el árbol que exige STYLE_BASE_URL (ver README, "Dónde se publican"). Se
# prepara en una carpeta temporal y reemplaza a la anterior con dos renombres.
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME (usá make site)}" "${STYLE_BASE_URL:?falta STYLE_BASE_URL}"
build_dir="${BUILD_DIR:-build}"
out="$build_dir/site"
tmp="$out.tmp"
old="$out.old"

fail() {
  echo "site.sh: $*" >&2
  exit 1
}

cleanup() {
  rm -rf "$tmp"
  if [[ -d "$old" && ! -e "$out" ]]; then
    mv "$old" "$out"
  fi
}
trap cleanup EXIT

require() {
  [[ -e "$1" ]] || fail "falta $1 ($2)"
}

pmtiles="$build_dir/$REGION_NAME.pmtiles"
require "$pmtiles" "corré make extract"
require "$build_dir/build.json" "corré make extract"
require "$build_dir/assets/fonts" "corré make assets"
require "$build_dir/assets/sprites" "corré make assets"
require "$build_dir/assets/licenses" "corré make assets"
require "$build_dir/assets/assets.json" "corré make assets"
for variant in claro oscuro; do
  for lang in es en; do
    require "$build_dir/style/veni-$variant-$lang.json" "corré make style"
  done
done
require node_modules/maplibre-gl/dist/maplibre-gl.mjs "faltan las dependencias de Node: npm ci"
require node_modules/pmtiles/dist/pmtiles.js "faltan las dependencias de Node: npm ci"

# Los estilos tienen que apuntar a la base de esta publicación: si no, el sitio
# pediría tiles y glyphs a otra URL (por ejemplo, localhost). La base se
# normaliza con la misma función que usó make style (host en minúsculas, sin
# barras finales ni puerto por defecto).
base="$(node -e 'import("./scripts/style/style.ts").then((m) => console.log(m.normalizeBaseUrl(process.argv[1]))).catch((e) => { console.error(e.message); process.exit(1); })' "$STYLE_BASE_URL")"   || fail "STYLE_BASE_URL inválida"
for style in "$build_dir"/style/veni-*.json; do
  styled_base="$(jq -r '.metadata["veni:base_url"]' "$style")"
  [[ "$styled_base" == "$base" ]] \
    || fail "$style apunta a '$styled_base', no a '$base': corré make style con la misma STYLE_BASE_URL"
done

rm -rf "$tmp"
mkdir -p "$tmp/vendor" "$tmp/licenses"

cp demo/index.html demo/demo.js demo/demo.css "$tmp/"
cp node_modules/maplibre-gl/dist/maplibre-gl.mjs \
  node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs \
  node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs \
  node_modules/maplibre-gl/dist/maplibre-gl.css \
  node_modules/pmtiles/dist/pmtiles.js \
  "$tmp/vendor/"

cp "$pmtiles" "$build_dir/build.json" "$tmp/"
cp -R "$build_dir/assets/fonts" "$build_dir/assets/sprites" "$tmp/"
cp "$build_dir/assets/assets.json" "$tmp/"
cp -R "$build_dir/style" "$tmp/style"
# Licencias de los recursos (make assets) y, directo del repositorio, las de
# vendor/: así un build/assets viejo no deja el sitio sin ellas.
cp "$build_dir"/assets/licenses/*.txt "$tmp/licenses/"
for license in maplibre-gl-BSD-3.txt pmtiles-BSD-3.txt vendor-deps.txt; do
  require "licenses/$license" "licencia de vendor/"
  cp "licenses/$license" "$tmp/licenses/"
done

chmod -R a+rX "$tmp"

rm -rf "$old" 2>/dev/null || fail "quedó $old de una corrida anterior y no se puede borrar; borralo a mano"
if [[ -d "$out" ]]; then mv "$out" "$old"; fi
mv "$tmp" "$out"
rm -rf "$old" 2>/dev/null || echo "site.sh: aviso: no se pudo borrar $old; borralo a mano" >&2

echo "==> Listo: $out ($(du -sh "$out" | cut -f1), base $base)"
