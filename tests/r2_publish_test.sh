#!/usr/bin/env bash
# Pruebas de scripts/r2-publish.sh sin red: un `aws` falso anota cada subida y
# el árbol que recibió; la release sale de scripts/release.sh con datos mínimos.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

mkdir -p "$tmp/bin"
cat >"$tmp/bin/aws" <<'EOF'
#!/usr/bin/env bash
# Anota destino, patrón, tipo, caché, endpoint y credenciales visibles.
src="$3" dest="$4" include="" type="" cache="" endpoint=""
shift 4
while (($#)); do
  case "$1" in
    --include) include="$2"; shift ;;
    --content-type) type="$2"; shift ;;
    --cache-control) cache="$2"; shift ;;
    --endpoint-url) endpoint="$2"; shift ;;
  esac
  shift
done
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$dest" "$include" "$type" "$cache" "$endpoint" "$AWS_ACCESS_KEY_ID:$AWS_DEFAULT_REGION:$AWS_REQUEST_CHECKSUM_CALCULATION" >>"$AWS_LOG"
[[ -f "$AWS_TREE" ]] || (cd "$src" && find . -type f | LC_ALL=C sort >"$AWS_TREE")
[[ -z "${AWS_FAIL:-}" ]]
EOF
chmod +x "$tmp/bin/aws"
export PATH="$tmp/bin:$PATH" AWS_LOG="$tmp/aws.log" AWS_TREE="$tmp/tree.txt"

# Release mínima armada con make release (scripts/release.sh).
build="$tmp/build" dist="$tmp/dist"
mkdir -p "$build/style" "$build/assets/fonts/Figtree Regular" "$build/assets/sprites" "$build/assets/licenses"
printf 'tiles' >"$build/prueba.pmtiles"
jq -n --arg sha "$(sha256sum "$build/prueba.pmtiles" | cut -d' ' -f1)" \
  '{region: "prueba", protomaps_build: "20260929", bbox: [-76.3, 4.3, -76, 4.55], requested_maxzoom: 16, source_maxzoom: 15, sha256: $sha}' >"$build/build.json"
for variant in claro oscuro; do
  for lang in es en; do
    jq -n '{version: 8, metadata: {"veni:version": "0.1.0", "veni:base_url": "https://tiles.example.com/v0.1.0", "veni:protomaps_build": "20260929"}}' \
      >"$build/style/veni-$variant-$lang.json"
  done
done
printf 'glyphs' >"$build/assets/fonts/Figtree Regular/0-255.pbf"
echo '{}' >"$build/assets/sprites/light.json"
printf 'png' >"$build/assets/sprites/light.png"
echo 'OFL' >"$build/assets/licenses/Figtree-OFL.txt"
echo '{}' >"$build/assets/assets.json"
BUILD_DIR="$build" DIST_DIR="$dist" REGION_NAME=prueba RELEASE_VERSION=0.1.0 scripts/release.sh >/dev/null \
  || { echo "FAIL - no se pudo armar la release de prueba"; exit 1; }

account=0123456789abcdef0123456789abcdef
secret='s3cr3t-no-debe-verse'
secrets() {
  export R2_ACCOUNT_ID="$account" R2_ACCESS_KEY_ID=clave R2_SECRET_ACCESS_KEY="$secret" R2_BUCKET=veni-tiles
}
nosecrets() {
  unset R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
}
run() {
  rm -f "$AWS_LOG" "$AWS_TREE"
  out="$(scripts/r2-publish.sh "$dist" 2>&1)"
}

# --- Desactivado ---------------------------------------------------------------

nosecrets
if run && [[ "$out" == *"::notice"*"no hay secrets de R2"* && ! -e "$AWS_LOG" ]]; then
  pass "sin secrets: aviso, éxito y sin llamar a aws"
else
  fail "sin secrets: $out"
fi

