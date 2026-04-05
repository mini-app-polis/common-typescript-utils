import { describe, it, expect } from "vitest";
import { UserRoleSchema, PaginationSchema, IdParamSchema } from "../schemas.js";

describe("UserRoleSchema", () => {
  it("accepts valid roles", () => {
    expect(UserRoleSchema.parse("user")).toBe("user");
    expect(UserRoleSchema.parse("admin")).toBe("admin");
  });

  it("rejects invalid role", () => {
    expect(() => UserRoleSchema.parse("superuser")).toThrow();
  });
});

describe("PaginationSchema", () => {
  it("applies defaults", () => {
    const result = PaginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it("coerces string numbers", () => {
    const result = PaginationSchema.parse({ page: "2", limit: "50" });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
  });

  it("rejects limit over 100", () => {
    expect(() => PaginationSchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects page less than 1", () => {
    expect(() => PaginationSchema.parse({ page: 0 })).toThrow();
  });
});

describe("IdParamSchema", () => {
  it("accepts non-empty id", () => {
    expect(IdParamSchema.parse({ id: "abc123" })).toEqual({ id: "abc123" });
  });

  it("rejects empty id", () => {
    expect(() => IdParamSchema.parse({ id: "" })).toThrow();
  });
});
