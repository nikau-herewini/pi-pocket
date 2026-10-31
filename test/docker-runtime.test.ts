import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

test("Compose deploys a published Docker image without a host source build", () => {
    const compose = source("docker-compose.yml");

    assert.match(
        compose,
        /image: \$\{PI_POCKET_IMAGE:-ghcr\.io\/nikau-herewini\/pi-pocket:latest\}/,
    );
    assert.doesNotMatch(compose, /^\s+build:/m);
    assert.match(
        source(".env.example"),
        /^PI_POCKET_IMAGE=ghcr\.io\/nikau-herewini\/pi-pocket:latest$/m,
    );
    assert.match(compose, /restart: unless-stopped/);
    assert.match(compose, /stop_grace_period: 30s/);
});

test("the runtime image includes the app but not the development test suite", () => {
    const dockerfile = source("docker/Dockerfile");

    assert.match(dockerfile, /COPY src \.\/src/);
    assert.match(dockerfile, /COPY web \.\/web/);
    assert.match(dockerfile, /COPY docs \.\/docs/);
    assert.doesNotMatch(dockerfile, /^COPY test\b/m);
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.match(dockerfile, /HEALTHCHECK/);
    assert.match(dockerfile, /ENTRYPOINT .*tini/);
});

test("Docker guide shell examples have valid syntax", () => {
    const examples = [...source("docs/docker.md").matchAll(/```bash\n([\s\S]*?)```/g)];

    assert.ok(examples.length > 0);

    for (const [, script] of examples) {
        const result = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });

        assert.equal(result.status, 0, result.stderr);
    }
});

test("host deployment packages and npm launcher shims are not shipped", () => {
    const manifest = JSON.parse(source("package.json"));
    const lockfile = JSON.parse(source("package-lock.json"));

    assert.equal(manifest.bin, undefined);
    assert.equal(lockfile.packages[""].bin, undefined);

    for (const path of [
        "flake.nix",
        "flake.lock",
        "nix",
        "contrib/systemd/pi-pocket@.service",
        "bin/strip-types.js",
    ]) {
        assert.equal(existsSync(new URL(path, ROOT)), false, `${path} must not return`);
    }
});
