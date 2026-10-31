// Chromium starts with its config and cache folders in its profile: a `~/.config` it cannot write (made by root for a
// mount below it, in a container) must not stop it.
import { cleanUp, root } from "./helpers.ts";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { Chromium, launchEnv } from "../src/server/browser/cdp.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";

after(() => cleanUp());

test("Chromium's config and cache folders are made in its profile, the rest of the environment kept", () => {
    const profile = join(root, "env-profile");
    const env = launchEnv(profile, { PATH: "/bin", XDG_CONFIG_HOME: "/elsewhere" });

    assert.equal(env.PATH, "/bin");
    assert.equal(env.XDG_CONFIG_HOME, join(profile, "xdg-config"));
    assert.equal(env.XDG_CACHE_HOME, join(profile, "xdg-cache"));
    assert.ok(existsSync(env.XDG_CONFIG_HOME) && existsSync(env.XDG_CACHE_HOME));
});

const chromium = findBrowser();

test(
    "Chromium starts when the home's .config cannot be written",
    {
        skip:
            chromium === undefined
                ? "no Chromium-based browser on this machine"
                : process.getuid?.() === 0
                  ? "root can write any folder"
                  : false,
    },
    async (t) => {
        const home = mkdtempSync(join(root, "locked-home-"));
        const config = join(home, ".config");
        const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

        mkdirSync(config);
        chmodSync(config, 0o555);
        process.env.HOME = home;
        delete process.env.XDG_CONFIG_HOME;
        t.after(() => {
            chmodSync(config, 0o755);

            for (const [name, value] of Object.entries(saved)) {
                if (value === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = value;
                }
            }
        });

        // The arguments the app adds, as a container needs (`--no-sandbox`).
        const extra = process.env.PI_POCKET_BROWSER_ARGS?.split(/\s+/).filter(Boolean) ?? [];
        const chrome = await Chromium.launch(chromium!, mkdtempSync(join(root, "profile-")), extra);

        t.after(() => chrome.kill());
        assert.match(chrome.userAgent, /Chrome\//);
    },
);
