#!/usr/bin/env bash
# Primer paso de `make routing`: las calles de la región desde OpenStreetMap.
#
# El PMTiles del mapa no sirve para rutas (geometría simplificada, sin nodos
# compartidos ni oneway), así que se parte del extracto de Colombia de Geofabrik
# (.osm.pbf, ~330 MB) y osmium recorta la región y se queda con las vías.
#
# Variables: REGION_NAME y REGION_BBOX (config/region.yml), BUILD_DIR y,
# opcional, ROUTING_DATE=AAAAMMDD (por defecto, el archivo fechado más reciente).
# GEOFABRIK_BASE cambia el origen (acepta file:// para las pruebas sin red).
#
# Salidas en BUILD_DIR/routing:
#   <región>-vias.opl   vías con highway=*, con las coordenadas de sus nodos (OPL)
#   source.json         de dónde salió: archivo, fecha, MD5 y SHA-256 del recorte
#
# La descarga queda en BUILD_DIR/cache/osm y se verifica con el MD5 que publica
# Geofabrik cada vez que se usa. Como en extract.sh, las salidas se preparan en
# una carpeta temporal y se publican juntas al final.
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME (usá make routing)}" "${REGION_BBOX:?falta REGION_BBOX}"
build_dir="${BUILD_DIR:-build}"
base="${GEOFABRIK_BASE:-https://download.geofabrik.de/south-america}"
country=colombia
requested="${ROUTING_DATE:-}"

fail() {
  echo "routing-source.sh: $*" >&2
  exit 1
}

fetch() {
  # --retry-all-errors: también reintenta cortes de conexión (SSL, error 56).
  curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "$@"
}

[[ -z "$requested" || "$requested" =~ ^20[0-9]{6}$ ]] || fail "ROUTING_DATE debe ser AAAAMMDD (recibido: '$requested')"

# Geofabrik nombra los archivos fechados como colombia-AAMMDD.osm.pbf y los
# lista en su página: los últimos días y el 1 de enero de cada año.
listing="$(fetch "$base/$country.html")" || fail "no se pudo leer la lista de $base/$country.html"
dates="$(grep -oE "$country-[0-9]{6}\.osm\.pbf" <<<"$listing" | sed -E "s/^$country-([0-9]{6}).*/20\1/" | sort -u)" || true
[[ -n "$dates" ]] || fail "$base/$country.html no lista archivos fechados"
if [[ -n "$requested" ]]; then
  grep -qx "$requested" <<<"$dates" || fail "Geofabrik no tiene el archivo del $requested (el más reciente es $(tail -n1 <<<"$dates"))"
  date="$requested"
else
  date="$(tail -n1 <<<"$dates")"
fi
file="$country-${date:2}.osm.pbf"
url="$base/$file"

cache="$build_dir/cache/osm"
mkdir -p "$cache"
md5="$(fetch "$url.md5" | awk -v f="$file" '$2 == f {print $1}')" || fail "no se pudo leer $url.md5"
[[ "$md5" =~ ^[0-9a-f]{32}$ ]] || fail "$url.md5 no trae el MD5 de $file"

if [[ -f "$cache/$file" ]] && [[ "$(md5sum "$cache/$file" | cut -d' ' -f1)" == "$md5" ]]; then
  echo "==> OSM: $file (en caché)"
else
  echo "==> OSM: descargando $file"
  fetch "$url" -o "$cache/$file.part" || fail "no se pudo descargar $url"
  [[ "$(md5sum "$cache/$file.part" | cut -d' ' -f1)" == "$md5" ]] || { rm -f "$cache/$file.part"; fail "$file no coincide con su MD5"; }
  mv "$cache/$file.part" "$cache/$file"
  # Solo se guarda el último: cada uno pesa cientos de MB.
  find "$cache" -maxdepth 1 -name "$country-*.osm.pbf" ! -name "$file" -delete
fi

mkdir -p "$build_dir/routing"
staging="$(mktemp -d "$build_dir/routing/.source.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

# complete_ways: una calle que cruza el borde de la caja queda entera, con
# todos sus nodos, y no se corta en un punto arbitrario.
echo "==> Recortando $REGION_NAME (bbox $REGION_BBOX)"
osmium extract --bbox "$REGION_BBOX" --strategy complete_ways "$cache/$file" -o "$staging/region.osm.pbf" --no-progress
osmium tags-filter "$staging/region.osm.pbf" w/highway -o "$staging/vias.osm.pbf" --no-progress
# OPL con las coordenadas dentro de cada vía: un solo archivo de texto, una
# vía por línea, fácil de leer desde Node sin otra dependencia.
osmium add-locations-to-ways "$staging/vias.osm.pbf" -o "$staging/vias.opl" -f opl --no-progress
[[ -s "$staging/vias.opl" ]] || fail "la región no tiene vías (¿bbox correcta?)"

timestamp="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$cache/$file" 2>/dev/null || true)"
jq -n \
  --arg region "$REGION_NAME" \
  --arg date "$date" \
  --arg url "$url" \
  --arg md5 "$md5" \
  --arg timestamp "$timestamp" \
  --arg bbox "$REGION_BBOX" \
  --arg sha256 "$(sha256sum "$staging/vias.opl" | cut -d' ' -f1)" \
  --arg osmium "$(osmium --version | head -n1)" \
  '{region: $region, osm_date: $date, source: $url, source_md5: $md5,
    osm_timestamp: (if $timestamp == "" then null else $timestamp end),
    bbox: ($bbox | split(",") | map(tonumber)), vias_sha256: $sha256, tools: {osmium: $osmium}}' >"$staging/source.json"

mv "$staging/source.json" "$build_dir/routing/source.json"
mv "$staging/vias.opl" "$build_dir/routing/$REGION_NAME-vias.opl"
echo "==> Listo: $build_dir/routing/$REGION_NAME-vias.opl ($(grep -c '^w' "$build_dir/routing/$REGION_NAME-vias.opl") vías, OSM del $date)"
