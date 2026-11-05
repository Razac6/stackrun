# Stackrun

Desktop app for everyday dev chores, split out of Thingy's "Dev Notes":

- **Commands**: packages of CLI steps (git pull, npm install when needed, Nest / Angular /
  Azure Functions dev servers…), packages inside packages, "ready when" checks, stop / force
  kill, rerun of the failed part, desktop notifications when a package is done, fails or is up.
- **Docker**: containers, logs, connection strings, volumes, database reset (Docker Desktop
  or Colima).
- **Notes**: markdown / JSON / SQL notes with notebooks, tags and version history.
- **JSON compare**, **cURL → .http**, **Base64**.

Data lives in the app's user-data folder (`stackrun-data.json`).

## Develop

```sh
npm install
npm start
```

Checks: `npx tsc --noEmit -p .`, `npm run lint`, `npm test`.

## Release

GitHub Actions → *Build & Release for macOS / Windows / Linux* (manual run).

macOS builds are for Apple Silicon (`-arm64.dmg`) and Intel. Without an Apple Developer
certificate they are ad-hoc signed, not notarized: the first launch needs right-click →
**Open** (or `xattr -cr /Applications/Stackrun.app`). With a certificate, set `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` secrets and drop the
`hardenedRuntime=false` flag from the workflow to get a signed, notarized build.
