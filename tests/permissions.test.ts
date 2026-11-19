import { describe, expect, it } from "vitest";
import { can } from "@/server/auth/permissions";

describe("permissions", () => {
  it("viewer is read-only", () => {
    expect(can("viewer", "data:read")).toBe(true);
    expect(can("viewer", "data:write")).toBe(false);
    expect(can("viewer", "ai:use")).toBe(false);
  });
  it("member can write but not delete or manage members", () => {
    expect(can("member", "data:write")).toBe(true);
    expect(can("member", "data:delete")).toBe(false);
    expect(can("member", "members:manage")).toBe(false);
  });
  it("admin and owner manage members and read audit", () => {
    for (const r of ["admin", "owner"] as const) {
      expect(can(r, "members:manage")).toBe(true);
      expect(can(r, "audit:read")).toBe(true);
    }
  });
});
