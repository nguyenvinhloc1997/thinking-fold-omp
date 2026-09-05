import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	COMMAND_USAGE,
	formatStatus,
	loadConfig,
	parseCommandArgs,
	saveConfig,
	type ThinkingFoldConfig,
} from "./config.ts";
import { endsThinkingPhase, resumesThinkingPhase } from "./events.ts";
import { hasDisplayableThinkingText } from "./fold.ts";
import { installThinkingFoldPatch, type ThinkingFoldPatchHandle } from "./renderer.ts";

const ITEM_TIMER_MS = 1000;

function isAssistantMessage(message: { role?: string }): message is AssistantMessage {
	return message.role === "assistant";
}

function hasThinking(message: AssistantMessage): boolean {
	return message.content.some((block) => block.type === "thinking" && hasDisplayableThinkingText(block.thinking));
}

function restoreTimings(ctx: ExtensionContext, patch: ThinkingFoldPatchHandle): void {
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || !isAssistantMessage(entry.message)) continue;
		const message = entry.message;
		if (!hasThinking(message)) continue;
		const completedAt = Date.parse(entry.timestamp);
		const startedAt = Number.isFinite(message.timestamp) ? message.timestamp : completedAt;
		if (!Number.isFinite(completedAt)) continue;
		patch.setMessageTiming(message.timestamp, {
			startedAt: Math.min(startedAt, completedAt),
			completedAt,
		});
	}
}

export default async function thinkingFold(pi: ExtensionAPI): Promise<void> {
	pi.setLabel("Thinking Fold");

	let config = await loadConfig();
	let patch: ThinkingFoldPatchHandle | undefined;
	let patchError: string | undefined;
	let itemTimer: ReturnType<ExtensionContext["setInterval"]> | undefined;
	let lastTimerSecond = -1;
	let thinkingStartedAt: number | undefined;
	let thinkingCompleted = false;
	let sawThinking = false;
	let currentAssistant: AssistantMessage | undefined;

	try {
		patch = installThinkingFoldPatch(config.previewLines);
		patch.setEnabled(config.enabled);
	} catch (error) {
		patchError = error instanceof Error ? error.message : String(error);
	}

	const persist = async (next: ThinkingFoldConfig, ctx: ExtensionContext): Promise<void> => {
		config = next;
		patch?.setEnabled(config.enabled);
		patch?.setPreviewLines(config.previewLines);
		try {
			await saveConfig(config);
		} catch (error) {
			ctx.ui.notify(
				`Failed to save thinking-fold settings: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	};

	pi.registerShortcut("alt+t", {
		description: "Expand or fold assistant thinking",
		handler: () => {
			if (!patch?.enabled) return;
			patch.toggle();
		},
	});

	pi.registerCommand("thinking-fold", {
		description: "Fold thinking preview: status, on/off, or preview line count",
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args);
			if (parsed.action === "error") {
				ctx.ui.notify(COMMAND_USAGE, "warning");
				return;
			}
			if (parsed.action === "status") {
				ctx.ui.notify(formatStatus(config), "info");
				return;
			}
			if (parsed.action === "enable") {
				await persist({ ...config, enabled: true }, ctx);
				ctx.ui.notify(formatStatus(config), "info");
				return;
			}
			if (parsed.action === "disable") {
				await persist({ ...config, enabled: false }, ctx);
				ctx.ui.notify(formatStatus(config), "info");
				return;
			}
			await persist({ ...config, previewLines: parsed.previewLines }, ctx);
			ctx.ui.notify(formatStatus(config), "info");
		},
	});

	const stopTimer = (ctx: ExtensionContext): void => {
		if (itemTimer) ctx.clearTimer(itemTimer);
		itemTimer = undefined;
		lastTimerSecond = -1;
	};

	const startTimer = (ctx: ExtensionContext): void => {
		if (!patch || itemTimer || ctx.mode !== "tui") return;
		itemTimer = ctx.setInterval(() => {
			if (!patch || thinkingStartedAt === undefined || thinkingCompleted) return;
			const elapsedSecond = Math.floor(Math.max(0, Date.now() - thinkingStartedAt) / 1000);
			if (elapsedSecond === lastTimerSecond) return;
			lastTimerSecond = elapsedSecond;
			patch.tick(Date.now());
		}, ITEM_TIMER_MS);
	};

	pi.on("session_start", (_event, ctx) => {
		if (patchError) {
			if (ctx.hasUI) ctx.ui.notify(`thinking-fold disabled: ${patchError}`, "warning");
			return;
		}
		if (!patch || ctx.mode !== "tui") return;
		restoreTimings(ctx, patch);
	});

	pi.on("message_start", (event, ctx) => {
		if (!isAssistantMessage(event.message) || ctx.mode !== "tui" || !patch) return;
		currentAssistant = event.message;
		sawThinking = false;
		thinkingCompleted = false;
		thinkingStartedAt = Date.now();
		lastTimerSecond = -1;
		patch.beginMessage(event.message, thinkingStartedAt);
	});

	pi.on("message_update", (event, ctx) => {
		if (!isAssistantMessage(event.message) || ctx.mode !== "tui" || !patch) return;
		currentAssistant = event.message;
		const eventType = event.assistantMessageEvent.type;
		if (hasThinking(event.message)) {
			sawThinking = true;
		}
		if (resumesThinkingPhase(eventType)) {
			sawThinking = true;
			if (thinkingCompleted) {
				thinkingCompleted = false;
				patch.resumeMessage(event.message);
			}
			startTimer(ctx);
			return;
		}
		if (hasThinking(event.message)) {
			startTimer(ctx);
		}
		if (sawThinking && !thinkingCompleted && endsThinkingPhase(eventType)) {
			patch.completeMessage(event.message, Date.now());
			thinkingCompleted = true;
			stopTimer(ctx);
		}
	});

	const clearStream = (ctx: ExtensionContext): void => {
		stopTimer(ctx);
		thinkingStartedAt = undefined;
		currentAssistant = undefined;
	};

	pi.on("message_end", (event, ctx) => {
		if (!isAssistantMessage(event.message)) return;
		if (patch && sawThinking && !thinkingCompleted) {
			patch.completeMessage(event.message);
		}
		clearStream(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (patch && currentAssistant && sawThinking && !thinkingCompleted) {
			patch.completeMessage(currentAssistant);
		}
		clearStream(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		stopTimer(ctx);
		patch?.dispose();
		patch = undefined;
	});
}
