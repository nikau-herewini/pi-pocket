// Subscription allowance follows the provider row, never an API-key connection or a guest.
import { cleanUp, openApp, root, scriptedModel, until } from "./helpers.ts";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, test } from "node:test";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import { VIEWPORTS } from "../src/server/browser/viewport.ts";
import { createHandler } from "../src/server/http.ts";

after(cleanUp);

test(
    "OpenAI and legacy allowance load and refresh on a phone, but API keys and guests do not load usage",
    {
        skip: findBrowser() === undefined ? "no Chromium-based browser on this machine" : false,
    },
    async () => {
        const app = await openApp(scriptedModel());
        const server = createServer(
            createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
        );

        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const browsers = new Browsers({
            dataDir: mkdtempSync(join(root, "providers-ui-")),
            load: async () => undefined,
            save: () => {},
        });

        try {
            const page = await browsers.open(1);

            await page.setViewport(VIEWPORTS.mobile);
            await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
            await until(
                async () =>
                    JSON.parse(
                        await page.evaluate(
                            `return JSON.stringify((await import('/store.js')).store.state.me?.role === 'owner')`,
                        ),
                    ),
                "owner signed in",
            );
            await page.evaluate(`
            const original = globalThis.fetch;
            window.usageRequests = [];
            window.subscription = true;
            globalThis.fetch = async (url, init) => {
                if (url === '/api/providers') {
                    return new Response(JSON.stringify(['openai', 'openai-codex'].map(id => ({
                        id, name: id === 'openai' ? 'OpenAI' : 'OpenAI Codex (legacy)',
                        configured: true, subscription: window.subscription, models: 1,
                        apiKey: true, oauth: 'ChatGPT',
                    }))));
                }
                if (typeof url === 'string' && /^\\/api\\/providers\\/[^/]+\\/usage$/.test(url)) {
                    window.usageRequests.push(url);
                    return new Response(JSON.stringify({ checkedAt: Date.now(),
                        primary: { remaining: 80, windowMinutes: 300, resetAt: Date.now() + 3600000 },
                        secondary: { remaining: 65, windowMinutes: 10080 },
                    }));
                }
                return original(url, init);
            };
            const { openSheet } = await import('/store.js');
            openSheet({ type: 'providers' });
        `);
            const state = async () =>
                JSON.parse(
                    await page.evaluate(`return JSON.stringify({
            count: document.querySelectorAll('.codex-usage').length,
            text: document.body.innerText,
            requests: window.usageRequests,
            overflow: document.documentElement.scrollWidth > innerWidth,
        })`),
                );

            await until(
                async () =>
                    (await state()).requests.length === 2 &&
                    (await state()).text.includes("65% left"),
                "both subscription windows",
            );
            const shown = await state();

            assert.equal(shown.count, 2);
            assert.match(shown.text, /5-hour window/);
            assert.match(shown.text, /1-week window/);
            assert.match(shown.text, /Resets/);
            assert.equal(shown.overflow, false);
            assert.deepEqual(shown.requests.sort(), [
                "/api/providers/openai-codex/usage",
                "/api/providers/openai/usage",
            ]);
            await page.evaluate(`document.querySelector('.codex-usage button').click()`);
            await until(
                async () => (await state()).requests.length === 3,
                "refresh for the selected provider",
            );

            for (const guest of [false, true]) {
                await page.evaluate(`
                const { store, openSheet } = await import('/store.js');
                store.set({ sheet: null });
                await new Promise(resolve => setTimeout(resolve, 400));
                window.subscription = ${guest};
                window.usageRequests = [];
                ${guest ? "store.set({ me: { ...store.state.me, role: 'guest' } });" : ""}
                openSheet({ type: 'providers' });
            `);
                await until(
                    async () => (await state()).text.includes("OpenAI Codex (legacy)"),
                    "provider rows reopened",
                );
                assert.equal((await state()).count, 0);
                assert.deepEqual((await state()).requests, []);
            }

            assert.deepEqual(
                page.logs().filter((entry) => entry.level === "error"),
                [],
            );
        } finally {
            await browsers.closeAll({ final: true });
            server.closeAllConnections();
            server.close();
            await app.close();
        }
    },
);
