// Clone a repository and start a session in it, from the folder picker's Clone: the repository's address, the folder
// it goes in (named for it, in the server's clone folder), and the picker's own worktree choice. The clone runs on the
// server: the sheet can close while it does, and a notice then offers the session.
import { useEffect, useRef, useState } from "preact/hooks";
import { actions, api, attempt, closeSheet, navigate, notify, store } from "../store.js";
import { sessionStarted } from "../extension-ui.js";
import { html, Icon, Sheet, shortPath, Spinner } from "../ui.js";

/** The folder name an address suggests, as the server makes it: its last part, without `.git`. */
export function repoName(url) {
    const name =
        url
            .trim()
            .replace(/[/\\]+$/, "")
            .replace(/\.git$/i, "")
            .split(/[/:]/)
            .pop() ?? "";

    return name === "." || name === ".." || name.startsWith("-") ? "" : name;
}

/** The clone under way, kept outside the sheet: going back and opening Clone again shows it. */
let job = null;

/** Start a session in a clone, as the folder picker's Open does. */
async function startIn(path, { worktree, fromList }) {
    const created = await actions.createSession(path, { worktree });

    navigate(created.id);

    if (fromList) {
        sessionStarted(created.id);
    }
}

function clone({ url, name, worktree, fromList }) {
    job = { url, name, worktree, error: null };
    store.set({});

    api("clone", { url, ...(name ? { name } : {}) }).then(
        async ({ path }) => {
            const open = store.state.sheet?.type === "clone";

            job = null;
            store.set({});

            if (open) {
                await attempt(() => startIn(path, { worktree, fromList }));

                return;
            }

            notify(
                "info",
                `Cloned into ${shortPath(path, store.state.server?.home)}. Tap to start a session there.`,
                () => attempt(() => startIn(path, { worktree, fromList })),
            );
        },
        (error) => {
            if (store.state.sheet?.type === "clone") {
                job = { ...job, error: error.message };
                store.set({});
            } else {
                job = null;
                notify("error", error.message);
            }
        },
    );
}

export function CloneSheet({ fromList = false, worktree: worktreeAtFirst = false }) {
    const { server } = store.state;
    const root = server?.cloneDir ?? "/workspace";
    const busy = job !== null && job.error === null;
    const [url, setUrl] = useState(job?.url ?? "");
    // The name follows the address until someone types one.
    const [name, setName] = useState(job?.name ?? "");
    const [named, setNamed] = useState(Boolean(job?.name));
    const [worktree, setWorktree] = useState(job?.worktree ?? worktreeAtFirst);
    const input = useRef(null);
    const folder = named ? name.trim() : repoName(url);
    const ready = url.trim() !== "" && folder !== "" && !/[/\\]/.test(folder) && !busy;

    useEffect(() => {
        if (!busy) {
            input.current?.focus();
        }
    }, []);

    const submit = (event) => {
        event.preventDefault();

        if (ready) {
            clone({ url: url.trim(), name: folder, worktree, fromList });
        }
    };

    const edited = () => {
        // Typing again after a failure starts afresh.
        if (job?.error) {
            job = null;
            store.set({});
        }
    };

    return html`<${Sheet} title="Clone a repository" onClose=${closeSheet} className="clone-sheet">
        <form class="clone-form" onSubmit=${submit}>
            <div class="field">
                <div class="label">Repository</div>
                <input
                    ref=${input}
                    class="mono"
                    aria-label="Repository address"
                    placeholder="https://github.com/owner/name or owner/name"
                    value=${url}
                    disabled=${busy}
                    autocapitalize="off"
                    autocomplete="off"
                    spellcheck="false"
                    inputmode="url"
                    enterkeyhint="go"
                    onInput=${(event) => {
                        setUrl(event.currentTarget.value);
                        edited();
                    }}
                />
            </div>
            <div class="field">
                <div class="label">Folder</div>
                <input
                    class="mono"
                    aria-label="Folder name"
                    placeholder="Named for the repository"
                    value=${folder}
                    disabled=${busy}
                    autocapitalize="off"
                    autocomplete="off"
                    spellcheck="false"
                    enterkeyhint="go"
                    onInput=${(event) => {
                        setName(event.currentTarget.value);
                        setNamed(true);
                        edited();
                    }}
                />
                <div class="muted small clone-target">
                    Clones into
                    <span class="mono">
                        ${shortPath(`${root.replace(/\/+$/, "")}/${folder || "…"}`, server?.home)}
                    </span>
                </div>
            </div>
            <label class="check" title="The session gets a branch of its own, apart from the clone">
                <input
                    type="checkbox"
                    checked=${worktree}
                    disabled=${busy}
                    onChange=${(event) => setWorktree(event.currentTarget.checked)}
                />
                Own git worktree
            </label>
            ${job?.error && html`<div class="error-box small">${job.error}</div>`}
            ${
                busy &&
                html`<p class="clone-busy" role="status">
                    <${Spinner} hidden=${true} />
                    <span>
                        Cloning <span class="mono">${job.url}</span>… You can close this: a notice says when it is done.
                    </span>
                </p>`
            }
            <div class="clone-buttons">
                <button type="button" class="button" onClick=${closeSheet}>
                    ${busy ? "Close" : "Cancel"}
                </button>
                <button type="submit" class="button primary" disabled=${!ready}>
                    <${Icon} name="download" size=${15} /> ${busy ? "Cloning…" : "Clone"}
                </button>
            </div>
        </form>
    <//>`;
}
