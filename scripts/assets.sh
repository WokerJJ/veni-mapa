#!/usr/bin/env bash
# Genera los recursos autohospedados del estilo en BUILD_DIR/assets:
#
#   fonts/<fontstack>/<rango>.pbf   glyphs SDF de config/fontstacks.yml
#   sprites/{light,dark}[@2x].{json,png}
#   licenses/                       licencias que deben viajar con los recursos
#   assets.json                     procedencia: con qué se generó todo esto
#
# 1. Descarga cada archivo de config/assets.lock (con caché en build/cache) y
#    verifica su SHA-256. Un hash distinto detiene todo.
# 2. Genera los glyphs con font-maker, combinando cada fuente de marca con su
#    respaldo de Noto Sans, y comprueba que el respaldo aportó glyphs.
# 3. Copia sprites y licencias, escribe el manifiesto y reemplaza
#    BUILD_DIR/assets con dos renombres: si algo falla, queda lo anterior.
set -euo pipefail

build_dir="${BUILD_DIR:-build}"
lock="${ASSETS_LOCK:-config/assets.lock}"
stacks="${FONTSTACKS:-config/fontstacks.yml}"
licenses_dir="${ASSETS_LICENSES:-licenses}"
cache="$build_dir/cache/assets"
out="$build_dir/assets"
tmp="$out.tmp"
old="$out.old"

# Rango cirílico: Figtree y Bricolage no lo cubren, Noto sí. Si un fontstack
# combina fuentes y este rango sale vacío, el respaldo no llegó.
fallback_range="1024-1279"
fallback_min_bytes=1024

fail() {
  echo "assets.sh: $*" >&2
  exit 1
}

cleanup() {
  rm -rf "$tmp"
  # Si el proceso se cortó entre los dos renombres, se restaura lo anterior.
  if [[ -d "$old" && ! -e "$out" ]]; then
    mv "$old" "$out"
  fi
}
trap cleanup EXIT

for tool in curl sha256sum yq font-maker; do
  command -v "$tool" >/dev/null || fail "falta $tool (usá la imagen: docker compose run --rm tools make assets)"
done
[[ -f "$lock" ]] || fail "no existe $lock"
[[ -f "$stacks" ]] || fail "no existe $stacks"
[[ -d "$licenses_dir" ]] || fail "no existe $licenses_dir"

# --- 1. Descarga verificada ------------------------------------------------------

