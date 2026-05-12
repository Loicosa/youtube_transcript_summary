const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chooseCaptionTrack,
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
  parseTranscriptXml,
  TranscriptError
} = require("../transcript");

test("extractVideoId returns ids from YouTube watch, short, and embed URLs", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("isExpectedTranscriptError recognizes handled transcript failures", () => {
  assert.equal(isExpectedTranscriptError(new TranscriptError("HTTP 429 for default")), true);
  assert.equal(isExpectedTranscriptError({ name: "TranscriptError", message: "Caption track was empty." }), true);
  assert.equal(isExpectedTranscriptError(new Error("Unexpected bug")), false);
});

test("parseCaptionTracks extracts tracks from ytInitialPlayerResponse JSON", () => {
  const watchHtml = `
    <script>
      var ytInitialPlayerResponse = {
        "videoDetails": {"title": "Demo Video"},
        "captions": {
          "playerCaptionsTracklistRenderer": {
            "captionTracks": [
              {
                "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=en",
                "name": {"simpleText": "English"},
                "languageCode": "en",
                "kind": "asr"
              },
              {
                "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=fr",
                "name": {"runs": [{"text": "French"}]},
                "languageCode": "fr"
              }
            ]
          }
        }
      };
    </script>
  `;

  const result = parseCaptionTracks(watchHtml);

  assert.equal(result.title, "Demo Video");
  assert.deepEqual(result.tracks, [
    {
      baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en",
      name: "English",
      languageCode: "en",
      kind: "asr"
    },
    {
      baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=fr",
      name: "French",
      languageCode: "fr",
      kind: ""
    }
  ]);
});

test("chooseCaptionTrack prefers English and falls back to first track", () => {
  const tracks = [
    { baseUrl: "fr-url", languageCode: "fr", name: "French" },
    { baseUrl: "en-url", languageCode: "en-US", name: "English" }
  ];

  assert.equal(chooseCaptionTrack(tracks).baseUrl, "en-url");
  assert.equal(chooseCaptionTrack(tracks, "de").baseUrl, "en-url");
  assert.equal(chooseCaptionTrack([]), null);
});

test("chooseCaptionTrack prefers requested browser language before English", () => {
  const tracks = [
    { baseUrl: "en-url", languageCode: "en", name: "English" },
    { baseUrl: "fr-url", languageCode: "fr", name: "French" }
  ];

  assert.equal(chooseCaptionTrack(tracks, "fr-FR").baseUrl, "fr-url");
});

test("parseTranscriptXml decodes text and preserves start times", () => {
  const xml = `<transcript>
    <text start="0.5" dur="2.1">Hello &amp; welcome</text>
    <text start="3" dur="1">Second&#39;s line</text>
  </transcript>`;

  assert.deepEqual(parseTranscriptXml(xml), [
    { start: 0.5, duration: 2.1, text: "Hello & welcome" },
    { start: 3, duration: 1, text: "Second's line" }
  ]);
});

test("parseTranscriptXml reads YouTube srv3 paragraph captions", () => {
  const xml = `<timedtext>
    <body>
      <p t="500" d="2100"><s>Hello</s><s> &amp; welcome</s></p>
      <p t="3000" d="1000">Second&#39;s line</p>
    </body>
  </timedtext>`;

  assert.deepEqual(parseTranscriptXml(xml), [
    { start: 0.5, duration: 2.1, text: "Hello & welcome" },
    { start: 3, duration: 1, text: "Second's line" }
  ]);
});

test("parseTranscriptJson reads YouTube json3 caption events", () => {
  const json = JSON.stringify({
    events: [
      {
        tStartMs: 500,
        dDurationMs: 2100,
        segs: [{ utf8: "Hello" }, { utf8: " & welcome" }]
      },
      {
        tStartMs: 3000,
        dDurationMs: 1000,
        segs: [{ utf8: "Second's line" }]
      }
    ]
  });

  assert.deepEqual(parseTranscriptJson(json), [
    { start: 0.5, duration: 2.1, text: "Hello & welcome" },
    { start: 3, duration: 1, text: "Second's line" }
  ]);
});

test("extractTimedTextUrls returns matching YouTube caption resource URLs", () => {
  const urls = extractTimedTextUrls(
    [
      "https://www.youtube.com/api/timedtext?v=abc12345678&lang=fr&pot=token&fmt=json3",
      "https://www.youtube.com/api/timedtext?v=otherVideo1&lang=fr&fmt=json3",
      "https://www.youtube.com/watch?v=abc12345678"
    ],
    "abc12345678"
  );

  assert.deepEqual(urls, [
    "https://www.youtube.com/api/timedtext?v=abc12345678&lang=fr&pot=token&fmt=json3"
  ]);
});

test("extractTimedTextUrls prefers URLs with proof tokens", () => {
  const urls = extractTimedTextUrls(
    [
      "https://www.youtube.com/api/timedtext?v=abc12345678&lang=fr&fmt=json3",
      "https://www.youtube.com/api/timedtext?v=abc12345678&lang=fr&pot=token&fmt=json3"
    ],
    "abc12345678"
  );

  assert.deepEqual(urls, [
    "https://www.youtube.com/api/timedtext?v=abc12345678&lang=fr&pot=token&fmt=json3",
    "https://www.youtube.com/api/timedtext?v=abc12345678&lang=fr&fmt=json3"
  ]);
});

test("createPlayerStyleCaptionUrl encodes signed params and adds player query fields", () => {
  const url = createPlayerStyleCaptionUrl(
    "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&signature=sig&kind=asr&lang=fr",
    {
      cbr: "Chrome",
      cbrver: "148.0.0.0",
      cver: "2.20260508.01.00",
      cos: "Windows",
      cosver: "10.0",
      pot: "proof-token"
    }
  );

  assert.equal(url.includes("sparams=ip%2Cipbits%2Cexpire"), true);
  assert.equal(url.includes("potc=1"), true);
  assert.equal(url.includes("pot=proof-token"), true);
  assert.equal(url.includes("fmt=json3"), true);
  assert.equal(url.includes("xorb=2"), true);
  assert.equal(url.includes("xobt=3"), true);
  assert.equal(url.includes("xovt=3"), true);
  assert.equal(url.includes("cbr=Chrome"), true);
  assert.equal(url.includes("cbrver=148.0.0.0"), true);
  assert.equal(url.includes("c=WEB"), true);
  assert.equal(url.includes("cver=2.20260508.01.00"), true);
  assert.equal(url.includes("cplayer=UNIPLAYER"), true);
  assert.equal(url.includes("cos=Windows"), true);
  assert.equal(url.includes("cosver=10.0"), true);
  assert.equal(url.includes("cplatform=DESKTOP"), true);
});

test("fetchTranscriptForVideo tries another format when srv3 returns empty", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&sparams=ip,ipbits,expire&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }]
      }
    }
  };`;

  const requestedUrls = [];
  const requestedOptions = [];
  const fetchImpl = async (url, options) => {
    requestedUrls.push(url);
    requestedOptions.push(options);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (url.includes("xorb=2")) {
      return { ok: true, text: async () => "" };
    }

    if (url.includes("fmt=srv3")) {
      return { ok: true, text: async () => "<timedtext><body></body></timedtext>" };
    }

    if (url.includes("fmt=json3")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Bonjour" }] }]
          })
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "fr-FR");

  assert.equal(result.text, "Bonjour");
  assert.equal(result.track.languageCode, "fr");
  assert.equal(requestedUrls.some((url) => url.includes("fmt=srv3")), true);
  assert.equal(requestedUrls.some((url) => url.includes("fmt=json3")), true);
  const staticCaptionUrls = requestedUrls.filter((url) => url.includes("/api/timedtext") && !url.includes("xorb=2"));
  assert.equal(staticCaptionUrls.every((url) => !url.includes("sparams=ip%2Cipbits%2Cexpire")), true);
  assert.equal(staticCaptionUrls.every((url) => url.includes("sparams=ip,ipbits,expire")), true);
  assert.equal(requestedOptions.every((options) => options.credentials === "include"), true);
});

test("fetchTranscriptForVideo tries generated player-style URL before static formats", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }]
      }
    }
  };`;
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (url.includes("sparams=ip%2Cipbits%2Cexpire") && url.includes("xorb=2") && url.includes("fmt=json3")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Bonjour generated" }] }]
          })
      };
    }

    return { ok: true, text: async () => "" };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "fr-FR", {
    clientPlaybackParams: {
      cbr: "Chrome",
      cbrver: "148.0.0.0",
      cver: "2.20260508.01.00",
      cos: "Windows",
      cosver: "10.0",
      pot: "generated-token"
    }
  });

  assert.equal(result.text, "Bonjour generated");
  assert.equal(result.sourceFormat, "generated-json3");
  const generatedUrlIndex = requestedUrls.findIndex((url) => url.includes("xorb=2"));
  const firstStaticUrlIndex = requestedUrls.findIndex((url) => url.includes("fmt=srv3"));
  assert.equal(generatedUrlIndex > 0, true);
  assert.equal(firstStaticUrlIndex === -1 || generatedUrlIndex < firstStaticUrlIndex, true);
  assert.equal(requestedUrls[generatedUrlIndex].includes("potc=1"), true);
  assert.equal(requestedUrls[generatedUrlIndex].includes("pot=generated-token"), true);
});

