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
	marker?: string;
}

export class FoldedThinkingSection implements Renderable {
	#content: Renderable;
	#labelFor: (canExpand: boolean) => string;
	#previewLines: number;
	#mode: FoldMode;
	readonly marker?: string;

	constructor(options: FoldedThinkingSectionOptions) {
		this.#content = options.content;
		this.#labelFor = options.labelFor;
		this.#previewLines = options.previewLines;
		this.#mode = options.mode;
		this.marker = options.marker;
	}

	update(options: Partial<Omit<FoldedThinkingSectionOptions, "marker">>): void {
		if (options.content) this.#content = options.content;
		if (options.labelFor) this.#labelFor = options.labelFor;
		if (options.previewLines !== undefined) this.#previewLines = options.previewLines;
		if (options.mode) this.#mode = options.mode;
	}

	setContentText(text: string): void {
		const content = this.#content as DebugPreview;
		content.setText?.(text);
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

		if (child instanceof FoldedThinkingSection && child.marker && pending.has(child.marker)) {
			const section = pending.get(child.marker);
			if (!section) continue;
			child.setContentText(section.text);
			child.update({
				labelFor: options.labelFor,
				previewLines: options.previewLines,
				mode: options.mode,
			});
			pending.delete(section.marker);
			continue;
		}

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
			marker: section.marker,
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

function thinkingRuns(message: AssistantLikeMessage): { start: number; end: number; text: string }[] {
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
	return runs;
}

export function latestThinkingText(message: AssistantLikeMessage): string {
	const runs = thinkingRuns(message);
	for (let index = runs.length - 1; index >= 0; index--) {
		const text = runs[index]?.text;
		if (text) return text;
	}
	return "";
}

export function stripThinkingBlocks<T extends AssistantLikeMessage>(message: T): T {
	return {
		...message,
		content: message.content.map((block) => (block.type === "thinking" ? { ...block, thinking: "" } : { ...block })),
	};
}

export function createMarkedThinkingMessage(
	message: AssistantLikeMessage,
	options?: { thinkingText?: string },
): MarkedThinkingMessage | undefined {
	const text = options?.thinkingText ?? latestThinkingText(message);
	if (!text) return undefined;

	const content = message.content.map((block) => ({ ...block }));
	const firstThinking = content.findIndex((block) => block.type === "thinking");
	if (firstThinking < 0) return undefined;

	for (let index = 0; index < content.length; index++) {
		const block = content[index];
		if (block?.type === "thinking") content[index] = { ...block, thinking: "" };
	}

	const first = content[firstThinking];
	if (!first || first.type !== "thinking") return undefined;
	const marker = createThinkingMarker(message.timestamp, 0);
	content[firstThinking] = { ...first, thinking: marker };
	return {
		message: { ...message, content },
		sections: [{ marker, text, showLabel: true }],
	};
}
