// Artifact bundles: immutable bytes, inherited manifests, replay, safe serving, and sandbox access.
import {
    type App,
    cleanUp,
    context,
    openApp,
    owner,
    root,
    say,
    scriptedModel,
    until,
    work,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
    type Stats,
    closeSync,
    ftruncateSync,
    mkdtempSync,
    openSync,
    symlinkSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, mock, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import { ArtifactAssetDoc } from "../src/server/docs.ts";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import createArtifacts, {
    MAX_BYTES,
    MAX_ASSET_BYTES,
    MAX_ASSETS_BYTES,
    MAX_ASSETS,
} from "../src/server/extensions/artifacts.ts";
import type { PocketHost } from "../src/server/host.ts";
import { assetName, assetType, assetRoot, assetUser } from "../src/server/http/artifact-assets.ts";
import { createHandler } from "../src/server/http.ts";

let app: App;
let server: Server;
let base: string;
let session: ConversationId;
let calls = 0;
let clock = Date.now();
const tools = createArtifacts({} as PocketHost).tools!;
const PAGE =
    '<!doctype html><html><head><link rel="stylesheet" href="assets/style.css"></head><body><img src="assets/pixel.png"><a href="nested/about.html">About</a></body></html>';

async function publish(args: Record<string, unknown>, call = String(++calls), inline = false) {
    return tools[inline ? 1 : 0]!.execute(
        args as never,
        {
            conversationId: session,
            taskId: 9876,
            callId: call,
            agent: async () => ({ cwd: work }),
            snapshot: app.harness.snapshot.bind(app.harness),
            commit: app.harness.commit.bind(app.harness),
        } as never,
        context,
    );
}

async function get(path: string, auth = true) {
    return fetch(new URL(path, base), {
        headers: auth ? { authorization: `Bearer ${app.config.ownerToken}` } : {},
    });
}

before(async () => {
    app = await openApp(scriptedModel(), undefined, () => clock);
    app.config.lastModel ??= { provider: "faux", modelId: "faux-1", thinkingLevel: "off" };
    ({ id: session } = await app.commands.createSession(owner(app), { cwd: work }));
    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
    server?.closeAllConnections();
    server?.close();
    await app?.close();
    cleanUp();
});

test("binary files and text assets commit once, inherit, replace, remove, and stay versioned", async () => {
    const dir = mkdtempSync(join(work, "bundle-"));
    const bytes = Buffer.from([0, 255, 34, 89]);
    const path = join(dir, "pixel.png");

    writeFileSync(path, bytes);
    await publish(
        {
            id: "bundle",
            title: "Bundle",
            content: PAGE,
            group: "test-design",
            kind: "page",
            assets: [
                { name: "assets/pixel.png", path },
                { name: "assets/style.css", content: "body{color:red}" },
                {
                    name: "nested/about.html",
                    content: '<!doctype html><h1>About</h1><img src="../assets/pixel.png">',
                },
                { name: "opaque.bin", content: "<script>alert(1)</script>" },
                { name: "__proto__", content: "not a prototype" },
            ],
        },
        "first",
    );
    const first = await app.artifactBundle(session, "bundle");

    assert.equal(first.version, 1);
    assert.equal(first.meta.group, "test-design");
    assert.equal(first.meta.kind, "page");
    assert.deepEqual(first.assets.find((asset) => asset.name === "assets/pixel.png")!.bytes, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");

    assert.equal(
        (await app.harness.snapshot(ArtifactAssetDoc, hash, context))!.base64,
        bytes.toString("base64"),
    );
    // Replay must not reread the now-missing source path or accept a different bundle.
    await publish(
        {
            id: "bundle",
            title: "Replay",
            path: "missing.html",
            assets: [{ name: "bad/../name", path: "missing" }],
        },
        "first",
    );
    assert.equal((await app.artifactBundle(session, "bundle")).version, 1);
    await publish(
        {
            id: "bundle",
            title: "Bundle 2",
            content: PAGE,
            assets: [{ name: "assets/style.css", content: "body{color:blue}" }],
            removeAssets: ["__proto__"],
        },
        undefined,
        true,
    );
    const second = await app.artifactBundle(session, "bundle");

    assert.equal(second.version, 2);
    assert.equal(second.assets.length, 4);
    assert.equal(
        second.assets.find((asset) => asset.name === "assets/style.css")!.bytes.toString(),
        "body{color:blue}",
    );
    assert.deepEqual(
        second.assets.find((asset) => asset.name === "assets/pixel.png")!.bytes,
        bytes,
    );
    assert.equal((await app.artifactBundle(session, "bundle", 1)).assets.length, 5);
});

test("asset names and extension types do not allow traversal or active unknown documents", () => {
    for (const name of [
        "",
        "/absolute",
        "../a",
        "a/../b",
        "a/./b",
        "a//b",
        "a\\b",
        "a%2fb",
        "a?b",
        "x".repeat(201),
    ]) {
        assert.equal(assetName(name), false, name);
    }

    assert.equal(assetName(".hidden/nested_1/image-2.png"), true);
    assert.equal(assetType("PAGE.HTML"), "text/html; charset=utf-8");
    assert.equal(assetType("unknown"), "application/octet-stream");
    assert.equal(assetType("__proto__"), "application/octet-stream");
});

test("limits and invalid sources fail without publishing a partial version", async () => {
    const common = { id: "invalid", title: "Invalid", content: "<p>test</p>" };

    for (const asset of [
        { name: "../x", content: "x" },
        { name: "x" },
        { name: "x", content: "x", path: "x" },
    ]) {
        await assert.rejects(publish({ ...common, assets: [asset] }));
    }

    await assert.rejects(
        publish({
            ...common,
            assets: [
                { name: "x", content: "x" },
                { name: "x", content: "y" },
            ],
        }),
    );
    // UTF-8 size, not character count: this is exactly one byte over the limit.
    await assert.rejects(
        publish({
            ...common,
            assets: [{ name: "x", content: "é".repeat(MAX_ASSET_BYTES / 2) + "x" }],
        }),
        /limited/,
    );
    await assert.rejects(
        publish({
            ...common,
            assets: Array.from({ length: 201 }, (_, i) => ({ name: String(i), content: "" })),
        }),
        /at most/,
    );
    await assert.rejects(publish({ ...common, removeAssets: ["../x"] }));
    await assert.rejects(publish({ ...common, group: "invalid group" }));
    const dir = mkdtempSync(join(work, "bad-asset-"));
    const target = join(dir, "target");
    const link = join(dir, "link");

    writeFileSync(target, "file");
    symlinkSync(target, link);
    await assert.rejects(publish({ ...common, assets: [{ name: "link", path: link }] }));
    await assert.rejects(
        publish({ ...common, assets: [{ name: "dir", path: dir }] }),
        /regular file/,
    );
    const oversize = join(dir, "oversize.bin");
    const descriptor = openSync(oversize, "w");

    try {
        // A sparse file exercises stat rejection without a large allocation.
        ftruncateSync(descriptor, MAX_ASSET_BYTES + 1);
    } finally {
        closeSync(descriptor);
    }

    await assert.rejects(
        publish({ ...common, assets: [{ name: "oversize.bin", path: oversize }] }),
        /limited to 64000000 bytes/,
    );
    await assert.rejects(app.artifactBundle(session, "invalid"), /No such artifact/);
    assert.equal(MAX_BYTES, 2_000_000);
    assert.equal(MAX_ASSET_BYTES, 64_000_000);
    assert.equal(MAX_ASSETS_BYTES, 128_000_000);
    assert.equal(MAX_ASSETS, 200);
});

test("64 MB UTF-8 and file boundaries; inherited aggregate replacement and removal are atomic", async (t) => {
    const content = "é".repeat(MAX_ASSET_BYTES / 2);
    const dir = mkdtempSync(join(work, "boundary-"));
    const path = join(dir, "boundary.bin");
    const descriptor = openSync(path, "w");
    const chunk = Buffer.from("é".repeat(32 * 1024));

    try {
        for (let offset = 0; offset < MAX_ASSET_BYTES; offset += chunk.length) {
            writeSync(descriptor, chunk, 0, Math.min(chunk.length, MAX_ASSET_BYTES - offset));
        }
    } finally {
        closeSync(descriptor);
    }

    const started = performance.now();
    const rssBefore = process.memoryUsage().rss;

    // Both inputs contain the same bytes, so storage deduplicates the large body.
    // The manifest must still count both names towards the aggregate limit.
    await publish({
        id: "limits",
        title: "Limits",
        content: "<p>limits</p>",
        assets: [
            { name: "0.bin", path },
            { name: "1.bin", content },
        ],
    });
    const published = performance.now();
    const found = await app.artifactAsset(session, "limits", 1, "0.bin");

    assert.equal(found.bytes.length, MAX_ASSET_BYTES);
    assert.equal(found.bytes.subarray(0, 2).toString("utf8"), "é");
    assert.equal(found.bytes.subarray(-2).toString("utf8"), "é");
    t.diagnostic(
        JSON.stringify({
            assetBytes: MAX_ASSET_BYTES,
            publishMs: Math.round(published - started),
            readMs: Math.round(performance.now() - published),
            rssBeforeMiB: Math.round(rssBefore / 1024 ** 2),
            rssAfterMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
            peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        }),
    );
    await assert.rejects(
        publish({
            id: "limits",
            title: "Limits",
            content: "<p>limits</p>",
            assets: [{ name: "overflow.bin", content: "x" }],
        }),
        /limited/,
    );
    assert.equal((await app.artifactBody(session, "limits")).version, 1);
    // Replacing a name at the exact aggregate boundary does not add its old size.
    await publish({
        id: "limits",
        title: "Limits",
        content: "<p>limits</p>",
        assets: [{ name: "0.bin", content }],
    });
    await publish({
        id: "limits",
        title: "Limits",
        content: "<p>limits</p>",
        removeAssets: ["0.bin"],
        assets: [{ name: "replacement.bin", content }],
    });
    const body = await app.artifactBody(session, "limits");
    const manifest = body.meta.versions.at(-1)!.assets!;

    assert.equal(body.version, 3);
    assert.deepEqual(Object.keys(manifest).sort(), ["1.bin", "replacement.bin"]);
    assert.equal(
        Object.values(manifest).reduce((size, asset) => size + asset.size, 0),
        MAX_ASSETS_BYTES,
    );
    await assert.rejects(
        publish({
            id: "limits",
            title: "Must not commit",
            content: "<p>changed</p>",
            assets: [{ name: "replacement.bin", content: content + "x" }],
            removeAssets: ["1.bin"],
        }),
        /limited/,
    );
    assert.equal((await app.artifactBody(session, "limits")).version, 3);
    assert.equal((await app.artifactBody(session, "limits")).meta.title, "Limits");
    assert.equal((await app.artifactBody(session, "limits")).content, "<p>limits</p>");
    await publish({
        id: "limits",
        title: "Limits",
        content: "<p>limits</p>",
        removeAssets: ["1.bin"],
    });
    assert.equal(
        Object.keys((await app.artifactBody(session, "limits")).meta.versions.at(-1)!.assets!)
            .length,
        1,
    );
});

test("page and asset count limits stay unchanged", async () => {
    await publish({ id: "page-limit", title: "Page", content: "é".repeat(MAX_BYTES / 2) });
    await assert.rejects(
        publish({ id: "page-limit", title: "Page", content: "é".repeat(MAX_BYTES / 2) + "x" }),
        /limited/,
    );
    assert.equal((await app.artifactBody(session, "page-limit")).version, 1);
    await publish({
        id: "counts",
        title: "Counts",
        content: "<p>counts</p>",
        assets: Array.from({ length: 200 }, (_, i) => ({ name: `${i}.txt`, content: "" })),
    });
    await assert.rejects(
        publish({
            id: "counts",
            title: "Counts",
            content: "<p>counts</p>",
            assets: [{ name: "overflow.txt", content: "" }],
        }),
        /at most/,
    );
});

test("tiny file assets use bounded allocations, not one full-limit buffer per file", async () => {
    const dir = mkdtempSync(join(work, "tiny-assets-"));
    const path = join(dir, "tiny.bin");

    writeFileSync(path, Buffer.from([0, 1, 2, 255]));
    const alloc = Buffer.alloc;
    const allocUnsafe = Buffer.allocUnsafe;
    const checkedAlloc = mock.method(
        Buffer,
        "alloc",
        (size: number, fill?: number | string | Uint8Array, encoding?: BufferEncoding) => {
            assert.ok(size <= 1024 * 1024, `Unexpected allocation for tiny assets: ${size}`);

            return alloc(size, fill, encoding);
        },
    );
    const checkedUnsafe = mock.method(Buffer, "allocUnsafe", (size: number) => {
        assert.ok(size <= 1024 * 1024, `Unexpected allocation for tiny assets: ${size}`);

        return allocUnsafe(size);
    });

    try {
        await publish({
            id: "tiny-assets",
            title: "Tiny",
            content: "<p>tiny</p>",
            assets: Array.from({ length: MAX_ASSETS }, (_, i) => ({ name: `${i}.bin`, path })),
        });
        assert.ok(checkedUnsafe.mock.callCount() >= MAX_ASSETS);
    } finally {
        checkedAlloc.mock.restore();
        checkedUnsafe.mock.restore();
    }

    assert.deepEqual(
        (await app.artifactAsset(session, "tiny-assets", 1, "199.bin")).bytes,
        Buffer.from([0, 1, 2, 255]),
    );
});

test("empty file assets are preserved", async () => {
    const dir = mkdtempSync(join(work, "empty-asset-"));
    const path = join(dir, "empty.bin");

    writeFileSync(path, "");
    await publish({
        id: "empty-file",
        title: "Empty",
        content: "<p>empty</p>",
        assets: [{ name: "empty.bin", path }],
    });
    assert.equal((await app.artifactAsset(session, "empty-file", 1, "empty.bin")).bytes.length, 0);
});

test("a file grown after stat is rejected after at most one excess byte", async () => {
    const dir = mkdtempSync(join(work, "growing-asset-"));
    const path = join(dir, "growing.bin");
    const descriptor = openSync(path, "w");
    const probe = await open(path, "r");
    const identity = await probe.stat();
    const prototype = Object.getPrototypeOf(probe);
    const stat = prototype.stat as (this: FileHandle) => Promise<Stats>;
    const read = prototype.read as (...args: unknown[]) => Promise<{ bytesRead: number }>;
    let targetFd = -1;
    let bytesRead = 0;
    const checkedStat = mock.method(prototype, "stat", async function (this: FileHandle) {
        const info = await stat.call(this);

        if (info.ino === identity.ino && info.dev === identity.dev && this.fd !== probe.fd) {
            targetFd = this.fd;
            ftruncateSync(descriptor, MAX_ASSET_BYTES + 100);
        }

        return info;
    });
    const checkedRead = mock.method(
        prototype,
        "read",
        async function (this: FileHandle, ...args: unknown[]) {
            const result = await Reflect.apply(read, this, args);

            if (this.fd === targetFd) {
                bytesRead += result.bytesRead;
            }

            return result;
        },
    );

    try {
        await assert.rejects(
            publish({
                id: "grown-file",
                title: "Growth",
                content: "<p>growth</p>",
                assets: [{ name: "growing.bin", path }],
            }),
            /limited to 64000000 bytes/,
        );
        assert.equal(bytesRead, MAX_ASSET_BYTES + 1);
    } finally {
        checkedRead.mock.restore();
        checkedStat.mock.restore();
        await probe.close();
        closeSync(descriptor);
    }

    await assert.rejects(app.artifactBundle(session, "grown-file"), /No such artifact/);
});

test("40 MB binary publish, bundle readback, and signed HTTP response preserve every byte", async (t) => {
    const dir = mkdtempSync(join(work, "large-binary-"));
    const path = join(dir, "data.bin");
    const descriptor = openSync(path, "w");
    const chunk = randomBytes(64 * 1024);
    const hash = createHash("sha256");
    const size = 40_000_000;

    try {
        for (let offset = 0; offset < size; offset += chunk.length) {
            const bytes = chunk.subarray(0, Math.min(chunk.length, size - offset));

            writeSync(descriptor, bytes);
            hash.update(bytes);
        }
    } finally {
        closeSync(descriptor);
    }

    const started = performance.now();
    const rssBefore = process.memoryUsage().rss;

    await publish({
        id: "large-binary",
        title: "Binary",
        content: "<p>binary</p>",
        assets: [{ name: "data.bin", path }],
    });
    const published = performance.now();
    const bundle = await app.artifactBundle(session, "large-binary");
    const bytes = bundle.assets[0]!.bytes;

    assert.equal(bytes.length, size);
    const expectedHash = hash.digest("hex");

    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
    const readBack = performance.now();
    const page = await get(`/a/${session}/large-binary/1`);
    const signed = /<base href="([^"]+)">/.exec(await page.text())![1]!;
    const response = await get(signed + "data.bin", false);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy")!, /^sandbox /);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const reader = response.body!.getReader();
    const responseHash = createHash("sha256");
    let responseSize = 0;

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        responseHash.update(value);
        responseSize += value.byteLength;
    }

    assert.equal(responseSize, size);
    assert.equal(responseHash.digest("hex"), expectedHash);
    t.diagnostic(
        JSON.stringify({
            assetBytes: size,
            publishMs: Math.round(published - started),
            readMs: Math.round(readBack - published),
            httpMs: Math.round(performance.now() - readBack),
            rssBeforeMiB: Math.round(rssBefore / 1024 ** 2),
            rssAfterMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
            lifetimePeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        }),
    );
});

