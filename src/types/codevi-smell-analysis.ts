/**
 * CodeVi Smell Analysis Integration Contract
 *
 * code-smell-detection-mcp에서 실행한 advanced_pyexamine 분석 결과를
 * CodeVi backend에 저장하고 조회하기 위한 타입 및 DTO 정의.
 *
 * 참고 문서:
 *   - docs/codevi-smell-analysis-contract.md
 *   - docs/advanced-pyexamine-service-design.md
 *   - docs/metrics-mcp-verification-2026-06-29.md
 */

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** SmellAnalysisJob 상태 전이: PENDING → RUNNING → SUCCESS | FAILED */
export type SmellAnalysisStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export type SmellSeverity = 'high' | 'medium' | 'low' | 'unknown';

/** 현재 지원 언어. 향후 typescript, java, c 확장 예정. */
export type LanguageType = 'python' | 'typescript' | 'java' | 'c' | string;

/** 현재 지원 analyzer. 향후 다국어 analyzer 추가 예정. */
export type AnalyzerType = 'advanced_pyexamine' | string;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * 실패한 SmellAnalysisJob에 저장되는 errorCode 열거형.
 * (codevi-smell-analysis-contract.md "Error Contract" 섹션 참고)
 */
export type SmellAnalysisErrorCode =
  | 'ANALYZER_NOT_CONFIGURED'   // analyzer service URL, binary, source dir 설정 누락
  | 'ANALYZER_SERVICE_FAILED'   // analyzer service가 4xx/5xx 반환
  | 'ANALYZER_TIMEOUT'          // timeout
  | 'ANALYZER_INVALID_RESPONSE' // 응답 JSON 구조가 contract와 다름
  | 'PROJECT_NOT_FOUND'         // 분석 대상 path 또는 source가 없음
  | 'UNAUTHORIZED_PROJECT'      // user/api key가 teamProject 접근 권한 없음
  | 'PERSISTENCE_FAILED';       // 분석은 성공했지만 DB 저장 실패

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

/**
 * summary 필드 shape.
 * MCP analyze_python_smells 응답의 summary와 동일한 구조를 유지한다.
 * summaryBySeverity 초기값은 {} (FAILED job도 동일하게 저장).
 */
export interface SmellSummary {
  total: number;
  bySeverity: Record<string, number>; // { high: 11, medium: 32, ... }
  byName: Record<string, number>;     // { long_method: 41, data_clumps: 2, ... }
}

/**
 * MCP/advanced-pyexamine-service 호출 시 전달하는 실행 옵션.
 * (advanced-pyexamine-service-design.md POST /analyze 요청 필드 참고)
 */
export interface SmellAnalysisRequestOptions {
  /** comma-separated detector 이름. ex) "long_method,data_clumps" */
  only?: string;
  /** true이면 smellGroups 생략, summary만 반환 */
  summaryOnly?: boolean;
  /** 각 smell group에서 반환할 최대 항목 수 */
  limitPerGroup?: number;
}

/**
 * MCP analyze_python_smells 또는 advanced-pyexamine-service /analyze
 * 응답의 response 메타 필드.
 */
export interface SmellAnalysisResponseMeta {
  summaryOnly: boolean;
  returnedTotal: number;
  truncated: boolean;
  limitPerGroup?: number;
}

// ---------------------------------------------------------------------------
// Domain models (Entity shape)
// ---------------------------------------------------------------------------

/**
 * SmellAnalysisJob entity.
 * 분석 요청 단위. metric-analysis와 별도 domain으로 분리한다.
 * (codevi-smell-analysis-contract.md "저장 모델 > SmellAnalysisJob" 참고)
 */
export interface SmellAnalysisJob {
  id: number;
  teamProjectId: number;

  /** Jenkins 기반 code analysis와 연결할 경우 사용 */
  codeAnalysisId?: number;
  /** metric-analysis job과 연결할 경우 사용 */
  metricAnalysisJobId?: number;

  buildNumber?: number;
  commitHash?: string;
  sourceRef?: string;

  language: LanguageType;
  analyzer: AnalyzerType;
  analyzerVersion?: string;

  status: SmellAnalysisStatus;

  requestedAt: Date | string;
  startedAt?: Date | string;
  completedAt?: Date | string;
  durationMs?: number;

