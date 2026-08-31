import type { BoardDrop } from './drops';
import { FIELD_COMPONENT_MIME, FIELD_NOTE_MIME } from './drops';

export interface PaneItem {
	id: string;
	label: string;
	subtitle?: string;
	placed?: boolean;
	drop: BoardDrop;
}

export interface ComponentsPaneHandlers {
	title: string;
	hint?: string;
	addLabel?: string;
	onAdd?: () => void;
}

export class ComponentsPane {
	readonly el: HTMLElement;
	private readonly listEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private readonly addBtn: HTMLButtonElement | null;

	constructor(parent: HTMLElement, handlers: ComponentsPaneHandlers) {
		this.el = parent.createDiv({ cls: 'fields-side-pane' });
		const header = this.el.createDiv({ cls: 'fields-side-pane-header' });
		header.createDiv({ cls: 'fields-side-pane-title', text: handlers.title });
		if (handlers.onAdd) {
			this.addBtn = header.createEl('button', {
				cls: 'fields-side-pane-add',
				text: handlers.addLabel ?? 'Add',
			});
			this.addBtn.addEventListener('click', () => handlers.onAdd?.());
		} else {
			this.addBtn = null;
		}
		if (handlers.hint) {
			this.el.createDiv({ cls: 'fields-side-pane-hint', text: handlers.hint });
		}
		this.listEl = this.el.createDiv({ cls: 'fields-side-pane-list' });
		this.emptyEl = this.el.createDiv({
			cls: 'fields-side-pane-empty',
			text: 'Nothing to place',
		});
	}

	setItems(items: PaneItem[]): void {
		this.listEl.empty();
		this.emptyEl.toggle(items.length === 0);
		for (const item of items) {
			const row = this.listEl.createDiv({
				cls: item.placed ? 'fields-side-pane-item is-placed' : 'fields-side-pane-item',
			});
			row.setAttr('draggable', 'true');
			row.createDiv({ cls: 'fields-side-pane-item-label', text: item.label });
			if (item.subtitle) {
				row.createDiv({ cls: 'fields-side-pane-item-sub', text: item.subtitle });
			}
			row.addEventListener('dragstart', (event) => {
				if (!event.dataTransfer) return;
				event.dataTransfer.effectAllowed = 'copy';
				if (item.drop.kind === 'piece') {
					event.dataTransfer.setData(FIELD_COMPONENT_MIME, JSON.stringify(item.drop));
					event.dataTransfer.setData('text/plain', item.drop.label);
				} else {
					event.dataTransfer.setData(FIELD_NOTE_MIME, JSON.stringify({ path: item.drop.path }));
					event.dataTransfer.setData('text/plain', item.drop.path);
				}
				row.addClass('is-dragging');
			});
			row.addEventListener('dragend', () => row.removeClass('is-dragging'));
		}
	}

	destroy(): void {
		this.el.remove();
	}
}
