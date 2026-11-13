// Custom settings use the public example on a phone, from Home and a session. Saves retain core authorization.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import type { BrowserPage } from "../src/server/browser/page.ts";
import { createHandler } from "../src/server/http.ts";
import { cleanUp, newSession, openApp, owner, root, scriptedModel, until } from "./helpers.ts";

const real = { skip: findBrowser() === undefined ? "no Chromium-based browser" : false };
let app: Awaited<ReturnType<typeof openApp>>;
let server: Server;
let browsers: Browsers;
let page: BrowserPage;
let base = "";
let session = 0;

const run = async <T>(script: string, on = page): Promise<T> =>
    JSON.parse(await on.evaluate(script)) as T;
const has = (selector: string) =>
    run<boolean>(`return JSON.stringify(!!document.querySelector(${JSON.stringify(selector)}));`);

const settle = async () => {
    await until(
        () =>
            run<boolean>(
                `return JSON.stringify(document.getAnimations().every(a => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity || a.effect?.target?.closest?.(".notices")));`,
            ),
        "sheet animation",
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
};

before(async () => {
    if (real.skip) {
        return;
    }

    const data = join(root, "settings-copy");
    const dropIns = join(data, "extensions");
    const examples = fileURLToPath(new URL("../docs/examples/", import.meta.url));

    mkdirSync(dropIns, { recursive: true });
    copyFileSync(join(examples, "settings-sheet.ts"), join(dropIns, "settings-sheet.ts"));
    // The test can inspect public calls without adding a test-only export to the example.
    writeFileSync(
        join(dropIns, "settings-sheet.js"),
        readFileSync(join(examples, "settings-sheet.js"), "utf8").replace(
            "export default function setup(pocket) {",
            "export default function setup(pocket) { globalThis.settingsPocket = pocket;",
        ),
    );
    app = await openApp(scriptedModel(), data);
    await app.setExtensionEnabled(owner(app), "settings-sheet.ts", true);
    session = Number(await newSession(app));
    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart() {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browsers = new Browsers({
        dataDir: mkdtempSync(join(root, "settings-browser-")),
        load: async () => undefined,
        save() {},
    });
    page = await browsers.open(1);
    await page.setViewport({ width: 390, height: 844, scale: 1, mobile: true });
    await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
});

after(async () => {
    await browsers?.closeAll({ final: true });
    server?.closeAllConnections();
    server?.close();
    await app?.close();
    cleanUp();
});

test(
    "custom settings open from Home and a session, save safely, and preserve Back",
    real,
    async () => {
        for (const path of ["/", `/s/${session}`]) {
            await page.navigate(base + path);
            await until(
                () => run<boolean>(`return JSON.stringify(!!globalThis.settingsPocket);`),
                "browser module",
            );
            await run(
                `const {openSheet} = await import("/store.js"); openSheet({type:"extensions",tab:"installed"}); return "null";`,
            );
            const row = '[aria-controls="ext-more-settings-sheet-ts"]';

            await until(() => has(row), "the named module row");
            await settle();
            await page.click({ selector: row });
            await until(() => has(".ext-row-more .button:not(:disabled)"), "module controls");
            assert.equal(
                await run(
                    `return JSON.stringify(document.querySelector(".ext-settings").closest("details").open);`,
                ),
                false,
                "the basic form stays collapsed when the custom sheet is ready",
            );
            assert.equal(
                await run(`return JSON.stringify(globalThis.settingsPocket.title);`),
                "Greeting preferences",
            );
            await settle();
            await run(
                `const button = [...document.querySelectorAll(".ext-row-more button")].find(b => b.textContent.trim() === "Open settings"); button.click(); return "null";`,
            );
            await until(() => has('input[name="apiKey"]'), "custom settings sheet");
            assert.equal(
                await run(`return JSON.stringify(globalThis.settingsPocket.conversationId());`),
                path === "/" ? null : session,
            );
            assert.equal(
                await run(
                    `return JSON.stringify(document.documentElement.scrollWidth <= innerWidth);`,
                ),
                true,
            );
            await settle();
            // Exercise the example's save button, not just the endpoint.
            await run(
                `const input = document.querySelector('input[name="greeting"]'); input.value = "Welcome"; input.dispatchEvent(new Event("input", {bubbles:true})); return "null";`,
            );
            await run(
                `const input = document.querySelector('input[name="apiKey"]'); input.value = "example-test-secret"; input.dispatchEvent(new Event("input", {bubbles:true})); return "null";`,
            );
            await run(
                `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Save settings").click(); return "null";`,
            );
            await until(
                () => app.config.extensionSettings("settings-sheet").greeting === "Welcome",
                "saved greeting",
            );
            await until(
                () =>
                    run<boolean>(
                        `return JSON.stringify(document.querySelector('input[name="apiKey"]').value === "");`,
                    ),
                "secret input cleared",
            );
            const saved = await run<{ values: Record<string, unknown>; set: string[] }>(
                `return JSON.stringify(await globalThis.settingsPocket.saveSettings({greeting:"Again"}));`,
            );

            assert.equal(saved.values.greeting, "Again");
            assert.equal(Object.hasOwn(saved.values, "apiKey"), false);
            assert.ok(saved.set.includes("apiKey"));
            assert.doesNotMatch(JSON.stringify(saved), /example-test-secret/);
            assert.equal(
                app.config.extensionSettings("settings-sheet").apiKey,
                "example-test-secret",
            );
            await run(
                `await globalThis.settingsPocket.saveSettings({apiKey:null}); return "null";`,
            );
            assert.equal(app.config.extensionSettings("settings-sheet").apiKey, undefined);
            await page.click({ selector: ".sheet-back" });
            await until(() => has(row), "Back to Extensions");
            await settle();
        }
    },
);

test(
    "basic settings remain usable in safe mode and after a browser module fails",
    real,
    async () => {
        for (const mode of ["safe", "failed"]) {
            if (mode === "failed") {
                writeFileSync(
                    join(root, "settings-copy", "extensions", "settings-sheet.js"),
                    'export default () => { throw new Error("test client failure"); };',
                );
            }

            await page.navigate(`${base}/?noext=${mode === "safe" ? "1" : "0"}`);
            await until(
                () =>
                    run<boolean>(
                        `const {browserModuleState} = await import("/extension-ui.js"); return JSON.stringify(browserModuleState("settings-sheet")?.status === ${JSON.stringify(mode === "safe" ? "off" : "failed")});`,
                    ),
                "client status",
            );
            await run(
                `const {openSheet} = await import("/store.js"); openSheet({type:"extensions",tab:"installed"}); return "null";`,
            );
            const row = '[aria-controls="ext-more-settings-sheet-ts"]';

            await until(() => has(row), "module row");
            await settle();
            await page.click({ selector: row });
            await until(() => has("#ext-setting-settings-sheet-greeting"), "basic settings input");
            assert.equal(
                await run(
                    `return JSON.stringify(document.querySelector(".ext-settings").closest("details").open);`,
                ),
                true,
            );
            await settle();
            await run(
                `const input = document.querySelector("#ext-setting-settings-sheet-greeting"); input.value = ${JSON.stringify("Fallback ")} + ${JSON.stringify(mode)}; input.dispatchEvent(new Event("input", {bubbles:true})); return "null";`,
            );
            await run(`document.querySelector(".ext-settings .primary").click(); return "null";`);
            await until(
                () =>
                    app.config.extensionSettings("settings-sheet").greeting === `Fallback ${mode}`,
                "basic settings save",
            );
        }
    },
);

test(
    "browser saveSettings cannot give a guest owner rights or write another module",
    real,
    async () => {
        // A public browser module can read settings, but must still pass core's owner-only save check.
        const dropIns = join(root, "settings-copy", "extensions");

        writeFileSync(
            join(dropIns, "shared-settings.ts"),
            `export default (_host, web) => {
        web.settings([{name:"value",label:"Value",type:"text",default:"original"}]);
        web.client("shared-settings.js", {access:"view"});
    };`,
        );
        writeFileSync(
            join(dropIns, "shared-settings.js"),
            `export default pocket => { globalThis.sharedSettings = pocket; };`,
        );
        await app.setExtensionEnabled(owner(app), "shared-settings.ts", true);
        const guest = app.config.addUser("Reader", "guest");
        const other = await browsers.open(2);

        try {
            await other.navigate(`${base}/login?token=${encodeURIComponent(guest.token)}`);
            await until(
                () => run<boolean>(`return JSON.stringify(!!globalThis.sharedSettings);`, other),
                "guest browser module",
            );
            assert.equal(
                await run(
                    `return JSON.stringify((await globalThis.sharedSettings.settings()).values.value);`,
                    other,
                ),
                "original",
            );
            assert.equal(
                await run(
                    `try { await globalThis.sharedSettings.saveSettings({value:"changed"}); return "null"; } catch (e) { return JSON.stringify(e.status); }`,
                    other,
                ),
                403,
            );
            assert.equal(app.config.extensionSettings("shared-settings").value, undefined);
        } finally {
            await browsers.close(2);
            app.config.removeUser(guest.user.id);
        }
    },
);