  /** summary.total 을 별도 컬럼으로 저장 (dashboard 필터 최적화) */
  summaryTotal: number;
  summaryBySeverity: Record<string, number>;
  summaryByName: Record<string, number>;

  /** MCP 호출 시 전달한 옵션 (only, summaryOnly, limitPerGroup 등) */
  requestOptions?: SmellAnalysisRequestOptions;

  /** MCP/service 원본 응답 전체 (optional, 디버그 보존용) */
  rawResult?: unknown;

  /** FAILED 상태일 때 저장되는 실패 메시지 */
  errorMessage?: string;
  /** FAILED 상태일 때 저장되는 실패 분류 코드 */
  errorCode?: SmellAnalysisErrorCode | string;
}

/**
 * SmellAnalysisFinding entity.
 * 개별 smell 탐지 결과. dashboard 필터링을 위해 별도 테이블로 저장 권장.
 * (codevi-smell-analysis-contract.md "저장 모델 > SmellAnalysisFinding" 참고)
 *
 * 언어별 analyzer adapter는 이 공통 shape로 정규화해야 한다.
 * 언어별 원본 필드는 rawFinding에 보존한다.
 */
export interface SmellAnalysisFinding {
  id: number;
  smellAnalysisJobId: number;

  /** query 최적화를 위해 job의 teamProjectId를 중복 저장 */
  teamProjectId: number;

  language: LanguageType;

  /** smell rule name. ex) "long_method", "data_clumps" */
  name: string;
  /** analyzer category. ex) "size_metric" */
  category?: string;
  severity: SmellSeverity;

  /** source relative file path */
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;

  /** class, function, module 등 */
  entity?: string;
  /** remediation message. ex) "Extract Method" */
  message?: string;

  /** detector-specific metric. ex) { loc: 61, threshold: 50 } */
  metrics?: Record<string, unknown>;
  /** 연관 위치 목록 */
  relatedLocations?: unknown[];

  /** analyzer 원본 finding (언어별 추가 필드 보존용) */
  rawFinding?: unknown;
}

// ---------------------------------------------------------------------------
// advanced-pyexamine-service HTTP shapes
// (advanced-pyexamine-service-design.md HTTP API 섹션 참고)
// ---------------------------------------------------------------------------

/** POST /analyze 요청 body */
export interface AdvancedPyexamineAnalyzeRequest {
  projectPath: string;
  only?: string;
  summaryOnly?: boolean;
  limitPerGroup?: number;
}

/** POST /analyze 성공 응답 */
export interface AdvancedPyexamineAnalyzeResponse {
  tool: 'advanced_pyexamine';
  language: 'python';
  projectPath: string;
  only?: string;
  /** summaryOnly=true이면 service 응답에서 생략될 수 있다. */
  smellGroups?: Record<string, AdvancedPyexamineFindingItem[]>;
  summary: SmellSummary;
  response: SmellAnalysisResponseMeta;
}

/** smellGroups 내 개별 finding item (MCP/service 공통 shape) */
export interface AdvancedPyexamineFindingItem {
  name: string;
  category?: string;
  entity?: string;
  location?: {
    file: string;
    line_start: number;
    line_end: number;
  };
  severity: SmellSeverity;
  metrics?: Record<string, unknown>;
  related_locations?: unknown[];
  message?: string;
}

/** GET /health 응답 */
export interface AdvancedPyexamineHealthResponse {
  ok: true;
  service: 'advanced-pyexamine-service';
}

/** POST /analyze 에러 응답 */
export interface AdvancedPyexamineErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// API DTOs — 요청
// ---------------------------------------------------------------------------

/**
 * POST /api/smell-analyses 요청 body.
 * CodeVi backend가 MCP 또는 service에 분석을 위임하고 결과를 저장하는 트리거.
 */
export interface CreateSmellAnalysisDto {
  teamProjectId: number;
  codeAnalysisId?: number;
  metricAnalysisJobId?: number;
  buildNumber?: number;
  commitHash?: string;
  sourceRef?: string;
  language: LanguageType;
  /** 분석 대상 Python project path (MCP/service에 전달) */
  projectPath?: string;
  analyzer: AnalyzerType;
  options?: SmellAnalysisRequestOptions;
}

