import { describe, expect, test } from "bun:test";
import { compilePrompt, defaultSpec, normalizeSpec, validateSpec } from "../shared/prompt.js";

describe("prompt compiler", () => {
  test("compiles a guided Computer Use contract", () => {
    const spec = defaultSpec();
    spec.name = "Signup run";
    spec.target.name = "Example app";
    spec.testing.include = ["Create an account", "Verify email"];
    const prompt = compilePrompt(spec);
    expect(prompt).toContain("Computer Use test session: Signup run");
    expect(prompt).toContain("- Create an account");
    expect(prompt).toContain("action timestamps plus freeze/motion detection");
  });

  test("compiles custom mode with the execution contract", () => {
    const spec = defaultSpec();
    spec.mode = "custom";
    spec.name = "Custom";
    spec.customPrompt = "Test the settings screen.";
    expect(compilePrompt(spec)).toContain("Test the settings screen.");
    expect(compilePrompt(spec)).toContain("If Computer Use is unavailable");
  });

  test("normalizes missing nested values", () => {
    const spec = normalizeSpec({ name: "Partial", target: { startUrl: "https://example.com" } });
    expect(spec.video.idleMinimumSeconds).toBe(3);
    expect(validateSpec(spec)).toEqual([]);
  });

  test("reports unsafe empty custom input", () => {
    const spec = defaultSpec();
    spec.mode = "custom";
    spec.customPrompt = "";
    expect(validateSpec(spec)).toContain("Custom prompt is required in custom mode.");
  });
});
