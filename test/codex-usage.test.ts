import assert from "node:assert/strict";
import { test } from "node:test";
import { codexUsage, parseCodexUsage } from "../src/server/codex-usage.ts";
import { HttpError } from "../src/server/errors.ts";

const token = `header.${Buffer.from(
    JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: "account-123", other: "private" },
    }),
).toString("base64url")}.signature`;

test("parses only supplied windows, with remaining percentage and reset times", () => {
    const usage = parseCodexUsage(
        {
            plan_type: "plus",
            rate_limit: {
                primary_window: {
                    used_percent: 25.54,
                    limit_window_seconds: 18_000,
                    reset_after_seconds: 60,
                },
                secondary_window: {
                    used_percent: 75,
                    limit_window_seconds: 604_800,
                    reset_at: 1_700_000_000,
                },
            },
        },
        1_600_000_000_000,
    );

    assert.deepEqual(usage, {
        checkedAt: 1_600_000_000_000,
        primary: { remaining: 74.5, windowMinutes: 300, resetAt: 1_600_000_060_000 },
        secondary: { remaining: 25, windowMinutes: 10_080, resetAt: 1_700_000_000_000 },
    });
    assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window: { used_percent: 0 } } }, 1), {
        checkedAt: 1,
        primary: { remaining: 100 },
    });
    assert.equal(
        parseCodexUsage({ rate_limit: { primary_window: { used_percent: "0" } } }),
        undefined,
    );
    assert.deepEqual(parseCodexUsage({ rate_limit: { allowed: false } }, 1), {
        checkedAt: 1,
        blocked: true,
    });
    assert.deepEqual(
        parseCodexUsage(
            { rate_limit: { limit_reached: true, primary_window: { used_percent: 0 } } },
            1,
        ),
        { checkedAt: 1, blocked: true, primary: { remaining: 100 } },
    );
});

test("Codex request uses the OAuth account and sends only sanitized windows to the UI", async () => {
    const usage = await codexUsage(token, (async (url, init) => {
        assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
        assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
        assert.equal(
            (init?.headers as Record<string, string>)["chatgpt-account-id"],
            "account-123",
        );

        return new Response(
            JSON.stringify({
                rate_limit: { primary_window: { used_percent: 20 } },
                access_token: "never send me",
            }),
        );
    }) as typeof fetch);

    assert.equal(usage.primary?.remaining, 80);
    assert.equal(JSON.stringify(usage).includes("account-123"), false);
    assert.equal(JSON.stringify(usage).includes("never send me"), false);
});

test("Codex usage fails safely when the endpoint changes or the token has no account", async () => {
    await assert.rejects(
        codexUsage(token, (async () => new Response("not JSON")) as typeof fetch),
        (error: unknown) => error instanceof HttpError && error.status === 502,
    );
    await assert.rejects(
        codexUsage("invalid", (async () => {
            throw new Error("should not fetch");
        }) as typeof fetch),
        (error: unknown) => error instanceof HttpError && error.status === 502,
    );
});
