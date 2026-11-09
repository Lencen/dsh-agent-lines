#!/usr/bin/env bash
set -euo pipefail

# dsh-agent-lines installer for ordinary users.
# It picks the DSH Web profile when present, otherwise the only profile.
# Override with: DSH_PROFILE=my-profile bash install.sh [package|tarball]

DSH_BIN="${DSH_BIN:-dsh}"
PKG="${1:-dsh-agent-lines@0.6.1}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILES="$DSH_HOME/profiles"

# Common user-level install locations; SSH shells often do not source the
# same PATH as the desktop session or systemd service.
for dir in "$HOME/.npm-global/bin" "$HOME/nodejs/bin" "$HOME/.local/bin"; do
  [ -d "$dir" ] && PATH="$dir:$PATH"
done

if [ "$PKG" = "dsh-agent-lines@0.6.1" ] && [ -f ./dsh-agent-lines-0.6.1.tgz ]; then
  PKG=./dsh-agent-lines-0.6.1.tgz
fi

if ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  echo "dsh not found on PATH. Install DeepSeek Harness first, or set DSH_BIN." >&2
  exit 1
fi

choose_profile() {
  if [ -n "${DSH_PROFILE:-}" ]; then printf '%s\n' "$DSH_PROFILE"; return; fi
  if [ -d "$PROFILES/web" ]; then printf '%s\n' web; return; fi
  local names=()
  if [ -d "$PROFILES" ]; then
    for d in "$PROFILES"/*; do
      [ -d "$d" ] || continue
      names+=("$(basename "$d")")
    done
  fi
  if [ "${#names[@]}" -eq 1 ]; then printf '%s\n' "${names[0]}"; return; fi
  echo "Cannot choose a DSH profile. Existing: ${names[*]:-none}" >&2
  echo "Run with DSH_PROFILE=<profile> bash install.sh" >&2
  exit 2
}

PROFILE="$(choose_profile)"
echo "DSH profile: $PROFILE"
echo "Installing:  $PKG"
"$DSH_BIN" plugin --profile "$PROFILE" add "$PKG"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if "$DSH_BIN" --profile "$PROFILE" --dump-config >"$TMP" 2>/dev/null; then
  if grep -q 'dsh-agent-lines' "$TMP"; then
    echo "OK: dsh-agent-lines is present in profile '$PROFILE'."
  else
    echo "Installed, but dsh-agent-lines was not in --dump-config. Check the profile bundle." >&2
    exit 3
  fi
else
  echo "Installed. Run manually: dsh --profile $PROFILE --dump-config | grep agent-lines" >&2
fi

echo "Next: edit $PROFILES/$PROFILE/cordis.patch.yml with the manager config from README."
echo "Then start: dsh --profile $PROFILE web --no-open"