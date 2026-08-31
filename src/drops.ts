import { TFile, type App } from 'obsidian';
import { unwrapLink } from './vault';

export const FIELD_COMPONENT_MIME = 'application/x-base-field-component';
export const FIELD_NOTE_MIME = 'application/x-base-field-note';

export interface ComponentDrop {
	kind: 'piece';
	label: string;
	model?: string | null;
}

export interface NoteDrop {
	kind: 'note';
	path: string;
}

export type BoardDrop = ComponentDrop | NoteDrop;

interface ExplorerDraggable {
	type?: string;
	file?: TFile;
	files?: TFile[];
}

interface AppWithDragManager extends App {
	dragManager?: { draggable?: ExplorerDraggable | null };
}

export function parseBoardDrop(app: App, event: DragEvent): BoardDrop[] {
	const dt = event.dataTransfer;
	if (!dt) return [];

	const componentRaw = dt.getData(FIELD_COMPONENT_MIME);
	if (componentRaw) {
		try {
			const parsed = JSON.parse(componentRaw) as Partial<ComponentDrop>;
			if (parsed && typeof parsed.label === 'string' && parsed.label.trim()) {
				return [
					{
						kind: 'piece',
						label: parsed.label.trim(),
						model: typeof parsed.model === 'string' ? parsed.model : null,
					},
				];
			}
		} catch {
			/* fall through */
		}
	}

	const noteRaw = dt.getData(FIELD_NOTE_MIME);
	if (noteRaw) {
		try {
			const parsed = JSON.parse(noteRaw) as { path?: string };
			if (parsed.path) {
				const file = resolveDroppedPath(app, parsed.path);
				if (file) return [{ kind: 'note', path: file.path }];
			}
		} catch {
			/* fall through */
		}
	}

	return filesFromExplorer(app, dt).map((file) => ({ kind: 'note', path: file.path }));
}

export function filesFromExplorer(app: App, dt: DataTransfer): TFile[] {
	const fromManager = filesFromDragManager(app);
	if (fromManager.length) return fromManager.filter((file) => file.extension === 'md');

	const seen = new Set<string>();
	const files: TFile[] = [];
	const add = (file: TFile | null): void => {
		if (!file || file.extension !== 'md' || seen.has(file.path)) return;
		seen.add(file.path);
		files.push(file);
	};

	const plain = dt.getData('text/plain') || dt.getData('text/uri-list');
	if (plain) {
		for (const token of tokenizeDropText(plain)) {
			add(resolveDroppedPath(app, token));
		}
	}

	return files;
}

function filesFromDragManager(app: App): TFile[] {
	const draggable = (app as AppWithDragManager).dragManager?.draggable;
	if (!draggable) return [];
	if (draggable.file instanceof TFile) return [draggable.file];
	if (Array.isArray(draggable.files)) {
		return draggable.files.filter((file): file is TFile => file instanceof TFile);
	}
	return [];
}

function tokenizeDropText(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'));
}

function resolveDroppedPath(app: App, raw: string): TFile | null {
	let token = raw.trim();
	if (!token) return null;
	if (token.startsWith('obsidian://')) {
		try {
			const url = new URL(token);
			token = url.searchParams.get('file') ?? token;
		} catch {
			/* keep token */
		}
	}
	const cleaned = unwrapLink(decodeURIComponent(token));
	const dest = app.metadataCache.getFirstLinkpathDest(cleaned, '');
	if (dest instanceof TFile) return dest;
	const direct = app.vault.getAbstractFileByPath(cleaned);
	return direct instanceof TFile ? direct : null;
}
