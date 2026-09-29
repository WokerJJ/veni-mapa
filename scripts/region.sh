#!/usr/bin/env bash
# Lee config/region.yml, lo valida y lo imprime como variables de make.
#
#   scripts/region.sh [archivo]   (por defecto, config/region.yml del repo)
#
# El Makefile incluye la salida (build/region.mk), así los valores viven en un
# solo lugar. Contrato: si el script termina bien, cada línea es una asignación
# simple de make sin caracteres que make o el shell interpreten ($ # \ ni
# saltos de línea). `title` no se emite: make no lo necesita y es texto libre.
#
# Requiere yq v4 (mikefarah); viene en la imagen de herramientas y en los
# runners de GitHub Actions. AWK permite elegir el intérprete (mawk, gawk).
set -euo pipefail

file="${1:-$(dirname "$0")/../config/region.yml}"
awk_bin="${AWK:-awk}"

fail() {
  echo "region.sh: $file: $*" >&2
  exit 1
}

[[ -f "$file" ]] || fail "no existe"
command -v yq >/dev/null || fail "falta yq v4 (https://github.com/mikefarah/yq)"
yq_version="$(yq --version 2>&1)"
[[ "$yq_version" == *mikefarah* && "$yq_version" == *"version v4"* ]] \
  || fail "se necesita yq v4 de mikefarah (encontrado: $yq_version)"

# Consulta yq y convierte cualquier error suyo en un mensaje uniforme.
query() {
  yq -r "$1" "$file" 2>/dev/null || fail "no se pudo leer ${2:-$1} (¿YAML inválido?)"
}

# Tipo YAML de una clave: !!str, !!int, !!float, !!seq, !!map o !!null.
tag_of() { query "$1 | tag" "$1"; }

require_tag() {
  local path="$1" message="$2" tag
  shift 2
  tag="$(tag_of "$path")"
  for expected in "$@"; do
    [[ "$tag" == "$expected" ]] && return 0
  done
  fail "$message"
}

# Secuencia de exactamente N números (enteros o decimales).
require_numbers() {
  local path="$1" count="$2" message="$3"
  require_tag "$path" "$message" '!!seq'
  [[ "$(query "$path | length" "$path")" == "$count" ]] || fail "$message"
  [[ "$(query "[$path[] | select(tag == \"!!int\" or tag == \"!!float\")] | length" "$path")" == "$count" ]] \
    || fail "$message"
}

require_tag '.name' "name es obligatorio y debe ser texto" '!!str'
require_tag '.title' "title es obligatorio y debe ser texto" '!!str'
require_tag '.maxzoom' "maxzoom debe ser un entero entre 0 y 22" '!!int'
require_numbers '.bbox' 4 "bbox debe tener 4 números [oeste, sur, este, norte]"
require_tag '.demo' "demo.center debe ser [lon, lat] y demo.zoom un número (falta demo)" '!!map'
require_numbers '.demo.center' 2 "demo.center debe ser [lon, lat]"
require_tag '.demo.zoom' "demo.zoom debe estar entre 0 y 22" '!!int' '!!float'

name="$(query '.name')"
title="$(query '.title')"
maxzoom="$(query '.maxzoom')"
bbox="$(query '.bbox | join(",")')"
center="$(query '.demo.center | join(",")')"
zoom="$(query '.demo.zoom')"

[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "name debe ser minúsculas, números y guiones (recibido: '$name')"
[[ -n "$title" && "$title" != *[[:cntrl:]]* ]] || fail "title no puede estar vacío ni tener saltos de línea"
# Solo regex: evita la aritmética de bash, que lee 010 como octal y desborda.
[[ "$maxzoom" =~ ^([0-9]|1[0-9]|2[0-2])$ ]] || fail "maxzoom debe ser un entero entre 0 y 22 (recibido: '$maxzoom')"

# awk compara decimales, cosa que bash no hace. LC_ALL=C porque mawk convierte
# con strtod según el locale: con es_CO.UTF-8 leería -76.30 como -76.
awk_error="$(LC_ALL=C "$awk_bin" -v bbox="$bbox" -v center="$center" -v zoom="$zoom" '
  function num(v) { return v ~ /^-?[0-9]+(\.[0-9]+)?$/ }
  BEGIN {
    if (split(bbox, b, ",") != 4) { print "bbox debe tener 4 números [oeste, sur, este, norte]"; exit 1 }
    if (split(center, c, ",") != 2) { print "demo.center debe ser [lon, lat]"; exit 1 }
    for (i = 1; i <= 4; i++) if (!num(b[i])) { print "bbox tiene un valor no numérico: " b[i]; exit 1 }
    if (b[1] < -180 || b[1] > 180 || b[3] < -180 || b[3] > 180) { print "la longitud del bbox debe estar entre -180 y 180"; exit 1 }
    if (b[2] < -90 || b[2] > 90 || b[4] < -90 || b[4] > 90) { print "la latitud del bbox debe estar entre -90 y 90"; exit 1 }
    if (b[1] >= b[3]) { print "oeste debe ser menor que este (¿orden lon/lat invertido?)"; exit 1 }
    if (b[2] >= b[4]) { print "sur debe ser menor que norte (¿orden lon/lat invertido?)"; exit 1 }
    if (!num(c[1]) || !num(c[2])) { print "demo.center debe ser [lon, lat]"; exit 1 }
    if (c[1] < b[1] || c[1] > b[3] || c[2] < b[2] || c[2] > b[4]) { print "demo.center queda fuera del bbox"; exit 1 }
    if (!num(zoom) || zoom < 0 || zoom > 22) { print "demo.zoom debe estar entre 0 y 22"; exit 1 }
  }')" || fail "$awk_error"

output="$(cat <<EOF
# Generado por scripts/region.sh desde config/region.yml. No editar.
REGION_NAME := $name
REGION_BBOX := $bbox
REGION_MAXZOOM := $maxzoom
REGION_CENTER := $center
REGION_ZOOM := $zoom
EOF
)"

# Defensa final del contrato: nada que make o el shell interpreten.
values="$(grep -v '^#' <<<"$output")"
[[ "$values" != *[\$\#\\]* ]] || fail "la salida tendría caracteres especiales para make"

echo "$output"
