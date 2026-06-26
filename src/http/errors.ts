/**
 * Typed application errors. Each carries an HTTP status and a stable code so the
 * mutation gate and route handlers can translate them to responses without
 * leaking internals.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    expose = true,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Permission denied") {
    super(403, "forbidden", message);
    this.name = "ForbiddenError";
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Request body too large") {
    super(413, "payload_too_large", message);
    this.name = "PayloadTooLargeError";
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Rate limit exceeded") {
    super(429, "rate_limited", message);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = "Idempotency key reused with a different request") {
    super(409, "idempotency_conflict", message);
    this.name = "IdempotencyConflictError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request") {
    super(422, "validation_error", message);
    this.name = "ValidationError";
  }
}
