import {
	FuzzySuggestModal,
	HoverParent,
	HoverPopover,
	Keymap,
	Menu,
	Notice,
	TextFileView,
	TFile,
	type WorkspaceLeaf,
} from 'obsidian';
import { ComponentsPane } from './components-pane';
import {
	FIELD_VIEW_TYPE,
	GROUND_SIZE_LABELS,
	HOVER_LINK_SOURCE,
	POSITION_DECIMALS,
	nearestGroundSizePreset,
	nextGroundSize,
} from './constants';
import { acceptBoardDrag, parseBoardDrop } from './drops';
import {
	createDefaultField,
	newId,
	parseField,
	serializeField,
} from './field-file';
import { FieldRenderer } from './renderer';
import { TextPromptModal } from './text-prompt-modal';
import type { CameraMode, FieldFileData, FieldInstance, FieldPiece } from './types';
import { resolveVaultFile } from './vault';

export class FieldFileView extends TextFileView implements HoverParent {
	hoverPopover: HoverPopover | null = null;

	private hostEl: HTMLElement | null = null;
	private toolbarEl: HTMLElement | null = null;
	private cameraButton: HTMLButtonElement | null = null;
	private sizeButton: HTMLButtonElement | null = null;
	private pane: ComponentsPane | null = null;
	private renderer: FieldRenderer | null = null;
	private field: FieldFileData = createDefaultField();
	private rawFallback: string | null = null;
	private applyingSelfChange = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return FIELD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'Field';
	}

	getIcon(): string {
		return 'map';
	}

	getViewData(): string {
		if (this.rawFallback !== null) return this.rawFallback;
		return serializeField(this.field);
	}

	setViewData(data: string, clear: boolean): void {
		if (this.applyingSelfChange) return;
		if (clear) this.rawFallback = null;

		if (!data.trim()) {
			this.field = createDefaultField();
			this.rawFallback = null;
			this.syncRenderer();
			this.requestSave();
			return;
		}

		const parsed = parseField(data);
		if (parsed.error) {
			this.rawFallback = data;
			new Notice(parsed.error);
			return;
		}

		this.rawFallback = null;
		this.field = parsed.data;
		if (this.field.instances.length === 0) {
			this.field.instances.push({
				id: newId(),
				kind: 'piece',
				label: 'Pawn',
				x: 0,
				y: 0,
			});
		}
		this.syncRenderer();
	}

	clear(): void {
		this.field = createDefaultField();
		this.rawFallback = null;
		this.syncRenderer();
	}

	protected async onOpen(): Promise<void> {
		await super.onOpen();
		this.contentEl.empty();
		this.contentEl.addClass('fields-file-view');
		this.hostEl = this.contentEl.createDiv({ cls: 'fields-view' });
		this.buildToolbar(this.hostEl);
		this.hostEl.createDiv({
			cls: 'fields-hint',
			text: 'Drop a note from the explorer · Drag a pawn to move · Drag the ground to pan',
		});
		this.renderer = new FieldRenderer(this.hostEl, this.app, {
			onPieceClick: (piece) => this.openPiece(piece),
			onPieceHover: (piece, event) => this.hoverPiece(piece, event),
			onPieceMoved: (piece, x, y) => this.movePiece(piece.id, x, y),
			onCameraChanged: (camera) => {
				this.field.camera = {
					...camera,
					mode: this.field.camera.mode,
				};
				this.persist();
			},
		});
		this.pane = new ComponentsPane(this.contentEl, {
			title: 'Components',
			hint: 'Drag onto the board',
			addLabel: 'Add',
			onAdd: () => this.promptAddComponent(),
		});
		this.registerDomEvent(this.hostEl, 'dragover', this.onDragOver);
		this.registerDomEvent(this.hostEl, 'dragleave', this.onDragLeave);
		this.registerDomEvent(this.hostEl, 'drop', this.onDrop);
		this.syncRenderer();
	}

	protected async onClose(): Promise<void> {
		this.renderer?.dispose();
		this.renderer = null;
		this.pane?.destroy();
		this.pane = null;
		this.hostEl = null;
		this.toolbarEl = null;
		this.cameraButton = null;
		this.sizeButton = null;
		await super.onClose();
	}

	onResize(): void {
		this.renderer?.resize();
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem((item) => {
			item.setTitle('Add piece')
				.setIcon('plus')
				.onClick(() => this.addPiece());
		});
		menu.addItem((item) => {
			item.setTitle('Add note')
				.setIcon('file-plus')
				.onClick(() => this.promptAddNote());
		});
	}

	addPiece(label = 'Piece', x?: number, y?: number, model?: string | null): void {
		const slot = nextOpenSlot(this.field.instances);
		const instance: FieldInstance = {
			id: newId(),
			kind: 'piece',
			label,
			x: x === undefined ? slot.x : roundCoord(x),
			y: y === undefined ? slot.y : roundCoord(y),
			model: model ?? null,
		};
		this.field.instances.push(instance);
		this.syncRenderer();
		this.persist();
	}

	addNote(file: TFile, x?: number, y?: number): void {
		const existing = this.field.instances.find(
			(instance) => instance.kind === 'note' && instance.path === file.path,
		);
		if (existing) {
			if (x !== undefined && y !== undefined) {
				existing.x = roundCoord(x);
				existing.y = roundCoord(y);
				this.syncRenderer();
				this.persist();
				return;
			}
			new Notice('That note is already on this field.');
			return;
		}
		const slot = nextOpenSlot(this.field.instances);
		this.field.instances.push({
			id: newId(),
			kind: 'note',
			path: file.path,
			x: x === undefined ? slot.x : roundCoord(x),
			y: y === undefined ? slot.y : roundCoord(y),
		});
		this.syncRenderer();
		this.persist();
	}

	promptAddNote(): void {
		new NoteSuggestModal(this.app, (file) => this.addNote(file)).open();
	}

	private buildToolbar(host: HTMLElement): void {
		this.toolbarEl = host.createDiv({ cls: 'fields-toolbar' });
		this.cameraButton = this.toolbarEl.createEl('button', {
			cls: 'fields-toolbar-button',
			text: cameraLabel(this.field.camera.mode),
		});
		this.cameraButton.addEventListener('click', () => {
			const next: CameraMode =
				this.field.camera.mode === 'ortho' ? 'perspective' : 'ortho';
			this.field.camera.mode = next;
			this.renderer?.setCameraMode(next);
			this.cameraButton?.setText(cameraLabel(next));
			this.persist();
		});

		this.sizeButton = this.toolbarEl.createEl('button', {
			cls: 'fields-toolbar-button',
			text: sizeLabel(this.field.groundSize),
		});
		this.sizeButton.addEventListener('click', () => {
			this.field.groundSize = nextGroundSize(this.field.groundSize);
			this.sizeButton?.setText(sizeLabel(this.field.groundSize));
			this.syncRenderer();
			this.persist();
		});

		const addPieceBtn = this.toolbarEl.createEl('button', {
			cls: 'fields-toolbar-button',
			text: 'Add piece',
		});
		addPieceBtn.addEventListener('click', () => this.addPiece());

		const addNoteBtn = this.toolbarEl.createEl('button', {
			cls: 'fields-toolbar-button',
			text: 'Add note',
		});
		addNoteBtn.addEventListener('click', () => this.promptAddNote());
	}

	private syncRenderer(): void {
		this.cameraButton?.setText(cameraLabel(this.field.camera.mode));
		this.sizeButton?.setText(sizeLabel(this.field.groundSize));
		this.pane?.setItems(
			this.field.components.map((component) => ({
				id: component.id,
				label: component.label,
				subtitle: component.model ? 'Custom model' : 'Default pawn',
				drop: { kind: 'piece', label: component.label, model: component.model ?? null },
			})),
		);
		this.renderer?.setState({
			camera: this.field.camera,
			groundImagePath: this.field.groundImage,
			groundSize: this.field.groundSize,
			pieces: this.field.instances.map(instanceToPiece),
		});
	}

	private promptAddComponent(): void {
		new TextPromptModal(this.app, 'Add component', 'Piece name', (label) => {
			this.field.components.push({ id: newId(), label, model: null });
			this.syncRenderer();
			this.persist();
		}).open();
	}

	private onDragOver = (event: DragEvent): void => {
		acceptBoardDrag(event);
		this.hostEl?.addClass('is-drop-target');
	};

	private onDragLeave = (event: DragEvent): void => {
		if (event.relatedTarget instanceof Node && this.hostEl?.contains(event.relatedTarget)) {
			return;
		}
		this.hostEl?.removeClass('is-drop-target');
	};

	private onDrop = (event: DragEvent): void => {
		acceptBoardDrag(event);
		this.hostEl?.removeClass('is-drop-target');
		// Unclamped raycast — Size is pan/play-area, not the drop box.
		const hit = this.renderer?.pickGround(event.clientX, event.clientY);
		if (!hit) return;
		const drops = parseBoardDrop(this.app, event, this.file?.path ?? '');
		if (drops.length === 0) return;
		drops.forEach((drop, index) => {
			const x = hit.x + index * 1.6;
			const y = hit.z;
			if (drop.kind === 'piece') {
				this.addPiece(drop.label, x, y, drop.model);
				return;
			}
			const file = resolveVaultFile(this.app, drop.path);
			if (file) this.addNote(file, x, y);
		});
	};

	private movePiece(id: string, x: number, y: number): void {
		const instance = this.field.instances.find((item) => item.id === id);
		if (!instance) return;
		instance.x = roundCoord(x);
		instance.y = roundCoord(y);
		this.persist();
	}

	private persist(): void {
		this.applyingSelfChange = true;
		this.requestSave();
		window.setTimeout(() => {
			this.applyingSelfChange = false;
		}, 50);
	}

	private openPiece(piece: FieldPiece): void {
		if (!piece.notePath) return;
		const event = window.event;
		const newLeaf =
			event instanceof MouseEvent ? Keymap.isModEvent(event) : false;
		void this.app.workspace.openLinkText(piece.notePath, this.file?.path ?? '', newLeaf);
	}

	private hoverPiece(piece: FieldPiece | null, event: PointerEvent): void {
		if (!piece?.notePath || !this.renderer) return;
		this.app.workspace.trigger('hover-link', {
			event,
			source: HOVER_LINK_SOURCE,
			hoverParent: this,
			targetEl: this.renderer.canvas,
			linktext: piece.notePath,
			sourcePath: this.file?.path ?? '',
		});
	}
}

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly onPick: (file: TFile) => void;

	constructor(app: FieldFileView['app'], onPick: (file: TFile) => void) {
		super(app);
		this.onPick = onPick;
		this.setPlaceholder('Add a note to this field');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

function instanceToPiece(instance: FieldInstance): FieldPiece {
	if (instance.kind === 'note') {
		const name = instance.path.split('/').pop()?.replace(/\.md$/i, '') ?? instance.path;
		return {
			id: instance.id,
			label: name,
			x: instance.x,
			y: instance.y,
			notePath: instance.path,
			modelPath: instance.model,
		};
	}
	return {
		id: instance.id,
		label: instance.label,
		x: instance.x,
		y: instance.y,
		modelPath: instance.model,
	};
}

function nextOpenSlot(instances: FieldInstance[]): { x: number; y: number } {
	const taken = new Set(instances.map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`));
	for (let i = 0; i < 64; i++) {
		const x = (i % 8) * 1.6 - 5.6;
		const y = Math.floor(i / 8) * 1.6 - 2.4;
		if (!taken.has(`${x.toFixed(1)},${y.toFixed(1)}`)) return { x, y };
	}
	return { x: 0, y: 0 };
}

function roundCoord(value: number): number {
	const factor = 10 ** POSITION_DECIMALS;
	return Math.round(value * factor) / factor;
}

function cameraLabel(mode: CameraMode): string {
	return mode === 'ortho' ? 'Orthographic' : 'Perspective';
}

function sizeLabel(size: number): string {
	return `Size: ${GROUND_SIZE_LABELS[nearestGroundSizePreset(size)]}`;
}

export function isFieldFileView(view: unknown): view is FieldFileView {
	return view instanceof FieldFileView;
}
