import { TFile, type App } from 'obsidian';
import { resolveVaultFile, unwrapLink } from './vault';

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

/**
 * Obsidian's unpublished drag payload (file explorer, graph, link chips).
 * Same shape Excalidraw / Canvas read via `app.dragManager.draggable`.
 */
interface ExplorerDraggable {
	type?: 'file' | 'files' | 'link' | 'text' | string;
	file?: TFile;
	files?: TFile[];
	title?: string;
	text?: string;
	linktext?: string;
	sourcePath?: string;
}

interface AppWithDragManager extends App {
	dragManager?: { draggable?: ExplorerDraggable | null };
}

/** Accept the drop and stop workspace from opening the file in a new leaf. */
export function acceptBoardDrag(event: DragEvent): void {
	event.preventDefault();
	event.stopPropagation();
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

export function parseBoardDrop(app: App, event: DragEvent, sourcePath = ''): BoardDrop[] {
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
				const file = resolveDroppedPath(app, parsed.path, sourcePath);
				if (file) return [{ kind: 'note', path: file.path }];
			}
		} catch {
			/* fall through */
		}
	}

	return filesFromExplorer(app, dt, sourcePath).map((file) => ({
		kind: 'note' as const,
		path: file.path,
	}));
}

export function filesFromExplorer(app: App, dt: DataTransfer, sourcePath = ''): TFile[] {
	const seen = new Set<string>();
	const files: TFile[] = [];
	const add = (file: TFile | null): void => {
		if (!file || file.extension !== 'md' || seen.has(file.path)) return;
		seen.add(file.path);
		files.push(file);
	};

	const draggable = (app as AppWithDragManager).dragManager?.draggable;
	if (draggable) {
		if (draggable.file instanceof TFile) add(draggable.file);
		if (Array.isArray(draggable.files)) {
			for (const file of draggable.files) {
				if (file instanceof TFile) add(file);
			}
		}
		const linkSource = draggable.sourcePath ?? sourcePath;
		for (const token of collectLinkTokens(
			[draggable.title, draggable.text, draggable.linktext].filter(
				(value): value is string => typeof value === 'string',
			),
		)) {
			add(resolveDroppedPath(app, token, linkSource));
		}
	}

	for (const token of collectLinkTokens([
		dt.getData('text/plain'),
		dt.getData('text/uri-list'),
	])) {
		add(resolveDroppedPath(app, token, sourcePath));
	}

	return files;
}

function collectLinkTokens(chunks: string[]): string[] {
	const tokens: string[] = [];
	for (const chunk of chunks) {
		if (!chunk) continue;
		tokens.push(...extractLinkTokens(chunk));
	}
	return tokens;
}

/** Split explorer / editor drop text the way Canvas does: wiki links, md links, paths, obsidian:// URLs. */
export function extractLinkTokens(text: string): string[] {
	const tokens: string[] = [];
	const wiki = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = wiki.exec(text))) {
		if (match[1]) tokens.push(match[1].trim());
	}
	const md = /\[([^\]]*)\]\(([^)\s]+)\)/g;
	while ((match = md.exec(text))) {
		const href = match[2] ?? '';
		if (href && !/^https?:/i.test(href)) tokens.push(href);
	}
	if (tokens.length) return tokens;

	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'));
}

function resolveDroppedPath(app: App, raw: string, sourcePath = ''): TFile | null {
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
	try {
		token = decodeURIComponent(token);
	} catch {
		/* keep token */
	}
	return resolveVaultFile(app, unwrapLink(token), sourcePath);
}
