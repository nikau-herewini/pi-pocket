<div align="center">

# Pi Pocket

**Your Pi coding agent, in your pocket.**

A durable, multiplayer, mobile-first web app for Pi agents, built on [Pi Durable](https://earendil.com/posts/pi-durable/).<br>
Deploy with Docker on your own machine. Use it from your phone or any browser. No cloud VM required.

[![Rolling main](https://img.shields.io/badge/channel-rolling%20main-7aa2f7)](https://github.com/nikau-herewini/pi-pocket/commits/main/)
[![Docker runtime](https://img.shields.io/badge/runtime-Docker-2496ed?logo=docker&logoColor=white)](docs/docker.md)
[![MIT license](https://img.shields.io/badge/license-MIT-ff9e64)](LICENSE)

[Website](https://nikau-herewini.github.io/pi-pocket/) · [Quick start](#quick-start) · [Feature tour](docs/features.md) · [Docs](https://nikau-herewini.github.io/pi-pocket/docs/)

<img src="docs/showcase-0.12.1.png" alt="Pi Pocket in the Tokyo Night theme, on a desktop and a phone. On the desktop, the session list beside a conversation where Pi has fixed a sign-in redirect loop, its edits and a passing run of 48 tests folded into a timeline. On the phone, the same session after a teammate, Alex, asks for the push: Lancet Guard waits for approval before git push." width="100%">

</div>

## Highlights

- **Durable.** Every model call, tool call, and subagent is stored as it happens. Restart the server mid-run, and the work continues.
- **Multiplayer.** Share a live session with presence, a side chat Pi does not see, invites, and roles.
- **Made for phones.** Push notifications, dictation, sharing into Pi from other apps, and a home-screen app.
- **PiP.** An assistant that starts, follows, and reports on your other sessions, and watches GitHub for you.
- **Your models.** Pi's own providers, sign-ins, skills, and prompt templates, with the model chosen per session.
- **Extensible.** Add mounted extensions and themes without rebuilding the image. Source editing is available for development and testing.

The [feature tour](docs/features.md) covers everything else, from plan mode and peek tiles to the built-in browser.

## Fork maintenance

This fork tracks `main` through pull requests. It does not maintain its own versions, Git tags, GitHub releases, or npm packages. Identify a build by its commit SHA or container digest. Package versions and API “Since” labels remain upstream metadata, not fork release identifiers. See the [rolling fork policy](docs/releases.md).

## Quick start

Docker with the Compose plugin is the only supported deployment runtime. The default Compose service pulls `ghcr.io/nikau-herewini/pi-pocket:latest`; no host Node.js or npm installation is required. Source checkouts and local image builds are for [development and testing](#development) only. Native host services, Nix, and Android/Termux deployments are not supported.

Get the Compose configuration and start the published image:

```bash
git clone https://github.com/nikau-herewini/pi-pocket.git
cd pi-pocket
cp .env.example .env    # review the persistent folders and access settings
docker compose pull
docker compose up -d --no-build
docker compose logs pi-pocket
```

The checkout supplies configuration here; it is not the deployed runtime. Follow the [Docker instructions](docs/docker.md) for persistent mounts, permissions, and access settings. Open the owner's sign-in link from the logs, using the host's address rather than the container's internal address. Keep the link private. Sign in to a model provider from the app's Providers sheet.

For a specific source commit, set `PI_POCKET_IMAGE=ghcr.io/nikau-herewini/pi-pocket:sha-<full-commit-sha>` in `.env`. Both `latest` and SHA tags can change after a rebuild. Use `PI_POCKET_IMAGE=ghcr.io/nikau-herewini/pi-pocket@sha256:<digest>` for an immutable deployment.

**Updates:** Stop the service and back up its persistent folders. Record the current image digest and review the intervening commits and pull request migration notes. Then pull and recreate the container:

```bash
docker compose pull
docker compose up -d --no-build --force-recreate
```

Change a pinned image reference before pulling an update. In-app image updates are unavailable because updates replace containers. Do not run npm inside the container to update it. Database migrations can require restoring a backup when rolling back; see the [maintenance policy](docs/releases.md).

## Remote access

Configure container access in `.env`; the interactive launcher menu is not available in Docker. See the [Docker access settings](docs/docker.md#access-and-ports).

- **Local host:** Keep `PI_POCKET_ACCESS=lan` inside the container and set `PI_POCKET_BIND=127.0.0.1` on the host.
- **Local network:** Use `PI_POCKET_ACCESS=lan` and publish port 8787 on the host's network address. This uses plain HTTP.
- **Cloudflare:** Use `PI_POCKET_ACCESS=cloudflare` for a public HTTPS quick tunnel. The image includes `cloudflared`.
- **Tailscale:** Run Tailscale on the host and route it to the container's published port. The container does not normally have a tailnet address.

Push notifications and dictation need HTTPS. `PI_POCKET_BROWSER` and `PI_POCKET_BROWSER_ARGS` pick the built-in browser and its flags when Chromium or Chrome is not found by itself. `PI_POCKET_PROMPT_DATE=1` puts today's date in Pi's system prompt; it is left out by default, so the prompt cache does not start over when the date changes. `PI_POCKET_CACHE_KEEPER=off` turns off the prompt cache keeper, which keeps a model's prompt cache warm while a run waits on a tool call ([features](docs/features.md)).

> [!WARNING]
> Anyone who can steer a session can make Pi run commands as the container's user. That reaches its mounted files, Pi Pocket's own settings and tokens, and provider credentials. Invite only people you would trust at your keyboard. View-only users cannot make Pi act. [SECURITY.md](SECURITY.md) says what is protected and what is not.

## Documentation

- [Feature tour](docs/features.md): every feature, in full.
- [Docs site](https://nikau-herewini.github.io/pi-pocket/docs/): customizing Pi without code, and writing extensions.
- [Engineering](https://nikau-herewini.github.io/pi-pocket/engineering.html) and [code map](docs/map.md): how Pi Pocket is built.

## Development

A source checkout needs Node.js 22.19 or newer. It is for development and testing, not a supported deployment. Local Docker image builds are also allowed for development; the default Compose service uses the published image without a build block. Use separate test data, never the live database.

```bash
git clone https://github.com/nikau-herewini/pi-pocket.git
cd pi-pocket
npm ci
node test/serve.ts  # throwaway development server
```

```bash
npm run check   # type-check
npm test        # server tests with a scripted model
npm run format  # ESLint's layout fixes, then Prettier
npm run lint    # check the layout rules
```

`web/` changes reload every open browser, and extensions reload into the running server. `node test/serve.ts` runs a throwaway copy to check a change on. [AGENTS.md](AGENTS.md) covers editing Pi Pocket safely from inside itself, and [CONTRIBUTING.md](CONTRIBUTING.md) how to send a change.

## Limitations

- Pi Durable is experimental, and its API can change between releases. Versions are pinned in `package.json`.
- Only one server process can use the database at a time.
- Pi's own extensions are not supported. Pi Pocket runs its own, on Pi Durable.
- A git worktree keeps a session's files apart; it is not a sandbox.
- The published Docker image includes Chromium for the built-in browser.

The [full list](docs/features.md#limitations) has the details.

## Credits and license

This fork builds on [Tanner Middleton's Pi Pocket](https://github.com/tannermidd/pi-pocket). Upstream package versions and API labels remain upstream metadata.

Inspired by [Mario Zechner's demo](https://x.com/badlogicgames/status/2106452296087302173) of his own Pi app. Pi Pocket is an independent project, not affiliated with Earendil. The bundled fonts keep their own licenses, which are beside them in [web/fonts/](web/fonts/).

[MIT](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
