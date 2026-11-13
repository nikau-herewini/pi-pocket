// Shared extension settings for local management and gallery details.
import { useEffect, useState } from "preact/hooks";
import { browserModuleState, ExtensionSettingsButton } from "../extension-ui.js";
import { api, store } from "../store.js";
import { html, Loader, Switch } from "../ui.js";

/**
 * A module's settings (`web.settings`), for the owner: each field as the module declared it, saved together. A secret
 * shows only whether it is set; typing a new one replaces it, and Clear puts its default back.
 */
function ModuleSettings({ module }) {
    const [shown, setShown] = useState(null);
    const [draft, setDraft] = useState({});
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const path = `extension-settings/${encodeURIComponent(module)}`;

    useEffect(() => {
        // Only the answer for the module shown now: a slower one for another module never takes its place.
        let live = true;

        setShown(null);
        setDraft({});
        setError(null);
        api(path).then(
            (answer) => live && setShown(answer),
            (failure) => live && setError(failure.message),
        );

        return () => {
            live = false;
        };
    }, [module]);

    if (error && !shown) {
        return html`<div class="error-box small">${error}</div>`;
    }

    if (!shown) {
        return html`<${Loader} label="Settings" />`;
    }

    // What a field shows: the owner's change, the default when they asked for it back (null), or the value now.
    const value = (field) => {
        if (!Object.hasOwn(draft, field.name)) {
            return shown.values[field.name] ?? "";
        }

        return draft[field.name] === null ? (field.default ?? "") : draft[field.name];
    };

    const set = (name, next) => setDraft({ ...draft, [name]: next });

    const save = async () => {
        setError(null);

        // A number is typed as text ("-", "1."), and becomes a number only now; an empty one puts the default back.
        const unreadable = shown.fields.find(
            (field) =>
                field.type === "number" &&
                typeof draft[field.name] === "string" &&
                draft[field.name].trim() !== "" &&
                !Number.isFinite(Number(draft[field.name])),
        );

        if (unreadable !== undefined) {
            setError(`${unreadable.label} must be a number.`);

            return;
        }

        setBusy(true);

        const change = Object.fromEntries(
            Object.entries(draft).map(([name, next]) => {
                const field = shown.fields.find((each) => each.name === name);

                if (field?.type !== "number" || typeof next !== "string") {
                    return [name, next];
                }

                return [name, next.trim() === "" ? null : Number(next)];
            }),
        );

        try {
            setShown(await api(path, change, { method: "PUT" }));
            setDraft({});
        } catch (failure) {
            setError(failure.message);
        } finally {
            setBusy(false);
        }
    };

    return html`<div class="ext-settings">
        <div class="small"><b>Settings</b></div>
        ${shown.fields.map((field) => {
            const secret = field.type === "text" && field.secret;
            const id = `ext-setting-${module}-${field.name}`;
            const range =
                field.type === "number" && (field.min !== undefined || field.max !== undefined)
                    ? `From ${field.min ?? "any"} to ${field.max ?? "any"}`
                    : undefined;
            const hint =
                secret && shown.set.includes(field.name)
                    ? "Set: type to replace"
                    : (field.placeholder ?? "");

            return html`<div class="setting wrap" key=${field.name}>
                <div class="grow">
                    <label class="small" for=${id}>${field.label}</label>
                    ${field.description && html`<div class="muted small">${field.description}</div>`}
                </div>
                ${
                    field.type === "boolean"
                        ? html`<${Switch}
                              on=${value(field) === true}
                              label=${field.label}
                              onChange=${() => set(field.name, value(field) !== true)}
                          />`
                        : field.type === "choice"
                          ? html`<select
                                id=${id}
                                value=${value(field)}
                                onChange=${(event) => set(field.name, event.currentTarget.value)}
                            >
                                ${field.choices.map(
                                    (choice) =>
                                        html`<option value=${choice.value}>${choice.label}</option>`,
                                )}
                            </select>`
                          : html`<input
                                id=${id}
                                class="ext-setting-input"
                                type=${secret ? "password" : "text"}
                                inputmode=${field.type === "number" ? "decimal" : undefined}
                                autocomplete="off"
                                placeholder=${hint}
                                value=${secret ? (draft[field.name] ?? "") : value(field)}
                                title=${range}
                                onInput=${(event) => set(field.name, event.currentTarget.value)}
                            />`
                }
                ${
                    shown.set.includes(field.name) &&
                    html`<button
                        class="button small"
                        title="Put its default back"
                        disabled=${busy}
                        onClick=${() => set(field.name, null)}
                    >
                        ${secret ? "Clear" : "Default"}
                    </button>`
                }
            </div>`;
        })}
        ${error && html`<div class="error-box small">${error}</div>`}
        <div class="ext-step-actions">
            <button
                class="button small primary"
                disabled=${busy || Object.keys(draft).length === 0}
                onClick=${save}
            >
                ${busy ? "Saving…" : "Save settings"}
            </button>
        </div>
    </div>`;
}

/** Custom sheets never remove the core form: it remains available if a client fails or safe mode is on. */
export function ExtensionSettings({ module }) {
    if (!module?.enabled || !module.web?.settings || store.state.me?.role !== "owner") {
        return null;
    }

    const name = module.file.replace(/\.ts$/, "");

    if (!module.web.settingsSheet) {
        return html`<${ModuleSettings} module=${name} />`;
    }

    const ready = browserModuleState(name)?.status === "ready";

    return html`<div>
        <${ExtensionSettingsButton} module=${module} />
        <details open=${!ready}>
            <summary>Basic settings</summary>
            ${!ready && html`<p class="muted small">The custom settings sheet is unavailable in this tab. Use the basic form below.</p>`}
            <${ModuleSettings} module=${name} />
        </details>
    </div>`;
}
