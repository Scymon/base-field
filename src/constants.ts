export const FIELD_VIEW_TYPE = 'field';
export const BASES_VIEW_TYPE = 'fields';
export const HOVER_LINK_SOURCE = 'base-field';

export const DEFAULT_X_PROPERTY = 'note.x';
export const DEFAULT_Y_PROPERTY = 'note.y';

export const GROUND_SIZE_PRESETS = {
	small: 48,
	medium: 160,
	large: 480,
	vast: 960,
} as const;

export type GroundSizePreset = keyof typeof GROUND_SIZE_PRESETS;

export const GROUND_SIZE_ORDER: GroundSizePreset[] = ['small', 'medium', 'large', 'vast'];

export const GROUND_SIZE_LABELS: Record<GroundSizePreset, string> = {
	small: 'Small',
	medium: 'Medium',
	large: 'Large',
	vast: 'Vast',
};

/** Default board is large so the plane recedes to a horizon. */
export const DEFAULT_GROUND_SIZE = GROUND_SIZE_PRESETS.large;
export const MIN_GROUND_SIZE = 24;
export const MAX_GROUND_SIZE = 1600;

export const DRAG_THRESHOLD_PX = 5;
export const POSITION_DECIMALS = 2;

export const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'webp',
	'gif',
	'bmp',
]);

export const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj']);

export function clampGroundSize(value: number): number {
	return Math.min(MAX_GROUND_SIZE, Math.max(MIN_GROUND_SIZE, value));
}

export function nearestGroundSizePreset(size: number): GroundSizePreset {
	let best: GroundSizePreset = 'large';
	let bestDist = Infinity;
	for (const key of GROUND_SIZE_ORDER) {
		const dist = Math.abs(GROUND_SIZE_PRESETS[key] - size);
		if (dist < bestDist) {
			best = key;
			bestDist = dist;
		}
	}
	return best;
}

export function nextGroundSize(size: number): number {
	const current = nearestGroundSizePreset(size);
	const index = GROUND_SIZE_ORDER.indexOf(current);
	const next = GROUND_SIZE_ORDER[(index + 1) % GROUND_SIZE_ORDER.length] ?? 'large';
	return GROUND_SIZE_PRESETS[next];
}

export function parseGroundSize(value: unknown): number {
	if (typeof value === 'string' && value in GROUND_SIZE_PRESETS) {
		return GROUND_SIZE_PRESETS[value as GroundSizePreset];
	}
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return DEFAULT_GROUND_SIZE;
	return clampGroundSize(n);
}
