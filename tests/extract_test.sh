#!/usr/bin/env bash
# Pruebas de scripts/extract.sh sin red: un `pmtiles` falso en el PATH registra
# sus argumentos y simula éxito, fallo o salida vacía.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

mkdir -p "$tmp/bin"
cat >"$tmp/bin/pmtiles" <<'EOF'
#!/usr/bin/env bash
# pmtiles falso. FAKE_MODE: ok | falla | vacio
echo "$*" >>"$FAKE_LOG"
case "$1" in
  version) echo "pmtiles falso" ;;
  extract)
    if [[ " $* " == *" --dry-run "* ]]; then
      echo "dry-run de $2"
    elif [[ "${FAKE_MODE:-ok}" == falla ]]; then
      echo "corte de red simulado" >&2
      exit 1
    elif [[ "${FAKE_MODE:-ok}" == vacio ]]; then
      : >"$3"
    else
      echo "tiles de $2" >"$3"
    fi
    ;;
esac
EOF
chmod +x "$tmp/bin/pmtiles"

export PATH="$tmp/bin:$PATH"
export PROTOMAPS_BUILDS_URL="file://$PWD/tests/fixtures/builds.json"
export REGION_NAME=prueba REGION_BBOX=-76.30,4.30,-76.00,4.55 REGION_MAXZOOM=16
export BUILD_DIR="$tmp/build"
export FAKE_LOG="$tmp/pmtiles.log"

snapshot() { (cd "$BUILD_DIR" && sha256sum prueba.pmtiles build.json extract-report.txt 2>/dev/null); }

# --- Extracción correcta --------------------------------------------------------

: >"$FAKE_LOG"
if out="$(BUILD_DATE=20260926 scripts/extract.sh 2>&1)"; then
  pass "extracción correcta termina bien"
else
  fail "extracción correcta falló: $out"
fi

mapfile -t calls < <(grep '^extract' "$FAKE_LOG")
[[ "${calls[0]:-}" == *"--dry-run"* && "${calls[1]:-}" != *"--dry-run"* ]] \
  && pass "primero --dry-run y luego la extracción real" || fail "orden de llamadas: ${calls[*]}"
[[ "${calls[1]:-}" == *"https://build.protomaps.com/20260926.pmtiles"* ]] \
  && pass "usa la build pedida" || fail "fuente inesperada: ${calls[1]:-}"
[[ "${calls[1]:-}" == *"--bbox=-76.30,4.30,-76.00,4.55"* && "${calls[1]:-}" == *"--maxzoom=16"* ]] \
  && pass "pasa bbox y zoom de la región" || fail "argumentos: ${calls[1]:-}"

json="$BUILD_DIR/build.json"
if jq -e --arg sha "$(sha256sum "$BUILD_DIR/prueba.pmtiles" | cut -d' ' -f1)" \
  --argjson bytes "$(stat -c %s "$BUILD_DIR/prueba.pmtiles")" \
  '.sha256 == $sha and .bytes == $bytes and .protomaps_build == "20260926"
   and .bbox == [-76.3, 4.3, -76, 4.55] and .requested_maxzoom == 16 and .region == "prueba"' \
  "$json" >/dev/null; then
  pass "build.json coincide con el archivo generado"
else
  fail "build.json no coincide: $(cat "$json")"
fi

[[ "$(sed -n 's/^Fuente: //p' "$BUILD_DIR/extract-report.txt")" == "$(jq -r .source "$json")" ]] \
  && pass "reporte y build.json hablan de la misma fuente" || fail "reporte y build.json no coinciden"
compgen -G "$BUILD_DIR/.extract.*" >/dev/null && fail "quedó la carpeta de staging" || pass "no deja staging"

# --- Fallos: la extracción anterior queda intacta --------------------------------

before="$(snapshot)"

if FAKE_MODE=falla scripts/extract.sh >/dev/null 2>&1; then
  fail "un corte tras el --dry-run debía fallar"
else
  [[ "$(snapshot)" == "$before" ]] && pass "un corte tras el --dry-run no toca la extracción anterior" \
    || fail "un corte tras el --dry-run mezcló artefactos"
fi

if out="$(FAKE_MODE=vacio scripts/extract.sh 2>&1)"; then
  fail "una salida vacía debía fallar"
else
  [[ "$out" == *"no generó"* && "$(snapshot)" == "$before" ]] && pass "una salida vacía se rechaza sin tocar nada" \
    || fail "salida vacía: $out"
fi

if BUILD_DATE=19990101 scripts/extract.sh >/dev/null 2>&1; then
  fail "una build inexistente debía fallar"
else
  [[ "$(snapshot)" == "$before" ]] && pass "una build inexistente no toca nada" || fail "una build inexistente cambió artefactos"
fi

compgen -G "$BUILD_DIR/.extract.*" >/dev/null && fail "un fallo dejó la carpeta de staging" || pass "los fallos no dejan staging"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de extract.sh pasaron"
