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

export const PREVIEW_THINKING_MAX_CHARS = 4000;

export function previewThinkingSource(text: string, previewLines: number): string {
	if (!text) return "";
	const keep = Math.max(1, previewLines);
	let start = text.length;
	let lines = 0;
	while (start > 0 && lines < keep) {
		const prev = text.lastIndexOf("\n", start - 1);
		start = prev === -1 ? 0 : prev;
		lines += 1;
		if (prev === -1) break;
	}
	if (start > 0 && text[start] === "\n") start += 1;
	let slice = text.slice(start);
	if (slice.length > PREVIEW_THINKING_MAX_CHARS) slice = slice.slice(-PREVIEW_THINKING_MAX_CHARS);
	return slice;
}

function displayThinkingSource(text: string, mode: FoldMode, previewLines: number): string {
	if (mode === "collapse") return "";
	if (previewLines >= Number.MAX_SAFE_INTEGER) return text;
	return previewThinkingSource(text, previewLines);
}

export function hasDisplayableThinkingText(text: string | undefined): boolean {
	if (!text) return false;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code > 32) return true;
		if (code !== 9 && code !== 10 && code !== 13 && code !== 32) return true;
	}
	return false;
}

export function contentShapeKey(message: AssistantLikeMessage): string {
	let key = "";
	for (const block of message.content) {
		if (block.type === "thinking") key += "K";
		else if (block.type === "text") key += hasDisplayableThinkingText(block.text) ? "T" : "t";
		else key += block.type[0] ?? "?";
	}
	return key;
}

export function nonThinkingFingerprint(message: AssistantLikeMessage): string {
	let fingerprint = "";
	for (const block of message.content) {
		if (block.type === "thinking") continue;
		if (block.type === "text") fingerprint += `${block.text?.length ?? 0}:`;
		else fingerprint += `${block.type[0] ?? "?"}:`;
	}
	return fingerprint;
}

export function findFoldedThinking(children: unknown[]): FoldedThinkingSection | undefined {
	for (const child of children) {
		if (child instanceof FoldedThinkingSection) return child;
	}
	return undefined;
}

export function hasVisibleNonThinking(message: AssistantLikeMessage): boolean {
	return message.content.some((block) => block.type !== "thinking" && (block.type !== "text" || hasDisplayableThinkingText(block.text)));
}

export class FoldedThinkingSection implements Renderable {
	#content: Renderable;
	#labelFor: (canExpand: boolean) => string;
	#previewLines: number;
	#mode: FoldMode;
	#fullText = "";
	#displayed?: string;
	#lazyFull = false;
	readonly marker?: string;

	constructor(options: FoldedThinkingSectionOptions) {
		this.#content = options.content;
		this.#labelFor = options.labelFor;
		this.#previewLines = options.previewLines;
		this.#mode = options.mode;
		this.marker = options.marker;
	}

	update(
		options: Partial<Omit<FoldedThinkingSectionOptions, "marker">> & { text?: string },
	): void {
		let contentChanged = false;
		if (options.content) {
			this.#content = options.content;
			contentChanged = true;
		}
		if (options.labelFor) this.#labelFor = options.labelFor;
		if (options.previewLines !== undefined && options.previewLines !== this.#previewLines) {
			this.#previewLines = options.previewLines;
			contentChanged = true;
		}
		if (options.mode && options.mode !== this.#mode) {
			this.#mode = options.mode;
			contentChanged = true;
		}
		if (options.text !== undefined && options.text !== this.#fullText) {
			this.#fullText = options.text;
			contentChanged = true;
		}
		if (contentChanged) this.#syncContent();
	}

	setContentText(text: string): void {
		this.update({ text });
	}

	#syncContent(): void {
		if (this.#previewLines >= Number.MAX_SAFE_INTEGER && this.#mode === "preview") {
			this.#lazyFull = true;
			return;
		}
		this.#lazyFull = false;
		const display = displayThinkingSource(this.#fullText, this.#mode, this.#previewLines);
		if (display === this.#displayed) return;
		this.#displayed = display;
		(this.#content as DebugPreview).setText?.(display);
	}

	#materializeFull(): void {
		if (!this.#lazyFull) return;
		this.#lazyFull = false;
		if (this.#displayed === this.#fullText) return;
		this.#displayed = this.#fullText;
		(this.#content as DebugPreview).setText?.(this.#fullText);
	}

	#canExpand(renderedLength = 0): boolean {
		if (this.#fullText) {
			return displayThinkingSource(this.#fullText, this.#mode, this.#previewLines) !== this.#fullText;
		}
		return this.#mode === "collapse" || renderedLength > this.#previewLines;
	}

	render(width: number): string[] {
		this.#materializeFull();
		if (this.#mode === "collapse") return [this.#labelFor(this.#canExpand())];
		const rendered = this.#content.render(width);
		const body = foldRenderedLines(rendered, this.#previewLines);
		return [this.#labelFor(this.#canExpand(rendered.length)), ...body];
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
			child.update({
				text: section.text,
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
		const fold = new FoldedThinkingSection({
			content,
			labelFor: options.labelFor,
			previewLines: options.previewLines,
			mode: options.mode,
			marker: section.marker,
		});
		fold.setContentText(section.text);
		options.children[index] = fold;
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
	text?: string;
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
			const text = thinking.thinking ?? "";
			if (hasDisplayableThinkingText(text)) fragments.push(text);
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

export function applyThinkingText<T extends AssistantLikeMessage>(message: T, thinkingText: string): T {
	const content = message.content.map((block) =>
		block.type === "thinking" ? { ...block, thinking: "" } : { ...block },
	);
	const firstThinking = content.findIndex((block) => block.type === "thinking");
	if (firstThinking >= 0) {
		const first = content[firstThinking];
		if (first?.type === "thinking") content[firstThinking] = { ...first, thinking: thinkingText };
	}
	return { ...message, content };
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
