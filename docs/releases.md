# Releases

This fork uses a rolling, commit-based maintenance model. It does not maintain its own semantic versions, Git tags, GitHub releases, release branches, or npm packages.

## Identifying a build

- `main` contains the reviewed fork changes. Every change must go through a pull request to `main`, including upstream integrations.
- Use the full Git commit SHA to identify source code. The [commit history](https://github.com/nikau-herewini/pi-pocket/commits/main/) and merged pull requests are the change log.
- Versions in `package.json`, `package-lock.json`, API documentation, and the app are inherited upstream metadata. They are not fork release identifiers. Do not bump them for fork changes or remove versions required by tooling.
- Upstream integrations can change that metadata without creating a fork release. The pristine `upstream` branch mirrors upstream source without syncing Git tags ([upstream integration](../.github/UPSTREAM_SYNC.md)).

## Publishing

- Docker images publish from `main` as `latest` and `sha-<full-commit-sha>`. These are container image tags, not Git tags or semantic releases.
- `latest` moves as builds succeed. A SHA image tag records the source commit, but rebuilding that commit can change the image. Pin `@sha256:…` for an immutable deployment ([Docker instructions](docker.md#published-images)).
- GitHub Pages publishes documentation from `main`. It does not wait for a release or a version bump.
- This fork has no npm publishing workflow, packaging allowlist, or pack/publish lifecycle hooks. Its package stays `private` to prevent accidental npm publication. `npm install -g pi-pocket` and `npx pi-pocket` install upstream, not this fork.

## Supported runtime

Docker is the only supported deployment runtime. Use the published image at `ghcr.io/nikau-herewini/pi-pocket:latest`, a `sha-<full-commit-sha>` tag, or an immutable digest reference. The default Compose service uses `${PI_POCKET_IMAGE:-ghcr.io/nikau-herewini/pi-pocket:latest}` without a build block. Set `PI_POCKET_IMAGE` in `.env` to select a different published tag or digest.

Source checkouts and local image builds are for development and testing only. Host npm installations, native systemd services, Nix, and Android/Termux are not supported deployment paths. This does not restrict phone browsers from using the Docker deployment.

## Updating a deployment

Record the current image reference and digest. Review the pull requests between the current and target commits, especially database and compatibility changes. Stop the service and back up all persistent folders, including Pi's credentials and workspace, before updating.

If `PI_POCKET_IMAGE` pins a SHA tag or digest, change it to the target image first. Then pull and recreate the container:

```bash
docker compose pull
docker compose up -d --no-build --force-recreate
```

Do not update application files inside the container with npm or Git. In-app image updates are unavailable: updates replace containers, not application files in the running image. A server restart alone does not load a new image; updates must pull and recreate the container.

To roll back, select the previous image digest and recreate the container. A rollback after a data migration can also require restoring the matching backup. See the [Docker instructions](docker.md) for mounts and access settings.

## Updating a source checkout

This section is for development and testing only. Use a clean source checkout and separate test data. Save local work, record `git rev-parse HEAD`, then use `git pull --ff-only origin main` and `npm ci`. Run the checks and throwaway server described in the [development guide](../README.md#development). This is not a deployment update procedure.

## Change notes

Describe user-visible changes, migration steps, and validation in each pull request. Use [release-notes.md](release-notes.md) as the change-note guide; do not create a version bump, tag, or release to accompany a fork change.
