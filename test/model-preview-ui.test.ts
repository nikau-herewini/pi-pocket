import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { AssistantEntry, ToolResultEntry, UserEntry } from "@earendil-works/pi-durable";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import { createHandler } from "../src/server/http.ts";
import { checkModelPreview, modelPreviewIds } from "../web/model-preview-data.js";
import { cleanUp, context, newSession, openApp, root, scriptedModel, until } from "./helpers.ts";

const direct = "a".repeat(64);
const nested = "b".repeat(64);
const failed = "c".repeat(64);

function glb(fields: object, bin?: Buffer) {
    const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, ...fields }));
    const length = Math.ceil(json.length / 4) * 4;
    const model = Buffer.alloc(20 + length + (bin ? 8 + bin.length : 0), 32);

    model.write("glTF");
    model.writeUInt32LE(2, 4);
    model.writeUInt32LE(model.length, 8);
    model.writeUInt32LE(length, 12);
    model.write("JSON", 16);
    json.copy(model, 20);

    if (bin) {
        model.writeUInt32LE(bin.length, 20 + length);
        model.writeUInt32LE(0x004e4942, 24 + length);
        bin.copy(model, 28 + length);
    }

    return model;
}

function triangle() {
    const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZkAAAAASUVORK5CYII=",
        "base64",
    );
    const coords = [-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1];
    const offset = coords.length * 4;
    const bin = Buffer.alloc(offset + Math.ceil(png.length / 4) * 4);

    coords.forEach((value, index) => bin.writeFloatLE(value, index * 4));
    png.copy(bin, offset);

    return glb(
        {
            scene: 0,
            scenes: [{ nodes: [0] }],
            nodes: [{ mesh: 0 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
            materials: [
                { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } },
            ],
            textures: [{ source: 0 }],
            images: [{ bufferView: 2, mimeType: "image/png" }],
            buffers: [{ byteLength: offset + png.length }],
            bufferViews: [
                { buffer: 0, byteLength: 36 },
                { buffer: 0, byteOffset: 36, byteLength: 24 },
                { buffer: 0, byteOffset: offset, byteLength: png.length },
            ],
            accessors: [
                {
                    bufferView: 0,
                    componentType: 5126,
                    count: 3,
                    type: "VEC3",
                    min: [-1, -1, 0],
                    max: [1, 1, 0],
                },
                { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
            ],
        },
        bin,
    );
}

const external = glb({ images: [{ uri: "/must-not-fetch.png" }] });
const arrayBuffer = (bytes: Buffer) => Uint8Array.from(bytes).buffer;

const codemodeDetails = {
    calls: [
        { name: "sf3d", status: "ok", modelPreview: nested },
        { name: "sf3d", status: "ok", modelPreview: nested },
        { name: "sf3d", status: "error", modelPreview: failed },
        { name: "sf3d", status: "ok", modelPreview: `${direct}\n` },
    ],
};

test("preview actions require successful results and exact, distinct IDs", () => {
    assert.deepEqual(modelPreviewIds("sf3d", { details: { modelPreview: direct } }), [direct]);
    assert.deepEqual(
        modelPreviewIds("sf3d", { isError: true, details: { modelPreview: direct } }),
        [],
    );
    assert.deepEqual(modelPreviewIds("codemode", { details: codemodeDetails }), [nested]);
    assert.deepEqual(modelPreviewIds("other", { details: codemodeDetails }), []);
});

test("the viewer rejects external resources and ambiguous GLB chunks", () => {
    assert.doesNotThrow(() => checkModelPreview(arrayBuffer(triangle())));
    assert.throws(() => checkModelPreview(arrayBuffer(external)), /does not allow .* URLs/);
    assert.throws(
        () =>
            checkModelPreview(
                arrayBuffer(glb({ buffers: [{ uri: "https://example.invalid/model.bin" }] })),
            ),
        /does not allow .* URLs/,
    );
    assert.throws(
        () =>
            checkModelPreview(
                arrayBuffer(glb({ images: [{ mimeType: "image/svg+xml", bufferView: 0 }] })),
            ),
        /not a supported GLB 2/,
    );
    const truncated = triangle().subarray(0, -1);

    assert.throws(() => checkModelPreview(arrayBuffer(truncated)), /not a supported GLB 2/);
});

test(
    "tool result opens a same-origin 3D popup on desktop and mobile",
    { skip: !findBrowser() },
    async (t) => {
        const app = await openApp(scriptedModel());
        const session = await newSession(app);
        const handle = createHandler({
            app,
            listen: { host: "127.0.0.1", port: 0 },
            restart: () => {},
        });
        const requests: { path: string; header?: string }[] = [];
        const fixture = triangle();
        const server = createServer((request, response) => {
            const path = request.url ?? "";

            if (path.startsWith("/api/model-previews/") || path === "/must-not-fetch.png") {
                requests.push({ path, header: request.headers["x-pocket"] as string | undefined });
                response.writeHead(200, { "content-type": "model/gltf-binary" });
                response.end(path.endsWith(direct) ? fixture : external);

                return;
            }

            void handle(request, response);
        });
        const browsers = new Browsers({
            dataDir: mkdtempSync(join(root, "model-preview-ui-")),
            load: async () => undefined,
            save: () => {},
        });

        t.after(async () => {
            await browsers.closeAll({ final: true });
            server.closeAllConnections();
            server.close();
            await app.close();
            cleanUp();
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

        await app.harness.commit(async (tx) => {
            await tx.appendEntry(UserEntry, session, {
                model: [{ role: "user", content: "Make a model", timestamp: Date.now() }],
            });
            const calls = ["test_model", "codemode"];

            await tx.appendEntry(AssistantEntry, session, {
                model: [
                    fauxAssistantMessage(
                        calls.map((name) => fauxToolCall(name, {}, { id: name })),
                        { stopReason: "toolUse" },
                    ),
                ],
            });

            for (const name of calls) {
                await tx.appendEntry(ToolResultEntry, session, {
                    model: [
                        {
                            role: "toolResult",
                            toolCallId: name,
                            toolName: name,
                            isError: false,
                            timestamp: Date.now(),
                            content: [{ type: "text", text: "Made a model." }],
                            details:
                                name === "codemode" ? codemodeDetails : { modelPreview: direct },
                        },
                    ],
                    data: { diagnostics: [] },
                });
            }
        }, context);
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const page = await browsers.open(1);
        const inPage = async <T>(body: string) => JSON.parse(await page.evaluate(body)) as T;
        const query = (expression: string) =>
            inPage<boolean>(`return JSON.stringify(Boolean(${expression}))`);
        const dialog = `document.querySelector('.model-preview-dialog[open]')`;
        const actions = `document.querySelectorAll('.model-preview-action')`;
        const wait = (predicate: string, label: string) =>
            until(() => query(predicate), label, 30_000);

        await page.setViewport({ width: 1100, height: 800, scale: 1, mobile: false });
        await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
        await page.navigate(`${base}/s/${session}`);
        await wait(
            `document.querySelector('[data-part="activity-summary"]') || ${actions}.length`,
            "activity",
        );
        await page.evaluate(
            `if (!${actions}.length) document.querySelector('[data-part="activity-summary"]').click()`,
        );
        await wait(`${actions}.length === 2`, "one action per tool result");
        assert.ok(
            await query(
                `[...${actions}].every(button => button.textContent.trim() === 'View in 3D')`,
            ),
        );
        assert.deepEqual(requests, []);
        await page.evaluate(`${actions}[0].click()`);
        await wait(
            `${dialog}?.querySelector('canvas[tabindex="0"]') || ${dialog}?.querySelector('[role="alert"]')`,
            "model renderer",
        );
        const error = await inPage<string | null>(
            `return JSON.stringify(${dialog}.querySelector('[role="alert"]')?.textContent.trim() ?? null)`,
        );

        assert.equal(error, null);
        assert.ok(await query(`${dialog}.getBoundingClientRect().width < innerWidth`));
        assert.ok(
            await query(
                `${dialog}.querySelector('a[download="model.glb"]').href.startsWith('blob:')`,
            ),
        );
        assert.deepEqual(requests, [
            { path: `/api/model-previews/${session}/${direct}`, header: "1" },
        ]);
        await page.evaluate(
            `${dialog}.querySelector('button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
        );
        await wait(
            `!${dialog} && document.activeElement === ${actions}[0]`,
            "dialog closes and restores focus",
        );

        await page.setViewport({ width: 390, height: 844, scale: 1, mobile: true });
        await page.evaluate(`${actions}[1].click()`);
        await wait(
            `${dialog}?.querySelector('[role="alert"]')?.textContent.includes('does not allow')`,
            "external URL rejected",
        );
        assert.ok(
            await query(
                `${dialog}.getBoundingClientRect().width === innerWidth && ${dialog}.getBoundingClientRect().height === innerHeight`,
            ),
        );
        assert.deepEqual(
            requests.map(({ path }) => path),
            [
                `/api/model-previews/${session}/${direct}`,
                `/api/model-previews/${session}/${nested}`,
            ],
        );
        await wait(`history.state.pocket.layers > 0`, "preview registered in back stack");
        await page.evaluate("history.back()");
        await wait(`!${dialog}`, "Back closes preview");
    },
);
