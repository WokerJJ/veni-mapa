#!/usr/bin/env bash
# Genera los recursos autohospedados del estilo en BUILD_DIR/assets:
#
#   fonts/<fontstack>/<rango>.pbf   glyphs SDF de config/fontstacks.yml
#   sprites/{light,dark}[@2x].{json,png}
#
# 1. Descarga cada archivo de config/assets.lock (con caché en build/cache) y
#    verifica su SHA-256. Un hash distinto detiene todo.
# 2. Genera los glyphs con font-maker, combinando cada fuente de marca con su
#    respaldo de Noto Sans.
# 3. Copia los sprites y reemplaza BUILD_DIR/assets de una sola vez, para no
#    dejar una mezcla de recursos viejos y nuevos si algo falla a mitad.
set -euo pipefail

build_dir="${BUILD_DIR:-build}"
lock="${ASSETS_LOCK:-config/assets.lock}"
stacks="${FONTSTACKS:-config/fontstacks.yml}"
cache="$build_dir/cache/assets"
out="$build_dir/assets"
tmp="$out.tmp"

fail() {
  echo "assets.sh: $*" >&2
  exit 1
}

for tool in curl sha256sum yq font-maker; do
  command -v "$tool" >/dev/null || fail "falta $tool (usá la imagen: docker compose run --rm tools make assets)"
done
[[ -f "$lock" ]] || fail "no existe $lock"
[[ -f "$stacks" ]] || fail "no existe $stacks"

trap 'rm -rf "$tmp"' EXIT

# --- 1. Descarga verificada ------------------------------------------------------

declare -A locked=()
while read -r sha dest url extra; do
  [[ -z "$sha" || "$sha" == \#* ]] && continue
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || fail "$lock: SHA-256 inválido para $dest"
  [[ -n "$dest" && "$dest" != /* && "$dest" != *..* ]] || fail "$lock: destino inválido '$dest'"
  # Solo HTTPS; file:// únicamente en las pruebas (ASSETS_ALLOW_FILE_URLS=1).
  [[ ("$url" == https://* || ("${ASSETS_ALLOW_FILE_URLS:-}" == 1 && "$url" == file://*)) && -z "${extra:-}" ]] \
    || fail "$lock: línea inválida para $dest (se espera <sha256> <destino> <url https>)"
  locked["$dest"]=1

  file="$cache/$dest"
  if [[ ! -f "$file" ]] || ! echo "$sha  $file" | sha256sum -c --status; then
    echo "==> Descargando $dest"
    mkdir -p "$(dirname "$file")"
    curl -fsSL --retry 3 --retry-delay 2 -o "$file.part" "$url" || fail "no se pudo descargar $url"
    mv "$file.part" "$file"
  fi
  if ! echo "$sha  $file" | sha256sum -c --status; then
    rm -f "$file"
    fail "el SHA-256 de $dest no coincide con $lock (¿cambió el archivo en origen?)"
  fi
done <"$lock"

((${#locked[@]} > 0)) || fail "$lock no tiene recursos"

# --- 2. Glyphs ------------------------------------------------------------------

rm -rf "$tmp"
mkdir -p "$tmp/fonts" "$tmp/sprites"

stack_count="$(yq -r 'length' "$stacks")"
((stack_count > 0)) || fail "$stacks no define fontstacks"

for ((i = 0; i < stack_count; i++)); do
  name="$(yq -r "to_entries[$i].key" "$stacks")"
  [[ "$name" =~ ^[A-Za-z0-9\ ]+$ ]] || fail "$stacks: nombre de fontstack inválido '$name' (letras, números y espacios)"
  mapfile -t sources < <(yq -r "to_entries[$i].value[]" "$stacks")
  ((${#sources[@]} > 0)) || fail "$stacks: '$name' no tiene fuentes"

  files=()
  for source in "${sources[@]}"; do
    [[ -n "${locked[$source]:-}" ]] || fail "$stacks: '$name' usa $source, que no está en $lock"
    files+=("$cache/$source")
  done

  echo "==> Glyphs: $name (${sources[*]})"
  # font-maker exige que su carpeta de salida no exista y crea <salida>/<nombre>.
  font-maker --name "$name" "$tmp/stack-$i" "${files[@]}" >/dev/null
  mv "$tmp/stack-$i/$name" "$tmp/fonts/"
  rmdir "$tmp/stack-$i"

  # 256 rangos de 256 códigos cubren todo el plano básico de Unicode.
  ranges="$(find "$tmp/fonts/$name" -name '*.pbf' | wc -l)"
  ((ranges == 256)) || fail "font-maker generó $ranges rangos para '$name' (se esperaban 256)"
done

# --- 3. Sprites y reemplazo ------------------------------------------------------

for dest in "${!locked[@]}"; do
  [[ "$dest" == sprites/* ]] && cp "$cache/$dest" "$tmp/sprites/"
done
for sprite in light light@2x dark dark@2x; do
  [[ -f "$tmp/sprites/$sprite.json" && -f "$tmp/sprites/$sprite.png" ]] || fail "falta el sprite $sprite en $lock"
done

rm -rf "$out"
mv "$tmp" "$out"

echo "==> Listo: $out ($(du -sh "$out" | cut -f1): $stack_count fontstacks, sprites claro y oscuro)"
