import { parsePropertyId, type BasesPropertyId, type Value } from 'obsidian';

export function valueToNumber(value: Value | null): number | null {
	if (!value || !value.isTruthy()) return null;
	const n = Number(value.toString());
	return Number.isFinite(n) ? n : null;
}

export function valueToString(value: Value | null): string | null {
	if (!value || !value.isTruthy()) return null;
	const text = value.toString().trim();
	return text ? text : null;
}

export function notePropertyName(propertyId: BasesPropertyId): string | null {
	const parsed = parsePropertyId(propertyId);
	return parsed.type === 'note' ? parsed.name : null;
}
