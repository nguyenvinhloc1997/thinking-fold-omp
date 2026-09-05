import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig, parseCommandArgs } from "../config.ts";

describe("normalizeConfig", () => {
	test("fills defaults for empty input", () => {
		expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
	});

	test("clamps previewLines to 1..20", () => {
		expect(normalizeConfig({ previewLines: 0 }).previewLines).toBe(1);
		expect(normalizeConfig({ previewLines: 99 }).previewLines).toBe(20);
		expect(normalizeConfig({ previewLines: 8 }).previewLines).toBe(8);
	});

	test("rejects non-boolean enabled", () => {
		expect(normalizeConfig({ enabled: "yes" }).enabled).toBe(true);
		expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
	});
});

describe("parseCommandArgs", () => {
	test("empty args means status", () => {
		expect(parseCommandArgs("")).toEqual({ action: "status" });
		expect(parseCommandArgs("   ")).toEqual({ action: "status" });
	});

	test("on/off toggle the patch", () => {
		expect(parseCommandArgs("on")).toEqual({ action: "enable" });
		expect(parseCommandArgs("off")).toEqual({ action: "disable" });
	});

	test("numeric args set preview depth", () => {
		expect(parseCommandArgs("8")).toEqual({ action: "preview", previewLines: 8 });
	});

	test("rejects invalid args", () => {
		expect(parseCommandArgs("nope")).toEqual({ action: "error", message: "usage" });
		expect(parseCommandArgs("0")).toEqual({ action: "error", message: "usage" });
		expect(parseCommandArgs("21")).toEqual({ action: "error", message: "usage" });
	});
});
