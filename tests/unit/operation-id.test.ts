import { describe, expect, it } from "vitest";
import { createOperationId, isOperationId } from "@/lib/sync/operation-id";

describe("operation_id contract (ADR 0003)", () => {
  it("generates a valid v4 UUID", () => {
    const id = createOperationId();
    expect(isOperationId(id)).toBe(true);
  });

  it("generates unique ids across calls", () => {
    const a = createOperationId();
    const b = createOperationId();
    expect(a).not.toEqual(b);
  });

  it("rejects non-UUID strings", () => {
    expect(isOperationId("not-a-uuid")).toBe(false);
  });
});
