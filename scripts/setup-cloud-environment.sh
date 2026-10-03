#!/usr/bin/env bash
set -euo pipefail

# Install the repository's package manager and headless Linux tools without root.
# APT verifies packages from the environment's existing, signed repositories.
with_wine=false
case "${1:-}" in
  '') ;;
  --with-wine) with_wine=true ;;
  *) printf 'Usage: bash scripts/setup-cloud-environment.sh [--with-wine]\n' >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  printf 'Unexpected arguments.\n' >&2
  exit 2
fi

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  printf 'This setup requires an x86_64 Linux environment with Debian packages.\n' >&2
  exit 1
fi
for command_name in node corepack apt-get dpkg-deb; do
  command -v "$command_name" >/dev/null || { printf 'Missing prerequisite: %s\n' "$command_name" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24+ is required."); process.exit(1); }'

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
bin_dir="$HOME/.local/bin"
tools_dir="${LLM_READER_ENV_TOOLS_DIR:-$HOME/.local/share/llm-reader-env}"
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/llm-reader-env"
sysroot="$tools_dir/sysroot"
libs64="$sysroot/usr/lib/x86_64-linux-gnu"
libs32="$sysroot/usr/lib/i386-linux-gnu"
loader64="$libs64/ld-linux-x86-64.so.2"
loader32="$libs32/ld-linux.so.2"
mkdir -p "$bin_dir" "$tools_dir" "$cache_dir"
export PATH="$bin_dir:$PATH"
cd "$repo_root"
corepack enable --install-directory "$bin_dir" pnpm
package_manager=$(node -p 'require("./package.json").packageManager')
corepack install --global "$package_manager"

apt_dir="$cache_dir/apt"
mkdir -p "$apt_dir/lists/partial" "$apt_dir/archives/partial" "$sysroot"
touch "$apt_dir/empty-status"
apt_options=(
  -o "Dir::State::lists=$apt_dir/lists"
  -o "Dir::State::status=$apt_dir/empty-status"
  -o "Dir::State::extended_states=$apt_dir/extended-states"
  -o "Dir::Cache::archives=$apt_dir/archives"
  -o "Dir::Cache::pkgcache=$apt_dir/pkgcache.bin"
  -o "Dir::Cache::srcpkgcache=$apt_dir/srcpkgcache.bin"
  -o Debug::NoLocking=1
  -o APT::Architectures::=amd64
)
if $with_wine || [[ -f "$tools_dir/.ready-wine-v2" ]]; then
  apt_options+=(-o APT::Architectures::=i386)
fi

if [[ ! -f "$tools_dir/.ready-xvfb-v1" || ! -x "$sysroot/usr/bin/Xvfb" ]] ||
   { $with_wine && [[ ! -f "$tools_dir/.ready-wine-v2" || ! -x "$sysroot/usr/lib/wine/wine64" ]]; }; then
  packages=(xvfb xauth x11-xkb-utils patchelf)
  if $with_wine; then
    packages+=(wine64 wine32:i386 wine32-preloader:i386 libz-mingw-w64)
  fi
  apt-get "${apt_options[@]}" update
  apt-get "${apt_options[@]}" --yes --download-only --no-install-recommends install "${packages[@]}"
  for archive in "$apt_dir/archives/"*.deb; do
    if [[ ${archive##*/} == qemu-user_* ]]; then
      dpkg-deb --fsys-tarfile "$archive" | tar -x -C "$sysroot" ./usr/bin/qemu-i386
    else
      dpkg-deb --extract "$archive" "$sysroot"
    fi
  done

  # Private ELF interpreters avoid installing libc on the host or exporting
  # library paths into Node/Electron.
  native_binaries=(usr/bin/Xvfb usr/bin/xauth usr/bin/xkbcomp
    usr/lib/wine/wine usr/lib/wine/wine64 usr/lib/wine/wineserver32 usr/lib/wine/wineserver64)
  for relative_path in "${native_binaries[@]}"; do
    binary="$sysroot/$relative_path"
    [[ -f "$binary" ]] || continue
    elf_class=$(od -An -tu1 -j4 -N1 "$binary" | tr -d ' ')
    case "$elf_class" in
      1) interpreter="$loader32"; library_dir="$libs32" ;;
      2) interpreter="$loader64"; library_dir="$libs64" ;;
      *) continue ;;
    esac
    "$loader64" --library-path "$libs64" "$sysroot/usr/bin/patchelf" \
      --set-interpreter "$interpreter" --set-rpath "$library_dir" "$binary"
  done
fi

write_native_wrapper() {
  local name=$1 target=$2
  {
    printf '#!/usr/bin/env bash\nset -e\n'
    printf 'export LD_LIBRARY_PATH=%q"${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\n' "$libs64"
    printf 'exec %q "$@"\n' "$sysroot/$target"
  } > "$bin_dir/$name"
  chmod +x "$bin_dir/$name"
}
write_native_wrapper Xvfb usr/bin/Xvfb
write_native_wrapper xauth usr/bin/xauth
write_native_wrapper xkbcomp usr/bin/xkbcomp
install -m 755 "$sysroot/usr/bin/xvfb-run" "$bin_dir/xvfb-run"
touch "$tools_dir/.ready-xvfb-v1"

if $with_wine || [[ -f "$tools_dir/.ready-wine-v2" ]]; then
  # Debian's server launcher contains absolute /usr paths. Use the private ELF
  # server directly, including when Wine starts helper processes internally.
  cp -p "$sysroot/usr/lib/wine/wineserver64" "$sysroot/usr/lib/wine/wineserver.new"
  mv -fT "$sysroot/usr/lib/wine/wineserver.new" "$sysroot/usr/lib/wine/wineserver"
  # Debian's relocated binaries compute share/wine/wine. Provide all their data
  # there, including wine.inf for prefix initialization and the NLS tables.
  mkdir -p "$sysroot/usr/share/wine/wine"
  for data_entry in "$sysroot/usr/share/wine/"*; do
    data_name=${data_entry##*/}
    [[ "$data_name" == wine ]] && continue
    ln -sfn "../$data_name" "$sysroot/usr/share/wine/wine/$data_name"
  done
  if ! "$loader32" --help >/dev/null 2>&1; then
    # Managed kernels may reject i386 ELF files. QEMU runs Wine's 32-bit helper
    # processes; Node, Electron, Xvfb and Wine's 64-bit tools stay native.
    if [[ ! -x "$sysroot/usr/bin/qemu-i386" ]]; then
      apt-get "${apt_options[@]}" \
        --yes --download-only --no-install-recommends install qemu-user
      for archive in "$apt_dir/archives/"qemu-user_*.deb; do
        dpkg-deb --fsys-tarfile "$archive" | tar -x -C "$sysroot" ./usr/bin/qemu-i386
      done
    fi
    # Wine's static preloader keeps the fixed NSIS image base (0x400000) free.
    # The wrapper also handles 32-bit child processes started by Wine itself.
    {
      printf '#!/usr/bin/env bash\nset -e\n'
      printf 'export LD_LIBRARY_PATH=%q\n' "$libs32"
      printf 'export WINELOADERNOEXEC=1\n'
      printf 'exec %q -L %q %q "$@"\n' \
        "$sysroot/usr/bin/qemu-i386" "$sysroot" \
        "$sysroot/usr/lib/wine/wine-preloader.static"
    } > "$sysroot/usr/lib/wine/wine-preloader.new"
    chmod +x "$sysroot/usr/lib/wine/wine-preloader.new"
    mv -fT "$sysroot/usr/lib/wine/wine-preloader.new" "$sysroot/usr/lib/wine/wine-preloader"
  fi
  # The relocated Debian installation does not populate SysWOW64 itself. Seed
  # its builtin PE modules so 32-bit cmd and the NSIS helper can load kernel32.
  mkdir -p "$tools_dir/wine-prefix/drive_c/windows/syswow64"
  if [[ ! -f "$tools_dir/wine-prefix/.seeded-i386-v1" ]]; then
    cp -a "$sysroot/usr/lib/i386-linux-gnu/wine/i386-windows/." \
      "$tools_dir/wine-prefix/drive_c/windows/syswow64/"
    touch "$tools_dir/wine-prefix/.seeded-i386-v1"
  fi
  # zlib is a native Windows DLL, so Wine must find it in the prefix's system
  # directories rather than the directory reserved for Wine builtin DLLs.
  mkdir -p "$tools_dir/wine-prefix/drive_c/windows/system32" "$tools_dir/wine-prefix/drive_c/windows/syswow64"
  install -m 644 "$sysroot/usr/x86_64-w64-mingw32/lib/zlib1.dll" "$tools_dir/wine-prefix/drive_c/windows/system32/zlib1.dll"
  install -m 644 "$sysroot/usr/i686-w64-mingw32/lib/zlib1.dll" "$tools_dir/wine-prefix/drive_c/windows/syswow64/zlib1.dll"
  {
    printf '#!/usr/bin/env bash\nset -e\n'
    printf 'tool_root=%q\n' "$sysroot"
    printf 'default_prefix=%q\n' "$tools_dir/wine-prefix"
    printf 'loader_path=%q\n' "$sysroot/usr/lib/wine/wine64"
    cat <<'WINE'
export LD_LIBRARY_PATH="$tool_root/usr/lib/x86_64-linux-gnu:$tool_root/usr/lib/i386-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export WINEPREFIX="${WINEPREFIX:-$default_prefix}"
export WINESERVER="${WINESERVER:-$tool_root/usr/lib/wine/wineserver}"
export WINEDATADIR="${WINEDATADIR:-$tool_root/usr/share/wine}"
export WINEDLLPATH="$tool_root/usr/lib/x86_64-linux-gnu/wine:$tool_root/usr/lib/i386-linux-gnu/wine${WINEDLLPATH:+:$WINEDLLPATH}"
export WINEDEBUG="${WINEDEBUG:--all}"
export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:-mscoree,mshtml=}"
exec "$loader_path" "$@"
WINE
  } > "$bin_dir/wine"
  chmod +x "$bin_dir/wine"
  ln -sfn wine "$bin_dir/wine64"
fi

cat > "$tools_dir/activate.sh" <<'ACTIVATE'
case "$PATH" in
  "$HOME/.local/bin"|"$HOME/.local/bin":*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
ACTIVATE

printf 'pnpm: %s\n' "$(pnpm --version)"
xvfb-run --auto-servernum --server-args='-screen 0 1600x1000x24 -nolisten tcp' true
if $with_wine; then
  wine --version
  # Verify both architectures, since NSIS uses a 32-bit Windows helper even
  # when the application being packaged is x64.
  xvfb-run --auto-servernum --server-args='-screen 0 1600x1000x24 -nolisten tcp' \
    env WINEPREFIX="$tools_dir/wine-prefix" \
    bash -c 'wine wineboot.exe --update && wine "C:\\windows\\system32\\cmd.exe" /d /c ver && wine "C:\\windows\\syswow64\\cmd.exe" /d /c ver'
  touch "$tools_dir/.ready-wine-v2"
fi
printf 'Environment tools are ready in %s\n' "$bin_dir"
printf 'For this shell: source %q\n' "$tools_dir/activate.sh"
