# YouTube Transcript Retriever

A small Manifest V3 Chrome/Chromium extension that adds a transcript button to YouTube video pages. Click it to open a right-side panel, retrieve the current video's transcript, then copy it or download it as a `.txt` file.

The project is intentionally simple: no backend, no account, no analytics, no bundled AI service, and no transcript storage. It reads the caption data YouTube exposes to the browser and formats it into plain text.

This project exists because small productivity extensions should be easy to inspect, fork, and own. I do not want to depend blindly on free Chrome extensions from unknown maintainers, especially after cases like ShadyPanda, the Stanley malware kit, and criminal groups buying legitimate extensions before pushing surveillance updates. In the era of agentic AI, there is little reason to rely on third-party developers for small productivity tools when the code can be public, auditable, and simple.

## Features

- One in-page button above the YouTube recommendations column.
- Right-side transcript panel that opens from the YouTube page and retrieves captions only when you click `Get Transcript`.
- Timestamped `Timed` view with clickable timecodes for seeking the YouTube video.
- Plain `Text` view for compact copying into other tools.
- Copy the transcript to the clipboard without manually selecting text.
- Download the transcript as a `.txt` file.
- `Summary` button that opens ChatGPT, Claude, or Gemini and inserts a summary prompt.
- Extension options for default caption language, LLM provider, and automatic LLM submit.
- Uses the configured caption language when set, otherwise the caption language currently selected in YouTube, then the browser language, then English, then the first available caption track.
- Works from source as an unpacked Chrome/Brave/Chromium extension.
- No build step required for normal use.

## Install From Source

1. Clone or download this repository.
2. Generate the clean runtime package in `dist/`:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/package-extension.ps1
   ```

   If generated icons are missing after a fresh clone, the package script creates them first.

3. Extract `dist/youtube-transcript-retriever-<version>.zip` to a local folder.
4. Open Chrome, Brave, or another Chromium browser.
5. Go to `chrome://extensions`.
6. Enable `Developer mode`.
7. Click `Load unpacked`.
8. Select the folder extracted from the generated zip.
9. Open a YouTube video and click `Get Transcript` above the recommendations column.

For development, install dependencies only if you want to run the tests:

```powershell
npm install
npm.cmd test
```

## Usage

1. Navigate to a YouTube video page.
2. Click `Get Transcript` above the recommendations column.
3. The right-side panel opens.
4. Click `Get Transcript` inside the panel to retrieve captions.
5. Use `Timed` or `Text` depending on the output format you want.
6. Use `Copy` or `Download (txt)`.

The in-page button opens the panel and starts transcript retrieval. The browser-action popup keeps a manual `Get Transcript` button.

The `Timed` view groups raw caption segments into readable blocks with clickable timestamps. `Copy`, `Download (txt)`, and `Summary` use the active view, so `Timed` includes timestamps while `Text` uses compact plain transcript text.

`Summary` opens the configured LLM with `Make a summary of this text:` and the transcript, then tries to insert the prompt into the message box. If auto submit is enabled, it also tries to click the provider's send button. If the provider is not ready, not logged in, or changes its page structure, the extension falls back to opening the provider and copying the prompt to your clipboard.

## Settings

Open settings from the popup `Settings` link, the extension context menu, or `chrome://extensions` details.

Settings are stored in `chrome.storage.sync`, which is intended for small user preferences that should follow a signed-in browser profile. The extension stores:

- `Default caption language`: `auto` uses the caption language currently selected in YouTube when the player exposes it; a value like `fr`, `fr-FR`, `en`, or `es` overrides it. If YouTube exposes the requested language only as a translation, the extension requests it with `tlang=<languageCode>`.
- `Select model`: chooses ChatGPT, Claude, or Gemini for the `Summary` button.
- `Auto submit to LLM`: when enabled, the extension clicks the provider's send button after inserting the prompt.
- `If language not found, request translation in LLM`: when enabled and the requested caption language is unavailable, the transcript falls back to the original captions and the `Summary` prompt asks the selected LLM to write the summary in the requested language.

## How Transcript Retrieval Works

YouTube captions are exposed through caption track metadata and `/api/timedtext` URLs. The extension uses the same caption source the YouTube player uses.

The current flow is:

1. The in-page button or browser popup extracts the video id from the active YouTube URL.
2. The content script briefly toggles the YouTube captions button twice. This makes the player issue a fresh `/api/timedtext` request while leaving the visible caption state where it started.
3. The content script reads the fresh timedtext request from `performance.getEntriesByType("resource")` and extracts YouTube's `pot` proof token when present.
4. The transcript module fetches the YouTube watch page with browser credentials and parses `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks`.
5. It chooses one caption track: configured language first, YouTube's current caption language when `auto` can detect it, browser language next, English after that, first available track last.
6. It ignores player-discovered caption URLs from another language when a specific language is selected.
7. It tries caption URL variants until one returns readable segments:
   - player-discovered `/api/timedtext` URLs that already include `pot`
   - the selected caption `baseUrl` with `c=WEB&pot=<token>`
   - a generated player-style JSON3 URL with `potc=1`, `pot`, and player client parameters
   - static `fmt=srv3`
   - static `fmt=json3`
   - the raw caption `baseUrl`
