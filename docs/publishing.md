# Publishing ScopeLane to npm

ScopeLane is published as the public npm package `opencode-scopelane`.

## Version and dist-tag policy

ScopeLane keeps CalVer-style versions encoded as valid SemVer.

Examples:

```text
2026.1.0-dev.1  -> npm dist-tag: dev
2026.1.0        -> npm dist-tag: latest
```

Development/WIP releases must remain prereleases and must not move `latest`.

## Local release verification

Before creating a GitHub Release:

```bash
bun install
bun run verify
```

The package allowlist is defined through `package.json#files`; `npm pack --dry-run`
must show only the intended runtime sources, documentation, README, and license.

## First npm publish

npm requires the package to exist before a Trusted Publisher relationship can be
configured. Publish the first version interactively from a clean checkout using an
npm account with publishing rights and 2FA enabled.

For the current prerelease:

```bash
npm login
npm publish --access public --tag dev
```

Do not publish the first development build under `latest`.

## Trusted Publishing

After the package exists on npmjs.com, configure npm Trusted Publishing for:

- GitHub owner: `s3tupw1zard`
- repository: `ScopeLane`
- workflow filename: `publish.yml`
- allow direct `npm publish`

The release workflow uses GitHub-hosted runners and OIDC. It intentionally does not
use a long-lived `NPM_TOKEN`.

## Automated releases

Create a GitHub Release whose tag is exactly:

```text
v<package.json version>
```

For example:

```text
v2026.1.0-dev.1
```

The workflow refuses to publish when the GitHub Release tag and package version do
not match.

Versions containing a prerelease suffix publish with the `dev` dist-tag.
Versions without a prerelease suffix publish with `latest`.

While ScopeLane remains WIP, mark GitHub Releases as prereleases.
