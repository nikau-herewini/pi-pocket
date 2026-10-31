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

test("the Forgejo client builds pinned source against the runtime's Debian release", () => {
    const installer = source("docker/install-fj.sh");
    const dockerfile = source("docker/Dockerfile");

    assert.match(installer, /forgejo-cli v0\.7\.0/);
    assert.match(installer, /commit=d014eb8ed5ff8b5793e135f2b4b99a5fb5793c2b/);
    assert.equal([...installer.matchAll(/checksum=[a-f0-9]{64}/g)].length, 1);
    assert.match(installer, /cargo build --release --locked/);
    assert.match(dockerfile, /FROM rust:1\.94\.0-bookworm AS forgejo-cli/);
    assert.match(dockerfile, /COPY --from=forgejo-cli \/out\/fj \/usr\/local\/bin\/fj/);
    assert.match(dockerfile, /RUN fj version/);
    assert.ok(installer.indexOf("sha256sum --check") < installer.indexOf("tar -xzf"));
    assert.match(installer, /install -D -m 0755/);
    assert.match(installer, /\/out\/fj version/);
    assert.match(dockerfile, /RUN sh \/tmp\/install-fj\.sh/);
    assert.match(
        source(".github/workflows/docker-check.yml"),
        /--user 1000:1000 pi-pocket-smoke fj version/,
    );
    assert.doesNotMatch(dockerfile, /ARG .*TOKEN|ENV .*TOKEN/);

    const syntax = spawnSync("sh", ["-n"], { input: installer, encoding: "utf8" });

    assert.equal(syntax.status, 0, syntax.stderr);
});

test("publication and smoke tests target native AMD64 only", () => {
    const publish = source(".github/workflows/docker-publish.yml");
    const smoke = source(".github/workflows/docker-check.yml");

    for (const workflow of [publish, smoke]) {
        assert.match(workflow, /runs-on: ubuntu-latest/);
        assert.match(workflow, /platforms: linux\/amd64/);
        assert.doesNotMatch(workflow, /setup-qemu-action|linux\/arm64|ubuntu-24\.04-arm/);
        assert.doesNotMatch(workflow, /matrix\./);
    }

    assert.match(publish, /push: true/);
    assert.match(publish, /scope=docker-publish-amd64/);
    assert.match(smoke, /scope=docker-check-amd64/);
    assert.match(publish, /type=sha,format=long,prefix=sha-/);
    assert.match(publish, /type=raw,value=latest/);
    assert.match(source("docs/docker.md"), /linux\/amd64` only/);
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
