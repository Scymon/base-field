import { normalizePath, type App } from 'obsidian';
import {
	AmbientLight,
	Box3,
	CanvasTexture,
	Color,
	CylinderGeometry,
	DirectionalLight,
	Group,
	HemisphereLight,
	LoadingManager,
	Mesh,
	MeshStandardMaterial,
	Object3D,
	OrthographicCamera,
	PerspectiveCamera,
	Plane,
	PlaneGeometry,
	Raycaster,
	Scene,
	ShaderMaterial,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	SRGBColorSpace,
	Texture,
	TextureLoader,
	Vector2,
	Vector3,
	WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { DEFAULT_GROUND_SIZE, DRAG_THRESHOLD_PX, parseGroundSize } from './constants';
import type { CameraMode, FieldCameraState, FieldPiece, FieldSceneState } from './types';
import { isRuntimeModelPath, resolveVaultFile, vaultResourceUrl } from './vault';

export interface FieldRendererCallbacks {
	onPieceClick: (piece: FieldPiece) => void;
	onPieceHover?: (piece: FieldPiece | null, event: PointerEvent) => void;
	onPieceMoved: (piece: FieldPiece, x: number, y: number) => void;
	onCameraChanged?: (camera: FieldCameraState) => void;
}

interface PieceNode {
	piece: FieldPiece;
	group: Group;
	modelKey: string;
}

const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), 0);
const SHARED_BASE = new CylinderGeometry(0.46, 0.5, 0.1, 16);
const SHARED_BODY = new CylinderGeometry(0.2, 0.3, 0.72, 12);
const SHARED_HEAD = new SphereGeometry(0.2, 12, 10);
const MIN_ELEVATION = 0.4;
const MAX_ELEVATION = 1.15;
const MIN_DISTANCE = 6;

const SKY_ZENITH = 0xf3f4f6;
const GROUND_COLOR = 0xc4c6cb;
const GRID_COLOR = 0x2c323a;

export class FieldRenderer {
	readonly canvas: HTMLCanvasElement;

	private readonly app: App;
	private readonly host: HTMLElement;
	private readonly callbacks: FieldRendererCallbacks;
	private readonly scene = new Scene();
	private readonly perspective: PerspectiveCamera;
	private readonly ortho: OrthographicCamera;
	private readonly renderer: WebGLRenderer;
	private readonly raycaster = new Raycaster();
	private readonly pointer = new Vector2();
	private readonly ground: Mesh;
	private readonly grid: Mesh;
	private readonly gridUniforms: {
		uColor: { value: Color };
		uHalf: { value: number };
		uCell: { value: number };
	};
	private readonly rimAlpha: CanvasTexture;
	private readonly skyBackground: CanvasTexture;
	private readonly piecesRoot = new Group();
	private readonly nodes = new Map<string, PieceNode>();
	private readonly modelCache = new Map<string, Object3D>();
	private readonly pendingLoads = new Map<string, Promise<Object3D | null>>();

	private cameraMode: CameraMode = 'perspective';
	private target = new Vector3(0, 0, 0);
	private distance = 18;
	private azimuth = 0.55;
	private elevation = 0.95;
	private width = 1;
	private height = 1;
	private frame = 0;
	private disposed = false;
	private observer: ResizeObserver | null = null;
	private groundTexture: Texture | null = null;
	private groundImagePath: string | null = null;
	private groundSize: number = DEFAULT_GROUND_SIZE;
	private draggingId: string | null = null;
	private panLast: Vector3 | null = null;
	private dragMoved = false;
	private pointerStart = new Vector2();
	private boardAction: 'none' | 'pan' | 'orbit' = 'none';
	private hoveredId: string | null = null;
	private ignoreIds = new Set<string>();
	private cameraNotifyTimer = 0;

	constructor(host: HTMLElement, app: App, callbacks: FieldRendererCallbacks) {
		this.host = host;
		this.app = app;
		this.callbacks = callbacks;

		this.skyBackground = createSkyBackground();
		this.scene.background = this.skyBackground;
		this.scene.fog = null;
		this.perspective = new PerspectiveCamera(36, 1, 0.1, 2000);
		this.ortho = new OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);

		this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
		this.renderer.outputColorSpace = SRGBColorSpace;
		this.renderer.setClearColor(SKY_ZENITH, 1);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.canvas = this.renderer.domElement;
		this.canvas.classList.add('fields-canvas');
		this.canvas.tabIndex = 0;
		host.appendChild(this.canvas);

