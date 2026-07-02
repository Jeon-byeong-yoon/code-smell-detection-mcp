# advanced-pyexamine-service

FastAPI wrapper for `advanced_pyexamine`.

This service is intentionally kept in `code-smell-detection-mcp` as a wrapper layer. It does not copy the smell detection rules. The real analyzer should be provided through `ADVANCED_PYEXAMINE_SOURCE_DIR` or an editable Python install.

Current status:

- `GET /health` is implemented.
- `POST /analyze` returns a mock analyzer response with the same response shape expected by the MCP tool.
- `response_transformer.py` is covered by local unit tests.

## Install

```bash
python -m pip install -r requirements.txt
```

## Run

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 18080
```

## Verify

```bash
curl http://localhost:18080/health
```

```bash
curl -X POST http://localhost:18080/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectPath":"/tmp/sample-python-project","summaryOnly":true}'
```

## Test

```bash
python -m unittest discover -s tests
```

## Real Analyzer Integration Plan

The next step is to replace the mock implementation in `app/analyzer_adapter.py` with a real call to:

```python
from advanced_pyexamine.analyzer import analyze_project
```

The service should support:

```bash
export ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2"
```

and add that path to `sys.path` before importing `advanced_pyexamine`.