test("every asset is sandboxed and nosniff; scoped capability serves opaque-origin subrequests", async () => {
    const root = `/a/${session}/bundle/1`;
    const page = await get(root);
    const html = await page.text();
    const signed = /<base href="([^"]+)">/.exec(html)![1]!;

    assert.ok(signed.startsWith(`${base}/a/${session}/bundle/1~`));
    assert.match(html, /pocket-bridge/);
    assert.equal((await app.artifactBody(session, "bundle", 1)).content, PAGE);
    assert.equal((await app.artifactBundle(session, "bundle", 1)).content, PAGE);
    const result = await publish({ id: "bundle", title: "Replay", content: PAGE }, "first");

    assert.ok(
        !JSON.stringify(result).includes("~"),
        "Tool results must not expose an asset capability",
    );

    for (const name of [
        "assets/pixel.png",
        "assets/style.css",
        "opaque.bin",
        "nested/about.html",
    ]) {
        const response = await get(signed + name, false);

        assert.equal(response.status, 200, name);
        assert.match(response.headers.get("content-security-policy")!, /^sandbox /);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");

        if (name.endsWith(".html")) {
            assert.match(await response.text(), /pocket-bridge/);
        }
    }

    assert.equal((await get(root + "/assets/pixel.png", false)).status, 401);
    assert.equal((await get(signed, false)).status, 401, "capability cannot read the main page");
    assert.equal((await get(signed + "not-there", false)).status, 404);
    assert.equal(
        (await get(signed.replace("/bundle/", "/other/") + "assets/pixel.png", false)).status,
        401,
    );
    assert.equal((await get(signed.replace("/1~", "/2~") + "assets/pixel.png", false)).status, 401);
    const { id: otherConversation } = await app.commands.createSession(owner(app), { cwd: work });

    assert.equal(
        (
            await get(
                signed.replace(`/a/${session}/`, `/a/${otherConversation}/`) + "assets/pixel.png",
                false,
            )
        ).status,
        401,
    );
    const changed = signed.replace(
        /([0-9a-f])\/$/,
        (match, digit: string) => `${digit === "0" ? "1" : "0"}/`,
    );

    assert.ok(changed !== signed, "The test must change the signature");
    const rejected = await get(changed + "assets/pixel.png", false);

    assert.equal(rejected.status, 401);
    assert.ok(!(await rejected.text()).includes(changed), "Errors must not echo a capability");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal(
        (await get(root + "/opaque.bin")).headers.get("content-type"),
        "application/octet-stream",
    );
    assert.equal((await get(root + "/__proto__")).status, 200);
    assert.equal((await get(`/a/${session}/bundle/2/__proto__`)).status, 404);
    const other = app.config.addUser("Bundle guest", "guest");
    const guestPage = await fetch(base + root, {
        headers: { authorization: `Bearer ${other.token}` },
    });
    const guestSigned = /<base href="([^"]+)">/.exec(await guestPage.text())![1]!;

    app.config.updateUser(other.user.id, { sessions: [] });
    assert.equal((await get(guestSigned + "assets/pixel.png", false)).status, 404);
});

