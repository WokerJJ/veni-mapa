#!/usr/bin/env bash
# Pruebas de scripts/assets.sh sin red: lock y fontstacks temporales con
# recursos locales (file://).
#
# La generación completa usa las fuentes reales de build/cache/assets (las deja
# `make assets`) y font-maker (imagen de herramientas). Sin ellas esos casos se
# omiten, salvo con ASSETS_TEST_REQUIRE_FULL=1 (CI), donde omitir es fallar.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
failures=0
skipped=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }
skip() {
  if [[ "${ASSETS_TEST_REQUIRE_FULL:-}" == 1 ]]; then
    fail "$1 (ASSETS_TEST_REQUIRE_FULL=1 no permite omitir)"
  else
    echo "skip - $1"
    skipped=$((skipped + 1))
  fi
}

export ASSETS_ALLOW_FILE_URLS=1
export BUILD_DIR="$tmp/build"

# Recursos de origen: sprites falsos y, si existen, las fuentes reales del caché.
src="$tmp/src"
mkdir -p "$src"
for sprite in light light@2x dark dark@2x; do
  echo '{"icono": {}}' >"$src/$sprite.json"
  printf 'png-%s' "$sprite" >"$src/$sprite.png"
done
fonts_available=1
for font in Figtree-Regular Figtree-SemiBold NotoSans-Regular; do
  if [[ -f "build/cache/assets/fonts/$font.ttf" ]]; then
    cp "build/cache/assets/fonts/$font.ttf" "$src/$font.ttf"
  else
    fonts_available=0
  fi
done

sha() { sha256sum "$1" | cut -d' ' -f1; }

