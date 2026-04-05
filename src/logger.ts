function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LogCategory = "infra" | "pipeline" | "data" | "api";

export interface LogParams {
  event: string;
  category: LogCategory;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug: (params: LogParams) => void;
  info: (params: LogParams) => void;
  warn: (params: LogParams) => void;
  error: (params: LogParams & { error?: unknown }) => void;
  start: (event: string, context?: Record<string, unknown>) => void;
  success: (event: string, context?: Record<string, unknown>) => void;
  failure: (event: string, context?: Record<string, unknown>) => void;
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

function mergeErrorContext(
  context: Record<string, unknown> | undefined,
  error?: unknown
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = context ? { ...context } : {};
  if (error instanceof Error) {
    out.error_message = error.message;
    out.error_stack = error.stack;
  } else if (error !== undefined) {
    out.error = error;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function emojiForLevel(level: LogLevel): string {
  switch (level) {
    case "DEBUG":
      return "🔍";
    case "INFO":
      return "📋";
    case "WARN":
      return "⚠️";
    case "ERROR":
      return "❌";
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

function writeLine(level: LogLevel, line: string) {
  if (level === "ERROR") console.error(line);
  else console.log(line);
}

export function createLogger(service: string): Logger {
  function emitProd(
    level: LogLevel,
    category: LogCategory,
    event: string,
    context?: Record<string, unknown>
  ) {
    const payload: Record<string, unknown> = {
      timestamp: isoTimestamp(),
      service,
      level,
      category,
      event,
    };
    if (context && Object.keys(context).length > 0) {
      payload.context = context;
    }
    const line = JSON.stringify(payload);
    writeLine(level, line);
  }

  function emitDev(
    level: LogLevel,
    category: LogCategory,
    event: string,
    context?: Record<string, unknown>
  ) {
    const ctx =
      context && Object.keys(context).length > 0
        ? ` ${JSON.stringify(context)}`
        : "";
    const line = `${emojiForLevel(level)} [${level}] [${category}] ${event}${ctx}`;
    writeLine(level, line);
  }

  function emit(
    level: LogLevel,
    category: LogCategory,
    event: string,
    context?: Record<string, unknown>
  ) {
    if (isProd()) emitProd(level, category, event, context);
    else emitDev(level, category, event, context);
  }

  return {
    debug(params) {
      emit("DEBUG", params.category, params.event, params.context);
    },
    info(params) {
      emit("INFO", params.category, params.event, params.context);
    },
    warn(params) {
      emit("WARN", params.category, params.event, params.context);
    },
    error(params) {
      const ctx = mergeErrorContext(params.context, params.error);
      emit("ERROR", params.category, params.event, ctx);
    },
    start(event, context) {
      if (isProd()) {
        emitProd("INFO", "infra", event, context);
      } else {
        const ctx =
          context && Object.keys(context).length > 0
            ? ` ${JSON.stringify(context)}`
            : "";
        console.log(`🚀 ${event}${ctx}`);
      }
    },
    success(event, context) {
      if (isProd()) {
        emitProd("INFO", "infra", event, context);
      } else {
        const ctx =
          context && Object.keys(context).length > 0
            ? ` ${JSON.stringify(context)}`
            : "";
        console.log(`✅ ${event}${ctx}`);
      }
    },
    failure(event, context) {
      if (isProd()) {
        emitProd("ERROR", "infra", event, context);
      } else {
        const ctx =
          context && Object.keys(context).length > 0
            ? ` ${JSON.stringify(context)}`
            : "";
        console.error(`❌ ${event}${ctx}`);
      }
    },
  };
}
