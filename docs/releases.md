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

## Updating a source checkout

Stop the server and back up its data before updating. Start with a clean checkout: commit or save any local work before switching branches. Review the pull requests between your current commit and the target commit, especially database and compatibility changes.

```bash
git rev-parse HEAD       # record the current commit for recovery
git switch main
git pull --ff-only origin main
npm ci
npm start
```

The upstream version/release-based in-app updater is not this fork's update mechanism. Turn off **Look for new versions** under Menu → Extensions → Installed → **Pi Pocket updates** to avoid irrelevant release checks. Use the source procedure above, or pull and recreate a published container. A rollback after a data migration can require restoring the backup as well as the previous code.

## Change notes

Describe user-visible changes, migration steps, and validation in each pull request. Use [release-notes.md](release-notes.md) as the change-note guide; do not create a version bump, tag, or release to accompany a fork change.
