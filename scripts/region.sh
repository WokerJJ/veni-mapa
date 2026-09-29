#!/usr/bin/env bash
# Lee config/region.yml, lo valida y lo imprime como variables de make.
#
#   scripts/region.sh [archivo]   (por defecto config/region.yml)
#
# El Makefile incluye la salida (build/region.mk), así los valores viven en un
# solo lugar. Requiere yq v4 (mikefarah); viene en la imagen de herramientas y
# en los runners de GitHub Actions.
set -euo pipefail

file="${1:-config/region.yml}"

fail() {
  echo "region.sh: $file: $*" >&2
  exit 1
}

[[ -f "$file" ]] || fail "no existe"
command -v yq >/dev/null || fail "falta yq v4 (https://github.com/mikefarah/yq)"

get() { yq -r "$1" "$file"; }

name="$(get '.name')"
title="$(get '.title')"
maxzoom="$(get '.maxzoom')"
bbox_len="$(get '.bbox | length')"
bbox="$(get '.bbox | join(",")')"
center="$(get '.demo.center | join(",")')"
zoom="$(get '.demo.zoom')"

[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "name debe ser minúsculas, números y guiones (recibido: '$name')"
[[ -n "$title" && "$title" != "null" ]] || fail "falta title"
[[ "$maxzoom" =~ ^[0-9]+$ ]] && ((maxzoom <= 22)) || fail "maxzoom debe ser un entero entre 0 y 22 (recibido: '$maxzoom')"
[[ "$bbox_len" == "4" ]] || fail "bbox debe tener 4 números [oeste, sur, este, norte]"

# awk hace la comparación numérica con decimales que bash no soporta.
awk -F, -v bbox="$bbox" -v center="$center" -v zoom="$zoom" '
  function num(v) { return v ~ /^-?[0-9]+(\.[0-9]+)?$/ }
  BEGIN {
    split(bbox, b, ","); split(center, c, ",")
    for (i = 1; i <= 4; i++) if (!num(b[i])) { print "bbox tiene un valor no numérico: " b[i]; exit 1 }
    if (b[1] < -180 || b[1] > 180 || b[3] < -180 || b[3] > 180) { print "la longitud del bbox debe estar entre -180 y 180"; exit 1 }
    if (b[2] < -90 || b[2] > 90 || b[4] < -90 || b[4] > 90) { print "la latitud del bbox debe estar entre -90 y 90"; exit 1 }
    if (b[1] >= b[3]) { print "oeste debe ser menor que este (¿orden lon/lat invertido?)"; exit 1 }
    if (b[2] >= b[4]) { print "sur debe ser menor que norte (¿orden lon/lat invertido?)"; exit 1 }
    if (!num(c[1]) || !num(c[2])) { print "demo.center debe ser [lon, lat]"; exit 1 }
    if (c[1] < b[1] || c[1] > b[3] || c[2] < b[2] || c[2] > b[4]) { print "demo.center queda fuera del bbox"; exit 1 }
    if (!num(zoom) || zoom < 0 || zoom > 22) { print "demo.zoom debe estar entre 0 y 22"; exit 1 }
  }' >&2 || fail "valores inválidos"

cat <<EOF
# Generado por scripts/region.sh desde $file. No editar.
REGION_NAME := $name
REGION_TITLE := $title
REGION_BBOX := $bbox
REGION_MAXZOOM := $maxzoom
REGION_CENTER := $center
REGION_ZOOM := $zoom
EOF
