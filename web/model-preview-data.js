// Untrusted tool details and GLB input. Keep this independent of the UI and the renderer.
const ID = /^[a-f0-9]{64}$/;
const isId = (value) => typeof value === "string" && value.length === 64 && ID.test(value);

export function modelPreviewIds(call, result) {
    const details = result?.details;
    const ids = new Set();

    if (!result?.isError && isId(details?.modelPreview)) {
        ids.add(details.modelPreview);
    }

    if (call === "codemode" && Array.isArray(details?.calls)) {
        for (const nested of details.calls) {
            if (nested?.status === "ok" && isId(nested.modelPreview)) {
                ids.add(nested.modelPreview);
            }
        }
    }

    return [...ids];
}

/** Accept only GLB 2 with embedded buffers and raster textures. Never pass file URIs to GLTFLoader. */
export function checkModelPreview(bytes) {
    const data = new DataView(bytes);
    const invalid = "This file is not a supported GLB 2 model.";

    if (
        bytes.byteLength < 20 ||
        bytes.byteLength > 64_000_000 ||
        data.getUint32(0, true) !== 0x46546c67 ||
        data.getUint32(4, true) !== 2 ||
        data.getUint32(8, true) !== bytes.byteLength ||
        data.getUint32(16, true) !== 0x4e4f534a
    ) {
        throw new Error(invalid);
    }

    const length = data.getUint32(12, true);
    const end = 20 + length;

    if (length % 4 !== 0 || length > 8_000_000 || end > bytes.byteLength) {
        throw new Error(invalid);
    }

    // Reject extra or duplicate chunks so we check the exact JSON and BIN that the loader uses.
    let binLength = 0;

    if (end !== bytes.byteLength) {
        if (end + 8 > bytes.byteLength || data.getUint32(end + 4, true) !== 0x004e4942) {
            throw new Error(invalid);
        }

        binLength = data.getUint32(end, true);

        if (binLength % 4 !== 0 || end + 8 + binLength !== bytes.byteLength) {
            throw new Error(invalid);
        }
    }

    let json;

    try {
        json = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, 20, length)),
        );
    } catch {
        throw new Error(invalid);
    }

    const { buffers = [], images = [], bufferViews = [] } = json ?? {};

    if (
        json?.asset?.version !== "2.0" ||
        !Array.isArray(buffers) ||
        !Array.isArray(images) ||
        !Array.isArray(bufferViews)
    ) {
        throw new Error(invalid);
    }

    if ([...buffers, ...images].some((item) => item !== null && item?.uri !== undefined)) {
        throw new Error("The preview does not allow GLB buffer or image URLs.");
    }

    if (
        buffers.length > 1 ||
        buffers.some(
            (buffer) =>
                !Number.isInteger(buffer?.byteLength) ||
                buffer.byteLength < 1 ||
                buffer.byteLength > binLength,
        )
    ) {
        throw new Error(invalid);
    }

    for (const image of images) {
        const view = bufferViews[image?.bufferView];
        const offset = view?.byteOffset ?? 0;
        const length = view?.byteLength;

        if (
            !Number.isInteger(image?.bufferView) ||
            view?.buffer !== 0 ||
            !Number.isInteger(offset) ||
            offset < 0 ||
            !Number.isInteger(length) ||
            length < 12 ||
            offset + length > (buffers[0]?.byteLength ?? 0)
        ) {
            throw new Error(invalid);
        }

        const start = end + 8 + offset;
        const raster =
            (image.mimeType === "image/png" &&
                data.getUint32(start) === 0x89504e47 &&
                data.getUint32(start + 4) === 0x0d0a1a0a) ||
            (image.mimeType === "image/jpeg" &&
                data.getUint16(start) === 0xffd8 &&
                data.getUint8(start + 2) === 0xff) ||
            (image.mimeType === "image/webp" &&
                data.getUint32(start) === 0x52494646 &&
                data.getUint32(start + 8) === 0x57454250);

        if (!raster) {
            throw new Error("The preview only supports embedded PNG, JPEG, or WebP textures.");
        }
    }
}
