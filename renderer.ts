import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent";
import { createCompletedThinkingLabel, createStreamingThinkingLabel } from "./labels.ts";
import {
	contentShapeKey,
	createMarkedThinkingMessage,
	nonThinkingFingerprint,
	findContentChildren,
	findFoldedThinking,
	hasDisplayableThinkingText,
	latestThinkingText,
	replaceMarkedThinkingChildren,
	stripThinkingBlocks,
	type FoldMode,
} from "./fold.ts";
import { beginTiming, completeTiming, elapsedThinkingMs, resumeTiming, type ThinkingTiming } from "./timing.ts";

interface ComponentState {
	fullMessage?: AssistantMessage;
	renderedMessage?: AssistantMessage;
	nativeHide?: boolean;
	foldShape?: string;
	nonThinking?: string;
}

interface AssistantInternals {
	hideThinkingBlock?: boolean;
}

const PATCH_SYMBOL = Symbol.for("thinking-fold-omp/assistant-message-patch");
const MARKER_PREFIX = "@@fold:";

export interface ThinkingFoldPatchHandle {
	readonly expanded: boolean;
	readonly enabled: boolean;
	setEnabled(enabled: boolean): void;
	setPreviewLines(previewLines: number): void;
	setExpanded(expanded: boolean): void;
	toggle(): void;
	setMessageTiming(timestamp: number, timing: ThinkingTiming): void;
	beginMessage(message: AssistantMessage, startedAt?: number): void;
	completeMessage(message: AssistantMessage, completedAt?: number): void;
	resumeMessage(message: AssistantMessage, now?: number): void;
	tick(now?: number): void;
	dispose(): void;
}

interface PatchRecord {
	owners: number;
	expanded: boolean;
	enabled: boolean;
	previewLines: number;
	originalUpdate: AssistantMessageComponent["updateContent"];
	states: WeakMap<AssistantMessageComponent, ComponentState>;
	components: Set<WeakRef<AssistantMessageComponent>>;
	knownComponents: WeakSet<AssistantMessageComponent>;
	timings: Map<number, ThinkingTiming>;
	latestThinking: Map<number, string>;
	primaries: Map<number, WeakRef<AssistantMessageComponent>>;
	rerenderAll(): void;
	rerenderTimestamp(timestamp: number): void;
}

function hasThinking(message: AssistantMessage): boolean {
	return message.content.some((block) => block.type === "thinking" && hasDisplayableThinkingText(block.thinking));
}

function isMarkedMessage(message: AssistantMessage): boolean {
	return message.content.some(
		(block) => block.type === "thinking" && block.thinking.startsWith(MARKER_PREFIX),
	);
}

function displayMode(timing: ThinkingTiming | undefined): FoldMode {
	return timing?.completedAt !== undefined ? "collapse" : "preview";
}

function primaryFor(
	record: PatchRecord,
	timestamp: number,
	component: AssistantMessageComponent,
): AssistantMessageComponent {
	const existing = record.primaries.get(timestamp)?.deref();
	if (existing) return existing;
	record.primaries.set(timestamp, new WeakRef(component));
	return component;
}

function restoreNativeHide(component: AssistantMessageComponent, state: ComponentState): void {
	if (state.nativeHide === undefined) return;
	(component as unknown as AssistantInternals).hideThinkingBlock = state.nativeHide;
}

