# Upstream integration

- `upstream` tracks the source tree of `TannerMidd/pi-pocket:main` without `.github`. Do not add fork changes there.
- `main` is this fork's default branch and contains our changes.
- Custom pull requests must target `main`.
- This fork is rolling: no fork version bumps, Git tags, release branches, GitHub releases, or npm publishing.
- Keep upstream version metadata when integrating source. Identify fork builds by commit SHA or container digest ([policy](../docs/releases.md)).

## Automatic updates

**Sync upstream mirror** runs daily at 03:23 UTC and can run manually on `main`.
It fetches without tags and adds a filtered snapshot commit to `upstream` when
files outside `.github` change. Each snapshot has an `Upstream-Source` trailer
with the original upstream SHA. The workflow never pushes original upstream
commits or force-pushes. An upstream history rewrite fails the run.

After a successful mirror run, **Propose upstream integration** opens or updates
one PR from `upstream` into `main`. It can also run manually on `main`.
It does nothing when there are no unmerged snapshot commits.

The integration workflow tests the exact proposed merge in a separate read-only
job: dependency installation, type/reference checks, lint, and the full test suite.
A merge conflict fails validation but leaves the PR open for investigation.
No workflow approves or merges the PR.

## Reviewing the sync PR

1. Open the validation run linked in the PR body and check that it succeeded.
2. Confirm the base and upstream SHAs in the PR still match the current branches.
   If either branch moved, manually rerun **Propose upstream integration**.
3. Resolve any conflicts on a separate integration branch if needed. Do not put
   resolution commits on the filtered `upstream` branch.
4. Use **Create a merge commit**, never squash or rebase. Preserve the snapshot
   ancestry so later syncs do not propose already-integrated commits again.

The PR uses `GITHUB_TOKEN`, so ordinary PR-triggered workflows generally do not
run automatically. The linked integration validation is the check to review;
it is not automatically a required check attached to the PR head.

Both workflow files live on `main`. A `workflow_run` trigger connects them because
a push made with `GITHUB_TOKEN` does not trigger a second push-based workflow.
The repository must allow Actions to create pull requests. Explicit workflow
permissions keep the default token read-only except for the required write jobs.

Tags are not synced. Local automatic tag fetching is also disabled in this
checkout; new clones must configure that separately if desired.
