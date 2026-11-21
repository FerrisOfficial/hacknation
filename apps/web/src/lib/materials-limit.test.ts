import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATERIALS_LIMIT,
  DEFAULT_SCHEDULER_BATCH,
  materialsLimit,
  schedulerBatch,
} from "./materials-limit";

describe("materialsLimit", () => {
  it("z env, 0 = bez limitu, śmieci = domyślny", () => {
    expect(materialsLimit("500")).toBe(500);
    expect(materialsLimit("0")).toBe(0);
    expect(materialsLimit(undefined)).toBe(DEFAULT_MATERIALS_LIMIT);
    expect(materialsLimit("abc")).toBe(DEFAULT_MATERIALS_LIMIT);
    expect(materialsLimit("-5")).toBe(DEFAULT_MATERIALS_LIMIT);
  });
});

describe("schedulerBatch", () => {
  it("z env, co najmniej 1", () => {
    expect(schedulerBatch("3")).toBe(3);
    expect(schedulerBatch("0")).toBe(DEFAULT_SCHEDULER_BATCH);
    expect(schedulerBatch(undefined)).toBe(DEFAULT_SCHEDULER_BATCH);
  });
});
