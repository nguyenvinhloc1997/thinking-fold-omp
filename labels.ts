export const TOGGLE_HINT = "alt+t";

export function formatThinkingSeconds(milliseconds: number): string {
	return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

export function formatStreamingThinkingSeconds(milliseconds: number): string {
	return `${Math.floor(Math.max(0, milliseconds) / 1000)}s`;
}

function withHint(label: string, canExpand: boolean): string {
	return canExpand ? `${label} (${TOGGLE_HINT} to expand)` : label;
}

export function createStreamingThinkingLabel(milliseconds: number, canExpand: boolean): string {
	return withHint(`Thinking ${formatStreamingThinkingSeconds(milliseconds)}`, canExpand);
}

export function createCompletedThinkingLabel(milliseconds: number, canExpand: boolean): string {
	return withHint(`Thought for ${formatThinkingSeconds(milliseconds)}`, canExpand);
}
