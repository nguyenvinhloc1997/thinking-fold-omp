import { describe, expect, test } from "bun:test";
import { beginTiming, completeTiming, elapsedThinkingMs, resumeTiming } from "../timing.ts";

describe("elapsedThinkingMs", () => {
	test("uses the wall clock while streaming so the label is not stuck at 0s", () => {
		const timing = beginTiming(1_000);
		expect(elapsedThinkingMs(timing, 8_400)).toBe(7_400);
	});

	test("returns 0 only when no timing exists yet", () => {
		expect(elapsedThinkingMs(undefined, 8_400)).toBe(0);
	});

	test("freezes at completedAt after the thinking burst ends", () => {
		const timing = completeTiming(beginTiming(1_000), 3_250);
		expect(elapsedThinkingMs(timing, 9_000)).toBe(2_250);
	});
});

describe("resumeTiming", () => {
	test("clears completedAt so a later thinking burst can stream again", () => {
		const paused = completeTiming(beginTiming(1_000), 2_000);
		const resumed = resumeTiming(paused, 5_000);
		expect(resumed.completedAt).toBeUndefined();
		expect(resumed.startedAt).toBe(1_000);
		expect(elapsedThinkingMs(resumed, 6_500)).toBe(5_500);
	});
});
