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

test("the Forgejo client installer pins both architectures and verifies before extraction", () => {
    const installer = source("docker/install-fj.sh");
    const dockerfile = source("docker/Dockerfile");

    assert.match(installer, /version=0\.7\.0/);
    assert.match(installer, /amd64\)[\s\S]*target=x86_64/);
    assert.match(installer, /arm64\)[\s\S]*target=aarch64/);
    assert.equal([...installer.matchAll(/checksum=[a-f0-9]{64}/g)].length, 2);
    assert.ok(installer.indexOf("sha256sum --check") < installer.indexOf("tar -xzf"));
    assert.match(installer, /install -m 0755/);
    assert.match(installer, /\/usr\/local\/bin\/fj --version/);
    assert.match(dockerfile, /RUN sh \/tmp\/install-fj\.sh/);
    assert.match(
        source(".github/workflows/docker-check.yml"),
        /--user 1000:1000 pi-pocket-smoke fj --version/,
    );
    assert.doesNotMatch(dockerfile, /ARG .*TOKEN|ENV .*TOKEN/);

    const syntax = spawnSync("sh", ["-n"], { input: installer, encoding: "utf8" });

    assert.equal(syntax.status, 0, syntax.stderr);
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
