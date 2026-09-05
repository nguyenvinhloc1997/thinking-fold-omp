import { describe, expect, test } from "bun:test";
import {
	FoldedThinkingSection,
	applyThinkingText,
	createMarkedThinkingMessage,
	createThinkingMarker,
	findContentChildren,
	contentShapeKey,
	findFoldedThinking,
	foldRenderedLines,
	hasDisplayableThinkingText,
	latestThinkingText,
	previewMatchesMarker,
	previewThinkingSource,
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

describe("hasDisplayableThinkingText", () => {
	test("rejects empty and whitespace without copying the string", () => {
		expect(hasDisplayableThinkingText("")).toBe(false);
		expect(hasDisplayableThinkingText(" \n\t")).toBe(false);
		expect(hasDisplayableThinkingText("ok")).toBe(true);
	});
});

describe("contentShapeKey", () => {
	test("ignores thinking body so a growing trace keeps the same shape", () => {
		expect(contentShapeKey({ timestamp: 1, content: [{ type: "thinking", thinking: "a" }] })).toBe("K");
		expect(contentShapeKey({ timestamp: 1, content: [{ type: "thinking", thinking: "ab" }] })).toBe("K");
		expect(
			contentShapeKey({
				timestamp: 1,
				content: [
					{ type: "thinking", thinking: "a" },
					{ type: "text", text: "hi" },
				],
			}),
		).toBe("KT");
	});
});

describe("findFoldedThinking", () => {
	test("returns the existing fold child", () => {
		const fold = new FoldedThinkingSection({
			content: { render: () => [] },
			labelFor: () => "x",
			previewLines: 1,
			mode: "collapse",
			marker: "@@fold:1:0@@",
		});
		expect(findFoldedThinking([{}, fold])).toBe(fold);
		expect(findFoldedThinking([])).toBeUndefined();
	});
});

describe("previewThinkingSource", () => {
	test("keeps only the last N source lines so Markdown never sees the whole trace", () => {
		expect(previewThinkingSource("a\nb\nc\nd\ne", 2)).toBe("d\ne");
	});

	test("caps a single huge line so wrap cannot explode the TUI", () => {
		const huge = "x".repeat(20_000);
		expect(previewThinkingSource(huge, 5).length).toBeLessThanOrEqual(4000);
	});
});

describe("FoldedThinkingSection markdown budget", () => {
	test("preview mode only gives Markdown the last N source lines", () => {
		let set = "";
		const content = {
			setText: (text: string) => {
				set = text;
			},
			render: () => set.split("\n"),
		};
		const section = new FoldedThinkingSection({
			content,
			labelFor: (canExpand) => (canExpand ? "Thinking 7s (alt+t to expand)" : "Thinking 7s"),
			previewLines: 2,
			mode: "preview",
		});
		section.setContentText("a\nb\nc\nd\ne");
		expect(set).toBe("d\ne");
		expect(section.render(80)).toEqual(["Thinking 7s (alt+t to expand)", "d", "e"]);
	});

	test("collapse mode does not feed Markdown the full thinking", () => {
		let set = "stale";
		const content = {
			setText: (text: string) => {
				set = text;
			},
			render: () => ["should not paint"],
		};
		const section = new FoldedThinkingSection({
			content,
			labelFor: () => "Thought for 12.3s (alt+t to expand)",
			previewLines: 2,
			mode: "collapse",
		});
		section.setContentText("a\n".repeat(5000));
		expect(set).toBe("");
		expect(section.render(80)).toEqual(["Thought for 12.3s (alt+t to expand)"]);
	});

	test("skips Markdown setText when the displayed tail did not change", () => {
		let sets = 0;
		const content = {
			setText: () => {
				sets += 1;
			},
			render: () => ["tail"],
		};
		const section = new FoldedThinkingSection({
			content,
			labelFor: () => "Thinking 1s",
			previewLines: 1,
			mode: "preview",
		});
		section.setContentText("keep\ntail");
		section.setContentText("keep\ntail");
		section.update({ labelFor: () => "Thinking 2s" });
		expect(sets).toBe(1);
	});

	test("defers loading the full trace until expand actually paints", () => {
		let set = "";
		const content = {
			setText: (text: string) => {
				set = text;
			},
			render: () => set.split("\n"),
		};
		const section = new FoldedThinkingSection({
			content,
			labelFor: () => "Thought for 1.0s",
			previewLines: 1,
			mode: "preview",
		});
		section.setContentText("hidden\nvisible");
		expect(set).toBe("visible");
		section.update({ previewLines: Number.MAX_SAFE_INTEGER, mode: "preview" });
		expect(set).toBe("visible");
		section.render(80);
		expect(set).toBe("hidden\nvisible");
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

describe("applyThinkingText", () => {
	test("puts the latest thinking on the first thinking slot", () => {
		const next = applyThinkingText(
			{
				timestamp: 1,
				content: [
					{ type: "thinking", thinking: "old" },
					{ type: "text", text: "hi" },
				],
			},
			"newest tail",
		);
		expect(next.content).toEqual([
			{ type: "thinking", thinking: "newest tail" },
			{ type: "text", text: "hi" },
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
		expect(thinking.text).toBe("");
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
		expect(thinking.text).toBe("");
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
