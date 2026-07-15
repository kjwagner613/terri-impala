window.KW_PLAYER_CONFIG = window.KW_PLAYER_CONFIG || {
  apiBaseUrl: "https://terri-impala-bf21f1293556.herokuapp.com/",
  liveStreamApiBaseUrl: "https://impala-livestream-0225c97b1e97.herokuapp.com",
  localLiveStreamApiBaseUrl: "https://impala-livestream-0225c97b1e97.herokuapp.com",
  authStorageKey: "impalaStreamer.authSession",
  playlistStoragePrefix: "impalaStreamer",
  instanceStorageId: "no1Healer",
  builtInPlaylistsEnabled: false,
  enabledBuiltInPlaylistIds: [],
  brandName: "Impala Streamer",
  appVersion: "1.0.0",
  appBuildDate: "2026.07.135",
  localHelperDownloadUrl: ""
};

window.ImpalaConfig = window.ImpalaConfig || (() => {
  const config = window.KW_PLAYER_CONFIG || {};

  function cleanStorageSegment(value) {
    return String(value || "").trim().replace(/[^a-z0-9._:-]/gi, "-").replace(/^-+|-+$/g, "");
  }

  function getStoragePrefix() {
    const basePrefix = cleanStorageSegment(config.playlistStoragePrefix) || "impalaStreamer";
    const instanceStorageId = cleanStorageSegment(config.instanceStorageId);
    return instanceStorageId ? `${basePrefix}.${instanceStorageId}` : basePrefix;
  }

  function getAuthStorageKey() {
    if (config.authStorageKey && !config.instanceStorageId) {
      return String(config.authStorageKey);
    }

    return `${getStoragePrefix()}.authSession`;
  }

  const preferencesKey = `${getStoragePrefix()}.uiPreferences`;

  function readPreferences() {
    try {
      const rawPreferences = localStorage.getItem(preferencesKey);
      return rawPreferences ? JSON.parse(rawPreferences) : {};
    } catch (error) {
      console.error("Unable to read Impala runtime preferences:", error);
      return {};
    }
  }

  function cleanUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function getCloudApiBaseUrl() {
    const preferences = readPreferences();
    return cleanUrl(preferences.cloudApiBaseUrl || config.apiBaseUrl || "");
  }

  function getLiveStreamApiBaseUrl() {
    const hostname = window.location?.hostname || "";
    const isLocalPreview = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    const configuredUrl = config.liveStreamApiBaseUrl || (isLocalPreview ? config.localLiveStreamApiBaseUrl : "");
    return cleanUrl(configuredUrl);
  }

  function getInstanceId() {
    const preferences = readPreferences();
    return String(preferences.instanceId || "").trim();
  }

  function areBuiltInPlaylistsEnabled() {
    return config.builtInPlaylistsEnabled === true;
  }

  function getEnabledBuiltInPlaylistIds() {
    if (!areBuiltInPlaylistsEnabled()) {
      return [];
    }

    return Array.isArray(config.enabledBuiltInPlaylistIds)
      ? config.enabledBuiltInPlaylistIds.map((playlistId) => String(playlistId))
      : [];
  }

  return {
    preferencesKey,
    getStoragePrefix,
    getAuthStorageKey,
    getCloudApiBaseUrl,
    getLiveStreamApiBaseUrl,
    getInstanceId,
    areBuiltInPlaylistsEnabled,
    getEnabledBuiltInPlaylistIds
  };
})();