test("fetchTranscriptForVideo tries original caption URL with c=WEB and proof token", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }]
      }
    }
  };`;
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (
      url.includes("sparams=ip,ipbits,expire") &&
      url.includes("c=WEB") &&
      url.includes("pot=proof-token") &&
      !url.includes("fmt=")
    ) {
      return {
        ok: true,
        text: async () => '<transcript><text start="0" dur="1">Bonjour proof</text></transcript>'
      };
    }

    return { ok: true, text: async () => "" };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "fr-FR", {
    clientPlaybackParams: {
      pot: "proof-token"
    }
  });

  assert.equal(result.text, "Bonjour proof");
  assert.equal(result.sourceFormat, "proof-token");
  assert.equal(requestedUrls[1].includes("sparams=ip,ipbits,expire"), true);
  assert.equal(requestedUrls[1].includes("c=WEB"), true);
  assert.equal(requestedUrls[1].includes("pot=proof-token"), true);
  assert.equal(requestedUrls[1].includes("fmt="), false);
});

test("fetchTranscriptForVideo tries player-discovered timedtext URLs before base track URLs", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }]
      }
    }
  };`;
  const playerUrl = "https://www.youtube.com/api/timedtext?v=abc12345678&kind=asr&lang=fr&pot=player-token&fmt=json3";
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (url === playerUrl) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Salut" }] }]
          })
      };
    }

    return { ok: true, text: async () => "" };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "fr-FR", {
    extraCaptionUrls: [playerUrl]
  });

  assert.equal(result.text, "Salut");
  assert.equal(result.sourceUrl, playerUrl);
  assert.equal(requestedUrls[1], playerUrl);
});

