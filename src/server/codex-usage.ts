/** Best-effort ChatGPT Codex subscription usage. This is an undocumented endpoint, not Pi's spend accounting. */
import { HttpError } from "./errors.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CLAIM = "https://api.openai.com/auth";

export interface UsageWindow {
    remaining: number;
    windowMinutes?: number;
    resetAt?: number;
}

export interface CodexUsage {
    checkedAt: number;
    blocked?: boolean;
    primary?: UsageWindow;
    secondary?: UsageWindow;
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/** Extract only the account id. Never send the bearer token or any other claim to the browser. */
function accountId(token: string): string | undefined {
    try {
        const payload = object(
            JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()),
        );
        const id = object(payload?.[CLAIM])?.chatgpt_account_id;

        return typeof id === "string" && id.length > 0 ? id : undefined;
    } catch {
        return undefined;
    }
}

function window(value: unknown, now: number): UsageWindow | undefined {
    const data = object(value);
    const used = data?.used_percent;

    if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100) {
        return undefined;
    }

    const seconds = data?.limit_window_seconds;
    const reset = data?.reset_at;
    const after = data?.reset_after_seconds;
    const resetAt =
        typeof reset === "number" && Number.isFinite(reset) && reset > 0
            ? reset * 1000
            : typeof after === "number" && Number.isFinite(after) && after >= 0
              ? now + after * 1000
              : undefined;

    return {
        remaining: Math.round((100 - used) * 10) / 10,
        ...(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
            ? { windowMinutes: seconds / 60 }
            : {}),
        ...(resetAt === undefined ? {} : { resetAt }),
    };
}

/** Parse only window figures the provider supplies. Missing windows are not assumed to be full. */
export function parseCodexUsage(value: unknown, now = Date.now()): CodexUsage | undefined {
    const rate = object(object(value)?.rate_limit);
    const primary = window(rate?.primary_window, now);
    const secondary = window(rate?.secondary_window, now);
    const blocked = rate?.allowed === false || rate?.limit_reached === true;

    if (primary === undefined && secondary === undefined && !blocked) {
        return undefined;
    }

    return {
        checkedAt: now,
        ...(blocked ? { blocked: true } : {}),
        ...(primary === undefined ? {} : { primary }),
        ...(secondary === undefined ? {} : { secondary }),
    };
}

/** Ask OpenAI with Pi's refreshed OAuth token, but return only sanitized usage figures. */
export async function codexUsage(
    token: string,
    fetcher: typeof fetch = fetch,
): Promise<CodexUsage> {
    const id = accountId(token);

    if (id === undefined) {
        throw new HttpError(502, "Codex usage is unavailable for this sign-in.");
    }

    let response: Response;

    try {
        response = await fetcher(USAGE_URL, {
            headers: { Authorization: `Bearer ${token}`, "chatgpt-account-id": id },
            redirect: "error",
            signal: AbortSignal.timeout(8_000),
        });
    } catch {
        throw new HttpError(502, "Could not reach Codex usage. Try again later.");
    }

    if (!response.ok) {
        throw new HttpError(502, "Codex usage is unavailable. Try again later.");
    }

    try {
        const usage = parseCodexUsage(await response.json());

        if (usage !== undefined) {
            return usage;
        }
    } catch {
        // An undocumented endpoint can change its response format without breaking the Providers sheet.
    }

    throw new HttpError(502, "Codex did not return usage windows.");
}
