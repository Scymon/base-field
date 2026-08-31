export type CameraMode = 'ortho' | 'perspective';

export interface FieldCameraState {
	mode: CameraMode;
	/** Board-space look target (x, y). */
	target: [number, number];
	distance: number;
	azimuth: number;
	elevation: number;
}

export type FieldInstance =
	| {
			id: string;
			kind: 'note';
			path: string;
			x: number;
			y: number;
			model?: string | null;
	  }
	| {
			id: string;
			kind: 'piece';
			label: string;
			x: number;
			y: number;
			model?: string | null;
	  };

export interface FieldFileData {
	version: 1;
	camera: FieldCameraState;
	groundImage: string | null;
	/** World-space width/depth of the board. Missing files default to large. */
	groundSize: number;
	instances: FieldInstance[];
}

export interface FieldPiece {
	id: string;
	label: string;
	x: number;
	y: number;
	notePath?: string;
	modelPath?: string | null;
}

export interface FieldSceneState {
	camera: FieldCameraState;
	groundImagePath?: string | null;
	groundSize?: number;
	pieces: FieldPiece[];
}
