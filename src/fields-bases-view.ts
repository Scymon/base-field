import {
	BasesView,
	HoverParent,
	HoverPopover,
	Keymap,
	Notice,
	parsePropertyId,
	TFile,
	type BasesAllOptions,
	type BasesPropertyId,
	type QueryController,
} from 'obsidian';
import { ComponentsPane } from './components-pane';
import {
	BASES_VIEW_TYPE,
	DEFAULT_GROUND_SIZE,
	DEFAULT_X_PROPERTY,
	DEFAULT_Y_PROPERTY,
	GROUND_SIZE_PRESETS,
	HOVER_LINK_SOURCE,
	MAX_GROUND_SIZE,
	POSITION_DECIMALS,
	parseGroundSize,
} from './constants';
import { FIELD_NOTE_MIME, acceptBoardDrag } from './drops';
import { DEFAULT_CAMERA } from './field-file';
import { FieldRenderer } from './renderer';
import type { CameraMode, FieldCameraState, FieldPiece } from './types';
import { isImageFile, unwrapLink } from './vault';
import { notePropertyName, valueToNumber, valueToString } from './values';

export class FieldsBasesView extends BasesView implements HoverParent {
	readonly type = BASES_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private readonly hostEl: HTMLElement;
	private readonly pane: ComponentsPane;
	private renderer: FieldRenderer | null = null;
	private camera: FieldCameraState = { ...DEFAULT_CAMERA, target: [0, 0] };
	private persistNoticeShown = false;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		const shell = parentEl.createDiv({ cls: 'fields-bases-shell' });
		this.hostEl = shell.createDiv({ cls: 'fields-view fields-bases-view' });
		this.pane = new ComponentsPane(shell, {
			title: 'Base filter',
			hint: 'Drag a note onto the board',
		});
	}

	onload(): void {
		this.ensureRenderer();
		this.registerDomEvent(this.hostEl, 'dragover', this.onDragOver);
		this.registerDomEvent(this.hostEl, 'dragleave', this.onDragLeave);
		this.registerDomEvent(this.hostEl, 'drop', this.onDrop);
	}

	onunload(): void {
		this.renderer?.dispose();
		this.renderer = null;
		this.pane.destroy();
	}

	onDataUpdated(): void {
		if (!this.data) return;
		this.ensureRenderer();
		const mode = readCameraMode(this.config.get('cameraMode'));
		this.camera = { ...this.camera, mode };
		this.renderer?.setCameraMode(mode);
		const roster = this.collectRoster();
		this.pane.setItems(
			roster.map((item) => ({
				id: item.notePath,
				label: item.label,
				subtitle: item.placed ? 'On field' : 'Not placed',
				placed: item.placed,
				drop: { kind: 'note', path: item.notePath },
			})),
		);
		this.renderer?.setState({
			camera: this.camera,
			groundImagePath: readPath(this.config.get('groundImage')),
			groundSize: parseGroundSize(this.config.get('groundSize')),
			pieces: roster.filter((item) => item.placed).map((item) => item.piece),
		});
	}

	static getViewOptions(): BasesAllOptions[] {
		return [
			{
				type: 'file',
				key: 'groundImage',
				displayName: 'Ground image',
				placeholder: 'Optional map image',
				filter: (file) => isImageFile(file),
			},
			{
				type: 'dropdown',
				key: 'cameraMode',
				displayName: 'Camera',
				default: 'perspective',
				options: {
					perspective: 'Perspective',
					ortho: 'Orthographic',
				},
			},
			{
				type: 'slider',
				key: 'groundSize',
				displayName: 'Field size',
				default: DEFAULT_GROUND_SIZE,
				min: GROUND_SIZE_PRESETS.small,
				max: MAX_GROUND_SIZE,
				step: 16,
				instant: true,
			},
			{
				type: 'property',
				key: 'xProperty',
				displayName: 'X position',
				default: DEFAULT_X_PROPERTY,
				placeholder: 'note.x',
				filter: (prop) => parsePropertyId(prop).type === 'note',
			},
			{
				type: 'property',
				key: 'yProperty',
				displayName: 'Y position',
				default: DEFAULT_Y_PROPERTY,
				placeholder: 'note.y',
				filter: (prop) => parsePropertyId(prop).type === 'note',
			},
			{
				type: 'property',
				key: 'modelProperty',
				displayName: 'Model file',
				placeholder: 'Optional glTF / OBJ path',
			},
		];
	}

	private ensureRenderer(): void {
		if (this.renderer) return;
		this.renderer = new FieldRenderer(this.hostEl, this.app, {
			onPieceClick: (piece) => this.openPiece(piece),
			onPieceHover: (piece, event) => this.hoverPiece(piece, event),
			onPieceMoved: (piece, x, y) => void this.persistPiece(piece, x, y),
			onCameraChanged: (camera) => {
				this.camera = { ...camera, mode: this.camera.mode };
			},
		});
	}

	private collectRoster(): Array<{
		notePath: string;
		label: string;
		placed: boolean;
		piece: FieldPiece;
	}> {
		const xId = this.config.getAsPropertyId('xProperty') ?? (DEFAULT_X_PROPERTY as BasesPropertyId);
		const yId = this.config.getAsPropertyId('yProperty') ?? (DEFAULT_Y_PROPERTY as BasesPropertyId);
		const modelId = this.config.getAsPropertyId('modelProperty');
		const roster: Array<{
			notePath: string;
			label: string;
			placed: boolean;
			piece: FieldPiece;
		}> = [];

		for (const entry of this.data.data) {
			const x = valueToNumber(entry.getValue(xId));
			const y = valueToNumber(entry.getValue(yId));
			const placed = x !== null && y !== null;
			roster.push({
				notePath: entry.file.path,
				label: entry.file.basename,
				placed,
				piece: {
					id: entry.file.path,
					label: entry.file.basename,
					x: x ?? 0,
					y: y ?? 0,
					notePath: entry.file.path,
					modelPath: modelId
						? resolveModelPath(valueToString(entry.getValue(modelId)))
						: null,
				},
			});
		}

		return roster;
	}

	private onDragOver = (event: DragEvent): void => {
		acceptBoardDrag(event);
		this.hostEl.addClass('is-drop-target');
	};

	private onDragLeave = (event: DragEvent): void => {
		if (event.relatedTarget instanceof Node && this.hostEl.contains(event.relatedTarget)) {
			return;
		}
		this.hostEl.removeClass('is-drop-target');
	};

	private onDrop = (event: DragEvent): void => {
		acceptBoardDrag(event);
		this.hostEl.removeClass('is-drop-target');
		const raw = event.dataTransfer?.getData(FIELD_NOTE_MIME);
		if (!raw) return;
		let path = '';
		try {
			path = (JSON.parse(raw) as { path?: string }).path ?? '';
		} catch {
			return;
		}
		if (!path) return;
		// Unclamped raycast — Size is pan/play-area, not the drop box.
		const hit = this.renderer?.pickGround(event.clientX, event.clientY);
		if (!hit) return;
		const roster = this.collectRoster();
		const item = roster.find((entry) => entry.notePath === path);
		if (!item) return;
		void this.persistPiece({ ...item.piece, x: hit.x, y: hit.z }, hit.x, hit.z);
	};

	private async persistPiece(piece: FieldPiece, x: number, y: number): Promise<void> {
		if (!piece.notePath) return;
		const file = this.app.vault.getAbstractFileByPath(piece.notePath);
		if (!(file instanceof TFile)) return;

		const xId = this.config.getAsPropertyId('xProperty') ?? (DEFAULT_X_PROPERTY as BasesPropertyId);
		const yId = this.config.getAsPropertyId('yProperty') ?? (DEFAULT_Y_PROPERTY as BasesPropertyId);
		const xName = notePropertyName(xId);
		const yName = notePropertyName(yId);
		if (!xName || !yName) {
			if (!this.persistNoticeShown) {
				this.persistNoticeShown = true;
				new Notice('Fields can only write X/Y to note properties.');
			}
			return;
		}

		this.renderer?.ignoreIncoming(piece.id, 800);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[xName] = roundCoord(x);
			frontmatter[yName] = roundCoord(y);
		});
	}

	private openPiece(piece: FieldPiece): void {
		if (!piece.notePath) return;
		const event = window.event;
		const newLeaf = event instanceof MouseEvent ? Keymap.isModEvent(event) : false;
		void this.app.workspace.openLinkText(piece.notePath, '', newLeaf);
	}

	private hoverPiece(piece: FieldPiece | null, event: PointerEvent): void {
		if (!piece?.notePath || !this.renderer) return;
		this.app.workspace.trigger('hover-link', {
			event,
			source: HOVER_LINK_SOURCE,
			hoverParent: this,
			targetEl: this.renderer.canvas,
			linktext: piece.notePath,
		});
	}
}

function readCameraMode(value: unknown): CameraMode {
	return value === 'ortho' ? 'ortho' : 'perspective';
}

function readPath(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return unwrapLink(value);
	if (value instanceof TFile) return value.path;
	return null;
}

function resolveModelPath(value: string | null): string | null {
	return value ? unwrapLink(value) : null;
}

function roundCoord(value: number): number {
	const factor = 10 ** POSITION_DECIMALS;
	return Math.round(value * factor) / factor;
}
