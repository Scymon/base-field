import { normalizePath, TFile, type App } from 'obsidian';
import { IMAGE_EXTENSIONS, MODEL_EXTENSIONS } from './constants';

export function resolveVaultFile(app: App, path: string, sourcePath = ''): TFile | null {
	const cleaned = unwrapLink(path);
	if (!cleaned) return null;
	const dest = app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath);
	if (dest instanceof TFile) return dest;
	const direct = app.vault.getAbstractFileByPath(normalizePath(cleaned));
	return direct instanceof TFile ? direct : null;
}

export function vaultResourceUrl(app: App, path: string, sourcePath = ''): string | null {
	const file = resolveVaultFile(app, path, sourcePath);
	return file ? app.vault.getResourcePath(file) : null;
}

export function isImageFile(file: TFile): boolean {
	return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function isRuntimeModelPath(path: string): boolean {
	const ext = path.split('.').pop()?.toLowerCase();
	return !!ext && MODEL_EXTENSIONS.has(ext);
}

export function unwrapLink(value: string): string {
	return value
		.trim()
		.replace(/^\[\[/, '')
		.replace(/\]\]$/, '')
		.split('|')[0]
		?.trim() ?? '';
}

export async function createUniqueFile(
	app: App,
	folderPath: string,
	basename: string,
	extension: string,
	contents: string,
): Promise<TFile> {
	const folder = folderPath === '/' ? '' : folderPath;
	let index = 0;
	while (true) {
		const name = index === 0 ? `${basename}.${extension}` : `${basename} ${index}.${extension}`;
		const path = normalizePath(folder ? `${folder}/${name}` : name);
		if (!app.vault.getAbstractFileByPath(path)) {
			return app.vault.create(path, contents);
		}
		index += 1;
	}
}
