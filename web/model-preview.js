import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useBack } from "./back.js";
import { checkModelPreview } from "./model-preview-data.js";
import { html } from "./ui.js";

export function ModelPreviewAction({ conversationId, id, index, count }) {
    const [open, setOpen] = useState(false);
    const close = () => setOpen(false);

    useBack(open, close);

    return html`<button
        type="button"
        class="artifact-link model-preview-action"
        aria-haspopup="dialog"
        onClick=${(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setOpen(true);
        }}
    >
        ${count === 1 ? "View in 3D" : `View in 3D ${index + 1}`}
    </button>
    ${open && html`<${ModelPreview} conversationId=${conversationId} id=${id} close=${close} />`}`;
}

function ModelPreview({ conversationId, id, close }) {
    const dialog = useRef(null);
    const canvas = useRef(null);
    const viewer = useRef(null);
    const closeButton = useRef(null);
    const [download, setDownload] = useState(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);

    useLayoutEffect(() => {
        const element = dialog.current;

        element.showModal();
        closeButton.current.focus({ preventScroll: true });

        return () => element.close();
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        const surface = canvas.current;
        let url;

        const load = async () => {
            try {
                const response = await fetch(
                    `/api/model-previews/${encodeURIComponent(conversationId)}/${id}`,
                    { headers: { "X-Pocket": "1" }, signal, redirect: "error", cache: "no-store" },
                );

                if (!response.ok) {
                    throw new Error("This model preview is not available.");
                }

                const bytes = await response.arrayBuffer();

                signal.throwIfAborted();
                checkModelPreview(bytes);
                url = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
                setDownload(url);

                const { renderModelPreview } = await import("./model-preview-renderer.js");

                signal.throwIfAborted();
                viewer.current = await renderModelPreview(bytes, surface, {
                    signal,
                    onContextLost: () => {
                        setReady(false);
                        setError(
                            "3D rendering stopped. Close and reopen the preview to try again.",
                        );
                    },
                });

                if (signal.aborted) {
                    viewer.current.dispose();
                    viewer.current = null;

                    return;
                }

                setReady(true);
            } catch (cause) {
                if (!signal.aborted) {
                    setError(
                        cause instanceof Error ? cause.message : "Could not open the 3D model.",
                    );
                }
            }
        };

        void load();

        return () => {
            controller.abort();
            viewer.current?.dispose();
            viewer.current = null;

            if (url !== undefined) {
                URL.revokeObjectURL(url);
            }
        };
    }, [conversationId, id]);

    return html`<dialog
        class="model-preview-dialog"
        ref=${dialog}
        aria-label="3D model preview"
        onCancel=${(event) => {
            event.preventDefault();
            close();
        }}
        onKeyDown=${(event) => {
            event.stopPropagation();

            if (event.key === "Escape" && !event.isComposing) {
                event.preventDefault();
                close();
            }
        }}
        onClick=${(event) => {
            if (event.target === event.currentTarget) {
                close();
            }
        }}
    >
        <div class="model-preview-layout">
            <header class="model-preview-bar">
                <h2>3D model</h2>
                <button class="button" type="button" ref=${closeButton} onClick=${close}>Close</button>
            </header>
            <div class="model-preview-stage">
                <canvas
                    ref=${canvas}
                    tabindex=${ready ? 0 : -1}
                    aria-hidden=${!ready}
                    aria-label="3D model. Arrow keys rotate, Shift and arrow keys pan, plus and minus zoom."
                ></canvas>
                ${
                    !ready &&
                    html`<div class="model-preview-status" role=${error ? "alert" : "status"}>
                    ${error ?? "Loading 3D model…"}
                </div>`
                }
            </div>
            <footer class="model-preview-bar model-preview-footer">
                ${ready && html`<p>Drag to rotate. Scroll or pinch to zoom. Right-drag or drag with two fingers to pan.</p>`}
                <button
                    class="button"
                    type="button"
                    disabled=${!ready}
                    onClick=${() => viewer.current?.reset()}
                >
                    Reset view
                </button>
                ${download && html`<a class="button" href=${download} download="model.glb">Download GLB</a>`}
            </footer>
        </div>
    </dialog>`;
}
