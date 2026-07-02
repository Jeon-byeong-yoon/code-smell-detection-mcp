# MCP + Advanced PyExamine Compose Workflow

## Purpose

This document describes how to run the MCP server and
`advanced-pyexamine-service` together with Docker Compose.

The MCP server is a stdio process, not an HTTP server. For that reason, the
main verification flow uses `docker compose run -T mcp-server` and pipes one
JSON request into stdin.

## Runtime Model

```text
docker compose
  -> mcp-server
       ADVANCED_PYEXAMINE_MODE=http
       ADVANCED_PYEXAMINE_SERVICE_URL=http://advanced-pyexamine-service:18080
  -> advanced-pyexamine-service
       ADVANCED_PYEXAMINE_SOURCE_DIR=/opt/advanced-pyexamine-source
       mounted advanced_pyexamine repository
```

The detector implementation is not copied into this repository. The original
`advanced_pyexamine` repository is mounted read-only into the service container.

## Compose Config

From the repository root:

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.example.yml config
```

## Build

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.example.yml build
```

This builds:

- `code-smell-detection-mcp:local`
- `advanced-pyexamine-service:local`

## MCP E2E Verification

Because the MCP server communicates over stdio, use `docker compose run -T`:

```bash
printf '%s\n' '{"id":"compose-e2e-1","tool":"analyze_python_smells","params":{"projectPath":"/opt/advanced-pyexamine-source/advanced_pyexamine","only":"long_method,data_clumps","summaryOnly":true}}' \
| ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
  docker compose -f docker-compose.example.yml run --rm -T mcp-server
```

Expected result shape:

```json
{
  "id": "compose-e2e-1",
  "result": {
    "ok": true,
    "result": {
      "tool": "advanced_pyexamine",
      "language": "python",
      "summary": {
        "total": 43,
        "byName": {
          "long_method": 41,
          "data_clumps": 2
        }
      },
      "response": {
        "summaryOnly": true,
        "returnedTotal": 0,
        "truncated": true
      }
    }
  }
}
```

## Cleanup

`docker compose run --rm` removes the one-off MCP container automatically.
If a service container remains, clean it up with:

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.example.yml down
```

## Notes

- The `projectPath` sent to MCP must be a path visible from inside the
  `advanced-pyexamine-service` container.
- When analyzing the mounted pyexamine repository itself, use:

```text
/opt/advanced-pyexamine-source/advanced_pyexamine
```

- Do not use a host-only path such as `/Users/...` as the MCP `projectPath`
  unless that path is also mounted into the service container.