		this.rimAlpha = createRimAlphaMap();
		const groundMat = new MeshStandardMaterial({
			color: GROUND_COLOR,
			roughness: 0.96,
			metalness: 0,
			fog: false,
			transparent: true,
			alphaMap: this.rimAlpha,
			depthWrite: true,
		});
		this.ground = new Mesh(new PlaneGeometry(this.groundSize, this.groundSize), groundMat);
		this.ground.rotation.x = -Math.PI / 2;
		this.ground.receiveShadow = false;
		this.scene.add(this.ground);

		const grid = createFadingGrid(this.groundSize);
		this.grid = grid.mesh;
		this.gridUniforms = grid.uniforms;
		this.scene.add(this.grid);

		this.scene.add(new HemisphereLight(0xf3f5f8, 0xb4b0a9, 0.8));
		this.scene.add(new AmbientLight(0xffffff, 0.32));
		const sun = new DirectionalLight(0xfff3e4, 0.75);
		sun.position.set(18, 34, 14);
		this.scene.add(sun);
		this.scene.add(this.piecesRoot);
		this.updateCameraRange();

		this.bindEvents();
		this.resize();
		this.applyCamera();
		this.loop();
	}

	setState(state: FieldSceneState): void {
		this.cameraMode = state.camera.mode;
		if (!this.draggingId) {
			this.target.set(state.camera.target[0], 0, state.camera.target[1]);
			this.distance = state.camera.distance;
			this.azimuth = state.camera.azimuth;
			this.elevation = state.camera.elevation;
			this.applyCamera();
		}
		this.setGroundSize(parseGroundSize(state.groundSize ?? this.groundSize));
		void this.setGroundImage(state.groundImagePath ?? null);
		this.syncPieces(state.pieces);
	}

	setCameraMode(mode: CameraMode): void {
		this.cameraMode = mode;
		this.applyCamera();
		this.emitCamera();
	}

	ignoreIncoming(id: string, ms = 400): void {
		this.ignoreIds.add(id);
		window.setTimeout(() => this.ignoreIds.delete(id), ms);
	}

	resize(): void {
		const rect = this.host.getBoundingClientRect();
		this.width = Math.max(1, Math.floor(rect.width));
		this.height = Math.max(1, Math.floor(rect.height));
		this.renderer.setSize(this.width, this.height, false);
		this.applyCamera();
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.frame);
		this.observer?.disconnect();
		this.observer = null;
		window.clearTimeout(this.cameraNotifyTimer);
		this.canvas.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas.removeEventListener('pointermove', this.onPointerMove);
		this.canvas.removeEventListener('pointerup', this.onPointerUp);
		this.canvas.removeEventListener('pointercancel', this.onPointerUp);
		this.canvas.removeEventListener('wheel', this.onWheel);
		this.canvas.removeEventListener('contextmenu', this.onContextMenu);
		this.nodes.forEach((node) => this.disposeNode(node));
		this.nodes.clear();
		this.groundTexture?.dispose();
		this.rimAlpha.dispose();
		this.skyBackground.dispose();
		(this.ground.material as MeshStandardMaterial).dispose();
		this.ground.geometry.dispose();
		disposeObject3D(this.grid);
		this.renderer.dispose();
		this.canvas.remove();
	}

	private get activeCamera(): PerspectiveCamera | OrthographicCamera {
		return this.cameraMode === 'ortho' ? this.ortho : this.perspective;
	}

	private loop = (): void => {
		if (this.disposed) return;
		this.renderer.render(this.scene, this.activeCamera);
		this.frame = requestAnimationFrame(this.loop);
	};

	private bindEvents(): void {
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.host);
		this.canvas.addEventListener('pointerdown', this.onPointerDown);
		this.canvas.addEventListener('pointermove', this.onPointerMove);
		this.canvas.addEventListener('pointerup', this.onPointerUp);
		this.canvas.addEventListener('pointercancel', this.onPointerUp);
		this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
		this.canvas.addEventListener('contextmenu', this.onContextMenu);
	}

	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	private onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 && event.button !== 2) return;
		this.canvas.setPointerCapture(event.pointerId);
		this.pointerStart.set(event.clientX, event.clientY);
		this.dragMoved = false;

		const piece = event.button === 0 ? this.hitPiece(event) : null;
		if (piece) {
			this.draggingId = piece.id;
			this.boardAction = 'none';
			this.liftPiece(piece.id, true);
			return;
		}

		this.draggingId = null;
		this.boardAction = event.button === 2 || event.altKey ? 'orbit' : 'pan';
		this.panLast =
			this.boardAction === 'pan' ? this.intersectGround(event, false) : null;
	};

	private onPointerMove = (event: PointerEvent): void => {
		const dx = event.clientX - this.pointerStart.x;
		const dy = event.clientY - this.pointerStart.y;
		if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) this.dragMoved = true;

		if (this.draggingId) {
			const hit = this.intersectGround(event);
			if (hit) {
				const node = this.nodes.get(this.draggingId);
				if (node) {
					node.piece.x = hit.x;
					node.piece.y = hit.z;
					node.group.position.set(hit.x, 0.12, hit.z);
				}
			}
			this.canvas.style.cursor = 'grabbing';
			return;
		}

		if (this.boardAction === 'pan') {
			this.panByPointer(event);
			this.canvas.style.cursor = 'grabbing';
			return;
		}

		if (this.boardAction === 'orbit') {
			this.azimuth -= event.movementX * 0.006;
			this.elevation = clamp(
				this.elevation - event.movementY * 0.004,
				MIN_ELEVATION,
				MAX_ELEVATION,
			);
			this.applyCamera();
			this.emitCamera();
			this.canvas.style.cursor = 'grabbing';
			return;
		}

		const hovered = this.hitPiece(event);
		const nextId = hovered?.id ?? null;
		if (nextId !== this.hoveredId) {
			this.hoveredId = nextId;
			this.callbacks.onPieceHover?.(hovered, event);
		}
		this.canvas.style.cursor = hovered ? 'pointer' : 'grab';
	};

	private onPointerUp = (event: PointerEvent): void => {
		if (this.canvas.hasPointerCapture(event.pointerId)) {
			this.canvas.releasePointerCapture(event.pointerId);
		}

		const draggingId = this.draggingId;
		if (draggingId) {
			this.liftPiece(draggingId, false);
			const node = this.nodes.get(draggingId);
			if (node) {
				node.group.position.y = 0;
				if (this.dragMoved) {
					this.ignoreIncoming(node.piece.id);
					this.callbacks.onPieceMoved(node.piece, node.piece.x, node.piece.y);
				} else {
					this.callbacks.onPieceClick(node.piece);
				}
			}
		}

		this.draggingId = null;
		this.boardAction = 'none';
		this.panLast = null;
		this.canvas.style.cursor = this.hoveredId ? 'pointer' : 'grab';
	};

	private onWheel = (event: WheelEvent): void => {
		event.preventDefault();
		const factor = Math.exp(event.deltaY * 0.0012);
		this.distance = clamp(this.distance * factor, MIN_DISTANCE, this.maxDistance());
		this.applyCamera();
		this.emitCamera();
	};

	private panByPointer(event: PointerEvent): void {
		const hit = this.intersectGround(event, false);
		if (!hit || !this.panLast) {
			this.panLast = hit;
			return;
		}
		this.target.x += this.panLast.x - hit.x;
		this.target.z += this.panLast.z - hit.z;
		this.clampTarget();
		this.applyCamera();
		this.emitCamera();
		this.panLast = this.intersectGround(event, false);
	}

	private applyCamera(): void {
		const { x, z } = this.target;
		const d = this.distance;
		const px = x + d * Math.sin(this.elevation) * Math.sin(this.azimuth);
		const py = d * Math.cos(this.elevation);
		const pz = z + d * Math.sin(this.elevation) * Math.cos(this.azimuth);

		this.perspective.position.set(px, py, pz);
		this.perspective.lookAt(x, 0, z);
		this.ortho.position.set(px, py, pz);
		this.ortho.lookAt(x, 0, z);

		const aspect = this.width / this.height;
		this.perspective.aspect = aspect;
		this.perspective.updateProjectionMatrix();

		const halfH = d * 0.26;
		const halfW = halfH * aspect;
		this.ortho.left = -halfW;
		this.ortho.right = halfW;
		this.ortho.top = halfH;
		this.ortho.bottom = -halfH;
		this.ortho.updateProjectionMatrix();
		this.updateCameraRange();
	}

	private setGroundSize(size: number): void {
		if (size === this.groundSize) {
			this.distance = clamp(this.distance, MIN_DISTANCE, this.maxDistance());
			return;
		}
		this.groundSize = size;
		this.ground.geometry.dispose();
		this.ground.geometry = new PlaneGeometry(size, size);
		this.grid.geometry.dispose();
		this.grid.geometry = new PlaneGeometry(size, size);
		this.gridUniforms.uHalf.value = size * 0.5;
		this.distance = clamp(this.distance, MIN_DISTANCE, this.maxDistance());
		this.clampTarget();
		this.applyCamera();
	}

	private maxDistance(): number {
		return clamp(this.groundSize * 0.55, 80, 720);
	}

	private clampTarget(): void {
		const limit = this.groundSize * 0.45;
		this.target.x = clamp(this.target.x, -limit, limit);
		this.target.z = clamp(this.target.z, -limit, limit);
	}

	private updateCameraRange(): void {
		const far = Math.max(1200, this.groundSize * 2.5 + this.maxDistance() * 2);
		this.perspective.far = far;
		this.ortho.far = far;
		this.perspective.updateProjectionMatrix();
		this.ortho.updateProjectionMatrix();
	}

	private snapshotCamera(): FieldCameraState {
		return {
			mode: this.cameraMode,
			target: [this.target.x, this.target.z],
			distance: this.distance,
			azimuth: this.azimuth,
			elevation: this.elevation,
		};
	}

	private emitCamera(): void {
		window.clearTimeout(this.cameraNotifyTimer);
		this.cameraNotifyTimer = window.setTimeout(() => {
			this.callbacks.onCameraChanged?.(this.snapshotCamera());
		}, 180);
	}

	private syncPieces(pieces: FieldPiece[]): void {
		const incoming = new Set(pieces.map((piece) => piece.id));
		for (const [id, node] of this.nodes) {
			if (!incoming.has(id)) {
				this.disposeNode(node);
				this.nodes.delete(id);
			}
		}

		for (const piece of pieces) {
			if (this.ignoreIds.has(piece.id) || this.draggingId === piece.id) continue;
			const existing = this.nodes.get(piece.id);
			const modelKey = piece.modelPath ?? '';
			if (!existing) {
				this.mountPiece(piece);
				continue;
			}
			existing.piece = piece;
			existing.group.position.set(piece.x, 0, piece.y);
			this.refreshLabel(existing.group, piece.label);
			if (existing.modelKey !== modelKey) {
				this.disposeNode(existing);
				this.nodes.delete(piece.id);
				this.mountPiece(piece);
			}
		}
	}

	private mountPiece(piece: FieldPiece): void {
		const group = new Group();
		group.name = piece.id;
		group.userData['pieceId'] = piece.id;
		group.position.set(piece.x, 0, piece.y);
		this.piecesRoot.add(group);
		this.nodes.set(piece.id, { piece, group, modelKey: piece.modelPath ?? '' });
		void this.fillPieceVisual(group, piece);
	}

	private async fillPieceVisual(group: Group, piece: FieldPiece): Promise<void> {
		const model = piece.modelPath ? await this.loadModel(piece.modelPath) : null;
		if (this.disposed || !this.nodes.has(piece.id)) return;
		clearGroup(group);
		if (model) {
			group.add(model);
		} else {
			group.add(createDefaultPawn(colorFor(`${piece.id}${piece.label}`)));
		}
		group.add(createLabelSprite(piece.label));
	}

	private refreshLabel(group: Group, label: string): void {
		const sprite = group.children.find((child) => child.userData['fieldsLabel']);
		if (sprite instanceof Sprite) {
			sprite.material.map?.dispose();
			sprite.material.dispose();
			sprite.removeFromParent();
		}
		group.add(createLabelSprite(label));
	}

	private liftPiece(id: string, lifted: boolean): void {
		const node = this.nodes.get(id);
		if (node) node.group.position.y = lifted ? 0.12 : 0;
	}

	private disposeNode(node: PieceNode): void {
		clearGroup(node.group);
		node.group.removeFromParent();
	}

	private async setGroundImage(path: string | null): Promise<void> {
		if (path === this.groundImagePath) return;
		this.groundImagePath = path;
		const material = this.ground.material as MeshStandardMaterial;
		this.groundTexture?.dispose();
		this.groundTexture = null;
		if (!path) {
			material.map = null;
			material.color.set(GROUND_COLOR);
			material.needsUpdate = true;
			this.grid.visible = true;
			return;
		}
		const url = vaultResourceUrl(this.app, path);
		if (!url) return;
		try {
			const texture = await new TextureLoader().loadAsync(url);
			if (this.disposed || this.groundImagePath !== path) {
				texture.dispose();
				return;
			}
			texture.colorSpace = SRGBColorSpace;
			this.groundTexture = texture;
			material.map = texture;
			material.color.set(0xffffff);
			material.needsUpdate = true;
			this.grid.visible = false;
		} catch (error) {
			console.warn('Fields: failed to load ground image', path, error);
		}
	}

	private async loadModel(path: string): Promise<Object3D | null> {
		if (!isRuntimeModelPath(path)) return null;
		const cached = this.modelCache.get(path);
		if (cached) return cached.clone();
		const pending = this.pendingLoads.get(path);
		if (pending) {
			const loaded = await pending;
			return loaded ? loaded.clone() : null;
		}
		const task = this.loadModelUncached(path);
		this.pendingLoads.set(path, task);
		const loaded = await task;
		this.pendingLoads.delete(path);
		if (!loaded) return null;
		this.modelCache.set(path, loaded);
		return loaded.clone();
	}

	private async loadModelUncached(path: string): Promise<Object3D | null> {
		const file = resolveVaultFile(this.app, path);
		if (!file) return null;
		const url = this.app.vault.getResourcePath(file);
		const manager = vaultLoadingManager(this.app, file.path);
		const ext = file.extension.toLowerCase();
		try {
			let object: Object3D;
			if (ext === 'glb' || ext === 'gltf') {
				const gltf = await new GLTFLoader(manager).loadAsync(url);
				object = gltf.scene;
			} else if (ext === 'obj') {
				object = await new OBJLoader(manager).loadAsync(url);
			} else {
				return null;
			}
			fitToPawn(object);
			return object;
		} catch (error) {
			console.warn('Fields: failed to load model', path, error);
			return null;
		}
	}

	private hitPiece(event: PointerEvent): FieldPiece | null {
		this.setPointer(event);
		this.raycaster.setFromCamera(this.pointer, this.activeCamera);
		const hits = this.raycaster.intersectObjects(this.piecesRoot.children, true);
		for (const hit of hits) {
			const id = findPieceId(hit.object);
			if (id) {
				const node = this.nodes.get(id);
				if (node) return node.piece;
			}
		}
		return null;
	}

	private intersectGround(event: PointerEvent, clampToBoard = true): Vector3 | null {
		this.setPointer(event);
		this.raycaster.setFromCamera(this.pointer, this.activeCamera);
		const point = new Vector3();
		if (this.raycaster.ray.intersectPlane(GROUND_PLANE, point)) {
			if (clampToBoard) {
				const half = this.groundSize / 2;
				point.x = clamp(point.x, -half, half);
				point.z = clamp(point.z, -half, half);
			}
			return point;
		}
		return null;
	}

	private setPointer(event: PointerEvent): void {
		const rect = this.canvas.getBoundingClientRect();
		this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	}
}

