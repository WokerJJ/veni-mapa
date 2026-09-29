#!/usr/bin/env bash
# Extrae la región de la build diaria de Protomaps a un PMTiles local.
#
# Lo llama `make extract`, que exporta REGION_NAME, REGION_BBOX, REGION_MAXZOOM
# (desde config/region.yml), BUILD_DIR y, opcionalmente, BUILD_DATE.
#
# Salidas en BUILD_DIR:
#   <REGION_NAME>.pmtiles   el extracto
#   extract-report.txt      reporte del --dry-run (tamaño y peticiones)
#   build.json              de dónde salió el extracto, para releases y PR
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME}" "${REGION_BBOX:?falta REGION_BBOX}" "${REGION_MAXZOOM:?falta REGION_MAXZOOM}"
build_dir="${BUILD_DIR:-build}"

date="$(scripts/protomaps-build.sh "${BUILD_DATE:-}")"
source_url="${PROTOMAPS_BUILD_BASE:-https://build.protomaps.com}/${date}.pmtiles"
out="$build_dir/$REGION_NAME.pmtiles"
tmp="$out.tmp"
report="$build_dir/extract-report.txt"

mkdir -p "$build_dir"
trap 'rm -f "$tmp"' EXIT

args=("$source_url" "$tmp" "--bbox=$REGION_BBOX" "--maxzoom=$REGION_MAXZOOM")

echo "==> Build de Protomaps: $date"
echo "==> Región: $REGION_NAME · bbox $REGION_BBOX · zoom máximo pedido $REGION_MAXZOOM"

# Primero el --dry-run: cuánto va a pesar y cuántas peticiones hará, sin escribir.
{
  echo "Fuente: $source_url"
  echo "Región: $REGION_NAME"
  echo "Bbox: $REGION_BBOX"
  echo "Zoom máximo pedido: $REGION_MAXZOOM"
  echo
  pmtiles extract "${args[@]}" --dry-run 2>&1
} | tee "$report"

# El reporte ya quedó en el --dry-run; aquí se omite la barra de progreso.
pmtiles extract "${args[@]}" --quiet
mv "$tmp" "$out"

bytes="$(stat -c %s "$out")"
jq -n \
  --arg region "$REGION_NAME" \
  --arg build_date "$date" \
  --arg source "$source_url" \
  --arg bbox "$REGION_BBOX" \
  --argjson maxzoom "$REGION_MAXZOOM" \
  --argjson bytes "$bytes" \
  --arg sha256 "$(sha256sum "$out" | cut -d' ' -f1)" \
  --arg pmtiles "$(pmtiles version 2>&1 | head -n1)" \
  '{region: $region, protomaps_build: $build_date, source: $source,
    bbox: ($bbox | split(",") | map(tonumber)), requested_maxzoom: $maxzoom,
    bytes: $bytes, sha256: $sha256, tool: $pmtiles}' >"$build_dir/build.json"

echo "==> Listo: $out ($bytes bytes)"
