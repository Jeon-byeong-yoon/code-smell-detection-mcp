# advanced-pyexamine-service

FastAPI wrapper for `advanced_pyexamine`.

This service is intentionally kept in `code-smell-detection-mcp` as a wrapper layer. It does not copy the smell detection rules. The real analyzer should be provided through `ADVANCED_PYEXAMINE_SOURCE_DIR` or an editable Python install.

Current status:

- `GET /health` is implemented.
- `POST /analyze` calls `advanced_pyexamine.analyzer.analyze_project`.
- `ADVANCED_PYEXAMINE_SOURCE_DIR` can point to a local `advanced_pyexamine` source repository.
- `Smell` objects are normalized to the same response shape expected by the MCP tool.
- The analyzer adapter and response transformer are covered by local unit tests.

## Security

- **Path allowlist (always on)**: `/analyze` only accepts a `projectPath` under
  `ADVANCED_PYEXAMINE_ALLOWED_ROOTS` (comma-separated directories). When unset it
  falls back to `ADVANCED_PYEXAMINE_SOURCE_DIR`; when neither is set every request
  is rejected with 403. Paths are `realpath`-normalized first, so `..` and symlink
  escapes are blocked. To analyze a project outside the source dir (local dev),
  add it explicitly: `ADVANCED_PYEXAMINE_ALLOWED_ROOTS="/path/to/project"`.
- **Shared-secret auth (opt-in)**: when `ADVANCED_PYEXAMINE_SHARED_SECRET` is set,
  `/analyze` requires a matching `X-Internal-Token` header (constant-time compare;
  401 otherwise). Callers (CodeVi backend, MCP server in http mode) must send the
  same value. When unset the service logs a warning and skips auth — dev only.
- `GET /health` is always unauthenticated.

## Install

```bash
python -m pip install -r requirements.txt
```

## Run

```bash
export ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2"
python -m uvicorn app.main:app --host 127.0.0.1 --port 18080
```

From the repository root, the same service can be started with:

```bash
ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2" npm run service:advanced-pyexamine
```

## Run With Docker

Build the wrapper image:

```bash
docker build -t advanced-pyexamine-service:local services/advanced-pyexamine
```

Run it with the original `advanced_pyexamine` repository mounted read-only:

```bash
docker run --rm \
  -p 18080:18080 \
  -e ADVANCED_PYEXAMINE_SOURCE_DIR=/opt/advanced-pyexamine-source \
  -v "/path/to/pyexamine 2:/opt/advanced-pyexamine-source:ro" \
  advanced-pyexamine-service:local
```

Or use the compose example:

```bash
cd services/advanced-pyexamine
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.example.yml up --build
```

The Docker image intentionally contains only the FastAPI wrapper. Detector code
is provided by the mounted `advanced_pyexamine` source repository.

## Verify

```bash
curl http://localhost:18080/health
```

```bash
curl -X POST http://localhost:18080/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectPath":"/path/to/python/project","summaryOnly":true}'
```

## Test

```bash
python -m unittest discover -s tests
```

From the repository root, verify a running service end-to-end with:

```bash
ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
ADVANCED_PYEXAMINE_E2E_PROJECT_PATH="/path/to/python/project" \
npm run test:advanced-pyexamine:service
```

This checks:

- `GET /health`
- `POST /analyze`
- MCP `analyze_python_smells` with `ADVANCED_PYEXAMINE_MODE=http`

## Real Analyzer Integration Plan

`app/analyzer_adapter.py` already calls:

```python
from advanced_pyexamine.analyzer import analyze_project
```

When `advanced_pyexamine` is not installed in the current Python environment,
set:

```bash
export ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2"
```

The service adds that path to `sys.path` before importing `advanced_pyexamine`.
