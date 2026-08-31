import { Notice, Plugin, TFile } from 'obsidian';
import { BASES_VIEW_TYPE, FIELD_VIEW_TYPE, HOVER_LINK_SOURCE } from './constants';
import { createDefaultField, serializeField } from './field-file';
import { FieldFileView, isFieldFileView } from './field-file-view';
import { FieldsBasesView } from './fields-bases-view';
import { createUniqueFile } from './vault';

export default class FieldsPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(
			FIELD_VIEW_TYPE,
			(leaf) => new FieldFileView(leaf),
		);
		this.registerExtensions(['field'], FIELD_VIEW_TYPE);

		const basesEnabled = this.registerBasesView(BASES_VIEW_TYPE, {
			name: 'Fields',
			icon: 'lucide-map',
			factory: (controller, containerEl) =>
				new FieldsBasesView(controller, containerEl),
			options: () => FieldsBasesView.getViewOptions(),
		});
		if (!basesEnabled) {
			console.warn(
				'Fields: Bases is not enabled in this vault, so the Fields layout is unavailable.',
			);
		}

		this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
			display: 'Fields',
			defaultMod: false,
		});

		this.addRibbonIcon('map', 'Create new field', () => {
			void this.createFieldFile();
		});

		this.addCommand({
			id: 'create-field',
			name: 'Create new field',
			callback: () => {
				void this.createFieldFile();
			},
		});

		this.addCommand({
			id: 'add-piece',
			name: 'Add piece to current field',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(FieldFileView);
				if (!view) return false;
				if (!checking) view.addPiece();
				return true;
			},
		});

		this.addCommand({
			id: 'add-note',
			name: 'Add note to current field',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(FieldFileView);
				if (!view) return false;
				if (!checking) view.promptAddNote();
				return true;
			},
		});

		this.addCommand({
			id: 'add-active-note',
			name: 'Add active note to current field',
			checkCallback: (checking) => {
				const fieldLeaf = this.app.workspace
					.getLeavesOfType(FIELD_VIEW_TYPE)
					.find((leaf) => isFieldFileView(leaf.view));
				const note = this.app.workspace.getActiveFile();
				if (!fieldLeaf || !note || note.extension !== 'md') return false;
				if (!checking) {
					const view = fieldLeaf.view;
					if (isFieldFileView(view)) view.addNote(note);
				}
				return true;
			},
		});
	}

	async createFieldFile(): Promise<TFile | null> {
		const parent = this.app.fileManager.getNewFileParent(
			this.app.workspace.getActiveFile()?.path ?? '',
		);
		try {
			const file = await createUniqueFile(
				this.app,
				parent.path,
				'Untitled',
				'field',
				serializeField(createDefaultField()),
			);
			await this.app.workspace.getLeaf(true).openFile(file);
			return file;
		} catch (error) {
			console.error('Fields: failed to create field file', error);
			new Notice('Could not create a field file.');
			return null;
		}
	}
}
