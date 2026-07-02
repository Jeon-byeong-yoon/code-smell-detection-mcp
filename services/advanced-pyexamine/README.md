# advanced-pyexamine-service

FastAPI wrapper for `advanced_pyexamine`.

This service is intentionally kept in `code-smell-detection-mcp` as a wrapper layer. It does not copy the smell detection rules. The real analyzer should be provided through `ADVANCED_PYEXAMINE_SOURCE_DIR` or an editable Python install.

Current status:

- `GET /health` is implemented.
- `POST /analyze` calls `advanced_pyexamine.analyzer.analyze_project`.
- `ADVANCED_PYEXAMINE_SOURCE_DIR` can point to a local `advanced_pyexamine` source repository.
- `Smell` objects are normalized to the same response shape expected by the MCP tool.
- The analyzer adapter and response transformer are covered by local unit tests.

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
