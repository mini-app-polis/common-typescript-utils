import { describe, it, expect } from "vitest";
import { success, successList, error, CommonErrors } from "../response.js";
import type { ZodIssue } from "zod";

describe("success", () => {
  it("wraps data with version meta", () => {
    const result = success({ id: 1 });
    expect(result.data).toEqual({ id: 1 });
    expect(result.meta.version).toBe("v1");
  });

  it("merges additional meta", () => {
    const result = success({ id: 1 }, { cursor: "abc" });
    expect(result.meta.cursor).toBe("abc");
  });
});

describe("successList", () => {
  it("includes count in meta", () => {
    const result = successList([1, 2, 3]);
    expect(result.meta.count).toBe(3);
  });
});

describe("error", () => {
  it("returns error envelope", () => {
    const result = error("NOT_FOUND", "Thing not found");
    expect(result.error.code).toBe("NOT_FOUND");
    expect(result.error.message).toBe("Thing not found");
  });
});

describe("CommonErrors", () => {
  it("unauthorized", () => {
    expect(CommonErrors.unauthorized().error.code).toBe("UNAUTHORIZED");
  });

  it("forbidden", () => {
    expect(CommonErrors.forbidden().error.code).toBe("FORBIDDEN");
  });

  it("notFound with resource", () => {
    expect(CommonErrors.notFound("User").error.message).toBe("User not found");
  });

  it("notFound without resource", () => {
    expect(CommonErrors.notFound().error.message).toBe("Not found");
  });

  it("badRequest", () => {
    expect(CommonErrors.badRequest("oops").error.code).toBe("BAD_REQUEST");
  });

  it("internalError default message", () => {
    expect(CommonErrors.internalError().error.message).toBe("Internal server error");
  });

  it("validationError formats zod issues", () => {
    const issues = [
      { path: ["email"], message: "Invalid email" },
      { path: ["name"], message: "Required" },
    ] as ZodIssue[];
    const result = CommonErrors.validationError(issues);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toBe("email: Invalid email; name: Required");
  });
});