function createSkyBackground(): CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 256;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const gradient = ctx.createLinearGradient(0, 0, 0, 256);
		gradient.addColorStop(0, '#f3f4f6');
		gradient.addColorStop(1, '#e2e4e8');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 2, 256);
	}
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

function createRimAlphaMap(): CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 256;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const gradient = ctx.createRadialGradient(128, 128, 108, 128, 128, 128);
		gradient.addColorStop(0, '#ffffff');
		gradient.addColorStop(1, '#000000');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 256, 256);
	}
	const texture = new CanvasTexture(canvas);
	return texture;
}

function createFadingGrid(size: number): {
	mesh: Mesh;
	uniforms: {
		uColor: { value: Color };
		uHalf: { value: number };
		uCell: { value: number };
	};
} {
	const uniforms = {
		uColor: { value: new Color(GRID_COLOR) },
		uHalf: { value: size * 0.5 },
		uCell: { value: 2 },
	};
	const material = new ShaderMaterial({
		name: 'FieldsGrid',
		transparent: true,
		depthWrite: false,
		fog: false,
		toneMapped: false,
		uniforms,
		vertexShader: `
			varying vec2 vWorldXZ;
			void main() {
				vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			varying vec2 vWorldXZ;
			uniform vec3 uColor;
			uniform float uHalf;
			uniform float uCell;
			void main() {
				vec2 coord = vWorldXZ / uCell;
				vec2 deriv = fwidth(coord);
				vec2 line = abs(fract(coord - 0.5) - 0.5) / max(deriv, vec2(1e-6));
				float minor = 1.0 - smoothstep(0.0, 1.25, min(line.x, line.y));

				vec2 majorCoord = vWorldXZ / (uCell * 5.0);
				vec2 majorDeriv = fwidth(majorCoord);
				vec2 majorLine = abs(fract(majorCoord - 0.5) - 0.5) / max(majorDeriv, vec2(1e-6));
				float major = 1.0 - smoothstep(0.0, 1.4, min(majorLine.x, majorLine.y));

				float rim = length(vWorldXZ) / max(uHalf, 0.001);
				float fade = 1.0 - smoothstep(0.58, 0.96, rim);
				float alpha = max(minor * 0.78, major * 0.95) * fade;
				if (alpha < 0.02) discard;
				gl_FragColor = vec4(uColor, alpha);
			}
		`,
	});
	const mesh = new Mesh(new PlaneGeometry(size, size), material);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = 0.02;
	mesh.renderOrder = 1;
	return { mesh, uniforms };
}

