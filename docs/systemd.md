# Migrate from systemd or Nix to Docker

Docker is the only supported deployment runtime for this fork. Native systemd services, Nix packages, and the NixOS module are no longer supported. This page remains available for existing links.

Use the [Docker deployment guide](docker.md) for installation, persistent folders, access settings, and updates.

## Migrate an existing installation

> [!WARNING]
> Existing sessions store absolute working folders. Worktrees also retain absolute source and worktree paths, including paths in Git metadata. Copying everything to the default `/data` and `/workspace` container paths does not repair those references. Preserve the original absolute paths inside the container. Do not edit the database to rewrite them.

1. Stop and disable the old service before starting the container. For NixOS, stop the service, remove `services.pi-pocket` from the host configuration, and apply the change. Do not garbage-collect the Nix store before copying files that the old installation needs.
2. Back up the complete Pi Pocket data folder, Pi's configuration and sign-ins, extensions, themes, project repositories, and worktrees. Include hidden files and Git metadata. Record their old absolute paths and the old `HOME` and `PI_POCKET_DIR` values. Keep the backups until you verify the new deployment.
3. Create a Compose override that mounts every required folder at its **old absolute path inside the container**. Set `HOME`, `PI_POCKET_DIR`, and `working_dir` to match the old installation. Include every session working folder, worktree source, and symlink target; a different host storage location is allowed only if the container still sees the original paths.
4. Copy extension and skill files from the Nix store as regular files, not store symlinks. Check the container user's read/write permissions. Configure access mode, port, and provider environment variables using the Docker guide.
5. Start the container with the override. Verify existing sessions, project files, Git worktrees, provider access, extensions, and themes before removing the old installation. If you cannot preserve the required paths, keep the backup and plan a separate migration; the default mounts are not a tested relocation procedure.

Do not run the native service and the container against the same data folder at the same time.

### Example: preserve an old path layout

For an installation that used `/home/alex/.pi-pocket`, `/home/alex/.pi`, and projects under `/srv/projects`, create `compose.migration.yml`:

```yaml
services:
    pi-pocket:
        environment:
            HOME: /home/alex
            PI_POCKET_DIR: /home/alex/.pi-pocket
        working_dir: /srv/projects
        volumes: !override
            - /home/alex/.pi-pocket:/home/alex/.pi-pocket
            - /home/alex/.pi:/home/alex/.pi
            - /srv/projects:/srv/projects
```

The `!override` tag requires Docker Compose 2.24.4 or newer. It replaces the default mount list rather than adding conflicting mounts. This is an example, not a universal layout: add any other original folders and external extension/theme mounts your installation used.

```bash
docker compose -f docker-compose.yml -f compose.migration.yml config
docker compose -f docker-compose.yml -f compose.migration.yml up -d
```

Keep using the same override for updates, stops, and other Compose operations. The original host folders remain in place; a deployment image change does not relocate session paths.

Source development and tests remain available. They are not a supported native deployment method.
