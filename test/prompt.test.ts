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
    expect(prompt).toContain("Never record the full display");
    expect(prompt).toContain("A transcode, resize, or format conversion");
  });

  test("compiles custom mode with the execution contract", () => {
    const spec = defaultSpec();
    spec.mode = "custom";
    spec.name = "Custom";
    spec.customPrompt = "Test the settings screen.";
    const prompt = compilePrompt(spec);
    expect(prompt).toContain("Test the settings screen.");
    expect(prompt).toContain("If Computer Use is unavailable");
    expect(prompt).toContain("Video contract — action-only delivery");
    expect(prompt).toContain("unrelated activity must never appear");
  });

  test("normalizes missing nested values", () => {
    const spec = normalizeSpec({ name: "Partial", target: { startUrl: "https://example.com" } });
    expect(spec.video.idleMinimumSeconds).toBe(2);
    expect(spec.video.maxFinalIdleSeconds).toBe(1.5);
    expect(validateSpec(spec)).toEqual([]);
  });

  test("normalizes legacy window capture and rejects full-display recording", () => {
    const legacy = normalizeSpec({ name: "Legacy", target: { startUrl: "https://example.com" }, video: { recordTarget: "window" } });
    expect(legacy.video.recordTarget).toBe("active-window");

    const unsafe = defaultSpec();
    unsafe.name = "Unsafe capture";
    unsafe.target.startUrl = "https://example.com";
    unsafe.video.recordTarget = "display";
    expect(validateSpec(unsafe)).toContain("Video capture must target the active test window or an agent-controlled region, never the full display.");
  });

  test("reports unsafe empty custom input", () => {
    const spec = defaultSpec();
    spec.mode = "custom";
    spec.customPrompt = "";
    expect(validateSpec(spec)).toContain("Custom prompt is required in custom mode.");
  });
});