function disposeObject3D(object: Object3D): void {
	object.traverse((node) => {
		if (node instanceof Mesh) {
			node.geometry.dispose();
			if (Array.isArray(node.material)) {
				node.material.forEach((material) => material.dispose());
			} else {
				node.material.dispose();
			}
		}
	});
	object.removeFromParent();
}

function vaultLoadingManager(app: App, modelPath: string): LoadingManager {
	const manager = new LoadingManager();
	const folder = modelPath.includes('/') ? modelPath.slice(0, modelPath.lastIndexOf('/')) : '';
	manager.setURLModifier((url) => {
		if (/^(data:|blob:|app:|capacitor:|http:|https:)/.test(url)) return url;
		const cleaned = decodeURIComponent(url.split('?')[0] ?? url).replace(/^\.\//, '');
		const vaultPath = normalizePath(folder ? `${folder}/${cleaned}` : cleaned);
		const file = resolveVaultFile(app, vaultPath);
		return file ? app.vault.getResourcePath(file) : url;
	});
	return manager;
}

function createDefaultPawn(color: number): Group {
	const group = new Group();
	group.userData['defaultPawn'] = true;
	const material = new MeshStandardMaterial({
		color,
		roughness: 0.45,
		metalness: 0.08,
		fog: false,
	});
	const base = new Mesh(SHARED_BASE, material);
	base.position.y = 0.05;
	const body = new Mesh(SHARED_BODY, material);
	body.position.y = 0.46;
	const head = new Mesh(SHARED_HEAD, material);
	head.position.y = 1.02;
	group.add(base, body, head);
	return group;
}

function createLabelSprite(text: string): Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		ctx.clearRect(0, 0, 256, 64);
		ctx.fillStyle = 'rgba(22, 24, 28, 0.82)';
		roundRect(ctx, 8, 10, 240, 44, 10);
		ctx.fill();
		ctx.fillStyle = '#f6f4ee';
		ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(ellipsize(text, 18), 128, 33);
	}
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	const sprite = new Sprite(
		new SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
	);
	sprite.position.y = 1.45;
	sprite.scale.set(1.7, 0.42, 1);
	sprite.userData['fieldsLabel'] = true;
	return sprite;
}

