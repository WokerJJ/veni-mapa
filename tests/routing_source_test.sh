#!/usr/bin/env bash
# Pruebas de scripts/routing-source.sh sin red: un Geofabrik falso (file://) con
# su página de descargas, dos archivos fechados de Colombia y sus MD5. Los
# .osm.pbf los arma osmium desde un OPL chico.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

geofabrik="$tmp/geofabrik"
mkdir -p "$geofabrik"
export GEOFABRIK_BASE="file://$geofabrik" BUILD_DIR="$tmp/build" REGION_NAME=prueba REGION_BBOX=-76.2,4.4,-76.1,4.5

# Dentro de la caja: una calle (w1), un edificio (w2) y una calle que sale de la
# caja (w3, n5 afuera). Fuera: una calle lejana (w4).
cat >"$tmp/colombia.opl" <<'EOF'
n1 v1 x-76.15 y4.41
n2 v1 x-76.149 y4.41
n3 v1 x-76.15 y4.42
n4 v1 x-76.149 y4.42
n5 v1 x-76.05 y4.41
n6 v1 x-75.5 y5.0
n7 v1 x-75.49 y5.0
w1 v1 Thighway=residential,name=Calle%20%7 Nn1,n2
w2 v1 Tbuilding=yes Nn3,n4,n1
w3 v1 Thighway=track Nn2,n5
w4 v1 Thighway=primary Nn6,n7
EOF

# publish AAMMDD...: arma colombia-AAMMDD.osm.pbf con su .md5 y la página que los lista.
publish() {
  local listing="<html>"
  for d in "$@"; do
    osmium cat "$tmp/colombia.opl" -o "$geofabrik/colombia-$d.osm.pbf" --overwrite \
      --output-header="osmosis_replication_timestamp=20${d:0:2}-${d:2:2}-${d:4:2}T20:00:00Z"
    (cd "$geofabrik" && md5sum "colombia-$d.osm.pbf" >"colombia-$d.osm.pbf.md5")
    listing+="<a href=\"colombia-$d.osm.pbf\">colombia-$d.osm.pbf</a>"
  done
  echo "$listing</html>" >"$geofabrik/colombia.html"
}

run() { scripts/routing-source.sh 2>&1; }

