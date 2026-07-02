#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SERVICE_DIR="$REPO_ROOT/services/advanced-pyexamine"

HOST="${ADVANCED_PYEXAMINE_SERVICE_HOST:-127.0.0.1}"
PORT="${ADVANCED_PYEXAMINE_SERVICE_PORT:-18080}"

if [ -z "${ADVANCED_PYEXAMINE_SOURCE_DIR:-}" ]; then
  echo "ADVANCED_PYEXAMINE_SOURCE_DIR is required." >&2
  echo "Example:" >&2
  echo "  ADVANCED_PYEXAMINE_SOURCE_DIR=\"/path/to/pyexamine 2\" npm run service:advanced-pyexamine" >&2
  exit 1
fi

if [ ! -d "$ADVANCED_PYEXAMINE_SOURCE_DIR" ]; then
  echo "ADVANCED_PYEXAMINE_SOURCE_DIR does not exist or is not a directory: $ADVANCED_PYEXAMINE_SOURCE_DIR" >&2
  exit 1
fi

cd "$SERVICE_DIR"

echo "Starting advanced-pyexamine-service on http://$HOST:$PORT"
echo "ADVANCED_PYEXAMINE_SOURCE_DIR=$ADVANCED_PYEXAMINE_SOURCE_DIR"

exec python -m uvicorn app.main:app --host "$HOST" --port "$PORT"
