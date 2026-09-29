#!/usr/bin/env bash
# Pruebas de scripts/region.sh.
#
# Los casos inválidos se generan con yq a partir de tests/fixtures/region-valida.yml:
# cada caso es una sola modificación, así se ve qué regla prueba.
# AWK=mawk|gawk elige el intérprete de awk que usa el script.
set -uo pipefail
cd "$(dirname "$0")/.."

valid=tests/fixtures/region-valida.yml
expected=tests/fixtures/region-valida.mk
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0
skipped=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }
skip() { echo "skip - $1"; skipped=$((skipped + 1)); }

expect_ok() {
  local file="$1" out
  if out="$(scripts/region.sh "$file" 2>&1)"; then pass "$file es válido"; else fail "$file debía ser válido: $out"; fi
}

# Aplica una expresión de yq al fixture válido y espera un error concreto.
expect_invalid() {
  local description="$1" expression="$2" message="$3" file out
  file="$tmp/$(echo "$description" | tr -c 'a-z0-9' '-').yml"
  yq "$expression" "$valid" >"$file"
  if out="$(scripts/region.sh "$file" 2>&1)"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" != "region.sh: $file: "* ]]; then
    fail "$description: el error no tiene el prefijo uniforme: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

# Escribe un YAML literal (para casos que yq no produce, como texto crudo).
expect_invalid_raw() {
  local description="$1" content="$2" message="$3" file="$tmp/raw.yml" out
  printf '%s\n' "$content" >"$file"
  if out="$(scripts/region.sh "$file" 2>&1)"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

echo "# awk: ${AWK:-awk} · locale: ${LC_ALL:-${LANG:-sin definir}}"

# --- Casos válidos y contrato de salida ---------------------------------------

expect_ok config/region.yml
expect_ok "$valid"

if diff -u "$expected" <(scripts/region.sh "$valid" 2>&1); then
  pass "la salida coincide exactamente con $expected"
else
  fail "la salida no coincide con $expected"
fi

# Contrato real: make incluye la salida y lee exactamente los mismos valores.
if command -v make >/dev/null; then
  scripts/region.sh "$valid" >"$tmp/region.mk"
  cat >"$tmp/Makefile" <<'EOF'
include region.mk
print:
	@echo "[$(REGION_NAME)|$(REGION_BBOX)|$(REGION_MAXZOOM)|$(REGION_CENTER)|$(REGION_ZOOM)]"
EOF
  got="$(make -s -C "$tmp" print)"
  want="[prueba|-76.30,4.30,-76.00,4.55|16|-76.15,4.41|13]"
  [[ "$got" == "$want" ]] && pass "make lee los valores exactos" || fail "make leyó '$got' en vez de '$want'"
else
  skip "contrato con make (make no está instalado)"
fi

# Con un locale de coma decimal, mawk leía -76.30 como -76 (BUG-001).
for locale in es_CO.UTF-8 de_DE.UTF-8; do
  if locale -a 2>/dev/null | grep -qi "^${locale%.UTF-8}.utf-\?8$"; then
    if out="$(LC_ALL=$locale scripts/region.sh config/region.yml 2>&1)"; then
      pass "config/region.yml es válido con LC_ALL=$locale"
    else
      fail "config/region.yml falla con LC_ALL=$locale: $out"
    fi
    LC_ALL=$locale expect_invalid "norte 90.5 no se trunca a 90 con $locale" '.bbox[3] = 90.5' "latitud del bbox"
  else
    skip "locale $locale no instalado"
  fi
done

# --- name y title ---------------------------------------------------------------

expect_invalid "sin name" 'del(.name)' "name es obligatorio"
expect_invalid "name null" '.name = null' "name es obligatorio"
expect_invalid "name numérico" '.name = 10' "name es obligatorio"
expect_invalid "name con espacios y mayúsculas" '.name = "Mi Región"' "name debe ser minúsculas"
expect_invalid "sin title" 'del(.title)' "title es obligatorio"
expect_invalid "title lista" '.title = ["a", "b"]' "title es obligatorio"
expect_invalid "title multilínea" '.title = "linea1\nlinea2"' "title no puede estar vacío ni tener saltos de línea"
expect_invalid "title vacío" '.title = ""' "title no puede estar vacío"

# title con sintaxis de make ya no llega a la salida (BUG-002): debe ser válido
# y la salida no puede contener nada del título.
file="$tmp/title-make.yml"
yq '.title = "Pwn $(shell touch /tmp/PWNED) # \\"' "$valid" >"$file"
if out="$(scripts/region.sh "$file" 2>&1)" && [[ "$out" != *PWNED* && "$out" != *'$('* ]]; then
  pass "title con sintaxis de make no llega a la salida"
else
  fail "title con sintaxis de make: $out"
fi

# --- maxzoom --------------------------------------------------------------------

expect_invalid "maxzoom 30" '.maxzoom = 30' "maxzoom debe ser un entero entre 0 y 22"
expect_invalid "maxzoom decimal" '.maxzoom = 15.5' "maxzoom debe ser un entero"
expect_invalid "maxzoom texto" '.maxzoom = "16"' "maxzoom debe ser un entero"
expect_invalid_raw "maxzoom octal 010" "$(sed 's/^maxzoom: .*/maxzoom: 010/' "$valid")" "maxzoom debe ser un entero entre 0 y 22"
expect_invalid_raw "maxzoom enorme" "$(sed 's/^maxzoom: .*/maxzoom: 18446744073709551621/' "$valid")" "maxzoom debe ser un entero entre 0 y 22"

# --- bbox -------------------------------------------------------------------------

expect_invalid "bbox incompleto" '.bbox = [-76.30, 4.30, -76.00]' "bbox debe tener 4 números"
expect_invalid "bbox con 5 valores" '.bbox += [1]' "bbox debe tener 4 números"
expect_invalid "bbox con un elemento con coma" '.bbox[3] = "4.55,9"' "bbox debe tener 4 números"
expect_invalid "bbox con texto" '.bbox[0] = "oeste"' "bbox debe tener 4 números"
expect_invalid "bbox escalar" '.bbox = -76.30' "bbox debe tener 4 números"
expect_invalid "sin bbox" 'del(.bbox)' "bbox debe tener 4 números"
expect_invalid "longitud fuera de rango" '.bbox[0] = -190' "longitud del bbox"
expect_invalid "latitud fuera de rango" '.bbox[3] = 95' "latitud del bbox"
expect_invalid "oeste mayor que este" '.bbox = [-76.00, 4.30, -76.30, 4.55]' "oeste debe ser menor que este"
expect_invalid "sur mayor que norte" '.bbox = [-76.30, 4.55, -76.00, 4.30]' "sur debe ser menor que norte"
expect_invalid "bbox en notación científica" '.bbox[0] = -7.63e1' "bbox tiene un valor no numérico"

# --- demo -------------------------------------------------------------------------

expect_invalid "sin demo" 'del(.demo)' "falta demo"
expect_invalid "center con 3 valores" '.demo.center = [-76.15, 4.41, 99]' "demo.center debe ser [lon, lat]"
expect_invalid "center con texto" '.demo.center[0] = "x"' "demo.center debe ser [lon, lat]"
expect_invalid "center fuera del bbox" '.demo.center = [-75.00, 4.41]' "demo.center queda fuera del bbox"
expect_invalid "zoom de la demo fuera de rango" '.demo.zoom = 23' "demo.zoom debe estar entre 0 y 22"
expect_invalid "zoom de la demo texto" '.demo.zoom = "13"' "demo.zoom debe estar entre 0 y 22"

# --- archivo ------------------------------------------------------------------------

out="$(scripts/region.sh tests/fixtures/no-existe.yml 2>&1)" && fail "archivo inexistente debía fallar" \
  || { [[ "$out" == *"no existe"* ]] && pass "archivo inexistente" || fail "archivo inexistente: $out"; }
expect_invalid_raw "YAML inválido" "name: [sin cerrar" "¿YAML inválido?"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron, $skipped omitida(s)"
  exit 1
fi
echo "Todas las pruebas de region.sh pasaron ($skipped omitida(s))"
