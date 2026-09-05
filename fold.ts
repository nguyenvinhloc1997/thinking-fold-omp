export type FoldMode = "preview" | "collapse";

export interface Renderable {
	render(width: number): string[];
}

export interface DebugPreview {
	debugState?: () => { textPreview?: unknown };
	setText?: (text: string) => unknown;
	render(width: number): string[];
}

export interface MarkedThinkingSection {
	marker: string;
	text: string;
	showLabel: boolean;
}

export interface FoldedThinkingSectionOptions {
	content: Renderable;
	labelFor: (canExpand: boolean) => string;
	previewLines: number;
	mode: FoldMode;
}

export class FoldedThinkingSection implements Renderable {
	readonly #content: Renderable;
	readonly #labelFor: (canExpand: boolean) => string;
	readonly #previewLines: number;
	readonly #mode: FoldMode;

	constructor(options: FoldedThinkingSectionOptions) {
		this.#content = options.content;
		this.#labelFor = options.labelFor;
		this.#previewLines = options.previewLines;
		this.#mode = options.mode;
	}

	render(width: number): string[] {
		const full = this.#content.render(width);
		const canExpand = this.#mode === "collapse" || full.length > this.#previewLines;
		const label = this.#labelFor(canExpand);
		const body = this.#mode === "collapse" ? [] : foldRenderedLines(full, this.#previewLines);
		return [label, ...body];
	}
}

export function foldRenderedLines(lines: string[], previewLines: number): string[] {
	if (lines.length <= previewLines) return lines;
	return lines.slice(-previewLines);
}

export function createThinkingMarker(timestamp: number, runIndex: number): string {
	return `@@fold:${timestamp}:${runIndex}@@`;
}

export function previewMatchesMarker(preview: string, marker: string): boolean {
	return preview === marker || preview.startsWith(marker);
}

export function findContentChildren(component: { children?: unknown }): unknown[] | undefined {
	const children = Array.isArray(component.children) ? component.children : undefined;
	const slot = children?.[0];
	if (!slot || typeof slot !== "object" || !("children" in slot) || !Array.isArray(slot.children)) {
		return undefined;
	}
	return slot.children;
}

export function replaceMarkedThinkingChildren(options: {
	children: unknown[];
	sections: MarkedThinkingSection[];
	labelFor: (canExpand: boolean) => string;
	previewLines: number;
	mode: FoldMode;
}): boolean {
	const pending = new Map(options.sections.map((section) => [section.marker, section]));
	for (let index = 0; index < options.children.length; index++) {
		const child = options.children[index];
		if (!child || typeof child !== "object") continue;
		const preview = readPreview(child);
		if (typeof preview !== "string") continue;
		const section = [...pending.values()].find((item) => previewMatchesMarker(preview, item.marker));
		if (!section) continue;
		const content = child as DebugPreview;
		content.setText?.(section.text);
		options.children[index] = new FoldedThinkingSection({
			content,
			labelFor: options.labelFor,
			previewLines: options.previewLines,
			mode: options.mode,
		});
		pending.delete(section.marker);
	}
	return pending.size === 0;
}

function readPreview(child: object): unknown {
	if (!("debugState" in child) || typeof child.debugState !== "function") return undefined;
	const state = child.debugState();
	return state && typeof state === "object" ? (state as { textPreview?: unknown }).textPreview : undefined;
}

export interface ThinkingBlock {
	type: string;
	thinking?: string;
}

export interface AssistantLikeMessage {
	timestamp: number;
	content: ThinkingBlock[];
}

export interface MarkedThinkingMessage {
	message: AssistantLikeMessage;
	sections: MarkedThinkingSection[];
}

export function createMarkedThinkingMessage(message: AssistantLikeMessage): MarkedThinkingMessage | undefined {
	const runs: { start: number; end: number; text: string }[] = [];
	let index = 0;
	while (index < message.content.length) {
		const block = message.content[index];
		if (!block || block.type !== "thinking") {
			index += 1;
			continue;
		}
		const start = index;
		const fragments: string[] = [];
		while (index < message.content.length) {
			const thinking = message.content[index];
			if (!thinking || thinking.type !== "thinking") break;
			const text = thinking.thinking?.trim() ?? "";
			if (text) fragments.push(text);
			index += 1;
		}
		runs.push({ start, end: index, text: fragments.join("\n\n") });
	}
	if (runs.length === 0) return undefined;

	const content = message.content.map((block) => ({ ...block }));
	const sections: MarkedThinkingSection[] = [];
	runs.forEach((run, runIndex) => {
		for (let i = run.start; i < run.end; i++) {
			const block = content[i];
			if (block?.type === "thinking") content[i] = { ...block, thinking: "" };
		}
		const first = content[run.start];
		if (!first || first.type !== "thinking") return;
		if (runIndex > 0 && !run.text) return;
		const marker = createThinkingMarker(message.timestamp, runIndex);
		content[run.start] = { ...first, thinking: marker };
		sections.push({ marker, text: run.text, showLabel: runIndex === 0 });
	});
	if (sections.length === 0) return undefined;
	return { message: { ...message, content }, sections };
}