/**
 * GET /api/smell-analyses 쿼리 파라미터.
 */
export interface ListSmellAnalysisQuery {
  teamProjectId: number;
  language?: LanguageType;
  status?: SmellAnalysisStatus;
  analyzer?: AnalyzerType;
  buildNumber?: number;
  commitHash?: string;
  limit?: number;
  offset?: number;
}

/**
 * GET /api/smell-analyses/:jobId/findings 쿼리 파라미터.
 * (codevi-smell-analysis-contract.md "Finding 조회" 섹션 참고)
 */
export interface ListSmellAnalysisFindingQuery {
  severity?: SmellSeverity;
  name?: string;
  category?: string;
  /** filePath prefix 검색. ex) "src/" */
  filePath?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// API DTOs — 응답
// ---------------------------------------------------------------------------

/**
 * 목록 조회 단건 아이템.
 * summary detail 없이 dashboard 카드 표시에 최적화.
 */
export interface SmellAnalysisListItem {
  jobId: number;
  status: SmellAnalysisStatus;
  teamProjectId: number;
  codeAnalysisId?: number;
  buildNumber?: number;
  commitHash?: string;
  language: LanguageType;
  analyzer: AnalyzerType;
  summaryTotal: number;
  summaryBySeverity: Record<string, number>;
  requestedAt: Date | string;
  completedAt?: Date | string;
}

/**
 * POST /api/smell-analyses 응답.
 * CodeVi backend의 기존 metric-analysis 응답 패턴(success/statusCode/message/data)과 일치.
 * (metrics-mcp-verification-2026-06-29.md Direct Backend Verification 참고)
 */
export interface CreateSmellAnalysisResponseDto {
  success: boolean;
  statusCode: 201;
  message: string;
  data: {
    jobId: number;
    status: SmellAnalysisStatus;
    teamProjectId: number;
    language: LanguageType;
    analyzer: AnalyzerType;
    summary: SmellSummary;
    response: SmellAnalysisResponseMeta;
  };
}

/**
 * GET /api/smell-analyses 목록 응답.
 * CodeVi backend의 기존 응답 패턴(success/statusCode/message/data/meta)과 일치.
 */
export interface SmellAnalysisListResponseDto {
  success: boolean;
  statusCode: 200;
  message: string;
  data: SmellAnalysisListItem[];
  meta: {
    total: number;
  };
}

/**
 * GET /api/smell-analyses/:jobId 단건 상세 응답.
 * findings 배열 포함. summaryOnly=true인 job의 경우 findings가 빈 배열일 수 있음.
 */
export interface SmellAnalysisDetailResponseDto {
  success: boolean;
  statusCode: 200;
  message: string;
  data: {
    jobId: number;
    status: SmellAnalysisStatus;
    teamProjectId: number;
    language: LanguageType;
    analyzer: AnalyzerType;
    summary: SmellSummary;
    findings: Array<Omit<SmellAnalysisFinding, 'smellAnalysisJobId' | 'teamProjectId' | 'language' | 'rawFinding'>>;
    requestedAt: Date | string;
    completedAt?: Date | string;
    errorMessage?: string | null;
    errorCode?: SmellAnalysisErrorCode | string | null;
  };
}

/**
 * GET /api/smell-analyses/:jobId/findings 필터링 조회 응답.
 * dashboard 상세 테이블 전용. 페이지네이션 포함.
 */
export interface SmellAnalysisFindingsResponseDto {
  success: boolean;
  statusCode: 200;
  message: string;
  data: {
    items: Array<Omit<SmellAnalysisFinding, 'smellAnalysisJobId' | 'teamProjectId' | 'language' | 'rawFinding'>>;
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * FAILED job 저장 shape.
 * (codevi-smell-analysis-contract.md "Error Contract" 참고)
 * summary는 total: 0, bySeverity/byName: {} 로 저장한다.
 */
export interface SmellAnalysisFailedJobDto {
  jobId: number;
  status: 'FAILED';
  teamProjectId: number;
  language: LanguageType;
  analyzer: AnalyzerType;
  summary: SmellSummary;
  errorCode: SmellAnalysisErrorCode | string;
  errorMessage: string;
  requestedAt: Date | string;
  completedAt?: Date | string;
}
