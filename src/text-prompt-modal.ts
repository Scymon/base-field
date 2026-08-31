import { Modal, type App } from 'obsidian';

export class TextPromptModal extends Modal {
	private readonly titleText: string;
	private readonly placeholder: string;
	private readonly onSubmit: (value: string) => void;
	private value = '';

	constructor(
		app: App,
		titleText: string,
		placeholder: string,
		onSubmit: (value: string) => void,
	) {
		super(app);
		this.titleText = titleText;
		this.placeholder = placeholder;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.titleEl.setText(this.titleText);
		const input = this.contentEl.createEl('input', {
			cls: 'fields-prompt-input',
			type: 'text',
			placeholder: this.placeholder,
		});
		input.addEventListener('input', () => {
			this.value = input.value;
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.submit();
			}
		});
		const row = this.contentEl.createDiv({ cls: 'fields-prompt-actions' });
		const ok = row.createEl('button', { cls: 'mod-cta', text: 'Add' });
		ok.addEventListener('click', () => this.submit());
		const cancel = row.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		window.setTimeout(() => input.focus(), 20);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const trimmed = this.value.trim();
		if (!trimmed) return;
		this.close();
		this.onSubmit(trimmed);
	}
}
