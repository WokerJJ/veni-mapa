#!/usr/bin/env bash
# Pruebas de scripts/r2-publish.sh sin red. Un `aws` falso guarda los objetos
# en una carpeta (un bucket de mentira): aplica --exclude/--include como la CLI
# (ruta relativa, "*" cruza "/", gana el último filtro que casa) y anota tipo y
# caché de cada objeto subido. La release sale de scripts/release.sh.
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
# S3 falso en $FAKE_S3/<bucket>/<clave>; metadatos en $FAKE_S3.meta/<bucket>/<clave>.
set -uo pipefail
echo "$*" >>"$AWS_CALLS"
echo "$AWS_ACCESS_KEY_ID:$AWS_DEFAULT_REGION:$AWS_REQUEST_CHECKSUM_CALCULATION:$AWS_RESPONSE_CHECKSUM_VALIDATION" >>"$AWS_ENV"
[[ -n "${AWS_FAIL:-}" && "$*" == *"$AWS_FAIL"* ]] && { echo "An error occurred (InternalError)" >&2; exit 1; }
service="$1" op="$2"
shift 2
args=() filters=() type="" cache="" endpoint="" bucket="" prefix=""
while (($#)); do
  case "$1" in
    --exclude) filters+=("exclude=$2"); shift ;;
    --include) filters+=("include=$2"); shift ;;
    --content-type) type="$2"; shift ;;
    --cache-control) cache="$2"; shift ;;
    --endpoint-url) endpoint="$2"; shift ;;
    --bucket) bucket="$2"; shift ;;
    --prefix) prefix="$2"; shift ;;
    --query | --output) shift ;;
    --recursive | --only-show-errors) ;;
    *) args+=("$1") ;;
  esac
  shift
