import { describe, expect, test } from "bun:test";
import { endsThinkingPhase, resumesThinkingPhase } from "../events.ts";

describe("endsThinkingPhase", () => {
	test("freezes when the model starts answering or calling a tool", () => {
		expect(endsThinkingPhase("thinking_end")).toBe(true);
		expect(endsThinkingPhase("text_start")).toBe(true);
		expect(endsThinkingPhase("text_delta")).toBe(true);
		expect(endsThinkingPhase("toolcall_start")).toBe(true);
		expect(endsThinkingPhase("toolcall_delta")).toBe(true);
	});

	test("does not freeze on thinking deltas", () => {
		expect(endsThinkingPhase("thinking_start")).toBe(false);
		expect(endsThinkingPhase("thinking_delta")).toBe(false);
		expect(endsThinkingPhase("start")).toBe(false);
	});
});

describe("resumesThinkingPhase", () => {
	test("reopens the fold when a later thinking burst starts after a tool", () => {
		expect(resumesThinkingPhase("thinking_start")).toBe(true);
		expect(resumesThinkingPhase("thinking_delta")).toBe(false);
		expect(resumesThinkingPhase("thinking_end")).toBe(false);
	});
});
