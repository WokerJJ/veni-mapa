#!/usr/bin/env bash
# `make release`: arma DIST_DIR (dist/) con lo que se adjunta a una release.
#
#   <región>.pmtiles                 make extract
#   <región>-rutas.json              make routing (grafo de calles para rutas en el navegador)
#   veni-{claro,oscuro}-{es,en}.json make style (con la base y la versión de esta release)
#   assets.tar.gz                    fonts/, sprites/, licenses/ y assets.json de make assets
#   manifest.json                    versión, build de Protomaps, fecha de OSM de las rutas, bbox
#                                    y cada archivo con su SHA-256
#   SHA256SUMS                       sumas de todo lo anterior (formato de sha256sum -c)
#
# Lo llama el workflow de release después de make all y make verify. Antes de
# armar nada comprueba que los estilos sean de esta versión y de la misma build
# de Protomaps que el extracto: una release no mezcla piezas de corridas distintas.
#
# assets.tar.gz es reproducible (orden, fechas y dueños fijos, gzip sin nombre
# ni hora): mismos recursos, mismo SHA-256.
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME (usá make release)}" "${RELEASE_VERSION:?falta RELEASE_VERSION (por ejemplo 0.1.0)}"
build_dir="${BUILD_DIR:-build}"
out="${DIST_DIR:-dist}"
tmp="$out.tmp"

fail() {
  echo "release.sh: $*" >&2
  exit 1
}

trap 'rm -rf "$tmp"' EXIT

# Solo X.Y.Z: la versión va en nombres de carpeta de R2 (/vX.Y.Z/) y en el tag.
[[ "$RELEASE_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
  || fail "RELEASE_VERSION inválida: '$RELEASE_VERSION' (se espera X.Y.Z, sin 'v')"

require() {
  [[ -e "$1" ]] || fail "falta $1 ($2)"
}

pmtiles="$build_dir/$REGION_NAME.pmtiles"
require "$pmtiles" "corré make extract"
require "$build_dir/build.json" "corré make extract"
for dir in fonts sprites licenses; do
  require "$build_dir/assets/$dir" "corré make assets"
done
require "$build_dir/assets/assets.json" "corré make assets"
routing="$build_dir/routing/$REGION_NAME-rutas.json"
require "$routing" "corré make routing"
require "$build_dir/routing/source.json" "corré make routing"

# El extracto es el que describe build.json.
sha="$(sha256sum "$pmtiles" | cut -d' ' -f1)"
jq -e --arg sha "$sha" '.sha256 == $sha' "$build_dir/build.json" >/dev/null \
  || fail "$pmtiles no coincide con el SHA-256 de $build_dir/build.json: corré make extract de nuevo"
protomaps_build="$(jq -r '.protomaps_build' "$build_dir/build.json")"

styles=()
for variant in claro oscuro; do
  for lang in es en; do
    styles+=("veni-$variant-$lang.json")
  done
done

base=""
for name in "${styles[@]}"; do
  style="$build_dir/style/$name"
  require "$style" "corré make style"
  jq -e --arg v "$RELEASE_VERSION" '.metadata["veni:version"] == $v' "$style" >/dev/null \
    || fail "$style es de la versión '$(jq -r '.metadata["veni:version"]' "$style")', no de '$RELEASE_VERSION': corré make style STYLE_VERSION=$RELEASE_VERSION"
  jq -e --arg b "$protomaps_build" '.metadata["veni:protomaps_build"] == $b' "$style" >/dev/null \
    || fail "$style es de otra build de Protomaps que el extracto ($protomaps_build): corré make style"
  style_base="$(jq -r '.metadata["veni:base_url"]' "$style")"
  [[ -z "$base" || "$style_base" == "$base" ]] || fail "los estilos apuntan a bases distintas ('$base' y '$style_base')"
  base="$style_base"
done

rm -rf "$tmp"
mkdir -p "$tmp/assets/licenses"

cp "$pmtiles" "$routing" "$tmp/"
for name in "${styles[@]}"; do
  cp "$build_dir/style/$name" "$tmp/"
done

# Recursos y licencias: las de make assets más la de las capas de estilo de
# Protomaps, de las que derivan los estilos adjuntos.
cp -R "$build_dir/assets/fonts" "$build_dir/assets/sprites" "$build_dir/assets/assets.json" "$tmp/assets/"
cp "$build_dir"/assets/licenses/*.txt "$tmp/assets/licenses/"
require licenses/protomaps-basemaps-BSD-3.txt "licencia de las capas de estilo"
cp licenses/protomaps-basemaps-BSD-3.txt THIRD_PARTY_NOTICES.md "$tmp/assets/licenses/"
chmod -R u=rwX,go=rX "$tmp/assets"
tar --create --format=gnu --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
  -C "$tmp/assets" fonts sprites licenses assets.json | gzip -n -9 >"$tmp/assets.tar.gz"
rm -rf "$tmp/assets"

files=("$REGION_NAME.pmtiles" "$REGION_NAME-rutas.json" "${styles[@]}" assets.tar.gz)
file_list="$(for f in "${files[@]}"; do
  jq -n --arg name "$f" --argjson bytes "$(stat -c %s "$tmp/$f")" \
    --arg sha256 "$(sha256sum "$tmp/$f" | cut -d' ' -f1)" '{name: $name, bytes: $bytes, sha256: $sha256}'
done | jq -s .)"

jq -n \
  --arg version "$RELEASE_VERSION" \
  --arg base "$base" \
  --argjson files "$file_list" \
  '{
    name: "veni-mapa",
    version: $version,
    region: $build[0].region,
    protomaps_build: $build[0].protomaps_build,
    bbox: $build[0].bbox,
    maxzoom: ([$build[0].requested_maxzoom, $build[0].source_maxzoom] | min),
    style_base_url: $base,
    pmtiles: ($build[0].region + ".pmtiles"),
    routing: {file: ($build[0].region + "-rutas.json"), osm_date: $routing[0].osm_date, source: $routing[0].source, source_md5: $routing[0].source_md5},
    styles: [$files[] | select(.name | startswith("veni-")) | .name],
    data_license: "ODbL-1.0",
    attribution: "© colaboradores de OpenStreetMap",
    files: $files
  }' --slurpfile build "$build_dir/build.json" --slurpfile routing "$build_dir/routing/source.json" >"$tmp/manifest.json"

(cd "$tmp" && sha256sum -- "${files[@]}" manifest.json >SHA256SUMS)

rm -rf "$out"
mv "$tmp" "$out"
echo "==> Listo: $out (v$RELEASE_VERSION, build $protomaps_build, base $base)"
(cd "$out" && ls -l)