function rebuild(
	component: AssistantMessageComponent,
	state: ComponentState,
	record: PatchRecord,
	opts?: { transient?: boolean },
): void {
	const message = state.fullMessage;
	if (!message) return;

	const internals = component as unknown as AssistantInternals;
	if (state.nativeHide === undefined) {
		state.nativeHide = internals.hideThinkingBlock === true;
	}

	const thinkingText = record.latestThinking.get(message.timestamp) ?? latestThinkingText(message);
	if (!record.enabled || !thinkingText) {
		restoreNativeHide(component, state);
		state.renderedMessage = message;
		state.foldShape = undefined;
		record.originalUpdate.call(component, message, opts);
		return;
	}

	const primary = primaryFor(record, message.timestamp, component);
	if (primary !== component) {
		const shape = contentShapeKey(message);
		const fingerprint = nonThinkingFingerprint(message);
		if (state.foldShape !== shape || state.nonThinking !== fingerprint) {
			restoreNativeHide(component, state);
			const stripped = stripThinkingBlocks(message);
			state.renderedMessage = stripped as AssistantMessage;
			state.foldShape = shape;
			state.nonThinking = fingerprint;
			record.originalUpdate.call(component, stripped as AssistantMessage, opts);
		}
		const primaryState = record.states.get(primary);
		if (primaryState) rebuild(primary, primaryState, record);
		return;
	}

	if (!record.timings.has(message.timestamp)) {
		record.timings.set(message.timestamp, beginTiming(Date.now()));
	}

	const children = findContentChildren(component);
	const existing = children ? findFoldedThinking(children) : undefined;
	const shape = contentShapeKey(message);
	if (existing && state.foldShape === shape) {
		updateFold(existing, record, message.timestamp, thinkingText);
		return;
	}

	const marked = createMarkedThinkingMessage(message, { thinkingText });
	if (!marked) {
		restoreNativeHide(component, state);
		state.renderedMessage = message;
		record.originalUpdate.call(component, message, opts);
		return;
	}

	// Stay off while the fold is live so OMP's shape key does not flip every token.
	internals.hideThinkingBlock = false;
	state.renderedMessage = marked.message as AssistantMessage;
	state.foldShape = shape;
	record.originalUpdate.call(component, marked.message as AssistantMessage, opts);

	const nextChildren = findContentChildren(component);
	if (!nextChildren) return;
	replaceMarkedThinkingChildren({
		children: nextChildren,
		sections: marked.sections,
		previewLines: record.expanded ? Number.MAX_SAFE_INTEGER : record.previewLines,
		mode: record.expanded ? "preview" : displayMode(record.timings.get(message.timestamp)),
		labelFor: foldLabel(record, message.timestamp),
	});
}

function foldLabel(record: PatchRecord, timestamp: number): (canExpand: boolean) => string {
	const timing = record.timings.get(timestamp);
	const elapsed = elapsedThinkingMs(timing, Date.now());
	const completed = timing?.completedAt !== undefined;
	return (canExpand) =>
		completed
			? createCompletedThinkingLabel(elapsed, canExpand)
			: createStreamingThinkingLabel(elapsed, canExpand);
}

function updateFold(
	fold: NonNullable<ReturnType<typeof findFoldedThinking>>,
	record: PatchRecord,
	timestamp: number,
	thinkingText: string,
): void {
	fold.update({
		text: thinkingText,
		previewLines: record.expanded ? Number.MAX_SAFE_INTEGER : record.previewLines,
		mode: record.expanded ? "preview" : displayMode(record.timings.get(timestamp)),
		labelFor: foldLabel(record, timestamp),
	});
}

function forEachLive(
	record: PatchRecord,
	callback: (component: AssistantMessageComponent, state: ComponentState) => void,
): void {
	for (const reference of record.components) {
		const component = reference.deref();
		if (!component) {
			record.components.delete(reference);
			continue;
		}
		const state = record.states.get(component);
		if (state) callback(component, state);
	}
}

function getPatchRecord(): PatchRecord | undefined {
	return (AssistantMessageComponent.prototype as unknown as Record<PropertyKey, unknown>)[PATCH_SYMBOL] as
		| PatchRecord
		| undefined;
}

function setPatchRecord(record: PatchRecord | undefined): void {
	const prototype = AssistantMessageComponent.prototype as unknown as Record<PropertyKey, unknown>;
	if (record) prototype[PATCH_SYMBOL] = record;
	else delete prototype[PATCH_SYMBOL];
}