test("fetchTranscriptForVideo ignores player-discovered URLs from another language", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [
          {
            "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
            "name": {"simpleText": "French"},
            "languageCode": "fr"
          },
          {
            "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&lang=en",
            "name": {"simpleText": "English"},
            "languageCode": "en"
          }
        ]
      }
    }
  };`;
  const frenchPlayerUrl = "https://www.youtube.com/api/timedtext?v=abc12345678&kind=asr&lang=fr&pot=player-token&fmt=json3";
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (url.includes("lang=en")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] }]
          })
      };
    }

    return { ok: true, text: async () => "" };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "en", {
    extraCaptionUrls: [frenchPlayerUrl]
  });

  assert.equal(result.text, "Hello");
  assert.equal(result.track.languageCode, "en");
  assert.equal(requestedUrls.includes(frenchPlayerUrl), false);
});

test("fetchTranscriptForVideo requests translated captions when preferred language is not native", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }],
        "translationLanguages": [{
          "languageCode": "es",
          "languageName": {"simpleText": "Spanish"}
        }]
      }
    }
  };`;
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (url.includes("tlang=es")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hola" }] }]
          })
      };
    }

    return { ok: true, text: async () => "" };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "es");

  assert.equal(result.text, "Hola");
  assert.equal(result.track.languageCode, "es");
  assert.equal(result.track.translationLanguageCode, "es");
  assert.equal(requestedUrls[1].includes("tlang=es"), true);
});