done
echo "$endpoint" >>"$AWS_ENDPOINTS"
case "$service $op" in
  "s3 cp")
    src="${args[0]}" dest="${args[1]}"
    if [[ "$src" == s3://* ]]; then
      obj="$FAKE_S3/${src#s3://}"
      [[ -f "$obj" ]] || { echo "An error occurred (404) when calling the HeadObject operation: Key \"${src#s3://*/}\" does not exist" >&2; exit 1; }
      cat "$obj"
      exit 0
    fi
    dest="${dest#s3://}"
    while IFS= read -r -d '' file; do
      rel="${file#"${src%/}"/}" keep=1
      for filter in "${filters[@]}"; do
        # shellcheck disable=SC2053
        [[ "$rel" == ${filter#*=} ]] && { [[ "$filter" == include=* ]] && keep=1 || keep=0; }
      done
      ((keep)) || continue
      mkdir -p "$(dirname "$FAKE_S3/$dest$rel")" "$(dirname "$FAKE_S3.meta/$dest$rel")"
      cp "$file" "$FAKE_S3/$dest$rel"
      printf '%s\t%s\n' "$type" "$cache" >"$FAKE_S3.meta/$dest$rel"
      printf '%s\t%s\t%s\n' "$dest$rel" "$type" "$cache" >>"$AWS_UPLOADS"
    done < <(find "$src" -type f -print0)
    ;;
  "s3 rm")
    rm -f "$FAKE_S3/${args[0]#s3://}" "$FAKE_S3.meta/${args[0]#s3://}"
    ;;
  "s3api list-objects-v2")
    [[ -d "$FAKE_S3/$bucket/$prefix" ]] || { echo null; exit 0; }
    (cd "$FAKE_S3/$bucket" && find "$prefix" -type f | LC_ALL=C sort) | jq -R . | jq -s .
    ;;
  *) echo "aws falso: operación no soportada: $service $op" >&2; exit 2 ;;
esac
EOF
chmod +x "$tmp/bin/aws"
export PATH="$tmp/bin:$PATH" FAKE_S3="$tmp/s3" AWS_CALLS="$tmp/calls" AWS_ENV="$tmp/env" AWS_ENDPOINTS="$tmp/endpoints" AWS_UPLOADS="$tmp/uploads"

# Release mínima armada con scripts/release.sh, en la versión pedida.
make_release() {
  local version="$1" build="$tmp/build" dist="$tmp/dist-$1"
  rm -rf "$build"
  mkdir -p "$build/style" "$build/assets/fonts/Figtree Regular" "$build/assets/sprites" "$build/assets/licenses"
  printf 'tiles %s' "$version" >"$build/prueba.pmtiles"
  jq -n --arg sha "$(sha256sum "$build/prueba.pmtiles" | cut -d' ' -f1)" \
    '{region: "prueba", protomaps_build: "20260929", bbox: [-76.3, 4.3, -76, 4.55], requested_maxzoom: 16, source_maxzoom: 15, sha256: $sha}' >"$build/build.json"
  for variant in claro oscuro; do
    for lang in es en; do
      jq -n --arg v "$version" '{version: 8, metadata: {"veni:version": $v, "veni:base_url": ("https://tiles.example.com/v" + $v), "veni:protomaps_build": "20260929"}}' \
        >"$build/style/veni-$variant-$lang.json"
    done
  done
  printf 'glyphs' >"$build/assets/fonts/Figtree Regular/0-255.pbf"
  echo '{}' >"$build/assets/sprites/light.json"
  printf 'png' >"$build/assets/sprites/light.png"
  echo 'OFL' >"$build/assets/licenses/Figtree-OFL.txt"
  echo '{}' >"$build/assets/assets.json"
  BUILD_DIR="$build" DIST_DIR="$dist" REGION_NAME=prueba RELEASE_VERSION="$version" scripts/release.sh >/dev/null \
    || { echo "FAIL - no se pudo armar la release $version"; exit 1; }
}
for v in 0.1.0 0.2.0 0.3.0; do make_release "$v"; done

account=0123456789abcdef0123456789abcdef
secret='s3cr3t-no-debe-verse'
secrets() {
  export R2_ACCOUNT_ID="$account" R2_ACCESS_KEY_ID=clave R2_SECRET_ACCESS_KEY="$secret" R2_BUCKET=veni-tiles
}
nosecrets() {
  unset R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
}
# Publica la release de la versión $1; el bucket falso persiste entre llamadas.
run() {
  rm -f "$AWS_CALLS" "$AWS_UPLOADS"
  out="$(scripts/r2-publish.sh "$tmp/dist-$1" 2>&1)"
}
latest_version() {
  jq -r .version "$FAKE_S3/veni-tiles/latest/manifest.json" 2>/dev/null
}

# --- Desactivado ---------------------------------------------------------------

nosecrets
if run 0.1.0 && [[ "$out" == *"::notice"*"no hay secrets de R2"* && ! -e "$AWS_CALLS" ]]; then
  pass "sin secrets: aviso, éxito y sin llamar a aws"
else
  fail "sin secrets: $out"
fi

export R2_BUCKET=veni-tiles R2_ACCOUNT_ID="$account"
if run 0.1.0 && [[ "$out" == *"::warning"*"R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY"* && ! -e "$AWS_CALLS" ]]; then
  pass "secrets a medias: advertencia con los que faltan y sin subir"
else
  fail "secrets a medias: $out"
fi

# --- Primera publicación (bucket vacío) ----------------------------------------

nosecrets
secrets
if run 0.2.0; then pass "publica con los cuatro secrets"; else fail "publica: $out"; fi
[[ "$out" != *"$secret"* ]] && pass "el script no imprime el secret" || fail "el secret aparece en la salida"
[[ "$(sort -u "$AWS_ENV")" == "clave:auto:when_required:when_required" ]] && pass "credenciales, región auto y checksums de R2" || fail "entorno de aws: $(sort -u "$AWS_ENV")"
[[ "$(sort -u "$AWS_ENDPOINTS")" == "https://$account.r2.cloudflarestorage.com" ]] && pass "endpoint de la cuenta" || fail "endpoint: $(sort -u "$AWS_ENDPOINTS")"

# Cada archivo del árbol se sube una sola vez por prefijo, con su tipo y su caché.
tree_files=(prueba.pmtiles veni-claro-es.json veni-claro-en.json veni-oscuro-es.json veni-oscuro-en.json manifest.json
  SHA256SUMS assets.tar.gz assets.json "fonts/Figtree Regular/0-255.pbf" sprites/light.json sprites/light.png licenses/Figtree-OFL.txt
  licenses/protomaps-basemaps-BSD-3.txt licenses/THIRD_PARTY_NOTICES.md)
declare -A expected_type=([pmtiles]=application/vnd.pmtiles [json]=application/json [pbf]=application/x-protobuf
  [png]=image/png [gz]=application/gzip [txt]="text/plain; charset=utf-8" [md]="text/markdown; charset=utf-8" [SHA256SUMS]="text/plain; charset=utf-8")
ok=1
for prefix in v0.2.0 latest; do
  [[ "$prefix" == latest ]] && cache="public, max-age=300" || cache="public, max-age=31536000, immutable"
  for file in "${tree_files[@]}"; do
    ext="${file##*.}"
    want="$(printf '%s\t%s\t%s' "veni-tiles/$prefix/$file" "${expected_type[$ext]}" "$cache")"
    count="$(grep -cxF "$want" "$AWS_UPLOADS")"
    [[ "$count" == 1 ]] || { ok=0; fail "$prefix/$file: se esperaba 1 subida con '${expected_type[$ext]}' y '$cache', hubo $count"; }
  done
done
[[ "$(wc -l <"$AWS_UPLOADS")" == $((2 * ${#tree_files[@]})) ]] || { ok=0; fail "subidas de más: $(wc -l <"$AWS_UPLOADS")"; }
((ok)) && pass "cada archivo, una vez por prefijo, con su tipo y su caché"

first_latest="$(grep -n '/latest/' "$AWS_UPLOADS" | head -1 | cut -d: -f1)"
last_version="$(grep -n '/v0.2.0/' "$AWS_UPLOADS" | tail -1 | cut -d: -f1)"
((last_version < first_latest)) && pass "toda la versión antes que latest" || fail "latest empezó antes de terminar la versión"
[[ "$(latest_version)" == 0.2.0 ]] && pass "latest creado con la 0.2.0" || fail "latest: $(latest_version)"

# --- latest no retrocede -------------------------------------------------------

if run 0.1.0 && [[ "$out" == *"latest/ ya tiene la v0.2.0"* ]]; then
  pass "una versión vieja no mueve latest (aviso)"
else
  fail "versión vieja: $out"
fi
[[ "$(latest_version)" == 0.2.0 && -f "$FAKE_S3/veni-tiles/v0.1.0/manifest.json" ]] \
  && ! grep -q '/latest/' "$AWS_UPLOADS" && pass "…pero sí publica su /v0.1.0/" || fail "versión vieja tocó latest o no subió su prefijo"

# --- latest avanza y queda sin restos ------------------------------------------

mkdir -p "$FAKE_S3/veni-tiles/latest/fonts/Vieja" "$FAKE_S3/veni-tiles/v0.2.0/extra"
echo x >"$FAKE_S3/veni-tiles/latest/fonts/Vieja/0-255.pbf"
echo x >"$FAKE_S3/veni-tiles/latest/obsoleto.txt"
echo x >"$FAKE_S3/veni-tiles/v0.2.0/extra/queda.txt"
if run 0.3.0; then pass "una versión nueva mueve latest"; else fail "versión nueva: $out"; fi
[[ "$(latest_version)" == 0.3.0 ]] || fail "latest: $(latest_version)"
[[ ! -e "$FAKE_S3/veni-tiles/latest/fonts/Vieja/0-255.pbf" && ! -e "$FAKE_S3/veni-tiles/latest/obsoleto.txt" ]] \
  && pass "borra de latest lo que la versión ya no trae" || fail "quedaron restos en latest: $(cd "$FAKE_S3/veni-tiles/latest" && find . -type f)"
[[ -f "$FAKE_S3/veni-tiles/v0.2.0/extra/queda.txt" ]] && pass "no borra fuera de latest/" || fail "borró fuera de latest/"
[[ "$(cd "$FAKE_S3/veni-tiles/latest" && find . -type f | wc -l)" == "${#tree_files[@]}" ]] \
  && pass "latest/ queda igual al árbol de la versión" || fail "latest/ tiene $(cd "$FAKE_S3/veni-tiles/latest" && find . -type f | wc -l) archivos"

# Re-adjunto de la misma versión: latest se vuelve a subir, igual.
if run 0.3.0 && [[ "$(latest_version)" == 0.3.0 ]] && grep -q '/latest/' "$AWS_UPLOADS"; then
  pass "la misma versión vuelve a subir latest"
else
  fail "misma versión: $out"
fi

# --- Errores -------------------------------------------------------------------

AWS_FAIL="latest/manifest.json -" run 0.3.0 && fail "un error al leer latest debía fallar" \
  || { [[ "$out" == *"no se pudo leer latest/manifest.json"*InternalError* ]] && ! grep -q '/latest/' "$AWS_UPLOADS" \
    && pass "un error (no 404) al leer latest falla sin tocar latest" || fail "error al leer latest: $out"; }

AWS_FAIL="list-objects-v2" run 0.3.0 && fail "un error al listar latest debía fallar" \
  || { ! grep -q '^s3 rm' "$AWS_CALLS" && pass "un error al listar latest falla sin borrar nada" || fail "borró sin listar"; }

AWS_FAIL="--include *.pbf" run 0.3.0 && fail "un error al subir debía fallar" || pass "un error al subir hace fallar la publicación"

echo '{"version": "no"}' >"$FAKE_S3/veni-tiles/latest/manifest.json"
run 0.3.0 && fail "latest con versión inválida debía fallar" || { [[ "$out" == *"no tiene una versión válida"* ]] && pass "rechaza un latest/manifest.json inválido" || fail "latest inválido: $out"; }

R2_ACCOUNT_ID="cuenta.evil.com/x" run 0.3.0 && fail "cuenta inválida debía fallar" || { [[ "$out" == *"R2_ACCOUNT_ID"* && ! -e "$AWS_CALLS" ]] && pass "rechaza un ID de cuenta inválido" || fail "cuenta: $out"; }
R2_BUCKET="Bucket_Malo" run 0.3.0 && fail "bucket inválido debía fallar" || { [[ "$out" == *"R2_BUCKET"* && ! -e "$AWS_CALLS" ]] && pass "rechaza un bucket inválido" || fail "bucket: $out"; }

# Un archivo sin tipo conocido no se subiría: falla antes de subir nada.
cp -R "$tmp/dist-0.3.0" "$tmp/dist-9.9.9"
printf 'x' >"$tmp/dist-9.9.9/extra.bin"
run 9.9.9 && fail "archivo sin tipo debía fallar" || { [[ "$out" == *"sin tipo de contenido: extra.bin"* && ! -e "$AWS_CALLS" ]] && pass "rechaza archivos sin tipo antes de subir" || fail "sin tipo: $out"; }

echo 'alterado' >>"$tmp/dist-0.3.0/veni-claro-es.json"
run 0.3.0 && fail "dist alterado debía fallar" || { [[ "$out" == *"SHA256SUMS"* && ! -e "$AWS_CALLS" ]] && pass "no sube un dist que no coincide con SHA256SUMS" || fail "dist alterado: $out"; }

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de r2-publish.sh pasaron"
