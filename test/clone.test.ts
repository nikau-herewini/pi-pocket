// Cloning a repository from the folder picker: the address forms, the folder each gets, a clone already there, and
// who may clone.
import { type App, cleanUp, openApp, owner, root, scriptedModel } from "./helpers.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { cloneRoot, cloneSource, remoteKey, validFolderName } from "../src/server/clone.ts";

let app: App;
const upstream = join(root, "upstream", "demo.git");
const clones = join(root, "clones");
const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], {
        cwd,
        encoding: "utf8",
    }).trim();

before(async () => {
    const source = join(root, "source");

    mkdirSync(source, { recursive: true });
    git(source, "init", "-q", "-b", "main");
    writeFileSync(join(source, "README.md"), "demo\n");
    git(source, "add", "-A");
    git(source, "commit", "-qm", "first");
    mkdirSync(join(root, "upstream"), { recursive: true });
    git(root, "clone", "-q", "--bare", source, upstream);
    mkdirSync(clones);
    process.env.PI_POCKET_CLONE_DIR = clones;
    app = await openApp(scriptedModel());
});

after(async () => {
    await app?.close();
    delete process.env.PI_POCKET_CLONE_DIR;
    cleanUp();
});

test("addresses become git URLs and folder names", () => {
    assert.deepEqual(cloneSource("owner/name"), {
        url: "https://github.com/owner/name.git",
        name: "name",
    });
    assert.deepEqual(cloneSource(" https://gitlab.com/a/b.git/ "), {
        url: "https://gitlab.com/a/b.git/",
        name: "b",
    });
    assert.equal(cloneSource("git@github.com:a/tool.git").name, "tool");
    assert.equal(cloneSource("ssh://git@host:2222/a/c").name, "c");
    assert.equal(cloneSource("/srv/repos/d.git").url, "/srv/repos/d.git");

    for (const bad of ["", "--upload-pack=x", "just words", "name", "ext::sh -c x"]) {
        assert.throws(() => cloneSource(bad), { status: 400 }, bad);
    }

    for (const name of [".", "..", "a/b", "-x", " a", ""]) {
        assert.equal(validFolderName(name), false, name);
    }

    assert.equal(validFolderName("my-app.v2"), true);
});

test("two ways of writing one repository compare equal", () => {
    const key = "github.com/a/b";

    for (const url of [
        "https://github.com/a/b.git",
        "https://user@github.com/a/b",
        "git@github.com:a/b.git",
        "ssh://git@github.com:22/a/b/",
        "HTTPS://GitHub.com/A/B",
    ]) {
        assert.equal(remoteKey(url), key, url);
    }

    assert.equal(remoteKey("file:///srv/x.git"), remoteKey("/srv/x"));
});

test("the clone folder is PI_POCKET_CLONE_DIR, or the fallback when it is not a folder", () => {
    assert.equal(cloneRoot("/fallback"), clones);
    process.env.PI_POCKET_CLONE_DIR = join(root, "nowhere");
    assert.equal(cloneRoot("/fallback"), "/fallback");
    process.env.PI_POCKET_CLONE_DIR = clones;
    assert.equal(app.workspace.cloneDir, clones);
});

test("a clone lands in the clone folder, named for its repository, and opens again as it is", async () => {
    const path = await app.workspace.cloneRepo(owner(app), upstream);

    assert.equal(path, join(clones, "demo"));
    assert.ok(existsSync(join(path, "README.md")));
    // No hidden part is left beside it.
    assert.deepEqual(readdirSync(clones), ["demo"]);

    // The same repository, written another way: the clone there is the answer, and nothing is cloned again.
    writeFileSync(join(path, "mine.txt"), "kept\n");
    assert.equal(await app.workspace.cloneRepo(owner(app), `file://${upstream}`), path);
    assert.ok(existsSync(join(path, "mine.txt")));

    // Two asks at once clone once.
    const [one, two] = await Promise.all([
        app.workspace.cloneRepo(owner(app), upstream, "twice"),
        app.workspace.cloneRepo(owner(app), upstream, "twice"),
    ]);

    assert.equal(one, join(clones, "twice"));
    assert.equal(two, one);
});

test("a folder in the way, or a clone that fails, is an error and leaves nothing behind", async () => {
    mkdirSync(join(clones, "taken"));
    await assert.rejects(app.workspace.cloneRepo(owner(app), upstream, "taken"), {
        status: 409,
    });
    await assert.rejects(app.workspace.cloneRepo(owner(app), join(root, "missing.git")), {
        status: 502,
    });
    await assert.rejects(app.workspace.cloneRepo(owner(app), upstream, "../out"), {
        status: 400,
    });
    assert.ok(!existsSync(join(clones, "missing")));
    assert.ok(readdirSync(clones).every((name) => !name.startsWith(".")));
});

test("only people who may browse folders can clone", async () => {
    const viewer = app.config.addUser("Vic", "viewer").user;
    const scoped = app.config.addUser("Scoped Sam", "guest", ["1"]).user;

    await assert.rejects(app.workspace.cloneRepo(viewer, upstream, "v"), { status: 403 });
    await assert.rejects(app.workspace.cloneRepo(scoped, upstream, "s"), { status: 403 });
    assert.ok(!existsSync(join(clones, "v")) && !existsSync(join(clones, "s")));
});
