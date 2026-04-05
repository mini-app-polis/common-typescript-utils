import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("emits dev-format info log", () => {
    vi.stubEnv("NODE_ENV", "development");
    const logger = createLogger("test-service");
    logger.info({ event: "test_event", category: "api" });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("test_event")
    );
  });

  it("emits JSON in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const logger = createLogger("test-service");
    logger.info({ event: "test_event", category: "api", context: { foo: "bar" } });
    const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(call);
    expect(parsed.service).toBe("test-service");
    expect(parsed.level).toBe("INFO");
    expect(parsed.event).toBe("test_event");
    expect(parsed.context).toEqual({ foo: "bar" });
  });

  it("routes error to console.error", () => {
    const logger = createLogger("test-service");
    logger.error({ event: "boom", category: "infra", error: new Error("oops") });
    expect(console.error).toHaveBeenCalled();
  });

  it("merges error into context", () => {
    vi.stubEnv("NODE_ENV", "production");
    const logger = createLogger("test-service");
    logger.error({ event: "boom", category: "infra", error: new Error("oops") });
    const call = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const parsed = JSON.parse(call);
    expect(parsed.context.error_message).toBe("oops");
  });

  it("start logs with rocket emoji in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const logger = createLogger("test-service");
    logger.start("starting up");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("🚀"));
  });

  it("success logs with check emoji in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const logger = createLogger("test-service");
    logger.success("all done");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("✅"));
  });
});