function fitToPawn(object: Object3D, height = 1.25): void {
	const box = new Box3().setFromObject(object);
	const size = box.getSize(new Vector3());
	const max = Math.max(size.x, size.y, size.z);
	if (max <= 0) return;
	object.scale.multiplyScalar(height / max);
	const fitted = new Box3().setFromObject(object);
	object.position.y -= fitted.min.y;
}

function clearGroup(group: Object3D): void {
	[...group.children].forEach((child) => {
		const disposeMats = Boolean(child.userData['defaultPawn']);
		child.traverse((node) => {
			if (disposeMats && node instanceof Mesh) {
				if (Array.isArray(node.material)) {
					node.material.forEach((material) => disposeMaterial(material));
				} else {
					disposeMaterial(node.material);
				}
			}
			if (node instanceof Sprite) {
				node.material.map?.dispose();
				node.material.dispose();
			}
		});
		child.removeFromParent();
	});
}

function disposeMaterial(material: { map?: Texture | null; dispose: () => void }): void {
	material.map?.dispose();
	material.dispose();
}

function findPieceId(object: Object3D): string | null {
	let current: Object3D | null = object;
	while (current) {
		const id = current.userData['pieceId'];
		if (typeof id === 'string') return id;
		current = current.parent;
	}
	return null;
}

function colorFor(seed: string): number {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	const hue = Math.abs(hash) % 360;
	return new Color().setHSL(hue / 360, 0.54, 0.4).getHex();
}

function ellipsize(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
