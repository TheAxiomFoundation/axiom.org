import { describe, expect, it } from "vitest";
import { opsPipelineVisible } from "./ops-pipeline-visibility";

describe("opsPipelineVisible", () => {
  it("hides the pipeline on the production site until it is made public", () => {
    expect(opsPipelineVisible({ VERCEL_ENV: "production" })).toBe(false);
    expect(opsPipelineVisible({ VERCEL_ENV: "production", OPS_PIPELINE_PUBLIC: "1" })).toBe(true);
    expect(opsPipelineVisible({ VERCEL_ENV: "production", OPS_PIPELINE_PUBLIC: "true" })).toBe(false);
  });

  it("shows it in previews and local development", () => {
    expect(opsPipelineVisible({ VERCEL_ENV: "preview" })).toBe(true);
    expect(opsPipelineVisible({})).toBe(true);
  });
});