nosecrets
export R2_BUCKET=veni-tiles R2_ACCOUNT_ID="$account"
if run && [[ "$out" == *"::warning"*"R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY"* && ! -e "$AWS_LOG" ]]; then
  pass "secrets a medias: advertencia con los que faltan y sin subir"
else
  fail "secrets a medias: $out"
fi

# --- Publicación ---------------------------------------------------------------

nosecrets
secrets
if run; then pass "publica con los cuatro secrets"; else fail "publica: $out"; fi

[[ "$out" != *"$secret"* ]] && ! grep -q "$secret" "$AWS_LOG" && pass "el secret no aparece en la salida" || fail "el secret se filtró"
grep -q $'\t'"clave:auto:when_required"'$' "$AWS_LOG" && pass "credenciales, región auto y checksums de R2" || fail "entorno de aws: $(head -1 "$AWS_LOG")"
[[ "$(cut -f5 "$AWS_LOG" | sort -u)" == "https://$account.r2.cloudflarestorage.com" ]] && pass "endpoint de la cuenta" || fail "endpoint: $(cut -f5 "$AWS_LOG" | sort -u)"

# Primero toda la versión, después latest.
prefixes="$(cut -f1 "$AWS_LOG" | uniq | tr '\n' ' ')"
[[ "$prefixes" == "s3://veni-tiles/v0.1.0/ s3://veni-tiles/latest/ " ]] && pass "vX.Y.Z antes que latest" || fail "orden: $prefixes"
[[ "$(grep '/v0.1.0/' "$AWS_LOG" | cut -f4 | sort -u)" == "public, max-age=31536000, immutable" ]] && pass "versión inmutable" || fail "caché de la versión"
[[ "$(grep '/latest/' "$AWS_LOG" | cut -f4 | sort -u)" == "public, max-age=300" ]] && pass "latest con caché corta" || fail "caché de latest"

ok=1
for pair in "*.pmtiles	application/vnd.pmtiles" "*.pbf	application/x-protobuf" "*.json	application/json" "SHA256SUMS	text/plain; charset=utf-8"; do
  grep -qF "/v0.1.0/	$pair	" "$AWS_LOG" || { ok=0; fail "falta el tipo para ${pair%%	*}"; }
done
((ok)) && pass "tipos de contenido por patrón"

# El árbol subido es el que esperan los estilos: fonts/ y sprites/ en la raíz.
ok=1
for file in ./prueba.pmtiles ./veni-claro-es.json ./manifest.json ./SHA256SUMS ./assets.tar.gz \
  "./fonts/Figtree Regular/0-255.pbf" ./sprites/light.png ./licenses/Figtree-OFL.txt ./assets.json; do
  grep -qxF "$file" "$AWS_TREE" || { ok=0; fail "falta $file en el árbol subido: $(tr '\n' ' ' <"$AWS_TREE")"; }
done
((ok)) && pass "árbol con el extracto, estilos, fuentes y sprites desempaquetados"

# --- Errores -------------------------------------------------------------------

AWS_FAIL=1 run && fail "un error de aws debía fallar" || pass "un error de aws hace fallar la publicación"

R2_ACCOUNT_ID="cuenta.evil.com/x" run && fail "cuenta inválida debía fallar" || { [[ "$out" == *"R2_ACCOUNT_ID"* && ! -e "$AWS_LOG" ]] && pass "rechaza un ID de cuenta inválido" || fail "cuenta: $out"; }
R2_BUCKET="Bucket_Malo" run && fail "bucket inválido debía fallar" || { [[ "$out" == *"R2_BUCKET"* ]] && pass "rechaza un bucket inválido" || fail "bucket: $out"; }

echo 'alterado' >>"$dist/veni-claro-es.json"
run && fail "dist alterado debía fallar" || { [[ "$out" == *"SHA256SUMS"* && ! -e "$AWS_LOG" ]] && pass "no sube un dist que no coincide con SHA256SUMS" || fail "dist alterado: $out"; }

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de r2-publish.sh pasaron"
