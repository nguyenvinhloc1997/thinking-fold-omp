import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent";
import { createCompletedThinkingLabel, createStreamingThinkingLabel } from "./labels.ts";
import {
	createMarkedThinkingMessage,
	findContentChildren,
	replaceMarkedThinkingChildren,
	type FoldMode,
} from "./fold.ts";

export interface ThinkingTiming {
	startedAt: number;
	completedAt?: number;
}

interface ComponentState {
	fullMessage?: AssistantMessage;
	renderedMessage?: AssistantMessage;
}

interface AssistantInternals {
	hideThinkingBlock?: boolean;
}

const PATCH_SYMBOL = Symbol.for("thinking-fold-omp/assistant-message-patch");

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
	tick(now?: number): void;
	dispose(): void;
}

interface PatchRecord {
	owners: number;
	expanded: boolean;
	enabled: boolean;
	previewLines: number;
	now: number;
	originalUpdate: AssistantMessageComponent["updateContent"];
	states: WeakMap<AssistantMessageComponent, ComponentState>;
	components: Set<WeakRef<AssistantMessageComponent>>;
	knownComponents: WeakSet<AssistantMessageComponent>;
	timings: Map<number, ThinkingTiming>;
	rerenderAll(): void;
	rerenderTimestamp(timestamp: number): void;
}

function hasThinking(message: AssistantMessage): boolean {
	return message.content.some((block) => block.type === "thinking" && block.thinking.trim());
}

function displayMode(timing: ThinkingTiming | undefined): FoldMode {
	return timing?.completedAt !== undefined ? "collapse" : "preview";
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
	const nativeHidden = internals.hideThinkingBlock;
	try {
		if (!record.enabled || record.expanded || !hasThinking(message)) {
			state.renderedMessage = message;
			record.originalUpdate.call(component, message, opts);
			return;
		}

		const marked = createMarkedThinkingMessage(message);
		if (!marked) {
			state.renderedMessage = message;
			record.originalUpdate.call(component, message, opts);
			return;
		}

		internals.hideThinkingBlock = false;
		state.renderedMessage = marked.message as AssistantMessage;
		record.originalUpdate.call(component, marked.message as AssistantMessage, opts);

		const children = findContentChildren(component);
		const timing = record.timings.get(message.timestamp);
		const elapsed = (timing?.completedAt ?? record.now) - (timing?.startedAt ?? record.now);
		const completed = timing?.completedAt !== undefined;
		const replaced =
			children !== undefined &&
			replaceMarkedThinkingChildren({
				children,
				sections: marked.sections,
				previewLines: record.previewLines,
				mode: displayMode(timing),
				labelFor: (canExpand) =>
					completed
						? createCompletedThinkingLabel(elapsed, canExpand)
						: createStreamingThinkingLabel(elapsed, canExpand),
			});

		if (!replaced) {
			state.renderedMessage = message;
			record.originalUpdate.call(component, message, opts);
		}
	} finally {
		internals.hideThinkingBlock = nativeHidden;
	}
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
		now: Date.now(),
		originalUpdate,
		states: new WeakMap(),
		components: new Set(),
		knownComponents: new WeakSet(),
		timings: new Map(),
		rerenderAll() {
			forEachLive(this, (component, state) => rebuild(component, state, this));
		},
		rerenderTimestamp(timestamp) {
			forEachLive(this, (component, state) => {
				if (state.fullMessage?.timestamp === timestamp) rebuild(component, state, this);
			});
		},
	};

	prototype.updateContent = function (this: AssistantMessageComponent, message: AssistantMessage, opts?: { transient?: boolean }) {
		const state = record.states.get(this) ?? {};
		if (message !== state.renderedMessage) state.fullMessage = message;
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
			record.rerenderTimestamp(timestamp);
		},
		beginMessage(message, startedAt = Date.now()) {
			record.timings.set(message.timestamp, { startedAt });
			record.now = startedAt;
			record.rerenderTimestamp(message.timestamp);
		},
		completeMessage(message, completedAt = Date.now()) {
			const timing = record.timings.get(message.timestamp) ?? {
				startedAt: Math.min(message.timestamp, completedAt),
			};
			if (timing.completedAt !== undefined) return;
			record.timings.set(message.timestamp, { ...timing, completedAt });
			record.now = completedAt;
			record.rerenderTimestamp(message.timestamp);
		},
		tick(now = Date.now()) {
			record.now = now;
			forEachLive(record, (component, state) => {
				const timestamp = state.fullMessage?.timestamp;
				if (timestamp === undefined || record.timings.get(timestamp)?.completedAt !== undefined) return;
				rebuild(component, state, record);
			});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			record.owners -= 1;
			if (record.owners > 0 || getPatchRecord() !== record) return;
			prototype.updateContent = record.originalUpdate;
			setPatchRecord(undefined);
		},
	};
}
