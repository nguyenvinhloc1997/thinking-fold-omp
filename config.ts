import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { TOGGLE_HINT } from "./labels.ts";

export interface ThinkingFoldConfig {
	previewLines: number;
	enabled: boolean;
}

export const DEFAULT_CONFIG: ThinkingFoldConfig = {
	previewLines: 5,
	enabled: true,
};

export const MIN_PREVIEW_LINES = 1;
export const MAX_PREVIEW_LINES = 20;

export type CommandAction =
	| { action: "status" }
	| { action: "enable" }
	| { action: "disable" }
	| { action: "preview"; previewLines: number }
	| { action: "error"; message: "usage" };

export function clampPreviewLines(value: number): number {
	if (!Number.isInteger(value)) return DEFAULT_CONFIG.previewLines;
	return Math.min(MAX_PREVIEW_LINES, Math.max(MIN_PREVIEW_LINES, value));
}

export function normalizeConfig(input: unknown): ThinkingFoldConfig {
	const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const previewLines =
		typeof raw.previewLines === "number" ? clampPreviewLines(raw.previewLines) : DEFAULT_CONFIG.previewLines;
	return {
		previewLines,
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
	};
}

export function parseCommandArgs(args: string): CommandAction {
	const token = args.trim().toLowerCase();
	if (token === "") return { action: "status" };
	if (token === "on") return { action: "enable" };
	if (token === "off") return { action: "disable" };
	if (/^\d+$/.test(token)) {
		const previewLines = Number(token);
		if (previewLines < MIN_PREVIEW_LINES || previewLines > MAX_PREVIEW_LINES) {
			return { action: "error", message: "usage" };
		}
		return { action: "preview", previewLines };
	}
	return { action: "error", message: "usage" };
}

export function getConfigPath(): string {
	return join(homedir(), ".omp", "agent", "thinking-fold.json");
}

export async function loadConfig(): Promise<ThinkingFoldConfig> {
	try {
		const text = await readFile(getConfigPath(), "utf8");
		return normalizeConfig(JSON.parse(text));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export async function saveConfig(config: ThinkingFoldConfig): Promise<void> {
	const path = getConfigPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf8");
}

export function formatStatus(config: ThinkingFoldConfig): string {
	const state = config.enabled ? "on" : "off";
	return `thinking-fold ${state}, preview ${config.previewLines} lines, expand with ${TOGGLE_HINT}`;
}

export const COMMAND_USAGE = "/thinking-fold [on|off|<1-20>]";