test("published bundle routes serve only their share's assets and close them with the share", async () => {
    const share = await app.shares.create(session, owner(app), { id: "bundle", version: 1 });
    const response = await get(share.path, false);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /pocket-bridge/);
    assert.ok(html.includes(`<base href="${base}/pub/${share.token}/">`));
    const nested = await get(share.path + "/nested/about.html", false);

    assert.equal(nested.status, 200);
    assert.doesNotMatch(await nested.text(), /pocket-bridge/);
    assert.match(nested.headers.get("content-security-policy")!, /^sandbox /);
    const asset = await get(share.path + "/assets/style.css", false);

    assert.equal(await asset.text(), "body{color:red}");
    assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
    assert.equal(asset.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(
        (await get(share.path + "/opaque.bin", false)).headers.get("content-type"),
        "application/octet-stream",
    );
    assert.equal((await get(share.path + "/absent", false)).status, 404);
    assert.equal((await get(share.path + "/bad%5cname", false)).status, 404);
    assert.equal((await get(share.path + "/bad%00name", false)).status, 404);
    await app.shares.revoke(owner(app), session, share.token);
    assert.equal((await get(share.path, false)).status, 404);
    assert.equal((await get(share.path + "/assets/style.css", false)).status, 404);
    assert.equal((await get(share.path + "/nested/about.html", false)).status, 404);
});

