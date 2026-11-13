export default function setup(pocket) {
    const { html, useEffect, useState } = pocket;

    function Settings() {
        const [shown, setShown] = useState(null);
        const [greeting, setGreeting] = useState("");
        const [apiKey, setApiKey] = useState("");
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(false);

        useEffect(() => {
            let live = true;

            pocket.settings().then(
                (answer) => {
                    if (live) {
                        setShown(answer);
                        setGreeting(answer.values.greeting ?? "");
                    }
                },
                (failure) => live && setError(failure.message),
            );

            return () => {
                live = false;
            };
        }, []);

        async function save() {
            setBusy(true);
            setError(null);

            try {
                // Leaving the key blank preserves it. Never fill a password input with a saved secret.
                const patch = { greeting, ...(apiKey ? { apiKey } : {}) };

                setShown(await pocket.saveSettings(patch));
                setApiKey("");
            } catch (failure) {
                setError(failure.message);
            } finally {
                setBusy(false);
            }
        }

        if (!shown) {
            return error
                ? html`<div class="error-box">${error}</div>`
                : html`<${pocket.Loader} label="Loading settings" />`;
        }

        return html`<div>
            <label class="setting">
                Greeting
                <input
                    name="greeting"
                    value=${greeting}
                    onInput=${(event) => setGreeting(event.target.value)}
                />
            </label>
            <label class="setting">
                API key (${shown.set.includes("apiKey") ? "set" : "not set"})
                <input
                    name="apiKey"
                    type="password"
                    autocomplete="new-password"
                    value=${apiKey}
                    onInput=${(event) => setApiKey(event.target.value)}
                />
            </label>
            ${error && html`<div class="error-box">${error}</div>`}
            <button class="button primary" disabled=${busy} onClick=${save}>Save settings</button>
        </div>`;
    }

    pocket.sheet({
        id: "settings",
        title: "Greeting preferences",
        component: Settings,
        wide: true,
    });
}
