/**
 * Cloning a repository from the folder picker: what people may type for one (any git address, a local path, or GitHub's
 * `owner/name`), the folder it gets, where clones go, and whether a folder already there is a clone of the same one.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { HttpError } from "./errors.ts";
import { expandHome } from "./paths.ts";

/** How long a clone may take. */
export const CLONE_TIMEOUT_MS = 15 * 60_000;

/** The folder clones go in: `PI_POCKET_CLONE_DIR`, else `/workspace`; the server's own folder when it is not one. */
export function cloneRoot(fallback: string): string {
    const written = process.env.PI_POCKET_CLONE_DIR?.trim() || "/workspace";
    const root = resolve(expandHome(written));

    try {
        if (statSync(root).isDirectory()) {
            return root;
        }
    } catch {
        // Not there: the fallback.
    }

    return fallback;
}

/** Whether a name can be a folder's in the clone folder: one plain name, not `.` or `..`, nothing to read as an option. */
export function validFolderName(name: string): boolean {
    return (
        name !== "" &&
        name !== "." &&
        name !== ".." &&
        name.length <= 255 &&
        !name.startsWith("-") &&
        !/[/\\\0]/.test(name) &&
        name.trim() === name
    );
}

/** GitHub's short form, `owner/name`. */
const SHORT = /^[\w-][\w.-]*\/[\w.-]+$/;
/** An address with a scheme git knows. */
const SCHEME = /^(https?|ssh|git|file):\/\//i;
/** Git's scp-like form, `user@host:path`. */
const SCP = /^[\w.-]+@[\w.-]+:[^\s]/;

/**
 * What was typed, as an address for `git clone` and the folder name it suggests: `owner/name` is on GitHub, a path
 * starting `/` or `~` is a repository on this machine. A 400 for anything else.
 */
export function cloneSource(typed: string): { url: string; name: string } {
    const text = typed.trim();

    if (text === "") {
        throw new HttpError(400, "Give the repository's address.");
    }

    if (/[\s\0]/.test(text) || text.startsWith("-")) {
        throw new HttpError(400, `${text} is not a repository address.`);
    }

    let url;

    if (SHORT.test(text) && !text.startsWith(".")) {
        url = `https://github.com/${text.replace(/\.git$/, "")}.git`;
    } else if (SCHEME.test(text) || SCP.test(text)) {
        url = text;
    } else if (/^[~/]/.test(text)) {
        url = resolve(expandHome(text));
    } else {
        throw new HttpError(
            400,
            `${text} is not a repository address: say https://…, git@host:owner/name, or owner/name.`,
        );
    }

    const name =
        url
            .replace(/[/\\]+$/, "")
            .replace(/\.git$/i, "")
            .split(/[/:]/)
            .pop() ?? "";

    return { url, name: validFolderName(name) ? name : "" };
}

/**
 * A repository address reduced so two ways of writing it compare equal: `https://github.com/a/b.git`,
 * `git@github.com:a/b`, and `ssh://git@github.com:22/a/b/` all become `github.com/a/b`.
 */
export function remoteKey(url: string): string {
    let key = url.trim().toLowerCase();

    if (SCP.test(key) && !SCHEME.test(key)) {
        key = key.replace(/^([^@]+@)?([^:]+):/, "$2/");
    }

    return key
        .replace(/^[a-z+]+:\/\//, "")
        .replace(/^[^@/]+@/, "")
        .replace(/^([^/]+):\d+\//, "$1/")
        .replace(/\/+$/, "")
        .replace(/\.git$/, "")
        .replace(/\/+$/, "");
}
