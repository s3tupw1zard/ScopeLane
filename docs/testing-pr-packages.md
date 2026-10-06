# Testing PR npm packages

Approved pull requests publish preview npm packages to GitHub Packages. Each PR gets a moving dist-tag named `pr-<PR_NUMBER>`, so testers do not need to know the generated preview version.

For example, PR #42 is available through:

```text
@s3tupw1zard/opencode-scopelane@pr-42
```

## Authenticate with GitHub Packages

GitHub Packages requires authentication for npm package downloads. Create a GitHub Personal Access Token (classic) with at least `read:packages`, then either log in interactively:

```bash
npm login \
  --scope=@s3tupw1zard \
  --auth-type=legacy \
  --registry=https://npm.pkg.github.com
```

or configure npm to use an environment variable in `~/.npmrc`:

```ini
@s3tupw1zard:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

and export the token before using npm or OpenCode:

```bash
export GITHUB_PACKAGES_TOKEN="YOUR_GITHUB_PAT"
```

Verify that the PR package is accessible:

```bash
npm view @s3tupw1zard/opencode-scopelane@pr-42 version
```

Install the preview in OpenCode:

```bash
opencode plugin add @s3tupw1zard/opencode-scopelane@pr-<PR_NUMBER>
```

Example:

```bash
opencode plugin add @s3tupw1zard/opencode-scopelane@pr-42
```

Restart OpenCode after changing the configured package so the new plugin build is loaded.

> ScopeLane previews start producing a package once the ScopeLane package itself exists on the PR's target branch.

The `pr-<PR_NUMBER>` tag is updated by every successful approved PR build. An exact generated version such as `2026.1.0-pr.42.17.1` can be used instead when a tester needs a reproducible build.

## Maintainer approval

Preview builds are intentionally restricted. A PR is approved when **any** of these conditions is true:

1. the PR author is `s3tupw1zard`;
2. the PR author is listed in the repository Actions variable `PR_PACKAGE_ALLOWED_ACTORS`;
3. the PR number is listed in the repository Actions variable `PR_PACKAGE_ALLOWED_PRS`; or
4. the PR has the `pr-package-approved` label.

### Permanently allow a contributor

In the repository, open:

`Settings → Secrets and variables → Actions → Variables`

Create or update:

```text
PR_PACKAGE_ALLOWED_ACTORS
```

Its value may contain comma- or whitespace-separated GitHub usernames:

```text
alice,bob,charlie
```

Those contributors' future PRs are eligible for preview packages automatically.

### Approve one PR

For a single PR, either add its number to:

```text
PR_PACKAGE_ALLOWED_PRS
```

for example:

```text
17,42,58
```

or apply the label:

```text
pr-package-approved
```

Applying the label triggers a package build immediately. As long as the label remains on the PR, every later push to that PR is also eligible for a new preview package. Removing the label revokes that approval for future runs.

The build workflow itself has read-only repository permissions. Publishing happens in a separate trusted `workflow_run` workflow, which re-fetches the PR author and labels and re-checks the allowlist before receiving `packages: write`.
