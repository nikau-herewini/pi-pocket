// Publication stays unavailable; extension dependency resolution still handles nested and hoisted packages.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { modulesWith } from "../src/server/config.ts";
import { prepareDropInFolder } from "../src/server/reload.ts";

const ROOT = new URL("..", import.meta.url);

test("modulesWith finds packages that npm put in a node_modules folder above Pi Pocket", (t) => {
    const temp = mkdtempSync(join(tmpdir(), "pocket-npm-"));

    t.after(() => rmSync(temp, { recursive: true, force: true }));

    const hoisted = join(temp, "node_modules");
    const app = join(hoisted, "pi-pocket");
    const own = join(app, "node_modules");

    mkdirSync(join(hoisted, "preact"), { recursive: true });
    writeFileSync(join(hoisted, "preact", "package.json"), "{}");
    mkdirSync(join(own, "htm"), { recursive: true });
    writeFileSync(join(own, "htm", "package.json"), "{}");

    assert.equal(modulesWith("preact", app), hoisted);
    assert.equal(modulesWith("htm", app), own);
    assert.equal(modulesWith("missing", app), own);
});

test("the rolling fork has no npm publishing configuration", () => {
    const manifest = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));

    assert.equal(manifest.private, true);
    assert.equal(manifest.files, undefined);
    assert.equal(manifest.publishConfig, undefined);

    for (const hook of [
        "prepack",
        "postpack",
        "prepublish",
        "prepublishOnly",
        "publish",
        "postpublish",
    ]) {
        assert.equal(manifest.scripts?.[hook], undefined, `${hook} must not return`);
    }

    assert.equal(existsSync(new URL(".github/workflows/publish.yml", ROOT)), false);
    assert.equal(existsSync(new URL("npm-shrinkwrap.json", ROOT)), false);
});

test("drop-ins can import dependencies split between nested and hoisted folders", (t) => {
    const temp = mkdtempSync(join(tmpdir(), "pocket-npm-"));

    t.after(() => rmSync(temp, { recursive: true, force: true }));

    const hoisted = join(temp, "project", "node_modules");
    const app = join(hoisted, "pi-pocket");
    const own = join(app, "node_modules");
    const dropIn = join(temp, "data", "extensions");
    const packages = [
        ["@review/nested", own, "nested"],
        ["@review/hoisted", hoisted, "hoisted"],
    ] as const;

    for (const [name, modules, value] of packages) {
        const folder = join(modules, name);

        mkdirSync(folder, { recursive: true });
        writeFileSync(
            join(folder, "package.json"),
            JSON.stringify({ name, type: "module", exports: "./index.js" }),
        );
        writeFileSync(join(folder, "index.js"), `export const value = "${value}";`);
    }

    prepareDropInFolder(
        dropIn,
        own,
        Object.fromEntries(packages.map(([name]) => [name, modulesWith(name, app)])),
    );

    const entry = join(dropIn, "probe.mjs");

    writeFileSync(
        entry,
        'import { value as a } from "@review/nested";\n' +
            'import { value as b } from "@review/hoisted";\nconsole.log(a, b);\n',
    );

    const run = spawnSync(process.execPath, [entry], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "nested hoisted\n");
});