test("published links select pinned or latest manifests, and expiry closes every asset", async () => {
    await publish({
        id: "public-versioned",
        title: "Versioned",
        content: "<h1>Version 1</h1>",
        assets: [
            { name: "value.txt", content: "one" },
            { name: "removed.txt", content: "old" },
        ],
    });
    const pinned = await app.shares.create(session, owner(app), {
        id: "public-versioned",
        version: 1,
        hours: 24,
    });
    const latest = await app.shares.create(session, owner(app), {
        id: "public-versioned",
        hours: 24,
    });

    assert.equal(await (await get(latest.path + "/value.txt", false)).text(), "one");
    await publish({
        id: "public-versioned",
        title: "Versioned",
        content: "<h1>Version 2</h1>",
        removeAssets: ["removed.txt"],
        assets: [
            { name: "value.txt", content: "two" },
            { name: "added.txt", content: "new" },
        ],
    });
    assert.match(await (await get(pinned.path, false)).text(), /Version 1/);
    assert.match(await (await get(latest.path, false)).text(), /Version 2/);
    assert.equal(await (await get(pinned.path + "/value.txt", false)).text(), "one");
    assert.equal(await (await get(latest.path + "/value.txt", false)).text(), "two");
    assert.equal((await get(pinned.path + "/removed.txt", false)).status, 200);
    assert.equal((await get(latest.path + "/removed.txt", false)).status, 404);
    assert.equal((await get(pinned.path + "/added.txt", false)).status, 404);
    assert.equal((await get(latest.path + "/added.txt", false)).status, 200);
    const before = clock;

    try {
        clock += 24 * 60 * 60 * 1000 + 1;

        for (const share of [pinned, latest]) {
            for (const name of ["", "/value.txt", "/removed.txt", "/added.txt"]) {
                assert.equal((await get(share.path + name, false)).status, 404);
            }
        }
    } finally {
        clock = before;
    }
});

