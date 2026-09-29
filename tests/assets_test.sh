#!/usr/bin/env bash
# Pruebas de scripts/assets.sh sin red: lock y fontstacks temporales con
# recursos locales (file://). Requiere font-maker (imagen de herramientas).
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0
skipped=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }
skip() { echo "skip - $1"; skipped=$((skipped + 1)); }

export ASSETS_ALLOW_FILE_URLS=1
export BUILD_DIR="$tmp/build"

# Recursos de origen: una fuente real del caché si existe, y sprites falsos.
src="$tmp/src"
mkdir -p "$src"
for sprite in light light@2x dark dark@2x; do
  echo '{}' >"$src/$sprite.json"
  printf 'png-%s' "$sprite" >"$src/$sprite.png"
done

sha() { sha256sum "$1" | cut -d' ' -f1; }

# Escribe un lock con los sprites y, opcionalmente, líneas extra.
write_lock() {
  local lock="$tmp/assets.lock"
  : >"$lock"
  for file in "$src"/*; do
    echo "$(sha "$file")  sprites/$(basename "$file")  file://$file" >>"$lock"
  done
  printf '%s\n' "$@" >>"$lock"
  echo "$lock"
}

run_assets() {
  ASSETS_LOCK="$1" FONTSTACKS="$2" scripts/assets.sh 2>&1
}

expect_error() {
  local description="$1" lock="$2" stacks="$3" message="$4" out
  rm -rf "$BUILD_DIR"
  if out="$(run_assets "$lock" "$stacks")"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

empty_stacks="$tmp/sin-fuentes.yml"
echo '{}' >"$empty_stacks"

# --- Validación del lock ------------------------------------------------------

expect_error "SHA-256 mal formado" "$(write_lock "abc  fonts/x.ttf  file://$src/light.json")" "$empty_stacks" "SHA-256 inválido"
expect_error "destino con .." "$(write_lock "$(sha "$src/light.json")  ../fuera.json  file://$src/light.json")" "$empty_stacks" "destino inválido"
expect_error "URL http sin TLS" "$(write_lock "$(sha "$src/light.json")  x.json  http://example.com/x.json")" "$empty_stacks" "línea inválida"
expect_error "columna de más" "$(write_lock "$(sha "$src/light.json")  x.json  file://$src/light.json  extra")" "$empty_stacks" "línea inválida"

# Hash correcto en formato pero distinto del contenido real: no se acepta.
other="0000000000000000000000000000000000000000000000000000000000000000"
expect_error "archivo alterado en origen" "$(write_lock "$other  sprites/alterado.json  file://$src/light.json")" "$empty_stacks" "no coincide"
[[ ! -e "$BUILD_DIR/cache/assets/sprites/alterado.json" ]] && pass "el archivo alterado no queda en el caché" \
  || fail "el archivo alterado quedó en el caché"

expect_error "fontstacks vacío" "$(write_lock)" "$empty_stacks" "no define fontstacks"

# --- Validación de fontstacks -------------------------------------------------

stacks="$tmp/stacks.yml"
echo '"Figtree ../x": [sprites/light.json]' >"$stacks"
expect_error "nombre de fontstack con caracteres raros" "$(write_lock)" "$stacks" "nombre de fontstack inválido"

echo 'Figtree Regular: [fonts/no-esta.ttf]' >"$stacks"
expect_error "fuente que no está en el lock" "$(write_lock)" "$stacks" "no está en"

# --- Generación completa con una fuente real ----------------------------------

font="$(find build/cache/assets/fonts -name 'Figtree-Regular.ttf' 2>/dev/null | head -n1)"
if ! command -v font-maker >/dev/null; then
  skip "generación de glyphs (falta font-maker; corré en la imagen de herramientas)"
elif [[ -z "$font" ]]; then
  skip "generación de glyphs (sin Figtree-Regular.ttf en build/cache; corré make assets una vez)"
else
  cp "$font" "$src/Figtree-Regular.ttf"
  lock="$(write_lock "$(sha "$src/Figtree-Regular.ttf")  fonts/Figtree-Regular.ttf  file://$src/Figtree-Regular.ttf")"
  echo 'Prueba Regular: [fonts/Figtree-Regular.ttf]' >"$stacks"
  rm -rf "$BUILD_DIR"
  if out="$(run_assets "$lock" "$stacks")"; then
    ranges="$(find "$BUILD_DIR/assets/fonts/Prueba Regular" -name '*.pbf' | wc -l)"
    ((ranges == 256)) && pass "genera 256 rangos de glyphs" || fail "generó $ranges rangos"
    [[ -f "$BUILD_DIR/assets/sprites/dark@2x.png" ]] && pass "copia los sprites" || fail "faltan sprites"
    [[ ! -e "$BUILD_DIR/assets.tmp" ]] && pass "no deja la carpeta temporal" || fail "quedó assets.tmp"

    # Un segundo intento que falla no toca los recursos anteriores.
    echo 'Otra Regular: [fonts/no-esta.ttf]' >"$stacks"
    run_assets "$lock" "$stacks" >/dev/null && fail "el segundo intento debía fallar"
    [[ -d "$BUILD_DIR/assets/fonts/Prueba Regular" ]] && pass "un fallo conserva los recursos anteriores" \
      || fail "un fallo borró los recursos anteriores"
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
