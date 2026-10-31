# Contributing to Pi Pocket

Thank you for your help. This page tells how to send a change.

## Before you start

- Read the [policies](docs/extensions/policies/index.md). They tell what belongs in core and what belongs in an extension, which interfaces are public, and how they change.
- For a large change, open an issue first. Tell what you want to change, and why.
- If an extension cannot do what you need, ask for an extension point ([how](docs/extensions/policies/core-or-extension.md#ask-for-a-new-extension-point)).
- To report a security problem, do not open an issue. Read [SECURITY.md](SECURITY.md).

## Make the change

- [AGENTS.md](AGENTS.md) and [docs/self-editing.md](docs/self-editing.md) tell how to work on the code. [docs/map.md](docs/map.md) tells where things are.
- Add one small test for each real risk that the change brings. The test must fail before the change.
- Run `npm run format`, `npm run check`, `npm run lint`, and `npm test`.

## Send it

- Open a pull request with a short title, and a brief note: what changed, why, and what you tested.
- Target `main`. Every change, including maintainer changes and upstream integrations, must go through a pull request. Maintainers use merge commits to preserve ancestry and authorship.
- This fork rolls forward by commit. Do not create fork version bumps, Git tags, release branches, or GitHub releases ([maintenance policy](docs/releases.md)). Keep upstream package versions and API version metadata intact.
- Put change notes, migration steps, and validation in the pull request description ([change-note guide](docs/release-notes.md)).