test("capability-authenticated HTML assets cannot renew their own expiry", async () => {
    const response = await get(`/a/${session}/bundle/1`);
    const signed = /<base href="([^"]+)">/.exec(await response.text())![1]!;
    const before = clock;

    try {
        clock += 1000;
        const nested = await get(signed + "nested/about.html", false);
        const nestedBase = /<base href="([^"]+)">/.exec(await nested.text())![1]!;

        assert.ok(
            nestedBase === signed + "nested/",
            "An HTML asset must keep the original capability",
        );
        clock = before + 12 * 60 * 60 * 1000 - 1;
        assert.equal((await get(signed + "assets/pixel.png", false)).status, 200);
        clock = before + 12 * 60 * 60 * 1000 + 1;
        assert.equal((await get(signed + "nested/about.html", false)).status, 401);
    } finally {
        clock = before;
    }
});

test(
    "a real sandbox loads relative CSS, images, modules, fonts and nested HTML in viewer, inline and own-tab pages",
    {
        skip: findBrowser() === undefined ? "no Chromium-based browser" : false,
    },
    async () => {
        const browsers = new Browsers({
            dataDir: mkdtempSync(join(root, "bundle-ui-")),
            load: async () => undefined,
            save: () => {},
        });
        const html = (
            prefix = "",
        ) => `<!doctype html><html><head><link rel="stylesheet" href="${prefix}assets/style.css"></head><body><h1>Bundle</h1><img src="${prefix}assets/pixel.svg"><script type="module">
        import { value } from "./${prefix}assets/module.js";
        await document.fonts.load('16px BundleFont');
        await new Promise(resolve => { const image = document.querySelector('img'); if(image.complete) resolve(); else image.onload = resolve; });
        window.bundleResult = { value, width: document.querySelector('img').naturalWidth, color: getComputedStyle(document.body).color, font: document.fonts.check('16px BundleFont') };
        parent.postMessage({ type:'bundle-test', result: window.bundleResult }, '*');
    </script></body></html>`;

        await publish(
            {
                id: "real-bundle",
                title: "Real bundle",
                content: html(),
                assets: [
                    {
                        name: "assets/style.css",
                        content:
                            "@font-face{font-family:BundleFont;src:url(font.woff2)}body{color:rgb(12, 34, 56);font-family:BundleFont}",
                    },
                    {
                        name: "assets/font.woff2",
                        path: join(import.meta.dirname, "../web/fonts/Geist.woff2"),
                    },
                    {
                        name: "assets/pixel.svg",
                        content:
                            '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="7"><rect width="13" height="7" fill="red"/></svg>',
                    },
                    { name: "assets/module.js", content: 'export { value } from "./dep.js";' },
                    { name: "assets/dep.js", content: "export const value = 42;" },
                    { name: "nested/about.html", content: html("../") },
                ],
            },
            undefined,
            true,
        );

        try {
            const page = await browsers.open(1);
            const address = `/a/${session}/real-bundle/1`;

            await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
            await page.evaluate(`window.bundleReports = []; addEventListener('message', event => { if (event.data?.type === 'bundle-test') bundleReports.push(event.data.result); });
            const source = await (await fetch(${JSON.stringify(address)})).text();
            const viewer = document.createElement('iframe'); viewer.sandbox = 'allow-scripts'; viewer.src = ${JSON.stringify(address)}; document.body.append(viewer);
            addEventListener('message', event => { if(event.data?.type === 'pocket-run-ready') event.source.postMessage({type:'pocket-run',html:source}, '*'); });
            const inline = document.createElement('iframe'); inline.sandbox = 'allow-scripts'; inline.src = '/a/frame'; document.body.append(inline);
            const nested = document.createElement('iframe'); nested.sandbox = 'allow-scripts'; nested.src = /<base href="([^"]+)">/.exec(source)[1] + 'nested/about.html'; document.body.append(nested);
            return 'null';`);
            await until(
                async () =>
                    JSON.parse(
                        await page.evaluate(
                            "return JSON.stringify(window.bundleReports?.length ?? 0)",
                        ),
                    ) === 3,
                "all bundle frames load their assets",
                30000,
            );
            const reports = JSON.parse(await page.evaluate("return JSON.stringify(bundleReports)"));

            for (const report of reports) {
                assert.deepEqual(report, {
                    value: 42,
                    width: 13,
                    color: "rgb(12, 34, 56)",
                    font: true,
                });
            }

            await page.navigate(base + address);
            await until(
                async () =>
                    JSON.parse(
                        await page.evaluate("return JSON.stringify(Boolean(window.bundleResult))"),
                    ),
                "own-tab assets",
                30000,
            );
            assert.deepEqual(
                JSON.parse(await page.evaluate("return JSON.stringify(bundleResult)")),
                reports[0],
            );
            const published = await app.shares.create(session, owner(app), {
                id: "real-bundle",
                version: 1,
            });

            await page.navigate(base + published.path);
            await until(
                async () =>
                    JSON.parse(
                        await page.evaluate("return JSON.stringify(Boolean(window.bundleResult))"),
                    ),
                "published bundle assets",
                30000,
            );
            assert.deepEqual(
                JSON.parse(await page.evaluate("return JSON.stringify(bundleResult)")),
                reports[0],
            );
        } finally {
            await browsers.closeAll({ final: true });
        }
    },
);

test("a fork and a server restart keep manifests and globally stored bytes", async () => {
    await say(app, session, "fork the bundle");
    const last = (await app.transcripts.allEntries(session, false)).at(-1)!;
    const fork = await app.commands.fork(session, owner(app), { entryId: last.id });
    const original = await app.artifactBundle(session, "bundle", 1);
    const forked = await app.artifactBundle(fork.id, "bundle", 1);

    assert.deepEqual(forked.assets, original.assets);
    const capability = assetRoot(app, String(session), "bundle", 1, owner(app)).split("/")[4]!;

    await app.close();
    app = await openApp(scriptedModel(), undefined, () => clock);
    assert.ok(
        assetUser(app, String(session), "bundle", capability) !== undefined,
        "The signing key must survive a restart",
    );
    assert.deepEqual((await app.artifactBundle(session, "bundle", 1)).assets, original.assets);
    assert.deepEqual((await app.artifactBundle(fork.id, "bundle", 1)).assets, original.assets);
});
