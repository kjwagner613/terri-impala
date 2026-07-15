(() => {
  function isVideoExtension(extension) {
    return ["mp4", "m4v", "webm", "mov"].includes(extension);
  }

  function getMediaPath(song) {
    if (song?.source === "local-library" && song?.file) {
      return String(song.file).trim();
    }

    return String(song?.objectKey || song?.file || "").trim();
  }

  function isAbsoluteMediaUrl(mediaPath) {
    return /^(https?:|file:|blob:|data:)/i.test(String(mediaPath || ""));
  }

  function getLocalMediaRoots() {
    const preferencesApi = window.UiPreferences;
    if (!preferencesApi?.getPreferences) {
      return { audio: "", video: "" };
    }

    const preferences = preferencesApi.getPreferences() || {};
    return {
      audio: String(preferences.localAudioDir || "").trim().replace(/\/+$/, ""),
      video: String(preferences.localVideoDir || "").trim().replace(/\/+$/, "")
    };
  }

  function getLocalHelperBaseUrl() {
    const preferencesApi = window.UiPreferences;
    const preferences = preferencesApi?.getPreferences?.() || {};
    const parsedPort = Number.parseInt(String(preferences.localHelperPort || "8089").trim(), 10);
    const safePort = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535
      ? parsedPort
      : 8089;
    return `http://127.0.0.1:${safePort}`;
  }

  function isLocalHelperEnabled() {
    const preferencesApi = window.UiPreferences;
    const preferences = preferencesApi?.getPreferences?.() || {};
    return preferences.localHelperEnabled === true;
  }

  function resolveLocalServiceUrl(song) {
    if (song?.source !== "local-service" || !isLocalHelperEnabled()) {
      return "";
    }

    const id = String(song.objectKey || song.file || song.id || "").trim();
    return id ? `${getLocalHelperBaseUrl()}/library/file?id=${encodeURIComponent(id)}` : "";
  }

  function buildLocalMediaUrl(baseRoot, mediaPath, mediaKind) {
    if (isAbsoluteMediaUrl(mediaPath)) {
      return String(mediaPath).trim();
    }

    const base = String(baseRoot || "").trim().replace(/\/+$/, "");
    if (!base || !mediaPath) {
      return "";
    }

    const normalizedPath = String(mediaPath).replace(/^\/+/, "");
    const relativePath = mediaKind === "video"
      ? normalizedPath.replace(/^videos?\//i, "")
      : normalizedPath.replace(/^audio\//i, "");

    if (!relativePath) {
      return "";
    }

    const encodedPath = relativePath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return encodedPath ? `${base}/${encodedPath}` : "";
  }

  function getMimeCandidates(extension) {
    switch (extension) {
      case "flac":
        return ["audio/flac", "audio/x-flac"];
      case "mp3":
        return ["audio/mpeg"];
      case "m4a":
        return ["audio/mp4"];
      case "mp4":
        return ["video/mp4", "audio/mp4"];
      case "wav":
        return ["audio/wav", "audio/wave"];
      case "ogg":
        return ["audio/ogg"];
      case "aac":
        return ["audio/aac"];
      default:
        return [];
    }
  }

  function getMediaInfo(song) {
    const mediaPath = getMediaPath(song);
    const match = mediaPath.match(/\.([a-z0-9]+)$/i);
    const extension = match ? match[1].toLowerCase() : "";
    const mimeCandidates = getMimeCandidates(extension);
    const declaredMediaType = String(song?.mediaType || "").trim().toLowerCase();

    let detectionPath = "defaulted to audio";
    if (declaredMediaType === "video") {
      detectionPath = "declared mediaType=video";
    } else if (declaredMediaType === "audio") {
      detectionPath = "declared mediaType=audio";
    } else if (isVideoExtension(extension)) {
      detectionPath = `video extension .${extension}`;
    } else if (extension) {
      detectionPath = `audio/default extension .${extension}`;
    }

    return {
      path: mediaPath,
      extension,
      mediaKind: declaredMediaType === "video" || isVideoExtension(extension)
        ? "video"
        : "audio",
      mimeCandidates,
      preferredMimeType: mimeCandidates[0] || "",
      detectionPath
    };
  }

  function resolveLocalMediaUrl(song, mediaInfo = getMediaInfo(song)) {
    const localServiceUrl = resolveLocalServiceUrl(song);
    if (localServiceUrl) {
      return localServiceUrl;
    }

    const mediaPath = getMediaPath(song);
    const localMediaRoots = getLocalMediaRoots();
    const localRoot = mediaInfo.mediaKind === "video" ? localMediaRoots.video : localMediaRoots.audio;
    return buildLocalMediaUrl(localRoot, mediaPath, mediaInfo.mediaKind);
  }

  window.MediaResolver = {
    isVideoExtension,
    getMediaPath,
    isAbsoluteMediaUrl,
    getLocalMediaRoots,
    getLocalHelperBaseUrl,
    isLocalHelperEnabled,
    buildLocalMediaUrl,
    getMimeCandidates,
    getMediaInfo,
    resolveLocalServiceUrl,
    resolveLocalMediaUrl
  };
})();
