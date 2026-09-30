#!/usr/bin/env bash
# Primer paso de `make routing`: las calles de la región desde OpenStreetMap.
#
# El PMTiles del mapa no sirve para rutas (geometría simplificada, sin nodos
# compartidos ni oneway), así que se parte del extracto de Colombia de Geofabrik
# (.osm.pbf, ~330 MB) y osmium recorta la región y se queda con las vías.
#
# Variables: REGION_NAME y REGION_BBOX (config/region.yml), BUILD_DIR y, opcionales:
#   ROUTING_DATE=AAAAMMDD    ese archivo fechado (por defecto, el más reciente)
#   ROUTING_PREFER_CACHE=1   CI, Pages y la actualización mensual: si el archivo en
#                            caché todavía está en la lista de Geofabrik, se usa ese
#                            en vez del más reciente (no bajar 330 MB cada día); y
#                            si Geofabrik no responde, se usa la caché con su MD5
#                            guardado y un aviso. La release no lo usa: arma con el
#                            más reciente.
# GEOFABRIK_BASE cambia el origen (acepta file:// para las pruebas sin red).
#
# Salidas en BUILD_DIR/routing:
#   <región>-vias.opl   vías con highway=*, con las coordenadas de sus nodos (OPL)
#   source.json         de dónde salió: archivo, fecha, MD5 y SHA-256 del recorte
#
# La descarga queda en BUILD_DIR/cache/osm, junto con su MD5, y se verifica cada
# vez que se usa. Como en extract.sh, las salidas se preparan en una carpeta
# temporal y se publican juntas al final.
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

cache="$build_dir/cache/osm"
mkdir -p "$cache"
prefer_cache="${ROUTING_PREFER_CACHE:-}"

# Archivo en caché (hay uno solo) y el MD5 que publicaba Geofabrik al bajarlo.
cached_file=""
for path in "$cache/$country"-[0-9][0-9][0-9][0-9][0-9][0-9].osm.pbf; do
  if [[ -f "$path" ]]; then cached_file="${path##*/}"; fi
done
cached_date=""
if [[ -n "$cached_file" ]]; then
  cached_date="20$(sed -E "s/^$country-([0-9]{6}).*/\1/" <<<"$cached_file")"
fi

# Geofabrik nombra los archivos fechados como colombia-AAMMDD.osm.pbf y los
# lista en su página: los últimos días y el 1 de enero de cada año.
if ! listing="$(fetch "$base/$country.html")"; then
  # Sin Geofabrik, la caché sirve si se prefiere y su MD5 guardado coincide.
  if [[ "$prefer_cache" == 1 && -z "$requested" && -n "$cached_file" && -f "$cache/$cached_file.md5" ]] \
    && [[ "$(md5sum "$cache/$cached_file" | cut -d' ' -f1)" == "$(cat "$cache/$cached_file.md5")" ]]; then
    echo "::warning title=Rutas::Geofabrik no respondió: se usa $cached_file de la caché" >&2
    date="$cached_date"
    file="$cached_file"
    url="$base/$file"
    md5="$(cat "$cache/$file.md5")"
  else
    fail "no se pudo leer la lista de $base/$country.html"
  fi
fi

if [[ -z "${file:-}" ]]; then
  dates="$(grep -oE "$country-[0-9]{6}\.osm\.pbf" <<<"$listing" | sed -E "s/^$country-([0-9]{6}).*/20\1/" | sort -u)" || true
  [[ -n "$dates" ]] || fail "$base/$country.html no lista archivos fechados"
  if [[ -n "$requested" ]]; then
    grep -qx "$requested" <<<"$dates" || fail "Geofabrik no tiene el archivo del $requested (el más reciente es $(tail -n1 <<<"$dates"))"
    date="$requested"
  elif [[ "$prefer_cache" == 1 && -n "$cached_date" ]] && grep -qx "$cached_date" <<<"$dates"; then
    date="$cached_date"
  else
    date="$(tail -n1 <<<"$dates")"
  fi
  file="$country-${date:2}.osm.pbf"
  url="$base/$file"
  md5="$(fetch "$url.md5" | awk -v f="$file" '$2 == f {print $1}')" || fail "no se pudo leer $url.md5"
  [[ "$md5" =~ ^[0-9a-f]{32}$ ]] || fail "$url.md5 no trae el MD5 de $file"
fi

if [[ -f "$cache/$file" ]] && [[ "$(md5sum "$cache/$file" | cut -d' ' -f1)" == "$md5" ]]; then
  echo "==> OSM: $file (en caché)"
else
  echo "==> OSM: descargando $file"
  fetch "$url" -o "$cache/$file.part" || fail "no se pudo descargar $url"
  [[ "$(md5sum "$cache/$file.part" | cut -d' ' -f1)" == "$md5" ]] || { rm -f "$cache/$file.part"; fail "$file no coincide con su MD5"; }
  mv "$cache/$file.part" "$cache/$file"
  # Solo se guarda el último: cada uno pesa cientos de MB.
  find "$cache" -maxdepth 1 -name "$country-*.osm.pbf*" ! -name "$file" -delete
fi
echo "$md5" >"$cache/$file.md5"

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
