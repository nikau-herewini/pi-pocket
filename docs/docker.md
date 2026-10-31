# Running Pi Pocket in Docker

Pi Pocket runs from its source with Node.js, so the container is thin: Node, Chromium for the Browser panel, and the command-line tools the built-in extensions use (`git`, `gh`, `fj`, `ripgrep`, `fd`, and `cloudflared`).

The image includes [`forgejo-cli`](https://codeberg.org/forgejo-contrib/forgejo-cli)
v0.7.0 as `fj` for Forgejo pull requests, issues, and repository operations alongside
Git. A separate Rust build stage compiles it for amd64 and arm64 against Debian
Bookworm, because the official prebuilt binaries need a newer glibc. The build
verifies the pinned source archive's SHA-256, uses `cargo build --locked`, and runs
`fj version` in both the builder and runtime images. No Rust toolchain enters the
runtime image. To update it, review the release and change the source commit and
hash in `docker/install-fj.sh` together; review the pinned Rust toolchain too.

Forgejo authentication belongs to the deployment, not the image. Use `fj --help`
and `fj --host <host> auth add-token` for an explicit host; without a token argument,
the latter reads the token from stdin. Never put a token in command arguments or
build settings. The CLI does not automatically reuse Git's credential helper.
On Linux its credential file is
`${XDG_DATA_HOME:-$HOME/.local/share}/forgejo-cli/keys.json`; protect it and any
backups as secrets. Fresh sessions only know to use `fj` if their global or project
`AGENTS.md` documents it ([customizing](customizing.md#agentsmd-rules-for-a-project-or-for-all-sessions)).

In v0.7.0, `fj pr merge` does not enable auto-merge; use the Forgejo API for that.
`fj pr status --wait` is useful for inspection but its exit status is not a reliable
required-check gate. This installation does not add Forgejo support to Pi Pocket's
GitHub-specific PR watch or repository watch tools.

Docker is the only supported deployment runtime for this fork. [`docker-compose.yml`](../docker-compose.yml) runs the published image by default; [`docker/Dockerfile`](../docker/Dockerfile) can build a custom image from the repository root. Host Node.js, npm, Nix, native systemd, Android, and other container engines are not supported deployment paths. Source checkouts remain useful for development and tests.

## Start it

```bash
cp .env.example .env    # optional, but it is where the external folders are set
docker compose pull
docker compose up -d
```

Then read the owner's sign-in link from the log. It is the key to this server, so keep it private:

```bash
docker compose logs pi-pocket | grep '/login?token='
```

The link is printed again on every start. Open it once per browser. The launcher's interactive menu is not available in a container, so the access mode comes from `PI_POCKET_ACCESS` (default `lan`).

In `lan` mode the printed link names the container's own address (often `172.x.x.x`), which other devices cannot reach. Keep its path and token, and change the address to the host's: `http://localhost:8787/login?token=…` on the host, or the host's address on the local network for a phone. Invite links use the address the app is open at, so open it at the host's network address before you invite someone.

Stop it with `docker compose down`. `down -v` is not needed for anything here: the state is in the host folders, not in an anonymous volume.

The container's entrypoint clears Chromium's stale `Singleton*` locks in `./data/browser/profile`. Without that, a recreated container can refuse to start the embedded browser, because the old locks name the previous container.

## Published images

The fork at `nikau-herewini/pi-pocket` publishes to GitHub Container Registry on every push to `main`. Maintainers can also run **Publish Docker image** manually from the Actions tab on `main`. The workflow uses the repository's `GITHUB_TOKEN` with `packages: write`; no registry password secret is needed.

This is a rolling fork with no semantic-version image tags, Git tags, or GitHub releases. The container tags below identify the moving channel and source commit; they are not fork release versions.

Images support `linux/amd64` and `linux/arm64`:

- `ghcr.io/nikau-herewini/pi-pocket:latest` tracks the most recently published `main` build, not an upstream release.
- `ghcr.io/nikau-herewini/pi-pocket:sha-<full-commit-sha>` identifies a source commit. For an immutable deployment, pin the image digest (`@sha256:…`), since rerunning a build can update a tag.

After the first publish, a maintainer must check the package's visibility in GitHub's package settings. Make it public for anonymous pulls, or authenticate with a token that has `read:packages` for private pulls.

Compose uses the published `latest` image unless `PI_POCKET_IMAGE` is set in `.env`. To pin an immutable image, set:

```dotenv
PI_POCKET_IMAGE=ghcr.io/nikau-herewini/pi-pocket@sha256:<image-digest>
```

A commit image tag works too: `ghcr.io/nikau-herewini/pi-pocket:sha-<full-commit-sha>`. No Compose file edits are needed. Start or update without a local build:

```bash
docker compose pull
docker compose up -d --no-build
```

The workflow only publishes from this fork's `main` branch. It does not publish from pull requests, other branches, or upstream releases.

## Folders from the host

Every folder that matters is a bind mount, so it stays outside the container and outside the image. Change the left-hand side in `.env` to use a folder anywhere on the host.

| Variable               | Default             | In the container   | Holds                                                                                             |
| ---------------------- | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `PI_POCKET_DATA`       | `./data`            | `/data`            | `pocket.sqlite`, `config.json`, `push.json`, uploads, worktrees, the browser profile, and logging |
| `PI_POCKET_EXTENSIONS` | `./data/extensions` | `/data/extensions` | The owner's drop-in extensions, loaded from this folder                                           |
| `PI_POCKET_THEMES`     | `./data/themes`     | `/data/themes`     | The owner's themes, loaded from this folder                                                       |
| `PI_POCKET_PI_DIR`     | `./data/pi`         | `/home/node/.pi`   | Pi's `agent/` folder: `auth.json`, `settings.json`, skills, prompts, trust, sessions, packages    |
| `PI_POCKET_WORKSPACE`  | `./data/workspace`  | `/workspace`       | The projects Pi works on, and where new sessions start                                            |

The mounts are nested on purpose: `extensions`, `themes`, `pi`, and `workspace` are separate host folders under `./data`, even though the app reads them inside `/data` or `/home/node`. Dropping a `.ts` file into `./data/extensions` makes it appear in Menu → Extensions, off until the owner turns it on. The gallery's **Install** writes there too.

Pi's sign-ins live in `./data/pi/agent/auth.json`, not in Pi Pocket's database. Keeping that folder means a fresh database reuses the same sign-ins, and a Pi CLI on the host can share it (`PI_CODING_AGENT_DIR=/absolute/path/to/data/pi/agent`).

Provider keys can go in `.env` and the `environment:` block of the Compose file instead. Keys are not written to the image.

The folder picker's **Clone** puts repositories in `/workspace/<name>`, so they land in `PI_POCKET_WORKSPACE` on the host. Set `PI_POCKET_CLONE_DIR` in the `environment:` block to use another folder inside the container.

## Access and ports

`PI_POCKET_BIND` is the host address the port is published on, and `PI_POCKET_PORT` is the port on both sides (default `8787`). For phones on the same network, leave the default `0.0.0.0` and `PI_POCKET_ACCESS=lan`.

For a single machine only, publish the port on the host's loopback address and keep `lan` inside the container:

```dotenv
PI_POCKET_BIND=127.0.0.1
PI_POCKET_ACCESS=lan
```

Do not use `PI_POCKET_ACCESS=local` with the published port: `local` listens on the container's own `127.0.0.1`, which the host cannot reach.

`cloudflare` works in the container: the image already contains `cloudflared`, so the launcher does not need a terminal to download it. The tunnel runs inside the container, and the published port is not used. `tailscale` looks for a Tailscale address in the container, which it usually does not have. Run Tailscale on the host instead: publish the port on `127.0.0.1` as above and point `tailscale serve` at it, or run the container with `network_mode: host`.

## Permissions

Compose runs the container as root by default. With rootful Docker, files created in the mounts belong to root on the host. To run as your user instead, make sure the external folders are owned by that user and add this to the service:

```yaml
user: "1000:1000"
```

Then set `HOME` to a writable folder (`HOME: /home/node` works when the uid is `1000`, the image's `node` user) and make `./data` writable by it. Leave `--no-sandbox` in `PI_POCKET_BROWSER_ARGS` in that case too, unless you have added the kernel's user-namespace permissions the Chromium sandbox needs.

The service sets `no-new-privileges`: no process in the container can gain privileges through setuid programs or file capabilities. Chromium runs with `--no-sandbox` in the container, so this, and not running as root, are what limit a page that breaks out of the browser.

On an SELinux host, add `:Z` to bind mounts, or run `chcon` on the folders yourself.

## Updating

Record the running image digest and stop the service before backing up all persistent folders. Review the intervening pull requests for migration warnings. Then update the selected image and recreate the service:

```bash
docker compose images
image_id="$(docker inspect pi-pocket --format '{{.Image}}')"
docker image inspect "$image_id" --format '{{json .RepoDigests}}'
docker compose stop
# Back up all configured persistent folders here.
docker compose pull
docker compose up -d --force-recreate
docker compose ps
```

Save the `RepoDigests` entry (`repository@sha256:…`) for recovery; the container's `.Image` value alone is a local image ID, not a pullable registry digest. A locally built development image may have no `RepoDigests`. If `PI_POCKET_IMAGE` pins a digest or commit, change it to the chosen build before pulling. The in-app self-updater is removed: updates replace the container image, never `/app` in a running container. Mounted folders stay in place, but a newer app can migrate their contents. A rollback can require restoring the backup, not just selecting the previous image.

## Custom images for development

The built-in source and web app are copied into the image. To test local changes, build an image and select it for Compose:

```bash
docker build -f docker/Dockerfile -t pi-pocket:local .
PI_POCKET_IMAGE=pi-pocket:local docker compose up -d --pull never --force-recreate
```

The production image omits development dependencies and the test suite. Run source tests in a development checkout, not inside the production image. Mounted drop-in extensions and themes can still be edited without rebuilding the image.

## Security

Anyone who can steer a session can run commands in this container as its user. With the default root user that means every file in the mounted folders, and every provider key in the environment. Mount only the projects you would trust Pi with, keep the port off the public internet unless you use a tunnel, and read [SECURITY.md](../SECURITY.md) before inviting other people.
