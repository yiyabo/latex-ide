import { describe, expect, it } from "vitest";
import { isSafeProjectPath, storageKey } from "../index";

describe("isSafeProjectPath", () => {
  it("accepts normal paths", () => {
    expect(isSafeProjectPath("main.tex")).toBe(true);
    expect(isSafeProjectPath("sections/intro.tex")).toBe(true);
    expect(isSafeProjectPath("figures/a/b.png")).toBe(true);
  });
  it("rejects traversal and absolute paths", () => {
    expect(isSafeProjectPath("../etc/passwd")).toBe(false);
    expect(isSafeProjectPath("/etc/passwd")).toBe(false);
    expect(isSafeProjectPath("a/../../b")).toBe(false);
    expect(isSafeProjectPath("")).toBe(false);
    expect(isSafeProjectPath("a\\b")).toBe(true); // backslash not special after normalize elsewhere
  });
});

describe("storageKey", () => {
  it("encodes path segments", () => {
    expect(storageKey("p1", "sections/intro.tex", "v1")).toBe(
      "projects/p1/sections/intro.tex#v1",
    );
  });
});