expect_error() {
  local description="$1" message="$2" out
  if out="$(run)"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

opl="$BUILD_DIR/routing/prueba-vias.opl"
source_json="$BUILD_DIR/routing/source.json"

# --- Recorte ------------------------------------------------------------------

publish 260101 260927 260928
if out="$(run)"; then
  pass "recorta la región"
  [[ "$out" == *"descargando colombia-260928.osm.pbf"* ]] && pass "usa el archivo fechado más reciente" || fail "archivo: $out"
  ways="$(grep -o '^w[0-9]*' "$opl" | tr '\n' ' ')"
  [[ "$ways" == "w1 w3 " ]] && pass "solo vías de la caja, sin edificios; la que sale de la caja queda entera" || fail "vías: $ways"
  grep -q '^w3 .*n5x-76.05y4.41' "$opl" && pass "cada nodo de la vía trae sus coordenadas" || fail "w3 sin coordenadas: $(grep '^w3' "$opl")"
  grep -q 'name=Calle%20%7' "$opl" && pass "conserva las etiquetas" || fail "etiquetas: $(grep '^w1' "$opl")"
  jq -e --arg sha "$(sha256sum "$opl" | cut -d' ' -f1)" '
    .region == "prueba" and .osm_date == "20260928" and (.source | endswith("/colombia-260928.osm.pbf"))
    and (.source_md5 | test("^[0-9a-f]{32}$")) and .osm_timestamp == "2026-09-28T20:00:00Z"
    and .bbox == [-76.2, 4.4, -76.1, 4.5] and .vias_sha256 == $sha and (.tools.osmium | startswith("osmium version"))' \
    "$source_json" >/dev/null && pass "source.json con fecha, origen, MD5, marca de tiempo y SHA-256" || fail "source.json: $(cat "$source_json")"
else
  fail "el recorte falló: $out"
fi

# --- Caché ---------------------------------------------------------------------

out="$(run)"
[[ "$out" == *"colombia-260928.osm.pbf (en caché)"* ]] && pass "la segunda vez usa la caché" || fail "sin caché: $out"

ROUTING_DATE=20260927 run >/dev/null
[[ -f "$BUILD_DIR/cache/osm/colombia-260927.osm.pbf" && ! -e "$BUILD_DIR/cache/osm/colombia-260928.osm.pbf" ]] \
  && pass "ROUTING_DATE elige otra fecha y la caché guarda solo un archivo" || fail "caché: $(ls "$BUILD_DIR/cache/osm")"
jq -e '.osm_date == "20260927"' "$source_json" >/dev/null && pass "source.json de la fecha pedida" || fail "fecha: $(cat "$source_json")"

# Un archivo en caché que ya no coincide con el MD5 se vuelve a bajar.
printf 'roto' >"$BUILD_DIR/cache/osm/colombia-260927.osm.pbf"
out="$(ROUTING_DATE=20260927 run)"
[[ "$out" == *"descargando colombia-260927.osm.pbf"* ]] && pass "una caché corrupta se descarga de nuevo" || fail "caché corrupta: $out"

[[ "$(cat "$BUILD_DIR/cache/osm/colombia-260927.osm.pbf.md5")" == "$(cut -d' ' -f1 "$geofabrik/colombia-260927.osm.pbf.md5")" ]] \
  && pass "la caché guarda el MD5 junto al archivo" || fail "sin MD5 en caché: $(ls "$BUILD_DIR/cache/osm")"

# --- ROUTING_PREFER_CACHE (CI, Pages, actualización mensual) --------------------

# En caché está el del 27, que Geofabrik todavía lista: se usa ese y no se baja el 28.
out="$(ROUTING_PREFER_CACHE=1 run)"
[[ "$out" == *"colombia-260927.osm.pbf (en caché)"* ]] && jq -e '.osm_date == "20260927"' "$source_json" >/dev/null \
  && pass "con caché todavía listada, no descarga el más reciente" || fail "prefer cache: $out"

# Sin preferir la caché, el más reciente.
out="$(run)"
[[ "$out" == *"descargando colombia-260928.osm.pbf"* ]] && pass "sin preferir la caché, baja el más reciente" || fail "sin prefer: $out"

# Geofabrik ya no lista el de la caché: se baja el más reciente aunque se prefiera la caché.
ROUTING_DATE=20260927 run >/dev/null
publish 260101 260928
out="$(ROUTING_PREFER_CACHE=1 run)"
[[ "$out" == *"descargando colombia-260928.osm.pbf"* ]] && pass "caché que ya no está en la lista: baja el más reciente" || fail "caché vieja: $out"

# Geofabrik no responde: con la caché preferida, se usa con un aviso; sin ella, falla.
mv "$geofabrik/colombia.html" "$tmp/colombia.html"
out="$(ROUTING_PREFER_CACHE=1 run)"
[[ "$out" == *"::warning title=Rutas::Geofabrik no respondió: se usa colombia-260928.osm.pbf de la caché"* && "$out" == *"(en caché)"* ]] \
  && jq -e '.osm_date == "20260928"' "$source_json" >/dev/null \
  && pass "sin Geofabrik, usa la caché con un aviso" || fail "sin Geofabrik con caché: $out"
printf 'roto' >"$BUILD_DIR/cache/osm/colombia-260928.osm.pbf"
ROUTING_PREFER_CACHE=1 expect_error "sin Geofabrik y con la caché corrupta, falla" "no se pudo leer la lista"
ROUTING_PREFER_CACHE=1 ROUTING_DATE=20260928 expect_error "sin Geofabrik y con ROUTING_DATE, falla" "no se pudo leer la lista"
mv "$tmp/colombia.html" "$geofabrik/colombia.html"
run >/dev/null

# --- Errores: las salidas anteriores quedan intactas ---------------------------

before="$(sha256sum "$opl" "$source_json")"

ROUTING_DATE=20250101 expect_error "fecha que Geofabrik no tiene" "no tiene el archivo del 20250101 (el más reciente es 20260928)"
for bad in 260928 2026-09-28 "20260928;rm"; do
  ROUTING_DATE="$bad" expect_error "ROUTING_DATE '$bad'" "ROUTING_DATE debe ser AAAAMMDD"
done

cached_sha="$(sha256sum "$BUILD_DIR/cache/osm/colombia-260928.osm.pbf" | cut -d' ' -f1)"
echo '0123456789abcdef0123456789abcdef  colombia-260928.osm.pbf' >"$geofabrik/colombia-260928.osm.pbf.md5"
expect_error "descarga que no coincide con el MD5" "colombia-260928.osm.pbf no coincide con su MD5"
[[ ! -e "$BUILD_DIR/cache/osm/colombia-260928.osm.pbf.part" && "$(sha256sum "$BUILD_DIR/cache/osm/colombia-260928.osm.pbf" | cut -d' ' -f1)" == "$cached_sha" ]] \
  && pass "una descarga mala no queda en la caché ni pisa la anterior" || fail "quedó en caché: $(ls "$BUILD_DIR/cache/osm")"

echo 'sin md5' >"$geofabrik/colombia-260928.osm.pbf.md5"
expect_error "MD5 ilegible" "no trae el MD5"

echo '<html>nada</html>' >"$geofabrik/colombia.html"
expect_error "página sin archivos fechados" "no lista archivos fechados"

rm "$geofabrik/colombia.html"
expect_error "sin página de descargas" "no se pudo leer la lista"

# Una región sin vías.
publish 260928
REGION_BBOX=-70.1,4.1,-70.0,4.2 expect_error "región sin vías" "la región no tiene vías"

[[ "$(sha256sum "$opl" "$source_json")" == "$before" ]] && pass "los errores no tocan las salidas anteriores" || fail "un error cambió las salidas"
[[ -z "$(find "$BUILD_DIR/routing" -name '.source.*')" ]] && pass "no deja temporales" || fail "quedaron temporales"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de routing-source.sh pasaron"
