#!/usr/bin/env bash
# Deja en BUILD_DIR/routing el grafo de rutas de una release ya publicada, en vez
# de armarlo de nuevo: lo usa release.yml al volver a adjuntar una versión.
#
#   scripts/routing-published.sh <manifest.json> <carpeta con el grafo descargado>
#
# Geofabrik borra los archivos fechados a los pocos días: reconstruir el grafo
# daría otros datos para una versión que ya se publicó. Aquí se verifica el
# grafo descargado contra el SHA-256 del manifest y se escribe el source.json
# que habría dejado make routing (para make verify y make release).
#
# Sale con 3 si la versión se publicó sin grafo de rutas (anterior a las rutas).
set -euo pipefail

manifest="${1:?uso: routing-published.sh <manifest.json> <carpeta>}"
downloaded="${2:?uso: routing-published.sh <manifest.json> <carpeta>}"
build_dir="${BUILD_DIR:-build}"

fail() {
  echo "routing-published.sh: $*" >&2
  exit 1
}

jq -e . "$manifest" >/dev/null 2>&1 || fail "$manifest no es JSON válido"
if ! jq -e '.routing.file' "$manifest" >/dev/null; then
  echo "routing-published.sh: $manifest no tiene grafo de rutas" >&2
  exit 3
fi
file="$(jq -r '.routing.file' "$manifest")"
# El nombre sale de un archivo publicado: nada de rutas ni caracteres raros.
[[ "$file" =~ ^[a-z0-9-]+-rutas\.json$ ]] || fail "nombre de grafo inválido en el manifest: '$file'"
sha="$(jq -r --arg f "$file" '.files[] | select(.name == $f) | .sha256' "$manifest")"
[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || fail "el manifest no trae el SHA-256 de $file"
[[ -f "$downloaded/$file" ]] || fail "falta $downloaded/$file"
[[ "$(sha256sum "$downloaded/$file" | cut -d' ' -f1)" == "$sha" ]] || fail "$file no coincide con su SHA-256 del manifest"

mkdir -p "$build_dir/routing"
jq -e '.routing | (.osm_date | test("^[0-9]{8}$")) and (.source | type == "string") and (.source_md5 | test("^[0-9a-f]{32}$"))' \
  "$manifest" >/dev/null || fail "el manifest no trae la procedencia del grafo (osm_date, source, source_md5)"
jq '{region, osm_date: .routing.osm_date, source: .routing.source, source_md5: .routing.source_md5, bbox}' "$manifest" \
  >"$build_dir/routing/source.json.tmp"
cp "$downloaded/$file" "$build_dir/routing/$file.tmp"
mv "$build_dir/routing/$file.tmp" "$build_dir/routing/$file"
mv "$build_dir/routing/source.json.tmp" "$build_dir/routing/source.json"
echo "==> Rutas: $file publicado (OSM del $(jq -r .routing.osm_date "$manifest"), SHA-256 verificado)"
