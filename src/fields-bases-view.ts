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
import { DEFAULT_CAMERA } from './field-file';
import { FieldRenderer } from './renderer';
import type { CameraMode, FieldCameraState, FieldPiece } from './types';
import { isImageFile, unwrapLink } from './vault';
import { notePropertyName, valueToNumber, valueToString } from './values';

export class FieldsBasesView extends BasesView implements HoverParent {
	readonly type = BASES_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private readonly hostEl: HTMLElement;
	private renderer: FieldRenderer | null = null;
	private camera: FieldCameraState = { ...DEFAULT_CAMERA, target: [0, 0] };
	private persistNoticeShown = false;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.hostEl = parentEl.createDiv({ cls: 'fields-view fields-bases-view' });
	}

	onload(): void {
		this.ensureRenderer();
	}

	onunload(): void {
		this.renderer?.dispose();
		this.renderer = null;
	}

	onDataUpdated(): void {
		if (!this.data) return;
		this.ensureRenderer();
		const mode = readCameraMode(this.config.get('cameraMode'));
		this.camera = { ...this.camera, mode };
		this.renderer?.setCameraMode(mode);
		this.renderer?.setState({
			camera: this.camera,
			groundImagePath: readPath(this.config.get('groundImage')),
			groundSize: parseGroundSize(this.config.get('groundSize')),
			pieces: this.collectPieces(),
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

	private collectPieces(): FieldPiece[] {
		const xId = this.config.getAsPropertyId('xProperty') ?? (DEFAULT_X_PROPERTY as BasesPropertyId);
		const yId = this.config.getAsPropertyId('yProperty') ?? (DEFAULT_Y_PROPERTY as BasesPropertyId);
		const modelId = this.config.getAsPropertyId('modelProperty');
		const pieces: FieldPiece[] = [];
		let unsetIndex = 0;

		for (const entry of this.data.data) {
			const x = valueToNumber(entry.getValue(xId));
			const y = valueToNumber(entry.getValue(yId));
			let boardX = x;
			let boardY = y;
			if (boardX === null || boardY === null) {
				const slot = autoSlot(unsetIndex);
				unsetIndex += 1;
				boardX = x ?? slot.x;
				boardY = y ?? slot.y;
			}
			pieces.push({
				id: entry.file.path,
				label: entry.file.basename,
				x: boardX,
				y: boardY,
				notePath: entry.file.path,
				modelPath: modelId
					? resolveModelPath(valueToString(entry.getValue(modelId)))
					: null,
			});
		}

		return pieces;
	}

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

function autoSlot(index: number): { x: number; y: number } {
	return {
		x: (index % 8) * 1.6 - 5.6,
		y: Math.floor(index / 8) * 1.6 - 2.4,
	};
}

function roundCoord(value: number): number {
	const factor = 10 ** POSITION_DECIMALS;
	return Math.round(value * factor) / factor;
}
