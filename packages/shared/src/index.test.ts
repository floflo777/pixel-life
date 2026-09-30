import { describe, expect, it } from "vitest";
import * as shared from "./index.js";

describe("@pl/shared", () => {
  it("loads", () => {
    expect(shared).toBeTypeOf("object");
  });
});