function createPatchRecord(previewLines: number): PatchRecord {
	const prototype = AssistantMessageComponent.prototype;
	const originalUpdate = prototype.updateContent;
	const record: PatchRecord = {
		owners: 0,
		expanded: false,
		enabled: true,
		previewLines,
		originalUpdate,
		states: new WeakMap(),
		components: new Set(),
		knownComponents: new WeakSet(),
		timings: new Map(),
		latestThinking: new Map(),
		primaries: new Map(),
		rerenderAll() {
			forEachLive(this, (component, state) => rebuild(component, state, this));
		},
		rerenderTimestamp(timestamp) {
			forEachLive(this, (component, state) => {
				if (state.fullMessage?.timestamp === timestamp) rebuild(component, state, this);
			});
		},
	};

	prototype.updateContent = function (
		this: AssistantMessageComponent,
		message: AssistantMessage,
		opts?: { transient?: boolean },
	) {
		const state = record.states.get(this) ?? {};
		if (message !== state.renderedMessage && !isMarkedMessage(message)) {
			state.fullMessage = message;
			if (hasThinking(message)) {
				const text = latestThinkingText(message);
				if (text) record.latestThinking.set(message.timestamp, text);
				if (!record.timings.has(message.timestamp)) {
					record.timings.set(message.timestamp, beginTiming(Date.now()));
				}
			}
		}
		record.states.set(this, state);
		if (!record.knownComponents.has(this)) {
			record.knownComponents.add(this);
			record.components.add(new WeakRef(this));
		}
		rebuild(this, state, record, opts);
	};

	setPatchRecord(record);
	return record;
}

export function installThinkingFoldPatch(previewLines: number): ThinkingFoldPatchHandle {
	const prototype = AssistantMessageComponent.prototype;
	if (typeof prototype.updateContent !== "function" || typeof prototype.render !== "function") {
		throw new Error("AssistantMessageComponent rendering API is unavailable");
	}

	const record = getPatchRecord() ?? createPatchRecord(previewLines);
	record.owners += 1;
	record.previewLines = previewLines;
	record.rerenderAll();
	let disposed = false;

	return {
		get expanded() {
			return record.expanded;
		},
		get enabled() {
			return record.enabled;
		},
		setEnabled(enabled) {
			if (record.enabled === enabled) return;
			record.enabled = enabled;
			record.rerenderAll();
		},
		setPreviewLines(next) {
			if (record.previewLines === next) return;
			record.previewLines = next;
			record.rerenderAll();
		},
		setExpanded(expanded) {
			if (record.expanded === expanded) return;
			record.expanded = expanded;
			record.rerenderAll();
		},
		toggle() {
			record.expanded = !record.expanded;
			record.rerenderAll();
		},
		setMessageTiming(timestamp, timing) {
			record.timings.set(timestamp, { ...timing });
		},
		beginMessage(message, startedAt = Date.now()) {
			if (!record.timings.has(message.timestamp)) {
				record.timings.set(message.timestamp, beginTiming(startedAt));
			}
			record.rerenderTimestamp(message.timestamp);
		},
		completeMessage(message, completedAt = Date.now()) {
			const timing = record.timings.get(message.timestamp) ?? beginTiming(Math.min(message.timestamp, completedAt));
			record.timings.set(message.timestamp, completeTiming(timing, completedAt));
			record.rerenderTimestamp(message.timestamp);
		},
		resumeMessage(message, now = Date.now()) {
			const timing = record.timings.get(message.timestamp) ?? beginTiming(now);
			record.timings.set(message.timestamp, resumeTiming(timing, now));
			record.rerenderTimestamp(message.timestamp);
		},
		tick(_now = Date.now()) {
			for (const [timestamp, timing] of record.timings) {
				if (timing.completedAt !== undefined) continue;
				const primary = record.primaries.get(timestamp)?.deref();
				if (!primary) continue;
				const state = record.states.get(primary);
				if (state) rebuild(primary, state, record);
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			record.owners -= 1;
			if (record.owners > 0 || getPatchRecord() !== record) return;
			forEachLive(record, restoreNativeHide);
			prototype.updateContent = record.originalUpdate;
			setPatchRecord(undefined);
		},
	};
}
