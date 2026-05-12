(function attachTranscriptModule(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.TranscriptModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTranscriptModule() {
  const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

  class TranscriptError extends Error {
    constructor(message, userMessage) {
      super(message);
      this.name = "TranscriptError";
      this.userMessage = userMessage || message;
    }
  }

  function isExpectedTranscriptError(error) {
    return Boolean(error && error.name === "TranscriptError");
  }

  function extractVideoId(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const hostname = url.hostname.replace(/^www\./, "");

      if (hostname === "youtube.com" || hostname === "m.youtube.com") {
        const fromQuery = url.searchParams.get("v");
        if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) {
          return fromQuery;
        }

        const pathMatch = url.pathname.match(/^\/(?:embed|shorts)\/([a-zA-Z0-9_-]{11})/);
        return pathMatch ? pathMatch[1] : null;
      }

      if (hostname === "youtu.be") {
        const candidate = url.pathname.split("/").filter(Boolean)[0];
        return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
      }

      return null;
    } catch (_error) {
      return null;
    }
  }

  function parseCaptionTracks(watchHtml) {
    const playerResponse = parsePlayerResponse(watchHtml);
    const rawTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
      parseCaptionTracksFallback(watchHtml);
    const rawTranslationLanguages =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.translationLanguages ||
      [];

    return {
      title: playerResponse?.videoDetails?.title || "",
      tracks: rawTracks.map(normalizeCaptionTrack).filter((track) => track.baseUrl),
      translationLanguages: rawTranslationLanguages.map(normalizeTranslationLanguage).filter((language) => language.languageCode)
    };
  }

  function parsePlayerResponse(watchHtml) {
    const marker = "ytInitialPlayerResponse";
    const markerIndex = watchHtml.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const firstBrace = watchHtml.indexOf("{", markerIndex);
    if (firstBrace === -1) {
      return null;
    }

    const jsonText = readBalancedJsonObject(watchHtml, firstBrace);
    if (!jsonText) {
      return null;
    }

    try {
      return JSON.parse(jsonText);
    } catch (_error) {
      return null;
    }
  }

  function readBalancedJsonObject(source, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }
    }

    return "";
  }

  function parseCaptionTracksFallback(watchHtml) {
    const match = watchHtml.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/);
    if (!match) {
      return [];
    }

    try {
      return JSON.parse(match[1]);
    } catch (_error) {
      return [];
    }
  }

  function normalizeCaptionTrack(track) {
    return {
      baseUrl: decodeJsonString(track.baseUrl || ""),
      name: getTrackName(track.name),
      languageCode: track.languageCode || "",
      kind: track.kind || ""
    };
  }

  function normalizeTranslationLanguage(language) {
    return {
      languageCode: language.languageCode || "",
      name: getTrackName(language.languageName)
    };
  }

  function getTrackName(name) {
    if (!name) {
      return "";
    }

    if (typeof name.simpleText === "string") {
      return name.simpleText;
    }

    if (Array.isArray(name.runs)) {
      return name.runs.map((run) => run.text || "").join("");
    }

    return "";
  }

  function decodeJsonString(value) {
    return value.replace(/\\u0026/g, "&");
  }

  function chooseCaptionTrack(tracks, preferredLanguageCode = "en") {
    if (!tracks.length) {
      return null;
    }

    const preferred = findTrackByLanguage(tracks, preferredLanguageCode);
    const english = findTrackByLanguage(tracks, "en");

    return preferred || english || tracks[0];
  }

  function findTrackByLanguage(tracks, preferredLanguageCode) {
    const preferred = normalizeLanguageCode(preferredLanguageCode);
    const preferredBase = preferred.split("-")[0];

    return tracks.find((track) => {
      const languageCode = normalizeLanguageCode(track.languageCode);
      return languageCode === preferred || languageCode.split("-")[0] === preferredBase;
    });
  }

  function normalizeLanguageCode(languageCode) {
    return String(languageCode || "").toLowerCase();
  }

  function parseTranscriptXml(xmlText) {
    if (typeof DOMParser !== "undefined") {
      return parseTranscriptXmlWithDomParser(xmlText);
    }

    return parseTranscriptXmlWithRegex(xmlText);
  }

  function parseTranscriptXmlWithDomParser(xmlText) {
    const document = new DOMParser().parseFromString(xmlText, "text/xml");
    const legacySegments = Array.from(document.querySelectorAll("text"))
      .map((node) => ({
        start: Number.parseFloat(node.getAttribute("start") || "0"),
        duration: Number.parseFloat(node.getAttribute("dur") || "0"),
        text: normalizeWhitespace(node.textContent || "")
      }))
      .filter((segment) => segment.text);

    if (legacySegments.length) {
      return legacySegments;
    }

    return Array.from(document.querySelectorAll("p"))
      .map((node) => ({
        start: parseYouTubeMilliseconds(node.getAttribute("t")),
        duration: parseYouTubeMilliseconds(node.getAttribute("d")),
        text: normalizeWhitespace(node.textContent || "")
      }))
      .filter((segment) => segment.text);
  }

  function parseTranscriptXmlWithRegex(xmlText) {
    const legacySegments = [];
    const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let match;

    while ((match = textPattern.exec(xmlText)) !== null) {
      const attributes = match[1];
      const rawText = match[2];
      const text = normalizeWhitespace(decodeHtmlEntities(rawText));

      if (!text) {
        continue;
      }

      legacySegments.push({
        start: Number.parseFloat(readXmlAttribute(attributes, "start") || "0"),
        duration: Number.parseFloat(readXmlAttribute(attributes, "dur") || "0"),
        text
      });
    }

    if (legacySegments.length) {
      return legacySegments;
    }

    const segments = [];
    const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;

    while ((match = paragraphPattern.exec(xmlText)) !== null) {
      const attributes = match[1];
      const rawText = stripXmlTags(match[2]);
      const text = normalizeWhitespace(decodeHtmlEntities(rawText));

      if (!text) {
        continue;
      }

      segments.push({
        start: parseYouTubeMilliseconds(readXmlAttribute(attributes, "t")),
        duration: parseYouTubeMilliseconds(readXmlAttribute(attributes, "d")),
        text
      });
    }

    return segments;
  }

  function parseTranscriptJson(jsonText) {
    let data;

    try {
      data = JSON.parse(jsonText);
    } catch (_error) {
      return [];
    }

    if (!Array.isArray(data.events)) {
      return [];
    }

    return data.events
      .map((event) => {
        const text = Array.isArray(event.segs)
          ? event.segs.map((segment) => segment.utf8 || "").join("")
          : "";

        return {
          start: parseYouTubeMilliseconds(event.tStartMs),
          duration: parseYouTubeMilliseconds(event.dDurationMs),
          text: normalizeWhitespace(text)
        };
      })
      .filter((segment) => segment.text);
  }

  function stripXmlTags(text) {
    return text.replace(/<[^>]+>/g, "");
  }

  function parseYouTubeMilliseconds(value) {
    const milliseconds = Number.parseFloat(value || "0");
    return Number.isFinite(milliseconds) ? milliseconds / 1000 : 0;
  }

  function readXmlAttribute(attributes, name) {
    const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
    return match ? decodeHtmlEntities(match[1]) : "";
  }

  function decodeHtmlEntities(text) {
    return text
      .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number.parseInt(code, 10)))
      .replace(/&#x([a-fA-F0-9]+);/g, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function formatTranscript(segments) {
    return segments.map((segment) => segment.text).filter(Boolean).join("\n\n");
  }

  function formatTimestamp(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${padTimePart(minutes)}:${padTimePart(remainingSeconds)}`;
    }

    return `${padTimePart(minutes)}:${padTimePart(remainingSeconds)}`;
  }

  function padTimePart(value) {
    return String(value).padStart(2, "0");
  }

  function groupTranscriptSegments(segments, options = {}) {
    const settings = {
      softMaxChars: options.softMaxChars || 360,
      hardMaxChars: options.hardMaxChars || 520,
      maxDurationSeconds: options.maxDurationSeconds || 55,
      maxGapSeconds: options.maxGapSeconds || 2.5
    };
    const blocks = [];
    let current = null;

    for (const segment of segments || []) {
      const text = normalizeWhitespace(segment.text || "");
      if (!text) {
        continue;
      }

      const start = Number(segment.start) || 0;
      const duration = Number(segment.duration) || 0;
      const end = start + duration;

      if (current && shouldStartNewTranscriptBlock(current, start, settings)) {
        flushTranscriptBlock(blocks, current);
        current = null;
      }

      if (!current) {
        current = {
          start,
          end,
          parts: []
        };
      }

      current.parts.push(text);
      current.end = Math.max(current.end, end);

      const combinedText = normalizeWhitespace(current.parts.join(" "));
      if (
        combinedText.length >= settings.hardMaxChars ||
        (combinedText.length >= settings.softMaxChars && endsWithStrongPunctuation(text))
      ) {
        flushTranscriptBlock(blocks, current);
        current = null;
      }
    }

    if (current) {
      flushTranscriptBlock(blocks, current);
    }

    return blocks;
  }

  function shouldStartNewTranscriptBlock(block, nextStart, settings) {
    const gap = nextStart - block.end;
    const duration = nextStart - block.start;
    return gap > settings.maxGapSeconds || duration >= settings.maxDurationSeconds;
  }

  function flushTranscriptBlock(blocks, block) {
    const text = normalizeWhitespace(block.parts.join(" "));
    if (!text) {
      return;
    }

    blocks.push({
      start: block.start,
      timestamp: formatTimestamp(block.start),
      text
    });
  }

  function endsWithStrongPunctuation(text) {
    return /[.!?]["')\]]?$/.test(text.trim());
  }

  function formatTimedTranscript(blocks) {
    return (blocks || [])
      .map((block) => `[${block.timestamp || formatTimestamp(block.start)}] ${block.text || ""}`.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function createTranscriptFilename(title, videoId) {
    const safeTitle = (title || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    return `${safeTitle || "youtube-transcript"}-${videoId}.txt`;
  }

  function extractTimedTextUrls(resourceUrls, videoId) {
    const seen = new Set();
    const urls = [];

    for (const resourceUrl of resourceUrls || []) {
      if (!resourceUrl || !String(resourceUrl).includes("/api/timedtext")) {
        continue;
      }

      try {
        const url = new URL(resourceUrl);
        if (url.searchParams.get("v") !== videoId || seen.has(resourceUrl)) {
          continue;
        }

        seen.add(resourceUrl);
        urls.push(resourceUrl);
      } catch (_error) {
        continue;
      }
    }

    return urls.sort((left, right) => {
      const leftHasPot = left.includes("&pot=") || left.includes("?pot=");
      const rightHasPot = right.includes("&pot=") || right.includes("?pot=");
      return Number(rightHasPot) - Number(leftHasPot);
    });
  }

  async function fetchTranscriptForVideo(videoId, fetchImpl = fetch, preferredLanguageCode = "en", options = {}) {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const fetchOptions = { credentials: "include" };
    const watchResponse = await fetchImpl(watchUrl, fetchOptions);

    if (!watchResponse.ok) {
      throw new TranscriptError("Failed to fetch YouTube video page.", "Could not load the YouTube video page.");
    }

    const watchHtml = await watchResponse.text();
    const { title, tracks, translationLanguages } = parseCaptionTracks(watchHtml);
    const selection = chooseCaptionTrackWithTranslations(tracks, preferredLanguageCode, translationLanguages);
    const { track, fallbackTrack, requestedTrack } = selection;

    if (!track) {
      throw new TranscriptError("No caption tracks found.", "No transcript or captions were found for this video.");
    }

    const clientPlaybackParams = createClientPlaybackParams(watchHtml, options.clientPlaybackParams || {});
    const transcriptResult = await fetchReadableTranscriptWithFallback(
      track,
      fallbackTrack,
      fetchImpl,
      fetchOptions,
      options.extraCaptionUrls || [],
      clientPlaybackParams
    );
    const segments = transcriptResult.segments;
    const text = formatTranscript(segments);

    if (!text) {
      throw new TranscriptError("Caption track was empty.", "The transcript track was empty.");
    }

    return {
      title,
      videoId,
      track: transcriptResult.track,
      requestedTrack,
      fellBackToOriginal: selection.fellBackToOriginal || transcriptResult.track !== track,
      sourceUrl: transcriptResult.url,
      sourceFormat: transcriptResult.format,
      segments,
      text,
      filename: createTranscriptFilename(title, videoId)
    };
  }

  function chooseCaptionTrackWithTranslations(tracks, preferredLanguageCode = "en", translationLanguages = []) {
    if (!tracks.length) {
      return { track: null, fallbackTrack: null, requestedTrack: null, fellBackToOriginal: false };
    }

    const nativePreferredTrack = findTrackByLanguage(tracks, preferredLanguageCode);
    if (nativePreferredTrack) {
      return {
        track: nativePreferredTrack,
        fallbackTrack: null,
        requestedTrack: nativePreferredTrack,
        fellBackToOriginal: false
      };
    }

    const translationLanguage = findTranslationLanguage(translationLanguages, preferredLanguageCode);
    const originalTrack = tracks[0];
    if (!translationLanguage) {
      return {
        track: originalTrack,
        fallbackTrack: null,
        requestedTrack: createUnavailableRequestedTrack(preferredLanguageCode),
        fellBackToOriginal: true
      };
    }

    const translatedTrack = createTranslatedCaptionTrack(originalTrack, translationLanguage);
    return {
      track: translatedTrack,
      fallbackTrack: originalTrack,
      requestedTrack: translatedTrack,
      fellBackToOriginal: false
    };
  }

  function findTranslationLanguage(translationLanguages, preferredLanguageCode) {
    const preferred = normalizeLanguageCode(preferredLanguageCode);
    const preferredBase = preferred.split("-")[0];

    return (translationLanguages || []).find((language) => {
      const languageCode = normalizeLanguageCode(language.languageCode);
      return languageCode === preferred || languageCode.split("-")[0] === preferredBase;
    });
  }

  function createTranslatedCaptionTrack(sourceTrack, translationLanguage) {
    return {
      ...sourceTrack,
      baseUrl: appendCaptionQueryParam(sourceTrack.baseUrl, "tlang", translationLanguage.languageCode),
      name: translationLanguage.name || `${sourceTrack.name || "Caption track"} translated to ${translationLanguage.languageCode}`,
      languageCode: translationLanguage.languageCode,
      sourceLanguageCode: sourceTrack.languageCode || "",
      translationLanguageCode: translationLanguage.languageCode
    };
  }

  function createUnavailableRequestedTrack(languageCode) {
    return {
      baseUrl: "",
      name: languageCode || "preferred language",
      languageCode: languageCode || "",
      kind: "",
      unavailable: true
    };
  }

  async function fetchFirstReadableTranscript(
    baseUrl,
    fetchImpl,
    fetchOptions,
    extraCaptionUrls = [],
    clientPlaybackParams = {}
  ) {
    const candidates = dedupeCaptionCandidates([
      ...extraCaptionUrls.map((url) => ({ format: readCaptionFormat(url) || "player", url })),
      { format: "proof-token", url: createProofTokenCaptionUrl(baseUrl, clientPlaybackParams) },
      { format: "generated-json3", url: createPlayerStyleCaptionUrl(baseUrl, clientPlaybackParams) },
      { format: "srv3", url: setCaptionFormat(baseUrl, "srv3") },
      { format: "json3", url: setCaptionFormat(baseUrl, "json3") },
      { format: "default", url: baseUrl }
    ]);
    let lastFailure = "";

    for (const candidate of candidates) {
      const response = await fetchImpl(candidate.url, fetchOptions);

      if (!response.ok) {
        lastFailure = `HTTP ${response.status || "error"} for ${candidate.format}`;
        continue;
      }

      const body = await response.text();
      if (looksLikeHtmlError(body)) {
        lastFailure = `HTML error response for ${candidate.format}`;
        continue;
      }
      const segments = candidate.format === "json3" || body.trim().startsWith("{")
        ? parseTranscriptJson(body)
        : parseTranscriptXml(body);

      if (segments.length) {
        return {
          format: candidate.format,
          url: candidate.url,
          segments
        };
      }

      lastFailure = `empty ${candidate.format} response`;
    }

    throw new TranscriptError(
      `Caption track was empty after trying all formats: ${lastFailure}`,
      "The transcript track was empty in every format YouTube returned."
    );
  }

  async function fetchReadableTranscriptWithFallback(
    track,
    fallbackTrack,
    fetchImpl,
    fetchOptions,
    extraCaptionUrls,
    clientPlaybackParams
  ) {
    try {
      return {
        ...(await fetchFirstReadableTranscript(
          track.baseUrl,
          fetchImpl,
          fetchOptions,
          filterCaptionUrlsForTrack(extraCaptionUrls, track),
          clientPlaybackParams
        )),
        track
      };
    } catch (error) {
      if (!fallbackTrack || !isExpectedTranscriptError(error)) {
        throw error;
      }

      return {
        ...(await fetchFirstReadableTranscript(
          fallbackTrack.baseUrl,
          fetchImpl,
          fetchOptions,
          filterCaptionUrlsForTrack(extraCaptionUrls, fallbackTrack),
          clientPlaybackParams
        )),
        track: fallbackTrack
      };
    }
  }

  function createClientPlaybackParams(watchHtml, clientPlaybackParams) {
    return {
      cbr: clientPlaybackParams.cbr || "Chrome",
      cbrver: clientPlaybackParams.cbrver || "",
      c: clientPlaybackParams.c || "WEB",
      cver: clientPlaybackParams.cver || readQuotedJsonField(watchHtml, "INNERTUBE_CLIENT_VERSION"),
      cplayer: clientPlaybackParams.cplayer || "UNIPLAYER",
      cos: clientPlaybackParams.cos || "",
      cosver: clientPlaybackParams.cosver || "",
      cplatform: clientPlaybackParams.cplatform || "DESKTOP",
      pot: clientPlaybackParams.pot || ""
    };
  }

  function readQuotedJsonField(source, fieldName) {
    const match = source.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`));
    return match ? decodeJsonString(match[1]) : "";
  }

  function dedupeCaptionCandidates(candidates) {
    const seen = new Set();
    const unique = [];

    for (const candidate of candidates) {
      if (!candidate.url || seen.has(candidate.url)) {
        continue;
      }

      seen.add(candidate.url);
      unique.push(candidate);
    }

    return unique;
  }

  function readCaptionFormat(rawUrl) {
    try {
      return new URL(rawUrl).searchParams.get("fmt") || "";
    } catch (_error) {
      return "";
    }
  }

  function filterCaptionUrlsForTrack(urls, track) {
    return (urls || []).filter((url) => isCaptionUrlCompatibleWithTrack(url, track));
  }

  function isCaptionUrlCompatibleWithTrack(rawUrl, track) {
    const urlLanguage = readCaptionUrlLanguage(rawUrl);
    if (!urlLanguage) {
      return true;
    }

    return languageCodesMatch(urlLanguage, track?.languageCode || "");
  }

  function readCaptionUrlLanguage(rawUrl) {
    try {
      const params = new URL(rawUrl).searchParams;
      return params.get("tlang") || params.get("lang") || "";
    } catch (_error) {
      return "";
    }
  }

  function languageCodesMatch(left, right) {
    const normalizedLeft = normalizeLanguageCode(left);
    const normalizedRight = normalizeLanguageCode(right);
    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    return normalizedLeft === normalizedRight || normalizedLeft.split("-")[0] === normalizedRight.split("-")[0];
  }

  function setCaptionFormat(baseUrl, format) {
    const encodedFormat = encodeURIComponent(format);
    if (/[?&]fmt=/.test(baseUrl)) {
      return baseUrl.replace(/([?&]fmt=)[^&]*/, `$1${encodedFormat}`);
    }

    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=${encodedFormat}`;
  }

  function createProofTokenCaptionUrl(baseUrl, clientPlaybackParams = {}) {
    const proofToken = clientPlaybackParams.pot || "";
    if (!proofToken) {
      return "";
    }

    return appendCaptionQueryParam(
      appendCaptionQueryParam(baseUrl, "c", clientPlaybackParams.c || "WEB"),
      "pot",
      proofToken
    );
  }

  function appendCaptionQueryParam(baseUrl, key, value) {
    if (!value) {
      return baseUrl;
    }

    const encodedKey = encodeURIComponent(key);
    const encodedValue = encodeURIComponent(value);
    const existingParamPattern = new RegExp(`([?&]${escapeRegExp(encodedKey)}=)[^&]*`);

    if (existingParamPattern.test(baseUrl)) {
      return baseUrl.replace(existingParamPattern, `$1${encodedValue}`);
    }

    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${encodedKey}=${encodedValue}`;
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function createPlayerStyleCaptionUrl(baseUrl, clientPlaybackParams = {}) {
    const url = new URL(baseUrl);
    const params = {
      fmt: "json3",
      potc: "1",
      pot: clientPlaybackParams.pot || "",
      xorb: "2",
      xobt: "3",
      xovt: "3",
      cbr: clientPlaybackParams.cbr || "Chrome",
      cbrver: clientPlaybackParams.cbrver || "",
      c: clientPlaybackParams.c || "WEB",
      cver: clientPlaybackParams.cver || "",
      cplayer: clientPlaybackParams.cplayer || "UNIPLAYER",
      cos: clientPlaybackParams.cos || "",
      cosver: clientPlaybackParams.cosver || "",
      cplatform: clientPlaybackParams.cplatform || "DESKTOP"
    };

    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  function looksLikeHtmlError(body) {
    const trimmed = body.trim().slice(0, 120).toLowerCase();
    return trimmed.startsWith("<html") || trimmed.startsWith("<!doctype html");
  }

  return {
    TranscriptError,
    chooseCaptionTrack,
    chooseCaptionTrackWithTranslations,
    createTranscriptFilename,
    createPlayerStyleCaptionUrl,
    extractVideoId,
    extractTimedTextUrls,
    fetchTranscriptForVideo,
    formatTranscript,
    formatTimedTranscript,
    formatTimestamp,
    groupTranscriptSegments,
    isExpectedTranscriptError,
    parseCaptionTracks,
    parseTranscriptJson,
    parseTranscriptXml
  };
});