declare -A locked=()
while read -r sha dest url extra; do
  [[ -z "$sha" || "$sha" == \#* ]] && continue
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || fail "$lock: SHA-256 inválido para $dest"
  # Destinos canónicos: sin alias (./, //, ..) ni subcarpetas que choquen al copiar.
  [[ "$dest" =~ ^(fonts|sprites)/[A-Za-z0-9._@-]+$ && "$dest" != */.* ]] \
    || fail "$lock: destino inválido '$dest' (se espera fonts/<archivo> o sprites/<archivo>)"
  [[ -z "${locked[$dest]:-}" ]] || fail "$lock: destino duplicado '$dest'"
  # Solo HTTPS; file:// únicamente en las pruebas (ASSETS_ALLOW_FILE_URLS=1).
  [[ ("$url" == https://* || ("${ASSETS_ALLOW_FILE_URLS:-}" == 1 && "$url" == file://*)) && -z "${extra:-}" ]] \
    || fail "$lock: línea inválida para $dest (se espera <sha256> <destino> <url https>)"
  locked["$dest"]=1

  file="$cache/$dest"
  if [[ ! -f "$file" ]] || ! echo "$sha  $file" | sha256sum -c --status; then
    echo "==> Descargando $dest"
    mkdir -p "$(dirname "$file")"
    curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors -o "$file.part" "$url" || fail "no se pudo descargar $url"
    mv "$file.part" "$file"
  fi
  if ! echo "$sha  $file" | sha256sum -c --status; then
    rm -f "$file"
    fail "el SHA-256 de $dest no coincide con $lock (¿cambió el archivo en origen?)"
  fi
done <"$lock"

((${#locked[@]} > 0)) || fail "$lock no tiene recursos"

# --- 2. Glyphs ------------------------------------------------------------------

stack_count="$(yq -r 'length' "$stacks")"
((stack_count > 0)) || fail "$stacks no define fontstacks"

# Carpetas que solo difieren en mayúsculas chocan en Windows y macOS.
collisions="$(yq -r 'keys[] | downcase' "$stacks" | sort | uniq -d)"
[[ -z "$collisions" ]] || fail "$stacks: fontstacks que solo difieren en mayúsculas: $collisions"

rm -rf "$tmp"
mkdir -p "$tmp/fonts" "$tmp/sprites" "$tmp/licenses"
log="$build_dir/font-maker.log"

for ((i = 0; i < stack_count; i++)); do
  name="$(yq -r "to_entries[$i].key" "$stacks")"
  # Termina siendo carpeta y URL: palabras de letras y números con un espacio.
  [[ "$name" =~ ^[A-Za-z0-9]+( [A-Za-z0-9]+)*$ ]] \
    || fail "$stacks: nombre de fontstack inválido '$name' (palabras de letras y números separadas por un espacio)"
  mapfile -t sources < <(yq -r "to_entries[$i].value[]" "$stacks")
  ((${#sources[@]} > 0)) || fail "$stacks: '$name' no tiene fuentes"

  files=()
  for source in "${sources[@]}"; do
    [[ -n "${locked[$source]:-}" ]] || fail "$stacks: '$name' usa $source, que no está en $lock"
    files+=("$cache/$source")
  done

  echo "==> Glyphs: $name (${sources[*]})"
  # font-maker exige que su carpeta de salida no exista, crea <salida>/<nombre>
  # y escribe sus errores en stdout: se guardan y se muestran si falla.
  if ! font-maker --name "$name" "$tmp/stack-$i" "${files[@]}" >"$log" 2>&1; then
    cat "$log" >&2
    fail "font-maker falló para '$name'"
  fi
  mv "$tmp/stack-$i/$name" "$tmp/fonts/"
  rmdir "$tmp/stack-$i"

  # font-maker escribe los 256 rangos aunque estén vacíos: contar no alcanza.
  ranges="$(find "$tmp/fonts/$name" -name '*.pbf' | wc -l)"
  ((ranges == 256)) || fail "font-maker generó $ranges rangos para '$name' (se esperaban 256)"
  if ((${#sources[@]} > 1)); then
    bytes="$(stat -c %s "$tmp/fonts/$name/$fallback_range.pbf")"
    ((bytes >= fallback_min_bytes)) \
      || fail "'$name' combina fuentes pero el rango $fallback_range pesa $bytes bytes: el respaldo no aportó glyphs"
  fi
done
rm -f "$log"

# --- 3. Sprites, licencias, manifiesto y reemplazo --------------------------------

for dest in "${!locked[@]}"; do
  [[ "$dest" == sprites/* ]] && cp "$cache/$dest" "$tmp/sprites/"
done
for sprite in light light@2x dark dark@2x; do
  [[ -f "$tmp/sprites/$sprite.json" && -f "$tmp/sprites/$sprite.png" ]] || fail "falta el sprite $sprite en $lock"
done

# La OFL y la MIT exigen que el aviso viaje con cada copia de los recursos.
cp "$licenses_dir"/*.txt "$tmp/licenses/"
compgen -G "$tmp/licenses/*.txt" >/dev/null || fail "no hay licencias en $licenses_dir"

freetype="$(apk info -v 2>/dev/null | grep -m1 '^freetype-' || echo desconocida)"
glyphs_sha="$(cd "$tmp/fonts" && find . -name '*.pbf' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
jq -n \
  --arg lock "$(sha256sum "$lock" | cut -d' ' -f1)" \
  --arg stacks "$(sha256sum "$stacks" | cut -d' ' -f1)" \
  --arg font_maker "${FONT_MAKER_COMMIT:-desconocido}" \
  --arg freetype "$freetype" \
  --arg glyphs "$glyphs_sha" \
  --argjson fontstacks "$(yq -o=json '.' "$stacks")" \
  '{assets_lock_sha256: $lock, fontstacks_sha256: $stacks, fontstacks: $fontstacks,
    glyphs_sha256: $glyphs, tools: {font_maker_commit: $font_maker, freetype: $freetype}}' \
  >"$tmp/assets.json"

rm -rf "$old" 2>/dev/null || fail "quedó $old de una corrida anterior y no se puede borrar; borralo a mano"
if [[ -d "$out" ]]; then mv "$out" "$old"; fi
mv "$tmp" "$out"
rm -rf "$old" 2>/dev/null || echo "assets.sh: aviso: no se pudo borrar $old; borralo a mano" >&2

echo "==> Listo: $out ($(du -sh "$out" | cut -f1): $stack_count fontstacks, sprites claro y oscuro)"
