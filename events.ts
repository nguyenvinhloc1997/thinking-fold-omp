const ENDS_THINKING = new Set([
	"thinking_end",
	"text_start",
	"text_delta",
	"toolcall_start",
	"toolcall_delta",
]);

export function endsThinkingPhase(type: string): boolean {
	return ENDS_THINKING.has(type);
}