8. It parses XML or JSON3 caption segments, decodes entities, normalizes whitespace, and joins the caption text into a readable transcript.
9. The panel and browser popup group segments into timestamped blocks using pauses, block duration, text length, and sentence punctuation.

## Can You Trust The Output?

The output is YouTube caption data. It can be creator-provided subtitles, YouTube auto-generated captions, or a YouTube-translated caption track when the selected language is available through YouTube translation.

This extension does not run speech-to-text. It does not verify the spoken audio independently. If YouTube's captions are wrong, missing, partial, or auto-generated poorly, the transcript will reflect that.

The transcript retrieval flow only formats the caption text. It does not summarize, translate, rewrite, or send the transcript anywhere unless you click `Summary`.

## Why There Is No Multi-Language Bulk Fetch

For now, the extension fetches one language: the configured language when set, then the current YouTube caption language when available, then the browser language, then English, then the first caption track YouTube exposes. A configured language can use either a native caption track or one YouTube-translated track.

Fetching every language is intentionally avoided. YouTube can expose many `translationLanguages`, and fetching them all would turn one user action into dozens of caption requests. That is more likely to trigger rate limits and is unnecessary for the default use case.

Bulk multi-language support is still straightforward to add later as an on-demand feature:

- native caption languages can use their own `captionTracks[*].baseUrl`
- translated caption languages are requested with `&tlang=<languageCode>`
- the UI should fetch only the selected language, not prefetch every available language

Another practical approach is to retrieve one reliable transcript and translate it afterwards with an LLM or another translation tool.

## Rate Limits And Responsible Testing

YouTube may rate limit caption endpoints or automated browser sessions. This extension tries to keep request volume low:

- no background polling
- no batch transcript downloads
- no all-language prefetching
- fallback URL attempts stop as soon as one transcript works

Automated tests in this repository are local unit tests. Avoid running browser automation repeatedly against YouTube when developing; use manual checks sparingly and prefer unit tests for parser and URL behavior.

## Privacy

The extension runs locally in your browser.

By default, it does not:

- send transcripts to a third-party server
- use a private backend
- collect analytics
- require login
- store transcript history
- call a speech-to-text provider

The `Summary` button is the explicit exception: when you click it, the extension opens the configured LLM provider and inserts a summary prompt with the transcript from the active view. If automatic insertion fails, it opens the provider and copies the full prompt to your clipboard instead. No API key or backend is used.

The required permissions are limited to script injection, synced settings storage, YouTube host access, and ChatGPT/Claude/Gemini host access for the user-triggered summary flow.

## Limitations

- The video must have captions available to the YouTube player.
- Some videos expose captions visually but return empty static caption URLs; the extension uses the player-token fallback for those cases, but YouTube can still block or rate limit requests.
- The default export is plain text, not SRT/VTT.
- YouTube can change its internal page data or caption endpoint behavior.
- This project is not affiliated with YouTube or Google.

## Development

Run the test suite:

```powershell
npm.cmd test
```

On shells where `npm` is not blocked by PowerShell execution policy:

```sh
npm test
```

Syntax-check the extension scripts:

```powershell
node --check content-script.js
node --check background.js
node --check options.js
node --check popup.js
node --check settings.js
node --check transcript.js
```

There is no bundler. The browser loads the extension files directly.

Create a Chrome Web Store/runtime zip:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-extension.ps1
```

Use the zip from `dist/` for Chrome Web Store uploads or GitHub releases. For local unpacked installation, extract that zip and select the extracted folder in `chrome://extensions` with `Load unpacked`. Do not package or load the repository root: it contains Git history, tests, generated local assets, and ignored reference-extension folders that are not needed by Chrome.

Regenerate extension icons and Chrome Web Store draft images:

```powershell
python scripts/generate-assets.py
```

Generated `icons/` and `store/` files are intentionally ignored by Git. The runtime zip includes icons generated locally before packaging.

## Project Structure

- `manifest.json`: extension manifest and permissions.
- `popup.html`: popup markup.
- `popup.css`: popup styling.
- `popup.js`: popup behavior, current-tab lookup, copy, and download actions.
- `options.html`, `options.css`, `options.js`: extension settings page.
- `settings.js`: settings defaults, validation, storage helpers, and LLM provider config.
- `background.js`: MV3 service worker that opens the configured LLM and injects the summary prompt.
- `content-script.js`: YouTube page integration, in-page panel UI, caption request refresh, and proof-token capture.
- `transcript.js`: video id extraction, caption track parsing, URL fallback generation, XML/JSON3 parsing, and transcript formatting.
- `icons/`: generated extension icons referenced by the manifest.
- `store/`: generated draft Chrome Web Store listing assets.
- `test/background.test.js`, `test/settings.test.js`: local Node tests for LLM injection and settings behavior.
- `test/transcript.test.js`: local Node tests for parser and retrieval behavior.
- `scripts/generate-assets.py`: deterministic icon and store-image generator.
- `scripts/package-extension.ps1`: creates a clean runtime zip in `dist/`.

## Ideas For Future Contributors

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Contributions should target the `dev` branch.

- Add a language picker in the transcript panel for on-demand translated captions.
- Add SRT or VTT export.
- Add a small diagnostics panel showing which caption source worked.

## License

MIT. See [LICENSE](LICENSE).
