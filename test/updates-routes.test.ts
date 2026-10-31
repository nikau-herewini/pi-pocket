// Docker image replacement is the only Pi Pocket update path; no self-updater is loaded or served.
import { cleanUp, openApp, root, scriptedModel } from "./helpers.ts";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createHandler } from "../src/server/http.ts";

let app: Awaited<ReturnType<typeof openApp>>;
let server: Server;
let base = "";
const tokens: Record<string, string> = {};

before(async () => {
    app = await openApp(scriptedModel(), join(root, "updates-data"));
    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    tokens.owner = app.config.ownerToken;
    tokens.guest = app.config.addUser("Gale", "guest").token;
});

after(async () => {
    server?.closeAllConnections();
    server?.close();
    await app?.close();
    cleanUp();
});

const call = async (who: string, path: string, body?: unknown, method?: string) => {
    const response = await fetch(`${base}${path}`, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
            authorization: `Bearer ${tokens[who]}`,
            "x-pocket": "1",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    return { status: response.status, data: (await response.json().catch(() => null)) as never };
};

test("the self-updater extension, routes, settings, and browser module are unavailable", async () => {
    assert.ok(!app.loader.extensionNames().includes("pocket-updates"));
    assert.ok(!app.loader.list().some((each) => each.file === "updates.ts"));
    assert.ok(!("updates" in app));

    for (const who of ["owner", "guest"]) {
        assert.equal((await call(who, "/api/x/updates/status")).status, 404);
        assert.equal((await call(who, "/api/x/updates/check", {})).status, 404);
        assert.equal((await call(who, "/api/x/updates/apply", {})).status, 404);
        assert.equal((await call(who, "/api/extension-settings/updates")).status, 404);
        assert.equal((await call(who, "/x/updates/old/index.js")).status, 404);
        assert.equal((await call(who, "/x/updates/old/style.css")).status, 404);

        const hello = (await call(who, "/api/me")).data as {
            server: { ui: { module: string }[] };
        };

        assert.ok(!hello.server.ui.some((each) => each.module === "updates"));
    }

    assert.equal(
        (await call("owner", "/api/extension-settings/updates", { check: true }, "PUT")).status,
        404,
    );
    assert.equal(
        (await call("owner", "/api/extensions/updates.ts", { enabled: true })).status,
        404,
        "the removed updater cannot be enabled again",
    );
});
