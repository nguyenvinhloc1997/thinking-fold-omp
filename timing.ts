export interface ThinkingTiming {
	startedAt: number;
	completedAt?: number;
}

export function beginTiming(startedAt: number): ThinkingTiming {
	return { startedAt };
}

export function completeTiming(timing: ThinkingTiming, completedAt: number): ThinkingTiming {
	if (timing.completedAt !== undefined) return timing;
	return { ...timing, completedAt };
}

export function resumeTiming(timing: ThinkingTiming, _now: number): ThinkingTiming {
	return { startedAt: timing.startedAt };
}

export function elapsedThinkingMs(timing: ThinkingTiming | undefined, now: number): number {
	if (!timing) return 0;
	return Math.max(0, (timing.completedAt ?? now) - timing.startedAt);
}