test("fetchTranscriptForVideo falls back to original captions when translated captions are empty", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }],
        "translationLanguages": [{
          "languageCode": "es",
          "languageName": {"simpleText": "Spanish"}
        }]
      }
    }
  };`;
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    if (url.includes("tlang=es")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ events: [] })
      };
    }

    if (url.includes("lang=fr")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Bonjour original" }] }]
          })
      };
    }

    return { ok: true, text: async () => "" };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "es");

  assert.equal(result.text, "Bonjour original");
  assert.equal(result.track.languageCode, "fr");
  assert.equal(result.requestedTrack.languageCode, "es");
  assert.equal(result.fellBackToOriginal, true);
  assert.equal(requestedUrls.some((url) => url.includes("tlang=es")), true);
  assert.equal(requestedUrls.some((url) => url.includes("lang=fr") && !url.includes("tlang=es")), true);
});

test("fetchTranscriptForVideo falls back to original captions when preferred language is unavailable", async () => {
  const watchHtml = `var ytInitialPlayerResponse = {
    "videoDetails": {"title": "Demo Video"},
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [{
          "baseUrl": "https://www.youtube.com/api/timedtext?v=abc12345678&sparams=ip,ipbits,expire&kind=asr&lang=fr",
          "name": {"simpleText": "French"},
          "languageCode": "fr"
        }]
      }
    }
  };`;
  const fetchImpl = async (url) => {
    if (url.includes("/watch?")) {
      return { ok: true, text: async () => watchHtml };
    }

    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Bonjour original" }] }]
        })
    };
  };

  const result = await fetchTranscriptForVideo("abc12345678", fetchImpl, "es");

  assert.equal(result.text, "Bonjour original");
  assert.equal(result.track.languageCode, "fr");
  assert.equal(result.requestedTrack.languageCode, "es");
  assert.equal(result.fellBackToOriginal, true);
});

test("formatTranscript joins transcript segments with readable spacing", () => {
  assert.equal(
    formatTranscript([
      { text: "Hello world." },
      { text: "This is a transcript." }
    ]),
    "Hello world.\n\nThis is a transcript."
  );
});

test("formatTimestamp renders compact YouTube-style timecodes", () => {
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(64.4), "01:04");
  assert.equal(formatTimestamp(3723.9), "1:02:03");
});

test("groupTranscriptSegments creates readable timed blocks", () => {
  const blocks = groupTranscriptSegments([
    { start: 0, duration: 1, text: "Last week, we heard David." },
    { start: 1.2, duration: 1, text: "Imagine a country where work is prohibited." },
    { start: 17, duration: 1, text: "And then what is necessary above all is that everyone can work." },
    { start: 18.2, duration: 1, text: "So we cannot say that this sentence is not a bit outdated." },
    { start: 35, duration: 1, text: "And then on the background, freedom to work is a concept." }
  ]);

  assert.deepEqual(blocks, [
    {
      start: 0,
      timestamp: "00:00",
      text: "Last week, we heard David. Imagine a country where work is prohibited."
    },
    {
      start: 17,
      timestamp: "00:17",
      text: "And then what is necessary above all is that everyone can work. So we cannot say that this sentence is not a bit outdated."
    },
    {
      start: 35,
      timestamp: "00:35",
      text: "And then on the background, freedom to work is a concept."
    }
  ]);
});

test("groupTranscriptSegments prefers punctuation when blocks get long", () => {
  const blocks = groupTranscriptSegments([
    { start: 0, duration: 1, text: "This is the first part" },
    { start: 1, duration: 1, text: "and it continues for a while." },
    { start: 2, duration: 1, text: "This sentence should start a fresh block after punctuation." }
  ], { softMaxChars: 45, hardMaxChars: 120, maxGapSeconds: 30 });

  assert.deepEqual(blocks.map((block) => block.timestamp), ["00:00", "00:02"]);
  assert.equal(blocks[0].text, "This is the first part and it continues for a while.");
});

test("formatTimedTranscript exports blocks with timestamps", () => {
  const text = formatTimedTranscript([
    { timestamp: "00:00", text: "Intro text." },
    { timestamp: "00:17", text: "Main point." }
  ]);

  assert.equal(text, "[00:00] Intro text.\n\n[00:17] Main point.");
});

test("createTranscriptFilename sanitizes titles and includes video id", () => {
  assert.equal(
    createTranscriptFilename("Demo: Video / Transcript?", "dQw4w9WgXcQ"),
    "Demo Video Transcript-dQw4w9WgXcQ.txt"
  );
  assert.equal(createTranscriptFilename("", "abc123"), "youtube-transcript-abc123.txt");
});

test("requestTimedTextWithCaptionsButton double-clicks and restores caption state", async () => {
  for (const initialPressed of ["false", "true"]) {
    const resourceEntries = [];
    const env = loadContentScriptTestEnvironment({
      initialPressed,
      resourceEntries
    });

    try {
      const observed = await env.contentScript.requestTimedTextWithCaptionsButton();

      assert.equal(observed, true);
      assert.equal(env.button.clickCount, 2);
      assert.equal(env.button.getAttribute("aria-pressed"), initialPressed);
      assert.equal(env.clearResourceTimingsCount(), 1);
    } finally {
      env.restore();
    }
  }
});

test("findRightSidebarContainer prefers the YouTube right sidebar inner container", () => {
  const selectors = [];
  const secondaryInner = { id: "secondary-inner" };
  const secondary = { id: "secondary" };
  const env = loadContentScriptTestEnvironment({
    initialPressed: "false",
    resourceEntries: [],
    querySelector(selector) {
      selectors.push(selector);
      return {
        "ytd-watch-flexy #secondary-inner": secondaryInner,
        "ytd-watch-flexy #secondary": secondary
      }[selector] || null;
    }
  });

  try {
    assert.equal(env.contentScript.findRightSidebarContainer(), secondaryInner);
    assert.deepEqual(selectors, ["ytd-watch-flexy #secondary-inner"]);
  } finally {
    env.restore();
  }
});

test("buildSummaryPrompt creates the ChatGPT summary request", () => {
  const env = loadContentScriptTestEnvironment({
    initialPressed: "false",
    resourceEntries: []
  });

  try {
    assert.equal(
      env.contentScript.buildSummaryPrompt("Transcript body."),
      "Make a summary of this text:\n\nTranscript body."
    );
    assert.equal(
      env.contentScript.buildSummaryPrompt(
        "Transcript body.",
        {
          fellBackToOriginal: true,
          requestedTrack: { name: "Spanish", languageCode: "es" },
          track: { name: "French", languageCode: "fr" }
        },
        { translateFallbackInLlm: true }
      ),
      "Make a summary of this text: The requested caption language was Spanish, but only French captions were available. Write the summary in Spanish.\n\nTranscript body."
    );
  } finally {
    env.restore();
  }
});

test("content script exposes the polished open button label", () => {
  const env = loadContentScriptTestEnvironment({
    initialPressed: "false",
    resourceEntries: []
  });

  try {
    assert.equal(env.contentScript.OPEN_BUTTON_LABEL, "Get Transcript");
    assert.equal(env.contentScript.INLINE_PANEL_AUTO_FETCH, true);
  } finally {
    env.restore();
  }
});

test("content script keeps auto language as YouTube caption language request", () => {
  const env = loadContentScriptTestEnvironment({
    initialPressed: "false",
    resourceEntries: []
  });

  try {
    assert.equal(
      env.contentScript.getPreferredLanguageMessageValue({ defaultLanguage: "auto" }, "fr-FR"),
      "auto"
    );
    assert.equal(
      env.contentScript.getPreferredLanguageMessageValue({ defaultLanguage: "en" }, "fr-FR"),
      "en"
    );
  } finally {
    env.restore();
  }
});

test("buildLlmSummaryMessage creates the configured background request", () => {
  const env = loadContentScriptTestEnvironment({
    initialPressed: "false",
    resourceEntries: []
  });

  try {
    assert.deepEqual(
      env.contentScript.buildLlmSummaryMessage("Make a summary of this text:\n\nHello world.", {
        autoSubmit: true,
        defaultLanguage: "fr",
        llmProvider: "claude"
      }),
      {
        type: "YTTR_OPEN_LLM_SUMMARY",
        prompt: "Make a summary of this text:\n\nHello world.",
        settings: {
          autoSubmit: true,
          defaultLanguage: "fr",
          llmProvider: "claude",
          translateFallbackInLlm: false
        }
      }
    );
  } finally {
    env.restore();
  }
});

function loadContentScriptTestEnvironment({ initialPressed, resourceEntries, querySelector }) {
  const contentScriptPath = require.resolve("../content-script");
  const previousChrome = global.chrome;
  const previousDocument = global.document;
  const previousPerformance = global.performance;
  let pressed = initialPressed;
  let clearCount = 0;
  const button = {
    disabled: false,
    clickCount: 0,
    getAttribute(name) {
      if (name === "aria-pressed") {
        return pressed;
      }
      if (name === "aria-disabled") {
        return "false";
      }
      return null;
    },
    click() {
      this.clickCount += 1;
      pressed = pressed === "true" ? "false" : "true";
      resourceEntries.push({
        name: `https://www.youtube.com/api/timedtext?v=abc12345678&pot=proof-${this.clickCount}`
      });
    }
  };

  delete require.cache[contentScriptPath];
  global.chrome = { runtime: { onMessage: { addListener() {} } } };
  global.document = {
    getElementById() {
      return null;
    },
    querySelector(selector) {
      if (querySelector) {
        return querySelector(selector);
      }

      return selector.includes("ytp-subtitles-button") ? button : null;
    }
  };
  global.performance = {
    clearResourceTimings() {
      clearCount += 1;
      resourceEntries.length = 0;
    },
    getEntriesByType(type) {
      return type === "resource" ? resourceEntries : [];
    }
  };

  const contentScript = require("../content-script");

  return {
    button,
    contentScript,
    clearResourceTimingsCount() {
      return clearCount;
    },
    restore() {
      delete require.cache[contentScriptPath];
      global.chrome = previousChrome;
      global.document = previousDocument;
      global.performance = previousPerformance;
    }
  };
}
