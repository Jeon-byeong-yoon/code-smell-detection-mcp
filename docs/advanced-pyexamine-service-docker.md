# Advanced PyExamine Service Docker Workflow

## Purpose

This document describes how to run `services/advanced-pyexamine` with Docker.

The Docker image contains only the FastAPI wrapper service. It does not copy
the `advanced_pyexamine` detector implementation into this repository or image.
Instead, mount the original `advanced_pyexamine` repository into the container
as a read-only volume.

## Runtime Model

```text
host advanced_pyexamine repository
  -> read-only Docker volume
  -> /opt/advanced-pyexamine-source
  -> ADVANCED_PYEXAMINE_SOURCE_DIR
  -> services/advanced-pyexamine
  -> advanced_pyexamine.analyzer.analyze_project()
```

This keeps detector ownership in the original `advanced_pyexamine` repository
and keeps this repository focused on the MCP and service wrapper.

## Build

From the repository root:

```bash
docker build \
  -t advanced-pyexamine-service:local \
  services/advanced-pyexamine
```

## Run

```bash
docker run --rm \
  -p 18080:18080 \
  -e ADVANCED_PYEXAMINE_SOURCE_DIR=/opt/advanced-pyexamine-source \
  -v "/path/to/pyexamine 2:/opt/advanced-pyexamine-source:ro" \
  advanced-pyexamine-service:local
```

## Run With Docker Compose

```bash
cd services/advanced-pyexamine
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.example.yml up --build
```

Optional port override:

```bash
ADVANCED_PYEXAMINE_SERVICE_PORT=18081 \
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.example.yml up --build
```

## Verify Service

```bash
curl http://localhost:18080/health
```

```bash
curl -X POST http://localhost:18080/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectPath":"/opt/advanced-pyexamine-source/advanced_pyexamine","only":"long_method,data_clumps","summaryOnly":true}'
```

## Verify Through MCP

From the repository root, with the Docker service running:

```bash
ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
ADVANCED_PYEXAMINE_E2E_PROJECT_PATH="/opt/advanced-pyexamine-source/advanced_pyexamine" \
npm run test:advanced-pyexamine:service
```

For a host-local Python project path, use a path that the service container can
actually access. If the target project is inside the mounted source repository,
use the container path under `/opt/advanced-pyexamine-source`.

## Verified Locally

The following Docker flow was verified on 2026-07-02:

```bash
docker build -t advanced-pyexamine-service:local services/advanced-pyexamine
```

```bash
docker run --rm -d \
  --name advanced-pyexamine-service-test \
  -p 18081:18080 \
  -e ADVANCED_PYEXAMINE_SOURCE_DIR=/opt/advanced-pyexamine-source \
  -v "/path/to/pyexamine 2:/opt/advanced-pyexamine-source:ro" \
  advanced-pyexamine-service:local
```

```bash
curl http://localhost:18081/health
```

Result:

```json
{"ok":true,"service":"advanced-pyexamine-service"}
```

MCP E2E against the Docker service:

```bash
ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18081 \
ADVANCED_PYEXAMINE_E2E_PROJECT_PATH=/opt/advanced-pyexamine-source/advanced_pyexamine \
npm run test:advanced-pyexamine:service
```

Result:

```text
advanced_pyexamine service E2E test success.
summary.total=43
summary.byName={"long_method":41,"data_clumps":2}
```

## Notes

- The mounted source path must contain the importable `advanced_pyexamine`
  package.
- The mounted target project path must be visible inside the container.
- The image intentionally does not vendor detector code. Future packaging can
  switch to a package dependency or submodule if that becomes the chosen
  distribution model.
