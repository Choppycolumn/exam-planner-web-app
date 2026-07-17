#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
RELEASES_DIR="$APP_DIR/releases"
SHARED_ROOT="${ASSET_SHARED_ROOT:-$APP_DIR/shared}"
SHARED_ASSETS_DIR="$SHARED_ROOT/assets"
RETENTION_DAYS="${STATIC_ASSET_RETENTION_DAYS:-14}"
RELEASE="$(readlink -f -- "${1:?release path is required}")"

[[ "$RELEASE" == "$RELEASES_DIR"/* && -d "$RELEASE/dist/assets" ]] || {
  echo "invalid release asset directory: $RELEASE" >&2
  exit 1
}
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ && "$RETENTION_DAYS" -ge 1 ]] || {
  echo "STATIC_ASSET_RETENTION_DAYS must be a positive integer" >&2
  exit 1
}

mkdir -p "$SHARED_ASSETS_DIR"
ASSET_LOCK_FILE="${ASSET_LOCK_FILE:-/run/lock/exam-planner-assets.lock}"
mkdir -p "$(dirname -- "$ASSET_LOCK_FILE")"
exec 8>"$ASSET_LOCK_FILE"
flock 8

while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$RELEASE/dist/assets/"}"
  destination="$SHARED_ASSETS_DIR/$relative_path"
  mkdir -p "$(dirname -- "$destination")"
  if [[ -f "$destination" ]]; then
    cmp -s -- "$source_file" "$destination" || {
      echo "immutable asset collision: $relative_path" >&2
      exit 1
    }
  else
    temporary="$destination.tmp.$$"
    install -m 0644 "$source_file" "$temporary"
    mv -f -- "$temporary" "$destination"
  fi
  touch -- "$destination"
done < <(find "$RELEASE/dist/assets" -type f -print0)

find "$SHARED_ASSETS_DIR" -type f -mtime "+$RETENTION_DAYS" -delete
find "$SHARED_ASSETS_DIR" -mindepth 1 -type d -empty -delete

while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$RELEASE/dist/assets/"}"
  cmp -s -- "$source_file" "$SHARED_ASSETS_DIR/$relative_path" || {
    echo "shared asset verification failed: $relative_path" >&2
    exit 1
  }
done < <(find "$RELEASE/dist/assets" -type f -print0)

echo "assets_published release=$RELEASE retention_days=$RETENTION_DAYS"
