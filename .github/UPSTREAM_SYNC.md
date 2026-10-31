# Upstream integration

- `upstream` mirrors `TannerMidd/pi-pocket:main`. Never add custom commits there.
- `main` is this fork's default branch and contains our changes.
- Custom pull requests must target `main`.

## Automatic updates

**Sync upstream mirror** runs daily at 03:23 UTC and can run manually on `main`.
It fetches without tags and fast-forwards `upstream`. It never force-pushes.
A divergence fails the run and needs investigation, not an automatic reset.

After a successful mirror run, **Propose upstream integration** opens or updates
one PR from `upstream` into `main`. It can also run manually on `main`.
It does nothing when there are no new upstream commits.

The integration workflow tests the exact proposed merge in a separate read-only
job: dependency installation, type/reference checks, lint, and the full test suite.
A merge conflict fails validation but leaves the PR open for investigation.
No workflow approves or merges the PR.

## Reviewing the sync PR

1. Open the validation run linked in the PR body and check that it succeeded.
2. Confirm the base and upstream SHAs in the PR still match the current branches.
   If either branch moved, manually rerun **Propose upstream integration**.
3. Resolve any conflicts on a separate integration branch if needed. Do not put
   resolution commits on the pristine `upstream` mirror.
4. Use **Create a merge commit**, never squash or rebase. Preserve upstream
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
