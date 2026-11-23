/** Private, conversation-scoped GLBs. Only a trusted extension can publish; the browser can only read. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationId } from "@earendil-works/pi-durable";

export const MODEL_PREVIEW_ID = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64_000_000;
const MAX_JSON_BYTES = 8_000_000;
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Do not accept GLBs that ask a loader to fetch buffers or images. */
function validate(bytes: Buffer): void {
    const invalid = "Expected a self-contained GLB 2 model, at most 64 MB.";

    if (
        bytes.length < 20 ||
        bytes.length > MAX_BYTES ||
        bytes.toString("latin1", 0, 4) !== "glTF" ||
        bytes.readUInt32LE(4) !== 2 ||
        bytes.readUInt32LE(8) !== bytes.length ||
        bytes.toString("latin1", 16, 20) !== "JSON"
    ) {
        throw new Error(invalid);
    }

    const length = bytes.readUInt32LE(12);

    const end = 20 + length;

    if (length > MAX_JSON_BYTES || length % 4 !== 0 || end > bytes.length) {
        throw new Error(invalid);
    }

    if (end < bytes.length) {
        if (end + 8 > bytes.length || bytes.readUInt32LE(end + 4) !== 0x004e4942) {
            throw new Error(invalid);
        }

        const bin = bytes.readUInt32LE(end);

        if (bin % 4 !== 0 || end + 8 + bin !== bytes.length) {
            throw new Error(invalid);
        }
    }

    const model = JSON.parse(bytes.toString("utf8", 20, end)) as {
        asset?: { version?: string };
        buffers?: { uri?: unknown }[];
        images?: { uri?: unknown }[];
    } | null;

    if (
        model?.asset?.version !== "2.0" ||
        (model.buffers ?? []).some((item) => item?.uri !== undefined) ||
        (model.images ?? []).some((item) => item?.uri !== undefined)
    ) {
        throw new Error(invalid);
    }
}

async function directory(data: string, id: ConversationId, create: boolean): Promise<string> {
    const number = String(id);

    if (!/^[1-9]\d*$/.test(number)) {
        throw new Error("Invalid model preview conversation.");
    }

    const root = join(await realpath(data), "x.model-previews", number);

    if (create) {
        await mkdir(root, { recursive: true, mode: 0o700 });
    }

    if ((await realpath(root)) !== root) {
        throw new Error("Invalid model preview directory.");
    }

    return root;
}

export async function publishModelPreview(
    data: string,
    id: ConversationId,
    model: Uint8Array,
): Promise<string> {
    // Copy once so the stored bytes are the same bytes we validate and hash.
    if (model.byteLength > MAX_BYTES) {
        throw new Error("Model preview exceeds 64 MB.");
    }

    const bytes = Buffer.from(model);

    validate(bytes);

    const token = sha256(bytes);
    const root = await directory(data, id, true);
    const target = join(root, `${token}.glb`);
    const temp = join(root, `${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);

    try {
        try {
            await file.writeFile(bytes);
            await file.sync();
        } finally {
            await file.close();
        }

        await rename(temp, target);

        const dir = await open(root, "r");

        try {
            await dir.sync();
        } finally {
            await dir.close();
        }
    } finally {
        await rm(temp, { force: true });
    }

    return token;
}

export async function readModelPreview(
    data: string,
    id: ConversationId,
    token: string,
): Promise<Buffer | undefined> {
    if (!MODEL_PREVIEW_ID.test(token)) {
        return undefined;
    }

    try {
        const root = await directory(data, id, false);
        const file = await open(
            join(root, `${token}.glb`),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );

        try {
            const stat = await file.stat();

            if (!stat.isFile() || stat.size < 20 || stat.size > MAX_BYTES) {
                return undefined;
            }

            if (
                process.platform === "linux" &&
                dirname(await realpath(`/proc/self/fd/${file.fd}`)) !== root
            ) {
                return undefined;
            }

            const bytes = Buffer.alloc(stat.size);
            let offset = 0;

            while (offset < bytes.length) {
                const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);

                if (bytesRead === 0) {
                    return undefined;
                }

                offset += bytesRead;
            }

            return sha256(bytes) === token ? bytes : undefined;
        } finally {
            await file.close();
        }
    } catch {
        return undefined;
    }
}
