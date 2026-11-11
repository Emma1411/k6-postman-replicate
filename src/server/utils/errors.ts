import "server-only";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "LIMIT_EXCEEDED"
  | "SSRF_BLOCKED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  LIMIT_EXCEEDED: 422,
  SSRF_BLOCKED: 403,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}