# Advanced PyExamine 에러 처리 검증

## 목적

`analyze_python_smells`는 외부 Python analyzer 또는 HTTP service를 호출한다.
따라서 정상 분석 결과뿐 아니라 실패 상황도 안정적으로 처리해야 한다.

이 문서는 MCP client와 `advanced-pyexamine-service` wrapper에서 검증하는 에러
케이스를 정리한다.

## MCP HTTP Mode 에러 케이스

테스트 스크립트:

```text
scripts/advanced-pyexamine-error-cases-test.js
```

실행 명령:

```bash
npm run test:advanced-pyexamine:errors
```

검증하는 케이스:

- advanced-pyexamine service가 HTTP 500을 반환하는 경우
- service가 JSON object가 아닌 응답을 반환하는 경우
- service 응답에 필수 필드인 `summary`가 없는 경우
- service 응답 timeout이 발생하는 경우
- MCP 요청 파라미터의 `limitPerGroup` 값이 잘못된 경우

기대 동작:

- MCP 서버 프로세스가 죽지 않는다.
- 응답은 `{ "id": "...", "error": "..." }` 형태로 반환된다.
- 에러 메시지는 사람이 원인을 파악할 수 있는 문구를 포함한다.

예시:

```json
{
  "id": "http-500",
  "error": "advanced_pyexamine service failed: analyzer exploded"
}
```

## Service Wrapper 에러 케이스

테스트 파일:

```text
services/advanced-pyexamine/tests/test_main.py
```

실행 명령:

```bash
cd services/advanced-pyexamine
python -m unittest discover -s tests
```

검증하는 케이스:

- `/health`가 정상 응답을 반환하는지
- `projectPath`가 존재하지 않을 때 404로 변환되는지
- analyzer 쪽 `ValueError`가 400으로 변환되는지
- 예상하지 못한 analyzer 예외가 500으로 변환되는지
- `limitPerGroup`이 0 이하일 때 request validation에서 422로 거부되는지

## CI 연결

기본 CI workflow에 다음 단계가 추가되었다.

```text
Run advanced pyexamine error case tests
  -> npm run test:advanced-pyexamine:errors
```

이 테스트는 실제 `advanced_pyexamine` repository나 Docker를 사용하지 않는다.
대신 mock HTTP service를 띄워 MCP HTTP mode의 실패 응답 contract를 검증한다.

## 현재 범위

이번 검증의 범위는 에러 응답 contract다.

포함:

- MCP HTTP mode 에러 응답 형태
- service wrapper HTTP status 변환
- 잘못된 요청 파라미터 검증

미포함:

- 실제 detector 규칙의 정확도
- CodeVi backend 저장 실패 처리
- Docker Compose 환경에서의 장애 복구

위 항목들은 후속 작업에서 별도로 검증한다.
