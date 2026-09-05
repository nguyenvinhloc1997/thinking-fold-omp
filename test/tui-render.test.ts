import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/assistant-message";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { splitAssistantMessageToolTimeline } from "@oh-my-pi/pi-coding-agent/modes/utils/transcript-render-helpers";
import { installThinkingFoldPatch, type ThinkingFoldPatchHandle } from "../renderer.ts";

const WIDTH = 80;

function assistant(content: AssistantMessage["content"], timestamp = 10): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "ollama",
		model: "qwen",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function lines(component: AssistantMessageComponent): string[] {
	return Bun.stripANSI(component.render(WIDTH).join("\n"))
		.split("\n")
		.map((line) => line.trimEnd());
}

function thinkingCount(text: string): number {
	return (text.match(/Thinking \d+s/g) ?? []).length;
}

beforeAll(async () => {
	await initTheme(false);
});

beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
});

describe("headless AssistantMessageComponent fold", () => {
	let patch: ThinkingFoldPatchHandle;
	let now = 1_000;

	beforeEach(() => {
		now = 1_000;
		const originalNow = Date.now;
		Date.now = () => now;
		patch = installThinkingFoldPatch(2);
		(patch as unknown as { restoreNow?: () => void }).restoreNow = () => {
			Date.now = originalNow;
		};
	});

	afterEach(() => {
		patch.dispose();
		(patch as unknown as { restoreNow?: () => void }).restoreNow?.();
	});

	test("streams a live tail with a wall-clock timer, then leaves one leftover", () => {
		const message = assistant([{ type: "thinking", thinking: "line one\nline two\nline three\nline four" }]);
		patch.beginMessage(message, 1_000);

		const component = new AssistantMessageComponent(undefined, true);
		component.updateContent(message, { transient: true });
		now = 8_400;
		patch.tick(now);
		const streaming = lines(component).join("\n");
		expect(streaming).toContain("Thinking 7s");
		expect(streaming).toContain("line three");
		expect(streaming).toContain("line four");
		expect(streaming).not.toContain("line one");
		expect(thinkingCount(streaming)).toBe(1);

		patch.completeMessage(message, 13_250);
		const leftover = lines(component).join("\n");
		expect(leftover).toContain("Thought for 12.3s");
		expect(leftover).not.toContain("line four");
		expect(thinkingCount(leftover)).toBe(0);
		component.dispose();
	});

	test("reuses one component across thinking deltas without dumping the full trace", () => {
		const component = new AssistantMessageComponent(undefined, true);
		patch.beginMessage(assistant([], 10), 1_000);
		const steps = ["a", "ab", "abc\nmore\ntail one\ntail two"];
		for (const thinking of steps) {
			component.updateContent(assistant([{ type: "thinking", thinking }], 10), { transient: true });
		}
		now = 4_000;
		patch.tick(now);
		const rendered = lines(component);
		const text = rendered.join("\n");
		expect(thinkingCount(text)).toBe(1);
		expect(text).toContain("Thinking 3s");
		expect(text).not.toContain("abc");
		expect(rendered.filter((line) => line.includes("tail")).length).toBeLessThanOrEqual(2);
		component.dispose();
	});

	test("keeps one leftover on the leading block after a tool; later thinking replaces it", () => {
		const leading = new AssistantMessageComponent(undefined, true);
		const first = assistant([{ type: "thinking", thinking: "first look\nmore\ntail" }], 10);
		patch.beginMessage(first, 1_000);
		leading.updateContent(first, { transient: true });

		const full = assistant(
			[
				{ type: "thinking", thinking: "first look\nmore\ntail" },
				{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
				{ type: "thinking", thinking: "after the tool\nnewest tail" },
				{ type: "text", text: "done" },
			],
			10,
		);
		const { beforeTools, afterToolCalls } = splitAssistantMessageToolTimeline(full);
		leading.updateContent(beforeTools);
		patch.completeMessage(full, 4_000);

		const after = new AssistantMessageComponent(undefined, true);
		after.updateContent([...afterToolCalls.values()][0]!);

		const leftover = lines(leading).join("\n");
		const tail = lines(after).join("\n");
		expect(leftover).toContain("Thought for");
		expect(thinkingCount(leftover)).toBe(0);
		expect(leftover).not.toContain("first look");
		expect(tail).not.toContain("Thinking");
		expect(tail).not.toContain("Thought for");
		expect(tail).toContain("done");

		patch.setExpanded(true);
		const expanded = lines(leading).join("\n");
		expect(expanded).toContain("newest tail");
		expect(expanded).not.toContain("first look");

		leading.dispose();
		after.dispose();
	});
});
