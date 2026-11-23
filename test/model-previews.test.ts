import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { createHandler } from "../src/server/http.ts";
import { publishModelPreview } from "../src/server/model-previews.ts";
import { cleanUp, openApp, owner, scriptedModel, work } from "./helpers.ts";

function glb(fields: Record<string, unknown> = {}): Buffer {
    const json = JSON.stringify({ asset: { version: "2.0" }, ...fields });
    const length = Math.ceil(json.length / 4) * 4;
    const bytes = Buffer.alloc(20 + length, 32);

    bytes.write("glTF");
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(length, 12);
    bytes.write("JSON", 16);
    bytes.write(json, 20);

    return bytes;
}

test("a saved GLB is readable only by readers of its conversation", async (t) => {
    const app = await openApp(scriptedModel());
    const server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );

    t.after(async () => {
        server.closeAllConnections();
        server.close();
        await app.close();
        cleanUp();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    app.config.lastModel ??= { provider: "faux", modelId: "faux-1", thinkingLevel: "off" };
    const { id } = await app.commands.createSession(owner(app), { cwd: work });
    const other = await app.commands.createSession(owner(app), { cwd: work });
    const reader = app.config.addUser("Reader", "viewer", [String(id)]).token;
    const stranger = app.config.addUser("Other reader", "viewer", [String(other.id)]).token;
    const model = glb();
    const token = await publishModelPreview(app.dataDir, id, model);
    const port = (server.address() as { port: number }).port;
    const path = `/api/model-previews/${id}/${token}`;
    const get = (auth?: string, address = path, header = true) =>
        fetch(`http://127.0.0.1:${port}${address}`, {
            headers: {
                ...(header ? { "x-pocket": "1" } : {}),
                ...(auth ? { authorization: `Bearer ${auth}` } : {}),
            },
        });
    const response = await get(reader);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "model/gltf-binary");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), model);
    assert.equal((await get()).status, 401);
    assert.equal((await get(reader, path, false)).status, 403);
    assert.equal((await get(stranger)).status, 404);
    assert.equal((await get(stranger, `/api/model-previews/${other.id}/${token}`)).status, 404);
    await assert.rejects(
        publishModelPreview(app.dataDir, id, glb({ images: [{ uri: "/other" }] })),
        /self-contained/,
    );
    await writeFile(
        join(app.dataDir, "x.model-previews", String(id), `${token}.glb`),
        glb({ changed: true }),
    );
    assert.equal((await get(reader)).status, 404);
});