# Lock con los sprites, las fuentes disponibles y, opcionalmente, líneas extra.
write_lock() {
  local lock="$tmp/assets.lock" file
  : >"$lock"
  for file in "$src"/*.json "$src"/*.png; do
    echo "$(sha "$file")  sprites/$(basename "$file")  file://$file" >>"$lock"
  done
  for file in "$src"/*.ttf; do
    [[ -f "$file" ]] && echo "$(sha "$file")  fonts/$(basename "$file")  file://$file" >>"$lock"
  done
  (($# > 0)) && printf '%s\n' "$@" >>"$lock"
  echo "$lock"
}

# Cada llamada crea un archivo nuevo, para que un fontstacks guardado en una
# variable no cambie cuando se escribe otro.
write_stacks() {
  local file
  file="$(mktemp "$tmp/stacks.XXXXXX.yml")"
  printf '%s\n' "$@" >"$file"
  echo "$file"
}

run_assets() {
  ASSETS_LOCK="$1" FONTSTACKS="$2" scripts/assets.sh 2>&1
}

expect_error() {
  local description="$1" lock="$2" stacks="$3" message="$4" out
  if out="$(run_assets "$lock" "$stacks")"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

empty_stacks="$(write_stacks '{}')"
light="$src/light.json"

# --- Validación del lock ------------------------------------------------------

expect_error "SHA-256 mal formado" "$(write_lock "abc  fonts/x.ttf  file://$light")" "$empty_stacks" "SHA-256 inválido"
expect_error "destino con .." "$(write_lock "$(sha "$light")  sprites/../fuera.json  file://$light")" "$empty_stacks" "destino inválido"
expect_error "destino alias con ./" "$(write_lock "$(sha "$light")  sprites/./light.json  file://$light")" "$empty_stacks" "destino inválido"
expect_error "destino en subcarpeta" "$(write_lock "$(sha "$light")  sprites/v4/light.json  file://$light")" "$empty_stacks" "destino inválido"
expect_error "destino fuera de fonts/ y sprites/" "$(write_lock "$(sha "$light")  otros/x.json  file://$light")" "$empty_stacks" "destino inválido"
expect_error "destino duplicado" "$(write_lock "$(sha "$light")  sprites/light.json  file://$light")" "$empty_stacks" "destino duplicado"
expect_error "URL http sin TLS" "$(write_lock "$(sha "$light")  sprites/x.json  http://example.com/x.json")" "$empty_stacks" "línea inválida"
expect_error "columna de más" "$(write_lock "$(sha "$light")  sprites/x.json  file://$light  extra")" "$empty_stacks" "línea inválida"

lock="$(write_lock)"
if out="$(ASSETS_ALLOW_FILE_URLS='' ASSETS_LOCK="$lock" FONTSTACKS="$empty_stacks" scripts/assets.sh 2>&1)"; then
  fail "file:// sin ASSETS_ALLOW_FILE_URLS debía fallar"
else
  [[ "$out" == *"línea inválida"* ]] && pass "file:// solo se acepta en pruebas" || fail "file:// sin permiso: $out"
fi

# Hash correcto en formato pero distinto del contenido real: no se acepta.
other="0000000000000000000000000000000000000000000000000000000000000000"
expect_error "archivo alterado en origen" "$(write_lock "$other  sprites/alterado.json  file://$light")" "$empty_stacks" "no coincide"
[[ ! -e "$BUILD_DIR/cache/assets/sprites/alterado.json" ]] && pass "el archivo alterado no queda en el caché" \
  || fail "el archivo alterado quedó en el caché"

# Un archivo corrupto en el caché se vuelve a descargar.
mkdir -p "$BUILD_DIR/cache/assets/sprites"
echo "corrupto" >"$BUILD_DIR/cache/assets/sprites/light.json"
run_assets "$(write_lock)" "$empty_stacks" >/dev/null
[[ "$(sha "$BUILD_DIR/cache/assets/sprites/light.json")" == "$(sha "$light")" ]] \
  && pass "un archivo corrupto en el caché se vuelve a descargar" || fail "el caché corrupto no se reparó"

expect_error "fontstacks vacío" "$(write_lock)" "$empty_stacks" "no define fontstacks"

# --- Validación de fontstacks -------------------------------------------------

expect_error "nombre con caracteres raros" "$(write_lock)" "$(write_stacks '"Figtree ../x": [sprites/light.json]')" "nombre de fontstack inválido"
expect_error "nombre solo con espacios" "$(write_lock)" "$(write_stacks '" ": [sprites/light.json]')" "nombre de fontstack inválido"
expect_error "nombre con espacio final" "$(write_lock)" "$(write_stacks '"Figtree Regular ": [sprites/light.json]')" "nombre de fontstack inválido"
expect_error "fontstacks que solo difieren en mayúsculas" "$(write_lock)" \
  "$(write_stacks 'Figtree Regular: [sprites/light.json]' 'figtree regular: [sprites/light.json]')" "solo difieren en mayúsculas"
expect_error "fuente que no está en el lock" "$(write_lock)" "$(write_stacks 'Figtree Regular: [fonts/no-esta.ttf]')" "no está en"

# --- Generación con font-maker -------------------------------------------------

if ! command -v font-maker >/dev/null; then
  skip "generación de glyphs (falta font-maker; corré en la imagen de herramientas)"
else
  # font-maker con un archivo que no es una fuente: el error se muestra.
  expect_error "font-maker falla con un archivo que no es fuente" "$(write_lock)" \
    "$(write_stacks 'Rota Regular: [sprites/light.json]')" "font-maker falló para 'Rota Regular'"
  [[ ! -e "$BUILD_DIR/assets.tmp" ]] && pass "un fallo no deja assets.tmp" || fail "un fallo dejó assets.tmp"
fi

if ! command -v font-maker >/dev/null || ((fonts_available == 0)); then
  skip "generación completa (faltan font-maker o las fuentes en build/cache; corré make assets una vez)"
else
  lock="$(write_lock)"
  stacks="$(write_stacks \
    'Prueba Regular: [fonts/Figtree-Regular.ttf, fonts/NotoSans-Regular.ttf]' \
    'Solo Noto: [fonts/NotoSans-Regular.ttf]')"
  rm -rf "$BUILD_DIR/assets"
  if out="$(run_assets "$lock" "$stacks")"; then
    fonts="$BUILD_DIR/assets/fonts"
    ranges="$(find "$fonts/Prueba Regular" -name '*.pbf' | wc -l)"
    ((ranges == 256)) && pass "genera 256 rangos de glyphs" || fail "generó $ranges rangos"
    (($(stat -c %s "$fonts/Prueba Regular/1024-1279.pbf") > 1024)) \
      && pass "el respaldo de Noto aporta los glyphs cirílicos" || fail "el rango cirílico quedó vacío"
    ! cmp -s "$fonts/Prueba Regular/0-255.pbf" "$fonts/Solo Noto/0-255.pbf" \
      && pass "manda la primera fuente (Figtree) en el rango latino" || fail "el rango latino salió de Noto"
    [[ -f "$BUILD_DIR/assets/sprites/dark@2x.png" ]] && pass "copia los sprites" || fail "faltan sprites"
    [[ -s "$BUILD_DIR/assets/licenses/Figtree-OFL.txt" && -s "$BUILD_DIR/assets/licenses/protomaps-sprites-MIT.txt" ]] \
      && pass "las licencias viajan con los recursos" || fail "faltan licencias en build/assets"
    if jq -e --arg lock "$(sha "$lock")" \
      '.assets_lock_sha256 == $lock and (.glyphs_sha256 | test("^[0-9a-f]{64}$"))
       and .fontstacks["Prueba Regular"][1] == "fonts/NotoSans-Regular.ttf" and (.tools | has("font_maker_commit"))' \
      "$BUILD_DIR/assets/assets.json" >/dev/null; then
      pass "assets.json registra la procedencia"
    else
      fail "assets.json incompleto: $(cat "$BUILD_DIR/assets/assets.json")"
    fi
    [[ ! -e "$BUILD_DIR/assets.tmp" && ! -e "$BUILD_DIR/assets.old" ]] && pass "no deja carpetas temporales" \
      || fail "quedaron assets.tmp o assets.old"

    # Un respaldo que no cubre el cirílico se detecta.
    expect_error "respaldo que no aporta glyphs" "$lock" \
      "$(write_stacks 'Sin Respaldo: [fonts/Figtree-Regular.ttf, fonts/Figtree-SemiBold.ttf]')" "el respaldo no aportó glyphs"

    # Un segundo intento que falla no toca los recursos anteriores.
    run_assets "$lock" "$(write_stacks 'Otra Regular: [fonts/no-esta.ttf]')" >/dev/null && fail "el intento debía fallar"
    [[ -d "$fonts/Prueba Regular" && ! -e "$BUILD_DIR/assets.tmp" ]] && pass "un fallo conserva los recursos anteriores" \
      || fail "un fallo borró los recursos anteriores o dejó assets.tmp"

    # Recursos anteriores que no se pueden borrar: se reemplazan igual por renombre
    # y lo viejo queda aparte con un aviso, nunca se pierden ambos.
    mkdir -p "$fonts/Prueba Regular/bloqueada" && touch "$fonts/Prueba Regular/bloqueada/x"
    chmod 555 "$fonts/Prueba Regular/bloqueada"
    if out="$(run_assets "$lock" "$stacks")"; then
      [[ -f "$fonts/Prueba Regular/0-255.pbf" && -f "$BUILD_DIR/assets/sprites/light.json" ]] \
        && pass "reemplaza aunque lo anterior no se pueda borrar" || fail "faltan recursos tras el reemplazo"
      [[ "$out" == *"no se pudo borrar"* ]] && pass "avisa que quedó assets.old" || fail "no avisó de assets.old: $out"
      out="$(run_assets "$lock" "$stacks")" && fail "con assets.old bloqueado la siguiente corrida debía fallar"
      [[ "$out" == *"borralo a mano"* && -f "$fonts/Prueba Regular/0-255.pbf" ]] \
        && pass "un assets.old bloqueado detiene la corrida sin tocar los recursos" || fail "assets.old bloqueado: $out"
    else
      fail "el reemplazo con lo anterior bloqueado falló: $out"
    fi
    chmod -R u+w "$BUILD_DIR"
  else
    fail "la generación completa falló: $out"
  fi
fi

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron, $skipped omitida(s)"
  exit 1
fi
echo "Todas las pruebas de assets.sh pasaron ($skipped omitida(s))"
