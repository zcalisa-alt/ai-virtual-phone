#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <release-archive.tar.gz> <git-sha> <base-sha>" >&2
  exit 64
fi

ARCHIVE="$1"
GIT_SHA="$2"
BASE_SHA="$3"
RELEASES_ROOT="/opt/ai-virtual-phone-releases"
CURRENT_LINK="$RELEASES_ROOT/current"
APP_NAME="ai-virtual-phone"
CANARY_NAME="ai-virtual-phone-canary"
APP_PORT="3001"
CANARY_PORT="3002"

if [[ ! "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid git SHA: $GIT_SHA" >&2
  exit 65
fi

if [[ ! "$BASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid base SHA: $BASE_SHA" >&2
  exit 65
fi

if [[ ! -f "$ARCHIVE" ]]; then
  echo "Release archive not found: $ARCHIVE" >&2
  exit 66
fi

RELEASE_DIR="$RELEASES_ROOT/$GIT_SHA"
PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
TEMP_LINK="$RELEASES_ROOT/.current-$GIT_SHA"
NEW_RELEASE_CREATED=0

healthcheck() {
  local port="$1"
  local attempts="${2:-30}"
  local delay="${3:-2}"
  local i

  for ((i = 1; i <= attempts; i += 1)); do
    if curl --fail --silent --show-error --max-time 10 \
      "http://127.0.0.1:${port}/" >/dev/null; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

rollback() {
  trap - ERR
  echo "Deployment failed; rolling back to the previous release." >&2
  pm2 delete "$CANARY_NAME" >/dev/null 2>&1 || true

  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    rm -f -- "$TEMP_LINK"
    ln -s -- "$PREVIOUS_RELEASE" "$TEMP_LINK"
    mv -Tf -- "$TEMP_LINK" "$CURRENT_LINK"
    NEXT_PUBLIC_SELF_HOSTED_MODE=true pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
  fi

  if [[ "$NEW_RELEASE_CREATED" == "1" && -d "$RELEASE_DIR" ]]; then
    resolved="$(realpath -m "$RELEASE_DIR")"
    case "$resolved" in
      "$RELEASES_ROOT"/"$GIT_SHA")
        find "$resolved" -mindepth 1 -delete >/dev/null 2>&1 || true
        rmdir -- "$resolved" >/dev/null 2>&1 || true
        ;;
    esac
  fi
}

trap rollback ERR

mkdir -p -- "$RELEASES_ROOT"

if [[ -e "$RELEASE_DIR" ]]; then
  echo "Release already exists: $RELEASE_DIR" >&2
  exit 67
fi

if [[ -z "$PREVIOUS_RELEASE" || ! -d "$PREVIOUS_RELEASE" ]]; then
  echo "Current release is unavailable." >&2
  exit 68
fi

DEPLOYED_SHA="$(cat "$PREVIOUS_RELEASE/.deployment-version" 2>/dev/null || true)"
if [[ "$DEPLOYED_SHA" != "$BASE_SHA" ]]; then
  echo "Deployed version changed: expected $BASE_SHA, found $DEPLOYED_SHA" >&2
  exit 69
fi

cp -al -- "$PREVIOUS_RELEASE/." "$RELEASE_DIR/"
NEW_RELEASE_CREATED=1

resolved_release="$(realpath -m "$RELEASE_DIR")"
if [[ "$resolved_release" != "$RELEASES_ROOT/$GIT_SHA" ]]; then
  echo "Unexpected release path: $resolved_release" >&2
  exit 70
fi

find "$RELEASE_DIR/.next" -mindepth 1 -delete 2>/dev/null || true
rmdir -- "$RELEASE_DIR/.next" 2>/dev/null || true
rm -rf -- "$RELEASE_DIR/node_modules"
rm -f -- "$RELEASE_DIR/.deployment-version"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"

remove_relative_path() {
  local relative_path="$1"
  if [[ -z "$relative_path" || "$relative_path" == /* ]]; then
    echo "Unsafe deleted path: $relative_path" >&2
    exit 71
  fi
  case "/$relative_path/" in
    *"/../"*|*"/./"*)
      echo "Unsafe deleted path: $relative_path" >&2
      exit 71
      ;;
  esac
  rm -rf -- "$RELEASE_DIR/$relative_path"
}

while IFS= read -r -d '' relative_path; do
  remove_relative_path "$relative_path"
done <"$RELEASE_DIR/deleted-files.zlist"

while IFS= read -r -d '' relative_path; do
  remove_relative_path "$relative_path"
done <"$RELEASE_DIR/changed-files.zlist"

tar -xf "$RELEASE_DIR/source-files.tar" -C "$RELEASE_DIR"
rm -f -- \
  "$RELEASE_DIR/source-files.tar" \
  "$RELEASE_DIR/changed-files.zlist" \
  "$RELEASE_DIR/deleted-files.zlist"

printf '%s\n' "$GIT_SHA" >"$RELEASE_DIR/.deployment-version"

if [[ -n "$PREVIOUS_RELEASE" \
  && -d "$PREVIOUS_RELEASE/node_modules" \
  && -f "$PREVIOUS_RELEASE/package-lock.json" ]] \
  && cmp -s "$PREVIOUS_RELEASE/package-lock.json" "$RELEASE_DIR/package-lock.json"; then
  ln -s -- "$(readlink -f "$PREVIOUS_RELEASE/node_modules")" "$RELEASE_DIR/node_modules"
  echo "Reused runtime dependencies from the previous release."
else
  (
    cd "$RELEASE_DIR"
    npm ci --omit=dev --no-audit --no-fund
  )
fi

pm2 delete "$CANARY_NAME" >/dev/null 2>&1 || true
NEXT_PUBLIC_SELF_HOSTED_MODE=true pm2 start "$RELEASE_DIR/scripts/local-next-server.mjs" \
  --name "$CANARY_NAME" \
  --cwd "$RELEASE_DIR" \
  -- \
  --prod --port "$CANARY_PORT" --host 127.0.0.1 >/dev/null

healthcheck "$CANARY_PORT" 30 2
pm2 delete "$CANARY_NAME" >/dev/null

rm -f -- "$TEMP_LINK"
ln -s -- "$RELEASE_DIR" "$TEMP_LINK"
mv -Tf -- "$TEMP_LINK" "$CURRENT_LINK"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  NEXT_PUBLIC_SELF_HOSTED_MODE=true pm2 restart "$APP_NAME" --update-env >/dev/null
else
  NEXT_PUBLIC_SELF_HOSTED_MODE=true pm2 start "$CURRENT_LINK/scripts/local-next-server.mjs" \
    --name "$APP_NAME" \
    --cwd "$CURRENT_LINK" \
    -- \
    --prod --port "$APP_PORT" --host 127.0.0.1 >/dev/null
fi

healthcheck "$APP_PORT" 30 2
curl --fail --insecure --silent --show-error --max-time 10 \
  "https://127.0.0.1:9443/" >/dev/null
pm2 save >/dev/null

trap - ERR
rm -f -- "$ARCHIVE"

echo "Float deployment completed: $GIT_SHA"
