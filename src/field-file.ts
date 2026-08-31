import { DEFAULT_GROUND_SIZE, parseGroundSize } from './constants';
import type { FieldCameraState, FieldFileData, FieldInstance } from './types';

export const DEFAULT_CAMERA: FieldCameraState = {
	mode: 'perspective',
	target: [0, 0],
	distance: 18,
	azimuth: 0.55,
	elevation: 0.95,
};

export function createDefaultField(): FieldFileData {
	return {
		version: 1,
		camera: { ...DEFAULT_CAMERA, target: [0, 0] },
		groundImage: null,
		groundSize: DEFAULT_GROUND_SIZE,
		instances: [
			{
				id: newId(),
				kind: 'piece',
				label: 'Pawn',
				x: 0,
				y: 0,
			},
		],
	};
}

export function serializeField(data: FieldFileData): string {
	return `${JSON.stringify(data, null, '\t')}\n`;
}

export function parseField(raw: string): { data: FieldFileData; error?: string } {
	if (!raw.trim()) {
		return { data: createDefaultField() };
	}

	try {
		return { data: normalizeField(JSON.parse(raw) as unknown) };
	} catch {
		return { data: createDefaultField(), error: 'This .field file is not valid JSON.' };
	}
}

export function newId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `piece-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeField(input: unknown): FieldFileData {
	const obj = isRecord(input) ? input : {};
	const cameraRaw = isRecord(obj['camera']) ? obj['camera'] : {};
	const instancesRaw = Array.isArray(obj['instances']) ? obj['instances'] : [];

	const camera: FieldCameraState = {
		mode: cameraRaw['mode'] === 'ortho' ? 'ortho' : 'perspective',
		target: readPair(cameraRaw['target'], [0, 0]),
		distance: readNumber(cameraRaw['distance'], DEFAULT_CAMERA.distance),
		azimuth: readNumber(cameraRaw['azimuth'], DEFAULT_CAMERA.azimuth),
		elevation: readNumber(cameraRaw['elevation'], DEFAULT_CAMERA.elevation),
	};

	const groundImage =
		typeof obj['groundImage'] === 'string' && obj['groundImage'].trim()
			? obj['groundImage']
			: null;

	return {
		version: 1,
		camera,
		groundImage,
		groundSize: parseGroundSize(
			obj['groundSize'] === undefined ? DEFAULT_GROUND_SIZE : obj['groundSize'],
		),
		instances: instancesRaw
			.map((item) => normalizeInstance(item))
			.filter((item): item is FieldInstance => item !== null),
	};
}

function normalizeInstance(input: unknown): FieldInstance | null {
	if (!isRecord(input)) return null;
	const x = readNumber(input['x'], 0);
	const y = readNumber(input['y'], 0);
	const model = typeof input['model'] === 'string' ? input['model'] : null;
	const id = typeof input['id'] === 'string' && input['id'] ? input['id'] : newId();

	if (input['kind'] === 'note' || typeof input['path'] === 'string') {
		const path = typeof input['path'] === 'string' ? input['path'] : '';
		if (!path) return null;
		return { id, kind: 'note', path, x, y, model };
	}

	const label =
		typeof input['label'] === 'string' && input['label'].trim()
			? input['label']
			: 'Piece';
	return { id, kind: 'piece', label, x, y, model };
}

function readPair(value: unknown, fallback: [number, number]): [number, number] {
	if (!Array.isArray(value) || value.length < 2) return fallback;
	return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1])];
}

function readNumber(value: unknown, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
