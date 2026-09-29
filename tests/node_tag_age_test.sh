#!/usr/bin/env bash
# Pruebas de scripts/node-tag-age.sh con una API de Docker Hub local (sin red).
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

export DOCKER_HUB_API="file://$tmp/api"
# "Ahora" fijo: las fechas de las pruebas no envejecen con el calendario.
NOW="$(date -u -d 2026-09-30T00:00:00Z +%s)"
export NOW
dockerfile="$tmp/Dockerfile"
mkdir -p "$tmp/api/node/tags"

# Dockerfile con las dos variables y fechas de push de las dos etiquetas.
setup() {
  local alpine="$1" major="$2" pinned="$3" floating="$4"
  rm -f "$tmp"/api/node/tags/*
  printf 'ARG FONT_MAKER_COMMIT=abc\nARG ALPINE_VERSION=%s\nARG NODE_MAJOR=%s\nFROM node:${NODE_MAJOR}-alpine${ALPINE_VERSION}\n' \
    "$alpine" "$major" >"$dockerfile"
  [[ -z "$pinned" ]] || printf '{"name": "%s-alpine%s", "tag_last_pushed": "%s"}' "$major" "$alpine" "$pinned" \
    >"$tmp/api/node/tags/$major-alpine$alpine"
  [[ -z "$floating" ]] || printf '{"name": "%s-alpine", "tag_last_pushed": "%s"}' "$major" "$floating" \
    >"$tmp/api/node/tags/$major-alpine"
}

expect_output() {
  local description="$1" expected="$2" out
  if out="$(scripts/node-tag-age.sh "$dockerfile" 2>&1)" && [[ "$out" == *"$expected"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$expected' y salió '$out'"
  fi
}

expect_error() {
  local description="$1" message="$2" out
  if out="$(scripts/node-tag-age.sh "$dockerfile" 2>&1)"; then
    fail "$description: debía fallar y salió '$out'"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: falló con otro mensaje: $out"
  fi
}

# --- Aviso --------------------------------------------------------------------

setup 3.24 24 2026-09-18T02:39:14.1Z 2026-09-18T02:39:03.9Z
expect_output "misma semana: al día" "node:24-alpine3.24 al día (último push 2026-09-18; node:24-alpine 2026-09-18)"

setup 3.22 24 2026-05-21T23:38:48.9Z 2026-09-18T02:39:03.9Z
expect_output "congelada desde mayo: avisa" "::warning title=Imagen de herramientas::node:24-alpine3.22 no recibe parches desde 2026-05-21 (node:24-alpine: 2026-09-18, 119 días después)"

out="$(scripts/node-tag-age.sh "$dockerfile" 2>&1)"
[[ "$out" == *"Subí ALPINE_VERSION en $dockerfile"* && "$out" == *"Actualizar la imagen de herramientas"* ]] \
  && pass "el aviso dice qué cambiar y dónde está la guía" || fail "aviso sin guía: $out"

# El límite es estricto: 30 días justos no avisan, 31 sí.
setup 3.24 24 2026-08-19T00:00:00Z 2026-09-18T00:00:00Z
expect_output "30 días: al día" "al día"
setup 3.24 24 2026-08-18T00:00:00Z 2026-09-18T00:00:00Z
expect_output "31 días: avisa" "::warning"
MAX_AGE_DAYS=40 expect_output "MAX_AGE_DAYS cambia el límite" "al día"

# Se leen las etiquetas del Dockerfile, no otras.
setup 3.23 22 2026-09-10T00:00:00Z 2026-09-18T00:00:00Z
expect_output "usa NODE_MAJOR y ALPINE_VERSION del Dockerfile" "node:22-alpine3.23 al día"

# La mayor de Node sin soporte: las dos etiquetas se congelan juntas.
setup 3.24 24 2026-05-01T00:00:00Z 2026-05-01T00:00:00Z
expect_output "flotante sin push en 152 días: avisa por la mayor" "::warning title=Imagen de herramientas::node:24-alpine no recibe push desde 2026-05-01 (152 días)"
out="$(scripts/node-tag-age.sh "$dockerfile" 2>&1)"
[[ "$out" == *"NODE_MAJOR"* && "$out" != *"no recibe parches desde"* ]] \
  && pass "el aviso de la mayor pide revisar NODE_MAJOR, no ALPINE_VERSION" || fail "aviso de la mayor: $out"
setup 3.24 24 2026-07-02T00:00:00Z 2026-07-02T00:00:00Z
expect_output "flotante con 90 días: al día" "al día"
setup 3.24 24 2026-07-01T00:00:00Z 2026-07-01T00:00:00Z
expect_output "flotante con 91 días: avisa" "node:24-alpine no recibe push desde 2026-07-01 (91 días)"
MAX_FLOATING_AGE_DAYS=200 expect_output "MAX_FLOATING_AGE_DAYS cambia el límite" "al día"

# Los avisos también quedan en el resumen de la corrida.
summary="$tmp/summary.md"
setup 3.22 24 2026-05-21T23:38:48.9Z 2026-09-18T02:39:03.9Z
: >"$summary"
GITHUB_STEP_SUMMARY="$summary" scripts/node-tag-age.sh "$dockerfile" >/dev/null 2>&1
grep -q "node:24-alpine3.22 no recibe parches desde 2026-05-21" "$summary" \
  && pass "el aviso va al resumen de la corrida" || fail "resumen: $(cat "$summary")"
setup 3.24 24 2026-09-18T00:00:00Z 2026-09-18T00:00:00Z
: >"$summary"
GITHUB_STEP_SUMMARY="$summary" scripts/node-tag-age.sh "$dockerfile" >/dev/null 2>&1
[[ ! -s "$summary" ]] && pass "al día: el resumen queda vacío" || fail "resumen sin aviso: $(cat "$summary")"

# --- Errores ------------------------------------------------------------------

# Un fallo también es un aviso: "sin aviso" no puede significar "no se comprobó".
setup 3.24 24 2026-09-18T00:00:00Z ""
: >"$summary"
out="$(GITHUB_STEP_SUMMARY="$summary" scripts/node-tag-age.sh "$dockerfile" 2>&1)"
[[ "$out" == *"::warning title=Imagen de herramientas::No se pudo comprobar"* ]] && grep -q "No se pudo comprobar" "$summary" \
  && pass "un fallo emite ::warning:: y va al resumen" || fail "fallo sin aviso: $out / $(cat "$summary")"

setup 3.24 24 2026-09-18T00:00:00Z ""
expect_error "falta la etiqueta flotante" "no se pudo leer $DOCKER_HUB_API/node/tags/24-alpine"

setup 3.24 24 "" 2026-09-18T00:00:00Z
expect_error "falta la etiqueta fijada" "node/tags/24-alpine3.24"

setup 3.24 24 2026-09-18T00:00:00Z 2026-09-18T00:00:00Z
echo '{"name": "24-alpine"}' >"$tmp/api/node/tags/24-alpine"
expect_error "sin tag_last_pushed" "no trae tag_last_pushed"

echo 'no es json' >"$tmp/api/node/tags/24-alpine"
expect_error "respuesta que no es JSON" "no es JSON válido"

echo '{"tag_last_pushed": "2026-13-45T00:00:00Z"}' >"$tmp/api/node/tags/24-alpine"
expect_error "fecha imposible" "fecha inválida"

# date -d interpreta texto relativo después de la fecha: solo se acepta ISO 8601 exacto.
for bad in "2026-09-18T00:00:00Z +400 days" "2026-09-18T00:00:00Z -1 year" "2026-09-18T00:00:00" "2026-09-18"; do
  echo "{\"tag_last_pushed\": \"$bad\"}" >"$tmp/api/node/tags/24-alpine"
  expect_error "fecha '$bad'" "no trae tag_last_pushed"
done

for bad in "3" "3.24;rm" "latest"; do
  setup "$bad" 24 2026-09-18T00:00:00Z 2026-09-18T00:00:00Z
  expect_error "ALPINE_VERSION '$bad'" "ALPINE_VERSION en $dockerfile debe ser X.Y"
done

setup 3.24 "24-slim" 2026-09-18T00:00:00Z 2026-09-18T00:00:00Z
expect_error "NODE_MAJOR no numérico" "NODE_MAJOR en $dockerfile debe ser un número"

setup 3.24 24 2026-09-18T00:00:00Z 2026-09-18T00:00:00Z
# Con cero adelante bash leería octal (08 falla, 010 vale 8): se rechaza.
for bad in abc 08 010 1000000; do
  MAX_AGE_DAYS="$bad" expect_error "MAX_AGE_DAYS '$bad'" "MAX_AGE_DAYS debe ser un entero"
  MAX_FLOATING_AGE_DAYS="$bad" expect_error "MAX_FLOATING_AGE_DAYS '$bad'" "MAX_FLOATING_AGE_DAYS debe ser un entero"
done
MAX_AGE_DAYS=0 expect_output "MAX_AGE_DAYS 0 es válido" "al día"
MAX_AGE_DAYS= expect_output "vacío usa el valor por defecto" "al día"
NOW=ayer expect_error "NOW no numérico" "NOW debe ser"

if out="$(scripts/node-tag-age.sh "$tmp/no-existe" 2>&1)"; then
  fail "Dockerfile inexistente: debía fallar"
else
  [[ "$out" == *"no existe $tmp/no-existe"* ]] && pass "Dockerfile inexistente" || fail "Dockerfile inexistente: $out"
fi

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de node-tag-age.sh pasaron"
