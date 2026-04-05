import type { ZodIssue } from "zod";

const VERSION = "v1" as const;

export type SuccessEnvelope<T> = {
  data: T;
  meta: { version: typeof VERSION; count?: number } & Record<string, unknown>;
};

export type ErrorEnvelope = {
  error: { code: string; message: string };
};

export function success<T>(data: T, meta?: Record<string, unknown>): SuccessEnvelope<T> {
  return {
    data,
    meta: { version: VERSION, ...meta },
  };
}

export function successList<T>(
  data: T[],
  meta?: Record<string, unknown>
): SuccessEnvelope<T[]> {
  return {
    data,
    meta: { version: VERSION, count: data.length, ...meta },
  };
}

export function error(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

export const CommonErrors = {
  unauthorized(): ErrorEnvelope {
    return error("UNAUTHORIZED", "Authentication required");
  },
  forbidden(): ErrorEnvelope {
    return error("FORBIDDEN", "Admin access required");
  },
  notFound(resource?: string): ErrorEnvelope {
    return error("NOT_FOUND", resource ? `${resource} not found` : "Not found");
  },
  badRequest(message: string): ErrorEnvelope {
    return error("BAD_REQUEST", message);
  },
  internalError(message = "Internal server error"): ErrorEnvelope {
    return error("INTERNAL", message);
  },
  validationError(issues: ZodIssue[]): ErrorEnvelope {
    const message = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return error("VALIDATION_ERROR", message || "Validation failed");
  },
};
