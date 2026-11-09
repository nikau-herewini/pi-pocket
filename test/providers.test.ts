// Provider sign-ins must not store an empty API key, even when a client bypasses the form.
import { cleanUp, fakeTab, openApp, owner, scriptedModel, until } from "./helpers.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { Providers } from "../src/server/providers.ts";
import type { PocketApp } from "../src/server/app.ts";
import { createHandler } from "../src/server/http.ts";
import { HttpError } from "../src/server/errors.ts";

after(cleanUp);

for (const providerId of ["openai", "openai-codex"]) {
    test(`${providerId} usage refreshes only its own subscription and sanitizes the response`, async (t) => {
        const token = `header.${Buffer.from(
            JSON.stringify({
                "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
            }),
        ).toString("base64url")}.signature`;
        const providers = new Providers({
            models: {
                isUsingOAuth: (id: string) => id === providerId,
                getProvider: () => ({ name: providerId }),
                getAuth: async (id: string, options: { signal: AbortSignal }) => {
                    assert.equal(id, providerId);
                    assert.ok(options.signal instanceof AbortSignal);

                    return { auth: { apiKey: token } };
                },
            },
        } as unknown as PocketApp);
        const request = t.mock.method(
            globalThis,
            "fetch",
            async (url: string | URL | Request, init?: RequestInit) => {
                assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
                const headers = new Headers(init?.headers);

                assert.equal(headers.get("Authorization"), `Bearer ${token}`);
                assert.equal(headers.get("chatgpt-account-id"), "test-account");

                return new Response(
                    JSON.stringify({
                        rate_limit: {
                            primary_window: { used_percent: 20, limit_window_seconds: 18000 },
                            secondary_window: { used_percent: 35, limit_window_seconds: 604800 },
                        },
                        access_token: "private",
                    }),
                );
            },
        );

        const usage = await providers.usage(providerId);

        assert.deepEqual(usage.primary, { remaining: 80, windowMinutes: 300 });
        assert.deepEqual(usage.secondary, { remaining: 65, windowMinutes: 10080 });
        assert.equal(request.mock.callCount(), 1);
        assert.doesNotMatch(JSON.stringify(usage), /private|test-account|signature/);
        await assert.rejects(
            providers.usage("anthropic"),
            (error: unknown) => error instanceof HttpError && error.status === 404,
        );
    });
}

test("an empty API key is refused without consuming the prompt or storing a credential", async () => {
    const app = await openApp(scriptedModel());
    const user = owner(app);
    const tab = fakeTab(undefined, user);

    app.attach(tab.client);

    try {
        const flowId = app.providers.startLogin(user, "ant-ling", "api_key");

        await until(() => tab.last("auth")?.step === "prompt", "the API key prompt");
        const promptId = tab.last("auth")!.promptId as string;

        assert.throws(
            () => app.providers.answerLogin(user, flowId, promptId, " \t "),
            (error: unknown) => error instanceof HttpError && error.status === 400,
        );
        assert.equal(app.models.getProviderAuthStatus("ant-ling").source, undefined);
        app.providers.answerLogin(user, flowId, promptId, "test-key");
        await until(() => tab.last("auth")?.step === "done", "the sign-in to finish");
        assert.equal(tab.last("auth")?.ok, true);
        assert.equal(app.models.getProviderAuthStatus("ant-ling").source, "stored");
    } finally {
        await app.close();
    }
});

test("Codex subscription usage is owner-only and requires a subscription sign-in", async (t) => {
    const app = await openApp(scriptedModel());
    const server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api/providers`;

    try {
        for (const providerId of ["openai", "openai-codex"]) {
            const url = `${base}/${providerId}/usage`;
            const guest = app.config.addUser("Cal", "guest").token;
            const guestResponse = await fetch(url, {
                headers: { authorization: `Bearer ${guest}` },
            });

            assert.equal(guestResponse.status, 403);
            const ownerResponse = await fetch(url, {
                headers: { authorization: `Bearer ${app.config.ownerToken}` },
            });

            assert.equal(ownerResponse.status, 409);
            assert.match((await ownerResponse.json()).error, /subscription/);
        }

        const usage = { checkedAt: 1, primary: { remaining: 80, windowMinutes: 300 } };
        const requests: string[] = [];

        t.mock.method(app.providers, "usage", async (providerId: string) => {
            requests.push(providerId);

            return usage;
        });

        for (const providerId of ["openai", "openai-codex"]) {
            const response = await fetch(`${base}/${providerId}/usage`, {
                headers: { authorization: `Bearer ${app.config.ownerToken}` },
            });

            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), usage);
        }

        assert.deepEqual(requests, ["openai", "openai-codex"]);
    } finally {
        server.closeAllConnections();
        server.close();
        await app.close();
    }
});
