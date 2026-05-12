# Contributing

Thanks for helping improve YouTube Transcript Retriever.

## Branches

- `main` is the stable branch used for releases.
- `dev` is the integration branch for contributions.
- Open pull requests against `dev` unless a maintainer asks otherwise.

## Local Setup

Install dependencies only if you want to run tests:

```powershell
npm install
npm.cmd test
```

Generate a clean runtime zip:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-extension.ps1
```

For local browser testing, extract the generated zip from `dist/`, then load the extracted folder from `chrome://extensions` with `Load unpacked`.

## Development Guidelines

- Keep the extension backend-free.
- Keep request volume low; do not add bulk language fetching or background polling by default.
- Prefer focused changes with tests for parser, settings, or UI behavior when possible.
- Do not commit generated release zips, `dist/`, `node_modules/`, copied reference extensions, local credentials, or browser profiles.
- Avoid automated browser testing against YouTube unless it is strictly necessary; repeated automated requests can trigger rate limits.

## Pull Request Checklist

Before opening a PR:

- Run `npm.cmd test`.
- Run the package script if the change affects runtime packaging.
- Update `README.md` when behavior, permissions, settings, or installation steps change.
- Include screenshots for visible UI changes.

## Good First Contributions

- Add a language picker in the transcript panel for on-demand translated captions.
- Add SRT or VTT export.
- Add a small diagnostics panel showing which caption source worked.
