// Loaded on demand, never in the app's startup module graph.
import {
    Box3,
    DirectionalLight,
    HemisphereLight,
    LoadingManager,
    PerspectiveCamera,
    Scene,
    Sphere,
    TextureLoader,
    Vector3,
    WebGLRenderer,
} from "three";
import { GLTFLoader } from "/vendor/gltf-loader.js";
import { OrbitControls } from "/vendor/orbit-controls.js";

function disposeModel(model) {
    const resources = new Set();

    for (const scene of model.scenes) {
        scene.traverse((object) => {
            resources.add(object.geometry);
            resources.add(object.skeleton);

            for (const material of [object.material].flat()) {
                if (material) {
                    resources.add(material);

                    for (const value of Object.values(material)) {
                        if (value?.isTexture) {
                            resources.add(value);
                        }
                    }
                }
            }
        });
    }

    for (const resource of resources) {
        resource?.dispose();
    }
}

/** Input has passed checkModelPreview. Permit only the object URLs GLTFLoader makes for embedded images. */
async function parse(bytes) {
    const urls = new Set();
    const manager = new LoadingManager();

    manager.setURLModifier((url) => {
        if (!url.startsWith(`blob:${location.origin}/`)) {
            throw new Error("Unexpected GLB resource URL.");
        }

        urls.add(url);

        return url;
    });
    const loader = new GLTFLoader(manager);

    loader.register((parser) => {
        // ImageBitmapLoader uses fetch(blob:), which the app's connect-src does not allow.
        // TextureLoader uses an image element, covered by the existing img-src blob: policy.
        parser.textureLoader = new TextureLoader(manager);

        return { name: "PocketEmbeddedTextures" };
    });

    try {
        return await loader.parseAsync(bytes, "");
    } finally {
        for (const url of urls) {
            URL.revokeObjectURL(url);
        }
    }
}

export async function renderModelPreview(bytes, canvas, { signal, onContextLost }) {
    const model = await parse(bytes);
    const scene = new Scene();
    const camera = new PerspectiveCamera(40, 1, 0.01, 100);
    let renderer;
    let controls;
    let observer;
    let frame = 0;

    const dispose = () => {
        cancelAnimationFrame(frame);
        observer?.disconnect();
        controls?.dispose();
        disposeModel(model);
        renderer?.dispose();
        renderer?.forceContextLoss();
    };

    try {
        signal.throwIfAborted();

        const root = model.scene;
        const bounds = new Box3().setFromObject(root).getBoundingSphere(new Sphere());

        if (!(bounds.radius > 0) || ![...bounds.center, bounds.radius].every(Number.isFinite)) {
            throw new Error("No visible model geometry.");
        }

        scene.add(root, new HemisphereLight(0xffffff, 0x777777, 2));
        const light = new DirectionalLight(0xffffff, 2.5);

        light.position.set(3, 5, 4);
        scene.add(light);

        try {
            renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
        } catch {
            throw new Error("3D rendering needs WebGL 2, which is not available in this browser.");
        }

        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        controls = new OrbitControls(camera, canvas);
        controls.minDistance = bounds.radius * 0.05;
        controls.maxDistance = bounds.radius * 100;
        camera.near = bounds.radius * 0.005;
        camera.far = bounds.radius * 150;

        const draw = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(() => {
                    frame = 0;
                    renderer.render(scene, camera);
                });
            }
        };

        const resize = () => {
            const { clientWidth: width, clientHeight: height } = canvas;

            if (width && height) {
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                draw();
            }
        };

        const reset = () => {
            const vertical = (camera.fov * Math.PI) / 360;
            const halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
            const distance = (1.12 * bounds.radius) / Math.sin(halfAngle);

            controls.target.copy(bounds.center);
            camera.position
                .copy(bounds.center)
                .addScaledVector(new Vector3(1, 0.65, 1).normalize(), distance);
            controls.update();
            draw();
        };

        const key = (event) => {
            if (event.metaKey || event.altKey || event.ctrlKey) {
                return;
            }

            switch (event.key) {
                case "ArrowLeft":
                    event.shiftKey ? controls.pan(24, 0) : controls.rotateLeft(0.15);
                    break;
                case "ArrowRight":
                    event.shiftKey ? controls.pan(-24, 0) : controls.rotateLeft(-0.15);
                    break;
                case "ArrowUp":
                    event.shiftKey ? controls.pan(0, 24) : controls.rotateUp(0.15);
                    break;
                case "ArrowDown":
                    event.shiftKey ? controls.pan(0, -24) : controls.rotateUp(-0.15);
                    break;
                case "+":
                case "=":
                    controls.dollyIn(0.85);
                    break;
                case "-":
                    controls.dollyOut(0.85);
                    break;
                default:
                    return;
            }

            event.preventDefault();
            event.stopPropagation();
        };

        controls.addEventListener("change", draw);
        resize();
        reset();
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        canvas.addEventListener("keydown", key);
        canvas.addEventListener("webglcontextlost", onContextLost);

        return {
            reset,
            dispose() {
                canvas.removeEventListener("keydown", key);
                canvas.removeEventListener("webglcontextlost", onContextLost);
                dispose();
            },
        };
    } catch (error) {
        dispose();

        throw error;
    }
}
