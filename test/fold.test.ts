import { describe, expect, test } from "bun:test";
import {
	FoldedThinkingSection,
	createMarkedThinkingMessage,
	createThinkingMarker,
	findContentChildren,
	foldRenderedLines,
	latestThinkingText,
	previewMatchesMarker,
	replaceMarkedThinkingChildren,
	stripThinkingBlocks,
} from "../fold.ts";

describe("foldRenderedLines", () => {
	test("keeps the last N terminal rows", () => {
		expect(foldRenderedLines(["a", "b", "c", "d", "e"], 2)).toEqual(["d", "e"]);
	});

	test("returns all rows when the block is shorter than the window", () => {
		expect(foldRenderedLines(["a", "b"], 5)).toEqual(["a", "b"]);
	});
});

describe("thinking markers", () => {
	test("round-trips through a short debug preview", () => {
		const marker = createThinkingMarker(1710000000000, 0);
		expect(marker.length).toBeLessThan(80);
		expect(previewMatchesMarker(marker, marker)).toBe(true);
		expect(previewMatchesMarker(`${marker} trailing`, marker)).toBe(true);
		expect(previewMatchesMarker("ordinary thinking", marker)).toBe(false);
	});
});

describe("findContentChildren", () => {
	test("uses the first Container child, matching OMP's content slot", () => {
		const inner = { children: [{ kind: "md" }] };
		const component = { children: [inner, { children: [] }] };
		expect(findContentChildren(component)).toBe(inner.children);
	});

	test("returns undefined when the content slot is missing", () => {
		expect(findContentChildren({})).toBeUndefined();
		expect(findContentChildren({ children: [] })).toBeUndefined();
	});
});

describe("FoldedThinkingSection", () => {
	test("preview mode shows label plus the last N rendered lines", () => {
		const section = new FoldedThinkingSection({
			content: { render: () => ["one", "two", "three", "four"] },
			labelFor: (canExpand) => (canExpand ? "Thinking 7s (alt+t to expand)" : "Thinking 7s"),
			previewLines: 2,
			mode: "preview",
		});
		expect(section.render(80)).toEqual([
			"Thinking 7s (alt+t to expand)",
			"three",
			"four",
		]);
	});

	test("collapse mode shows only the leftover label", () => {
		const section = new FoldedThinkingSection({
			content: { render: () => ["one", "two", "three"] },
			labelFor: () => "Thought for 12.3s (alt+t to expand)",
			previewLines: 2,
			mode: "collapse",
		});
		expect(section.render(80)).toEqual(["Thought for 12.3s (alt+t to expand)"]);
	});
});

describe("latestThinkingText", () => {
	test("keeps only the last thinking run so a later burst replaces the first", () => {
		expect(
			latestThinkingText({
				timestamp: 1,
				content: [
					{ type: "thinking", thinking: "first look" },
					{ type: "toolCall" },
					{ type: "thinking", thinking: "after the tool" },
				],
			}),
		).toBe("after the tool");
	});
});

describe("stripThinkingBlocks", () => {
	test("blanks thinking so a post-tool segment does not spawn another fold", () => {
		const stripped = stripThinkingBlocks({
			timestamp: 1,
			content: [
				{ type: "thinking", thinking: "later thoughts" },
				{ type: "text", text: "answer" },
			],
		});
		expect(stripped.content).toEqual([
			{ type: "thinking", thinking: "" },
			{ type: "text", text: "answer" },
		]);
	});
});

describe("createMarkedThinkingMessage", () => {
	test("emits one fold section whose text is the latest thinking", () => {
		const marked = createMarkedThinkingMessage(
			{
				timestamp: 1,
				content: [
					{ type: "thinking", thinking: "old" },
					{ type: "thinking", thinking: "older" },
					{ type: "text", text: "hi" },
					{ type: "thinking", thinking: "newest" },
				],
			},
			{ thinkingText: "newest" },
		);
		expect(marked?.sections).toHaveLength(1);
		expect(marked?.sections[0]?.text).toBe("newest");
		expect(marked?.message.content.filter((block) => block.type === "thinking" && block.thinking)).toHaveLength(1);
	});
});

describe("replaceMarkedThinkingChildren", () => {
	test("replaces a marked markdown child and restores the full thinking text", () => {
		const marker = createThinkingMarker(1, 0);
		const thinking = {
			debugState: () => ({ textPreview: marker }),
			setText: (text: string) => {
				thinking.text = text;
				return true;
			},
			text: marker,
			render: () => ["full", "trace", "tail"],
		};
		const children: unknown[] = [{ debugState: () => ({ textPreview: "answer" }) }, thinking];
		const replaced = replaceMarkedThinkingChildren({
			children,
			sections: [{ marker, text: "full\ntrace\ntail", showLabel: true }],
			labelFor: () => "Thought for 1.0s (alt+t to expand)",
			previewLines: 1,
			mode: "collapse",
		});
		expect(replaced).toBe(true);
		expect(thinking.text).toBe("full\ntrace\ntail");
		expect(children[1]).toBeInstanceOf(FoldedThinkingSection);
		expect((children[1] as FoldedThinkingSection).render(80)).toEqual([
			"Thought for 1.0s (alt+t to expand)",
		]);
	});

	test("updates an existing fold in place instead of requiring a new marker child", () => {
		const marker = createThinkingMarker(1, 0);
		const thinking = {
			debugState: () => ({ textPreview: "already restored" }),
			setText: (text: string) => {
				thinking.text = text;
				return true;
			},
			text: "old thinking",
			render: () => ["old thinking"],
		};
		const fold = new FoldedThinkingSection({
			content: thinking,
			labelFor: () => "Thinking 0s",
			previewLines: 1,
			mode: "preview",
			marker,
		});
		const children: unknown[] = [fold];
		const replaced = replaceMarkedThinkingChildren({
			children,
			sections: [{ marker, text: "new thinking", showLabel: true }],
			labelFor: () => "Thinking 3s (alt+t to expand)",
			previewLines: 1,
			mode: "collapse",
		});
		expect(replaced).toBe(true);
		expect(children[0]).toBe(fold);
		expect(thinking.text).toBe("new thinking");
		expect(fold.render(80)).toEqual(["Thinking 3s (alt+t to expand)"]);
	});

	test("returns false when a marker is missing so the caller can fall back", () => {
		const marker = createThinkingMarker(1, 0);
		expect(
			replaceMarkedThinkingChildren({
				children: [{ debugState: () => ({ textPreview: "nope" }) }],
				sections: [{ marker, text: "trace", showLabel: true }],
				labelFor: () => "x",
				previewLines: 5,
				mode: "preview",
			}),
		).toBe(false);
	});
});
