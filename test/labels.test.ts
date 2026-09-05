import { describe, expect, test } from "bun:test";
import {
	TOGGLE_HINT,
	createCompletedThinkingLabel,
	createStreamingThinkingLabel,
	formatStreamingThinkingSeconds,
	formatThinkingSeconds,
} from "../labels.ts";

describe("formatThinkingSeconds", () => {
	test("formats elapsed milliseconds to one decimal place", () => {
		expect(formatThinkingSeconds(12300)).toBe("12.3s");
		expect(formatThinkingSeconds(0)).toBe("0.0s");
		expect(formatThinkingSeconds(-50)).toBe("0.0s");
	});
});

describe("formatStreamingThinkingSeconds", () => {
	test("floors to whole seconds while thinking", () => {
		expect(formatStreamingThinkingSeconds(7100)).toBe("7s");
		expect(formatStreamingThinkingSeconds(999)).toBe("0s");
	});
});

describe("thinking labels", () => {
	test("streaming label includes timer and alt+t expand hint when content is folded", () => {
		expect(createStreamingThinkingLabel(7100, true)).toBe(
			`Thinking 7s (${TOGGLE_HINT} to expand)`,
		);
	});

	test("streaming label omits expand hint when nothing is hidden", () => {
		expect(createStreamingThinkingLabel(7100, false)).toBe("Thinking 7s");
	});

	test("completed leftover includes precise duration and expand hint", () => {
		expect(createCompletedThinkingLabel(12300, true)).toBe(
			`Thought for 12.3s (${TOGGLE_HINT} to expand)`,
		);
	});

	test("completed leftover omits expand hint when nothing is hidden", () => {
		expect(createCompletedThinkingLabel(12300, false)).toBe("Thought for 12.3s");
	});
});
