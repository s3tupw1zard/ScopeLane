# Feature ID prefixes

ScopeLane supports both ScopeSeed-backed repositories and standalone repositories.

## Standalone repositories

No configuration is required when ScopeSeed is not in use. If the configured ScopeSeed registry (by default `specs/FEATURES.md`) is absent, ScopeLane treats the repository as standalone.

Feature work then uses a normal branch name without a ScopeSeed ID:

```text
feat/companion-authentication
feat/server-console
```

ScopeLane will not invent `F001`, `C001`, or any other feature ID in this mode.

## ScopeSeed repositories

The default ScopeSeed feature ID pattern is:

```text
^F\d{3,}$
```

That produces branches such as:

```text
feat/F001-panel-authentication
feat/F001-A-token-lifecycle
```

ScopeLane reads accepted IDs from the configured ScopeSeed registry and never invents an ID that is not present there.

## Custom feature ID format

Repository-specific ScopeLane options belong in:

```text
.opencode/opencode.jsonc
```

For example, PeliPocket Companion can use `C001`, `C002`, and so on:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-scopelane@dev",
      "options": {
        "branches": {
          "featureIdPattern": "^C\\d{3,}$"
        }
      }
    }
  ]
}
```

The corresponding ScopeSeed registry may then contain IDs such as:

```text
C001
C002
C003
```

and ScopeLane renders branches such as:

```text
feat/C001-companion-access-authorization
```

The branch kind prefix and the feature ID format are separate settings:

- `branches.prefixes.feature` controls the branch namespace such as `feat/`.
- `branches.featureIdPattern` controls accepted ScopeSeed IDs such as `F001` or `C001`.
- `branches.featurePartPattern` controls one-level part labels such as `A` and `B`.

For a different convention, provide another regular expression, for example `^APP-\\d{4}$`. The IDs in `specs/FEATURES.md` must match that expression.
