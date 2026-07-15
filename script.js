document.addEventListener("DOMContentLoaded", () => {
  const audioPlayer = document.getElementById("audioPlayer");
  const videoPlayer = document.getElementById("videoPlayer");
  const videoScreen = document.getElementById("video-screen");
  const videoResumeButton = document.getElementById("video-resume-btn");
  const statusDisplay = document.getElementById("status");
  const mediaSourceBadge = document.getElementById("media-source-badge");
  const currentSongDisplay = document.getElementById("current-song");
  const playlistSelector = document.getElementById("playlist-selector");
  const playlistDisplay = document.getElementById("playlist");
  const trackList = document.getElementById("track-list");
  const trackCount = document.getElementById("track-count");
  const trackFilterInput = document.getElementById("track-filter-input");
  const scrollPlayingButton = document.getElementById("scroll-playing-btn");
  const playerStarredCount = document.getElementById("player-starred-count");
  const playerAddStarredButton = document.getElementById("player-add-starred-btn");
  const playerNewStarredButton = document.getElementById("player-new-starred-btn");
  const playerManageStarredButton = document.getElementById("player-manage-starred-btn");
  const playerClearStarredButton = document.getElementById("player-clear-starred-btn");
  const transportButtons = document.querySelectorAll("[data-action]");
  const repeatModeButton = document.getElementById("repeat-mode-btn");
  const randomModeButton = document.querySelector('[data-action="random"]');
  const cardTitle = document.getElementById("card-title");
  const cardSubtitle = document.querySelector(".card-subtitle");
  const asideText = document.querySelector(".player-aside-text");
  const authPanel = document.getElementById("auth-panel");
  const authStatus = document.getElementById("auth-status");
  const authForm = document.getElementById("auth-form");
  const authUsername = document.getElementById("auth-username");
  const authPassword = document.getElementById("auth-password");
  const authLogoutButton = document.getElementById("auth-logout-btn");
  const accountLink = document.getElementById("account-link");
  const diagnosticsButton = document.getElementById("diagnostics-btn");
  const aboutTitle = document.getElementById("impala-title");
  const aboutLink = document.getElementById("about-link");
  const aboutDialog = document.getElementById("about-dialog");
  const aboutCloseButton = document.getElementById("about-close");
  const diagnosticsDialog = document.getElementById("diagnostics-dialog");
  const diagnosticsCloseButton = document.getElementById("diagnostics-close");
  const diagnosticsFrame = document.getElementById("diagnostics-frame");

  const playerConfig = window.KW_PLAYER_CONFIG || {};
  const forceSignerContentType = Boolean(playerConfig.forceSignerContentType);
  const storagePrefix = window.ImpalaConfig?.getStoragePrefix?.()
    || playerConfig.playlistStoragePrefix
    || "impalaStreamer";
  const mediaResolver = window.MediaResolver;
  const playerEngine = window.PlayerEngine;
  const authSessionApi = window.AuthSession;
  const apiClient = window.ImpalaApiClient;
  const liveStreamClient = window.LiveStreamClient;
  const preferencesApi = window.UiPreferences;
  const hlsAdapter = window.ImpalaHlsAdapter;
  const trackSelectionStore = window.TrackSelectionStore;
  const playerStateStore = window.PlayerStateStore;
  const authNotice = window.ImpalaAuthNotice;
  const RESUME_THRESHOLD_SECONDS = 12;
  const FINISHED_THRESHOLD_SECONDS = 20;
  const ERROR_RETRY_LIMIT = 2;
  const RANDOM_HISTORY_LIMIT = 100;

  if (!mediaResolver) {
    console.error("MediaResolver module is missing.");
    return;
  }

  if (!playerEngine) {
    console.error("PlayerEngine module is missing.");
    return;
  }

  let playlistRegistry = [];
  let currentPlaylist = null;
  let currentSongIndex = 0;
  let trackFilterTerm = "";
  let playbackIntent = "paused";
  let activePlaybackMode = "playlist";
  let currentLiveSession = null;
  let activeObjectKey = "";
  let activeMediaKind = "audio";
  let authSession = authSessionApi.load();
  let playerToastTimer = null;
  let repeatMode = playerStateStore.loadRepeatMode();
  let randomMode = playerStateStore.loadRandomMode();
  let randomHistory = [];
  let randomHistoryCursor = -1;
  let errorRetryCount = 0;
  let restoringPosition = false;
  let activeMediaSource = "unknown";
  let activeMediaUrl = "";
  let lastPlayerError = "";
  let mediaLoadStartedAt = 0;
  let activeMediaDebug = {};
  let ambientIdentityController = null;

  function getApiBaseUrl() {
    return apiClient?.getApiBaseUrl?.()
      || window.ImpalaConfig?.getCloudApiBaseUrl?.()
      || String(playerConfig.apiBaseUrl || "").replace(/\/+$/, "");
  }

  function getDiagnosticSource(song) {
    if (song?.source === "local-library" || currentPlaylist?.kind === "local") return "local-library";
    if (currentPlaylist?.kind === "custom") return "custom";
    return "built-in";
  }

  function publishDiagnostics() {
    if (!window.DiagnosticStore) return;

    const builtInCount = PlaylistStore.getBuiltInPlaylists().length;
    const customCount = PlaylistStore.getCustomPlaylists().length;
    const localCount = playlistRegistry.filter((playlist) => playlist.kind === "local").length;
    window.DiagnosticStore.publish({
      player: {
        playlistId: currentPlaylist?.id || "",
        songIndex: currentSongIndex,
        playbackState: playbackIntent,
        repeatMode,
        lastError: lastPlayerError
      },
      registry: {
        builtInCount,
        customCount,
        localCount,
        activeMode: localCount ? "local" : "built-in"
      },
      media: activeMediaDebug
    });
  }

  function updateAboutSystemInfo() {
    const browser = document.getElementById("about-browser");
    const platform = document.getElementById("about-platform");
    const connection = document.getElementById("about-connection");
    const mediaSource = document.getElementById("about-media-source");
    const version = document.getElementById("about-version");
    const connectionInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (version) {
      const appVersion = playerConfig.appVersion || "1.0.0";
      const appBuildDate = playerConfig.appBuildDate || "unknown";
      version.textContent = `v${appVersion} · Build ${appBuildDate}`;
    }
    if (browser) browser.textContent = navigator.userAgent || "Unknown";
    if (platform) platform.textContent = navigator.platform || "Unknown";
    if (connection) connection.textContent = connectionInfo?.effectiveType || "Unknown";
    if (mediaSource) mediaSource.textContent = activeMediaSource === "cloud" || activeMediaSource === "local"
      ? activeMediaSource
      : "Unknown";
  }

  function openAboutDialog() {
    if (!aboutDialog) return;
    ambientIdentityController?.stop();
    updateAboutSystemInfo();
    aboutDialog.showModal();
  }

  function openDiagnosticsDialog() {
    if (!diagnosticsDialog) return;
    publishDiagnostics();
    if (diagnosticsFrame) {
      diagnosticsFrame.src = "diagnostics.html";
    }
    diagnosticsDialog.showModal();
  }

  function getMediaElementForKind(kind) {
    if (kind === "video") {
      return videoPlayer || audioPlayer;
    }

    return audioPlayer || videoPlayer;
  }

  function getActiveMediaElement() {
    return getMediaElementForKind(activeMediaKind);
  }

  function getPrimaryPlaybackElement(mediaInfo) {
    if (mediaInfo.mediaKind === "video") {
      return videoPlayer || audioPlayer;
    }

    return audioPlayer || videoPlayer;
  }

  function getFallbackPlaybackElement(primaryElement) {
    if (!primaryElement) {
      return null;
    }

    if (primaryElement === videoPlayer) {
      return audioPlayer || null;
    }

    if (primaryElement === audioPlayer) {
      return videoPlayer || null;
    }

    return null;
  }

  function stopAndClearMediaElement(mediaElement) {
    if (!mediaElement) {
      return;
    }

    mediaElement.pause();
    hlsAdapter?.destroy?.(mediaElement);
    mediaElement.removeAttribute("src");
    mediaElement.load();
  }

  function pauseMediaElement(mediaElement) {
    if (!mediaElement) {
      return;
    }

    mediaElement.pause();
  }

  function stopAllMediaPlayback() {
    pauseMediaElement(audioPlayer);
    pauseMediaElement(videoPlayer);
  }

  function clearAllMediaSources() {
    stopAndClearMediaElement(audioPlayer);
    stopAndClearMediaElement(videoPlayer);
  }

  function isLivePlaybackActive() {
    return activePlaybackMode === "live" && Boolean(currentLiveSession?.streamUrl);
  }

  function enforceExclusivePlayback(activeElement) {
    if (activeElement === videoPlayer) {
      pauseMediaElement(audioPlayer);
      return;
    }

    if (activeElement === audioPlayer) {
      pauseMediaElement(videoPlayer);
    }
  }

  function setMediaMode(kind) {
    activeMediaKind = kind === "video" ? "video" : "audio";
    document.body.classList.toggle("is-video-mode", activeMediaKind === "video");
    document.body.classList.toggle("is-audio-mode", activeMediaKind !== "video");

    if (audioPlayer) {
      audioPlayer.hidden = activeMediaKind === "video";
    }

    if (videoScreen) {
      videoScreen.hidden = activeMediaKind !== "video";
    }

    updateVideoResumeButton();
  }

  function saveRepeatMode(mode) {
    repeatMode = playerStateStore.saveRepeatMode(mode);
    updateRepeatModeUi();
    publishDiagnostics();
  }

  function updateRepeatModeUi() {
    if (!repeatModeButton) {
      return;
    }

    const labelMap = {
      off: "Repeat Off",
      one: "Repeat One",
      all: "Repeat All"
    };
    repeatModeButton.textContent = labelMap[repeatMode] || labelMap.off;
    repeatModeButton.setAttribute("aria-pressed", repeatMode === "off" ? "false" : "true");
  }

  function cycleRepeatMode() {
    const nextMode = repeatMode === "off" ? "one" : repeatMode === "one" ? "all" : "off";
    saveRepeatMode(nextMode);
    showPlayerToast(repeatModeButton?.textContent || "Repeat mode updated.");
  }

  function saveRandomMode(enabled) {
    randomMode = playerStateStore.saveRandomMode(enabled);
    updateRandomModeUi();
    publishDiagnostics();
  }

  function updateRandomModeUi() {
    if (!randomModeButton) {
      return;
    }

    randomModeButton.classList.toggle("is-active", randomMode);
    randomModeButton.setAttribute("aria-pressed", randomMode ? "true" : "false");
    randomModeButton.setAttribute("title", randomMode ? "Random mode on" : "Random mode off");
  }

  function playRandomSong() {
    const totalSongs = currentPlaylist?.songs?.length || 0;

    if (!totalSongs) {
      getActiveMediaElement().pause();
      updateDisplayText("No songs available");
      persistPlayerState("paused");
      return;
    }

    const randomIndex = generateRandomTrackIndex();
    if (randomIndex < 0) {
      return;
    }

    pushRandomHistory(randomIndex);
    playSong(randomIndex, true);
  }

  function toggleRandomMode() {
    const nextMode = !randomMode;
    saveRandomMode(nextMode);

    if (nextMode) {
      resetRandomHistory(currentSongIndex);
      playRandomSong();
      showPlayerToast("Random mode on.");
      return;
    }

    showPlayerToast("Random mode off.");
  }

  function resetRandomHistory(seedIndex = currentSongIndex) {
    randomHistory = [];
    randomHistoryCursor = -1;

    if (Number.isInteger(seedIndex) && seedIndex >= 0) {
      randomHistory.push(seedIndex);
      randomHistoryCursor = 0;
    }
  }

  function pushRandomHistory(index) {
    if (!Number.isInteger(index) || index < 0) {
      return;
    }

    if (randomHistoryCursor < randomHistory.length - 1) {
      randomHistory = randomHistory.slice(0, randomHistoryCursor + 1);
    }

    const currentValue = randomHistory[randomHistoryCursor];
    if (currentValue === index) {
      return;
    }

    randomHistory.push(index);
    randomHistoryCursor = randomHistory.length - 1;

    if (randomHistory.length > RANDOM_HISTORY_LIMIT) {
      const overflow = randomHistory.length - RANDOM_HISTORY_LIMIT;
      randomHistory = randomHistory.slice(overflow);
      randomHistoryCursor = Math.max(0, randomHistoryCursor - overflow);
    }
  }

  function getNextRandomHistoryIndex() {
    if (randomHistoryCursor >= 0 && randomHistoryCursor < randomHistory.length - 1) {
      randomHistoryCursor += 1;
      return randomHistory[randomHistoryCursor];
    }

    return null;
  }

  function getPreviousRandomHistoryIndex() {
    if (randomHistoryCursor > 0) {
      randomHistoryCursor -= 1;
      return randomHistory[randomHistoryCursor];
    }

    return null;
  }

  function generateRandomTrackIndex() {
    const totalSongs = currentPlaylist?.songs?.length || 0;
    if (!totalSongs) {
      return -1;
    }

    let randomIndex = Math.floor(Math.random() * totalSongs);
    if (totalSongs > 1 && randomIndex === currentSongIndex) {
      randomIndex = (randomIndex + 1) % totalSongs;
    }

    return randomIndex;
  }

  function playRandomHistoryNext() {
    const totalSongs = currentPlaylist?.songs?.length || 0;
    if (!totalSongs) {
      getActiveMediaElement().pause();
      updateDisplayText("No songs available");
      persistPlayerState("paused");
      return;
    }

    const historyIndex = getNextRandomHistoryIndex();
    if (Number.isInteger(historyIndex)) {
      playSong(historyIndex, true);
      return;
    }

    const randomIndex = generateRandomTrackIndex();
    if (randomIndex < 0) {
      return;
    }

    pushRandomHistory(randomIndex);
    playSong(randomIndex, true);
  }

  function saveAuthSession(session) {
    authSession = authSessionApi.save(session);
  }

  function updateAuthUi(message) {
    const usesPrivateApi = Boolean(getApiBaseUrl());
    const isLoggedIn = Boolean(authSession && authSession.token);
    authNotice?.render?.({
      targetSelector: ".hero-meta",
      needsPrivateAccess: usesPrivateApi && !isLoggedIn
    });

    if (accountLink) {
      accountLink.textContent = isLoggedIn ? "Current User" : "Sign In";
      accountLink.classList.toggle("is-authorized", isLoggedIn);
      accountLink.title = isLoggedIn
        ? `Signed in as ${authSession.displayName || authSession.username}`
        : "Sign in for private playback";
    }

    if (!authPanel || !authStatus || !authForm || !authLogoutButton) {
      if (message) showPlayerToast(message);
      return;
    }

    authPanel.hidden = (!usesPrivateApi && !message) || (usesPrivateApi && isLoggedIn && !message);

    if (message) {
      authStatus.textContent = message;
    } else if (!usesPrivateApi) {
      authStatus.textContent = "Private MEGA playback requires a configured signer API.";
    } else if (isLoggedIn) {
      authStatus.textContent = `Authorized for ${authSession.displayName || authSession.username}.`;
    } else {
      authStatus.textContent = "Private library access requires sign-in.";
    }

    authForm.hidden = !usesPrivateApi || isLoggedIn;
    authLogoutButton.hidden = !usesPrivateApi || !isLoggedIn;
  }

  async function apiRequest(path, options = {}) {
    try {
      return await apiClient.request(path, options);
    } finally {
      authSession = authSessionApi.load();
    }
  }

  async function login(username, password) {
    const payload = await apiRequest("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    saveAuthSession(payload);
    updateAuthUi();
  }

  function logout() {
    saveAuthSession(null);
    PlaylistStore.clearTransientTrackSelections();
    updateAuthUi("Authorized playback disabled.");
    renderTrackList();
  }

  function getMediaPath(song) {
    return mediaResolver.getMediaPath(song);
  }

  function getSongIdentity(song) {
    return trackSelectionStore.getSongIdentity(song);
  }

  function clearTrackSelections() {
    trackSelectionStore.clear();
  }

  function isTrackSelected(playlistId, song, songIndex) {
    return trackSelectionStore.isSelected(playlistId, song, songIndex);
  }

  function toggleTrackSelection(playlistId, song, songIndex) {
    trackSelectionStore.toggle(playlistId, song, songIndex);
  }

  function getSelectedSongCount(playlist) {
    return trackSelectionStore.countSelected(playlist);
  }

  function getSelectedSongsFromCurrentPlaylist() {
    return trackSelectionStore.getSelectedSongs(currentPlaylist);
  }

  function getPlayerToastElement() {
    let element = document.getElementById("player-toast");
    if (element) {
      return element;
    }

    element = document.createElement("div");
    element.id = "player-toast";
    element.className = "player-toast";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    document.body.appendChild(element);
    return element;
  }

  function showPlayerToast(message) {
    const toast = getPlayerToastElement();
    toast.textContent = message;
    toast.classList.add("is-visible");

    if (playerToastTimer) {
      window.clearTimeout(playerToastTimer);
    }

    playerToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2200);
  }

  function appendSongsToCustomPlaylist(playlistId, songs) {
    let addedCount = 0;
    let duplicateCount = 0;

    PlaylistStore.updateCustomPlaylist(playlistId, (playlist) => {
      const existingKeys = new Set(playlist.songs.map((song) => getSongIdentity(song)).filter(Boolean));
      const songsToAdd = [];

      songs.forEach((song, index) => {
        const identity = getSongIdentity(song);
        if (identity && existingKeys.has(identity)) {
          duplicateCount += 1;
          return;
        }

        if (identity) {
          existingKeys.add(identity);
        }

        addedCount += 1;
        songsToAdd.push({
          ...song,
          id: `${playlistId}-${Date.now()}-${index}`
        });
      });

      return {
        ...playlist,
        songs: [...playlist.songs, ...songsToAdd]
      };
    });

    return { addedCount, duplicateCount };
  }

  function buildImportMessage(label, playlistName, addedCount, duplicateCount) {
    if (!addedCount && duplicateCount) {
      return `${label} already exists in ${playlistName}.`;
    }

    const duplicateSuffix = duplicateCount
      ? ` Skipped ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}.`
      : "";
    return `Added ${addedCount} track${addedCount === 1 ? "" : "s"} from ${label} to ${playlistName}.${duplicateSuffix}`;
  }

  function resolveExistingPlaylistChoice(customPlaylists, rawInput) {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) {
      return null;
    }

    const byIndex = Number.parseInt(trimmed, 10);
    if (Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= customPlaylists.length) {
      return customPlaylists[byIndex - 1];
    }

    return customPlaylists.find((playlist) => (
      playlist.id === trimmed || playlist.name.toLowerCase() === trimmed.toLowerCase()
    )) || null;
  }

  async function addStarredToExistingPlaylist() {
    const selectedSongs = getSelectedSongsFromCurrentPlaylist();
    if (!selectedSongs.length) {
      showPlayerToast("Star tracks first.");
      return;
    }

    const customPlaylists = PlaylistStore.getCustomPlaylists();
    if (!customPlaylists.length) {
      showPlayerToast("Create a custom playlist first.");
      return;
    }

    const choices = customPlaylists.map((playlist, index) => `${index + 1}. ${playlist.name}`).join("\n");
    const defaultName = customPlaylists[0].name;
    const input = await window.ImpalaDialog.prompt({
      title: "Add Starred Tracks",
      message: `Add starred tracks to which playlist?\n\n${choices}\n\nType a number or exact playlist name:`,
      defaultValue: defaultName,
      confirmLabel: "Add"
    });

    if (input === null) {
      return;
    }

    const targetPlaylist = resolveExistingPlaylistChoice(customPlaylists, input);
    if (!targetPlaylist) {
      showPlayerToast("Playlist not found.");
      return;
    }

    const { addedCount, duplicateCount } = appendSongsToCustomPlaylist(targetPlaylist.id, selectedSongs);
    clearTrackSelections();
    refreshRegistry();
    currentPlaylist = getPlaylistById(currentPlaylist?.id || "") || currentPlaylist;
    renderTrackList();
    showPlayerToast(buildImportMessage("starred tracks", targetPlaylist.name, addedCount, duplicateCount));
  }

  async function createPlaylistFromStarred() {
    const selectedSongs = getSelectedSongsFromCurrentPlaylist();
    if (!selectedSongs.length) {
      showPlayerToast("Star tracks first.");
      return;
    }

    const defaultName = currentPlaylist ? `${currentPlaylist.name} Starred` : "Starred Tracks";
    const playlistNameInput = await window.ImpalaDialog.prompt({
      title: "New Playlist",
      message: "Name the new playlist:",
      defaultValue: defaultName,
      confirmLabel: "Create"
    });
    if (playlistNameInput === null) {
      return;
    }

    const playlistName = playlistNameInput.trim() || defaultName;
    const playlistId = PlaylistStore.createCustomPlaylist(playlistName);
    const { addedCount, duplicateCount } = appendSongsToCustomPlaylist(playlistId, selectedSongs);
    clearTrackSelections();
    refreshRegistry();
    setCurrentPlaylist(playlistId, { songIndex: 0, playbackState: "paused" });
    showPlayerToast(buildImportMessage("starred tracks", playlistName, addedCount, duplicateCount));
  }

  function canUseGlobalHotkeys(event) {
    if (event.defaultPrevented || event.repeat) {
      return false;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return true;
    }

    if (target.closest("input, textarea, select, [contenteditable='true']")) {
      return false;
    }

    return true;
  }

  function toggleCurrentTrackStar() {
    if (!currentPlaylist || !currentPlaylist.songs[currentSongIndex]) {
      return;
    }

    const song = currentPlaylist.songs[currentSongIndex];
    const nextIsSelected = !isTrackSelected(currentPlaylist.id, song, currentSongIndex);
    toggleTrackSelection(currentPlaylist.id, song, currentSongIndex);
    renderTrackList();
    showPlayerToast(nextIsSelected ? "Starred current track." : "Removed star from current track.");
  }

  function handleGlobalHotkeys(event) {
    if (!canUseGlobalHotkeys(event)) {
      return;
    }

    const key = String(event.key || "").toLowerCase();

    switch (key) {
      case "s":
        event.preventDefault();
        toggleCurrentTrackStar();
        break;
      case "a":
        event.preventDefault();
        addStarredToExistingPlaylist();
        break;
      case "n":
        event.preventDefault();
        createPlaylistFromStarred();
        break;
      case "m":
        event.preventDefault();
        window.location.href = "songlist.html";
        break;
      case "c":
        event.preventDefault();
        clearTrackSelections();
        renderTrackList();
        showPlayerToast("Cleared starred tracks.");
        break;
      case "h":
      case "?":
        event.preventDefault();
        showPlayerToast("Hotkeys: S star current, A add starred, N new playlist, M manage starred, C clear starred.");
        break;
      default:
        break;
    }
  }

  function updatePlayerStarredUi() {
    if (
      !playerStarredCount
      || !playerAddStarredButton
      || !playerNewStarredButton
      || !playerManageStarredButton
      || !playerClearStarredButton
    ) {
      return;
    }

    const selectedCount = getSelectedSongCount(currentPlaylist);
    playerStarredCount.textContent = `${selectedCount} starred`;
    const hasSelection = selectedCount > 0;
    playerAddStarredButton.disabled = !hasSelection;
    playerNewStarredButton.disabled = !hasSelection;
    playerManageStarredButton.disabled = !hasSelection;
    playerClearStarredButton.disabled = !hasSelection;
  }

  function getMediaInfo(song) {
    return mediaResolver.getMediaInfo(song);
  }

  function getSavedPlaybackPosition(song) {
    return playerStateStore.getSavedPlaybackPosition(song);
  }

  function savePlaybackPosition(song, positionSeconds, durationSeconds = 0) {
    playerStateStore.savePlaybackPosition(song, positionSeconds, durationSeconds, {
      resumeThresholdSeconds: RESUME_THRESHOLD_SECONDS,
      finishedThresholdSeconds: FINISHED_THRESHOLD_SECONDS
    });
  }

  function getCurrentVideoResumePosition() {
    const song = currentPlaylist?.songs?.[currentSongIndex];
    if (!song || getMediaInfo(song).mediaKind !== "video") {
      return 0;
    }

    return getSavedPlaybackPosition(song);
  }

  function snapshotCurrentVideoPosition() {
    const song = currentPlaylist?.songs?.[currentSongIndex];
    if (!song || !videoPlayer || getMediaInfo(song).mediaKind !== "video") {
      return;
    }

    savePlaybackPosition(song, videoPlayer.currentTime || 0, videoPlayer.duration || 0);
  }

  function updateVideoResumeButton() {
    if (!videoResumeButton) {
      return;
    }

    const position = getCurrentVideoResumePosition();
    const isVideoPlaying = activeMediaKind === "video"
      && Boolean(videoPlayer)
      && !videoPlayer.paused
      && !videoPlayer.ended;
    videoResumeButton.hidden = activeMediaKind !== "video"
      || position < RESUME_THRESHOLD_SECONDS
      || isVideoPlaying;
    if (!videoResumeButton.hidden) {
      const minutes = Math.floor(position / 60);
      const seconds = Math.floor(position % 60).toString().padStart(2, "0");
      videoResumeButton.textContent = `Resume ${minutes}:${seconds}`;
    }
  }

  function canPlaySong(song) {
    const { mimeCandidates } = getMediaInfo(song);
    const mediaElements = [videoPlayer, audioPlayer].filter(Boolean);

    if (!mediaElements.length) {
      return false;
    }

    if (!mimeCandidates.length) {
      return true;
    }

    return mediaElements.some((mediaElement) => (
      mimeCandidates.some((mimeType) => mediaElement.canPlayType(mimeType) !== "")
    ));
  }

  async function resolveMediaUrl(song) {
    const mediaInfo = getMediaInfo(song);
    const mediaPath = getMediaPath(song);

    if (song?.source === "local-service" && !mediaResolver.isLocalHelperEnabled?.()) {
      throw new Error("Local Library Companion is off. Turn it on in Settings to play this local-library playlist.");
    }

    const localMediaUrl = mediaResolver.resolveLocalMediaUrl(song, mediaInfo);
    if (localMediaUrl) {
      return { url: localMediaUrl, source: "local" };
    }

    if (!song.objectKey) {
      if (mediaPath) {
        return { url: mediaPath, source: "local" };
      }
      throw new Error("This song is missing both objectKey and file path.");
    }

    if (!getApiBaseUrl()) {
      throw new Error("This song uses a private object key, but no API signer is configured.");
    }

    const { preferredMimeType } = mediaInfo;
    const query = new URLSearchParams({
      key: song.objectKey,
      media: mediaInfo.mediaKind
    });
    const explicitContentType = String(song?.contentType || "").trim().toLowerCase();

    if (explicitContentType) {
      query.set("contentType", explicitContentType);
    } else if (mediaInfo.mediaKind === "video" && preferredMimeType) {
      query.set("contentType", preferredMimeType);
    } else if (forceSignerContentType && preferredMimeType) {
      query.set("contentType", preferredMimeType);
    }

    const payload = await apiRequest(`/api/media-url?${query.toString()}`);
    return { url: payload.url, source: "cloud" };
  }

  function updateMediaSourceBadge(source = activeMediaSource) {
    if (!mediaSourceBadge) {
      return;
    }

    const normalizedSource = ["cloud", "local", "live"].includes(source) ? source : "unknown";
    activeMediaSource = normalizedSource;

    const currentSong = currentPlaylist?.songs?.[currentSongIndex] || null;
    const localTitle = isLocalServiceSong(currentSong)
      ? "Local Library Companion source"
      : "Local media source";
    const badgeMap = {
      local: { label: "L", title: localTitle },
      cloud: { label: "C", title: "Cloud media source" },
      live: { label: "LIVE", title: "Live stream source" },
      unknown: { label: "-", title: "Media source unknown" }
    };

    function getUrlDetailLabel(url, sourceType) {
      const value = String(url || "").trim();
      if (!value) {
        return "no URL yet";
      }

      if (/^file:\/\//i.test(value)) {
        return "file:// path";
      }

      if (/^blob:/i.test(value)) {
        return "blob URL";
      }

      if (/^https?:\/\//i.test(value)) {
        return sourceType === "cloud" ? "signed cloud URL" : "web URL";
      }

      if (value.startsWith("/")) {
        return "absolute local/web path";
      }

      return "relative path";
    }

    const badge = badgeMap[normalizedSource];
    const detailLabel = getUrlDetailLabel(activeMediaUrl, normalizedSource);
    mediaSourceBadge.textContent = badge.label;
    mediaSourceBadge.setAttribute("title", `${badge.title} (${detailLabel})`);
    mediaSourceBadge.setAttribute("aria-label", `${badge.title}; ${detailLabel}`);
    mediaSourceBadge.classList.remove("is-local", "is-cloud", "is-unknown");
    mediaSourceBadge.classList.add(`is-${normalizedSource}`);
  }

  function refreshRegistry() {
    playlistRegistry = PlaylistStore.getPlaylistRegistry();
  }

  function getPlaylistById(playlistId) {
    return playlistRegistry.find((playlist) => playlist.id === playlistId) || null;
  }

  function isLocalServiceSong(song) {
    return song?.source === "local-service";
  }

  function isLocalServicePlaylist(playlist) {
    return Array.isArray(playlist?.songs) && playlist.songs.some(isLocalServiceSong);
  }

  function buildPlaylistSelector(selectedPlaylistId) {
    playlistSelector.innerHTML = "";

    playlistRegistry.forEach((playlist) => {
      const option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = `${playlist.name}${isLocalServicePlaylist(playlist) ? " (Local)" : ""}`;
      if (isLocalServicePlaylist(playlist)) {
        option.title = "Local Library Companion playlist";
      }
      option.selected = playlist.id === selectedPlaylistId;
      playlistSelector.appendChild(option);
    });
  }

  function persistPlayerState(nextPlaybackState = playbackIntent) {
    if (!currentPlaylist) {
      return;
    }

    playbackIntent = nextPlaybackState === "playing" ? "playing" : "paused";
    PlaylistStore.savePlayerState({
      playlistId: currentPlaylist.id,
      songIndex: currentSongIndex,
      playbackState: playbackIntent
    });
    publishDiagnostics();
  }

  function updateDisplayText(status) {
    statusDisplay.textContent = status;

    if (isLivePlaybackActive()) {
      const session = currentLiveSession;
      currentSongDisplay.textContent = "";
      currentSongDisplay.append(
        document.createTextNode(session.title || "Live Stream"),
        document.createElement("br"),
        document.createTextNode("Live Stream")
      );
      playlistDisplay.textContent = "Live";
      if (asideText) {
        asideText.textContent = `${session.title || "Live Stream"} is active.`;
      }
      updateMediaSourceBadge("live");
      return;
    }

    if (!currentPlaylist || !currentPlaylist.songs[currentSongIndex]) {
      updateMediaSourceBadge("unknown");
      currentSongDisplay.textContent = "No song loaded";
      playlistDisplay.textContent = "No playlist";
      if (asideText) {
        asideText.textContent = "Choose a playlist to begin listening.";
      }
      return;
    }

    const song = currentPlaylist.songs[currentSongIndex];
    currentSongDisplay.textContent = "";
    currentSongDisplay.append(
      document.createTextNode(song.name),
      document.createElement("br"),
      document.createTextNode(song.artist || "Unknown artist")
    );
    playlistDisplay.textContent = `${isLocalServicePlaylist(currentPlaylist) ? "L " : ""}${currentPlaylist.name}`;

    if (asideText) {
      asideText.textContent = `${song.name} by ${song.artist || "Unknown artist"} from the PlayList ${currentPlaylist.name}.`;
    }

    updateMediaSourceBadge();
  }

  function updateHeroCopy() {
    if (!currentPlaylist) {
      document.body.classList.remove("is-local-helper-playlist");
      return;
    }

    if (cardTitle) {
      cardTitle.textContent = currentPlaylist.name;
    }

    if (cardSubtitle) {
      cardSubtitle.textContent = isLocalServicePlaylist(currentPlaylist)
        ? "Local library playlist served by Impala Helper."
        : currentPlaylist.kind === "custom"
        ? "Custom playlist saved on this device."
        : "Built-in catalog playlist.";
    }

    document.body.classList.toggle("is-local-helper-playlist", isLocalServicePlaylist(currentPlaylist));
  }

  function renderTrackList() {
    if (!trackList || !trackCount) {
      return;
    }

    if (!currentPlaylist || !currentPlaylist.songs.length) {
      trackCount.textContent = "0 songs";
      trackList.innerHTML = `
        <div class="track-item track-item-empty">
          <div class="track-number">0</div>
          <div class="track-meta">
            <strong>No songs yet</strong>
            <span>Add songs in the editor to build this playlist.</span>
          </div>
        </div>
      `;
      updatePlayerStarredUi();
      return;
    }

    trackCount.textContent = `${currentPlaylist.songs.length} song${currentPlaylist.songs.length === 1 ? "" : "s"}`;
    trackList.innerHTML = "";

    const visibleSongs = currentPlaylist.songs
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => trackMatchesFilter(song, trackFilterTerm));

    if (!visibleSongs.length) {
      const empty = document.createElement("div");
      empty.className = "track-item track-item-empty";
      empty.innerHTML = `
        <span class="track-number">0</span>
        <span class="track-meta">
          <strong>No matches</strong>
          <span>Try another first-letter filter.</span>
        </span>
      `;
      trackList.appendChild(empty);
      updatePlayerStarredUi();
      return;
    }

    visibleSongs.forEach(({ song, index }) => {
      const row = document.createElement("div");
      row.className = `track-item-row${isLocalServiceSong(song) ? " is-local-service" : ""}`;

      const item = document.createElement("button");
      item.type = "button";
      item.className = `track-item${index === currentSongIndex ? " is-active" : ""}${isLocalServiceSong(song) ? " is-local-service" : ""}`;
      const number = document.createElement("span");
      number.className = "track-number";
      number.textContent = String(index + 1);

      const meta = document.createElement("span");
      meta.className = "track-meta";

      const title = document.createElement("strong");
      title.textContent = song.name;

      const artist = document.createElement("span");
      artist.textContent = song.artist || "Unknown artist";

      if (isLocalServiceSong(song)) {
        const sourceBadge = document.createElement("span");
        sourceBadge.className = "track-source-pill";
        sourceBadge.textContent = "L";
        sourceBadge.title = "Local Library Companion";
        meta.appendChild(sourceBadge);
      }
      meta.appendChild(title);
      meta.appendChild(artist);
      item.appendChild(number);
      item.appendChild(meta);
      item.addEventListener("click", () => {
        playSong(index, true);
      });

      const starred = isTrackSelected(currentPlaylist.id, song, index);
      const starButton = document.createElement("button");
      starButton.type = "button";
      starButton.className = `track-star-btn${starred ? " is-selected" : ""}`;
      starButton.setAttribute("aria-pressed", starred ? "true" : "false");
      starButton.setAttribute("aria-label", starred ? "Remove star" : "Star track");
      starButton.setAttribute("title", starred ? "Remove star" : "Star track");
      starButton.textContent = starred ? "★" : "☆";
      starButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleTrackSelection(currentPlaylist.id, song, index);
        renderTrackList();
      });

      row.appendChild(item);
      row.appendChild(starButton);
      trackList.appendChild(row);
    });

    updatePlayerStarredUi();
  }

  function normalizeTrackFilter(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getTrackSearchTokens(value) {
    return String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function trackFieldMatches(value, term) {
    if (!term) return true;
    return getTrackSearchTokens(value).some((token) => token.startsWith(term));
  }

  function trackMatchesFilter(song, term) {
    if (!term) return true;
    return (
      trackFieldMatches(song?.name, term) ||
      trackFieldMatches(song?.artist, term) ||
      trackFieldMatches(song?.album, term)
    );
  }

  function scrollCurrentTrackIntoView() {
    if (!trackList || !currentPlaylist) return;
    if (trackFilterInput && trackFilterTerm) {
      trackFilterTerm = "";
      trackFilterInput.value = "";
      renderTrackList();
    }

    const active = trackList.querySelector(".track-item.is-active");
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function setCurrentPlaylist(playlistId, options = {}) {
    const playlist = getPlaylistById(playlistId) || playlistRegistry[0] || null;

    currentPlaylist = playlist;
    currentSongIndex = options.songIndex || 0;

    if (currentPlaylist && currentSongIndex >= currentPlaylist.songs.length) {
      currentSongIndex = 0;
    }

    buildPlaylistSelector(currentPlaylist ? currentPlaylist.id : "");
    updateHeroCopy();
    renderTrackList();
    updateDisplayText("Paused");
    persistPlayerState(options.playbackState || "paused");
  }

  function getFriendlyPlaybackMessage(error) {
    const rawMessage = String(error?.message || "").toLowerCase();
    if (error?.name === "AbortError" || rawMessage.includes("interrupted by a call to pause")) {
      return "click Play.";
    }

    return error?.message || "click Play.";
  }

  async function playSong(index, autoPlay = true, options = {}) {
    if (!currentPlaylist || !currentPlaylist.songs[index]) {
      return;
    }

    activePlaybackMode = "playlist";
    currentLiveSession = null;
    snapshotCurrentVideoPosition();
    currentSongIndex = index;
    const song = currentPlaylist.songs[currentSongIndex];
    const songIdentity = getSongIdentity(song);
    activeObjectKey = songIdentity;
    lastPlayerError = "";
    mediaLoadStartedAt = performance.now();
    updateDisplayText("Loading");

    try {
      const mediaInfo = getMediaInfo(song);
      activeMediaDebug = {
        resolvedPath: "Resolving…",
        extension: mediaInfo.extension || "unknown",
        mime: String(song.contentType || "").trim() || mediaInfo.preferredMimeType || "unknown",
        source: getDiagnosticSource(song),
        loadTimeMs: null,
        detectionPath: `${mediaInfo.mediaKind} via ${mediaInfo.detectionPath}`
      };
      publishDiagnostics();
      if (!canPlaySong(song)) {
        throw new Error(`This browser cannot play ${mediaInfo.extension ? mediaInfo.extension.toUpperCase() : "this"} media files.`);
      }

      const resolvedMedia = await resolveMediaUrl(song);
      activeMediaSource = resolvedMedia.source;
      activeMediaUrl = resolvedMedia.url;
      activeMediaDebug.resolvedPath = resolvedMedia.url;
      activeMediaDebug.source = resolvedMedia.source;
      activeMediaDebug.loadTimeMs = Math.round(performance.now() - mediaLoadStartedAt);
      updateMediaSourceBadge(resolvedMedia.source);
      publishDiagnostics();
      setMediaMode(mediaInfo.mediaKind);

      let activeMediaElement = getPrimaryPlaybackElement(mediaInfo);
      const fallbackMediaElement = getFallbackPlaybackElement(activeMediaElement);
      clearAllMediaSources();

      activeMediaElement.pause();
      activeMediaElement.removeAttribute("src");
      activeMediaElement.src = resolvedMedia.url;
      activeMediaElement.load();

      const savedResumePosition = options.useSavedPosition ? getSavedPlaybackPosition(song) : 0;
      const resumePosition = Number(options.resumePosition || savedResumePosition || 0);
      if (resumePosition > 0) {
        restoringPosition = true;
        activeMediaElement.addEventListener("loadedmetadata", () => {
          try {
            activeMediaElement.currentTime = resumePosition;
          } catch (error) {
            console.error("Unable to restore playback position:", error);
          } finally {
            restoringPosition = false;
          }
        }, { once: true });
      } else {
        activeMediaElement.currentTime = 0;
      }

      if (autoPlay) {
        try {
          await activeMediaElement.play();
        } catch (primaryPlayError) {
          // Keep audio playback audio-only so the video surface does not appear for music.
          const allowFallback = false;
          if (!fallbackMediaElement || !allowFallback) {
            throw primaryPlayError;
          }

          fallbackMediaElement.pause();
          fallbackMediaElement.removeAttribute("src");
          fallbackMediaElement.src = resolvedMedia.url;
          fallbackMediaElement.load();
          if (resumePosition > 0) {
            fallbackMediaElement.addEventListener("loadedmetadata", () => {
              try {
                fallbackMediaElement.currentTime = resumePosition;
              } catch (error) {
                console.error("Unable to restore fallback playback position:", error);
              }
            }, { once: true });
          } else {
            fallbackMediaElement.currentTime = 0;
          }
          await fallbackMediaElement.play();
          activeMediaElement = fallbackMediaElement;
        }
      } else {
        updateDisplayText("Paused");
        persistPlayerState("paused");
      }

      setMediaMode(activeMediaElement === videoPlayer ? "video" : "audio");
      enforceExclusivePlayback(activeMediaElement);
      errorRetryCount = 0;

      renderTrackList();
    } catch (error) {
      console.error("Error playing song:", error);
      lastPlayerError = getFriendlyPlaybackMessage(error);
      activeMediaDebug.loadTimeMs = Math.round(performance.now() - mediaLoadStartedAt);
      activeMediaSource = "unknown";
      activeMediaUrl = "";
      updateDisplayText("Playback Error");
      persistPlayerState("paused");
      updateAuthUi(getFriendlyPlaybackMessage(error));
      publishDiagnostics();
    }
  }

  async function refreshLiveSessionForPlayer() {
    const livePreferenceEnabled = preferencesApi?.getPreferences?.().liveStreamEnabled === true;
    if (!livePreferenceEnabled || !liveStreamClient?.getSession) {
      return false;
    }

    try {
      const payload = await liveStreamClient.getSession();
      const session = payload?.session || {};
      if (payload?.enabled && session.status === "live" && session.streamUrl) {
        await loadLiveSession(session, false);
        return true;
      }
    } catch (error) {
      console.error("Unable to load live stream session for player:", error);
    }

    if (isLivePlaybackActive()) {
      activePlaybackMode = "playlist";
      currentLiveSession = null;
      updateDisplayText("Paused");
    }
    return false;
  }

  async function loadLiveSession(session, autoPlay = false) {
    const streamUrl = String(session?.streamUrl || "").trim();
    if (!streamUrl) {
      return;
    }

    snapshotCurrentVideoPosition();
    activePlaybackMode = "live";
    currentLiveSession = {
      sessionId: session.sessionId || "",
      title: session.title || "Live Stream",
      streamUrl,
      updatedAt: session.updatedAt || ""
    };
    activeObjectKey = `live:${currentLiveSession.sessionId || currentLiveSession.streamUrl}`;
    lastPlayerError = "";
    errorRetryCount = 0;
    mediaLoadStartedAt = performance.now();
    activeMediaSource = "live";
    activeMediaUrl = streamUrl;
    activeMediaDebug = {
      resolvedPath: streamUrl,
      extension: "m3u8",
      mime: "application/vnd.apple.mpegurl",
      source: "live",
      loadTimeMs: null,
      detectionPath: "live stream session"
    };
    setMediaMode("video");
    clearAllMediaSources();
    updateDisplayText(autoPlay ? "Loading" : "Live Ready");
    publishDiagnostics();

    if (autoPlay) {
      await startLivePlayback();
    }
  }

  async function prepareLiveMediaElement() {
    if (!isLivePlaybackActive()) {
      return null;
    }

    const streamUrl = currentLiveSession.streamUrl;
    const activeMediaElement = getMediaElementForKind("video");
    if (!activeMediaElement) {
      throw new Error("No media player is available for live stream playback.");
    }

    if (activeMediaElement.currentSrc === streamUrl || activeMediaElement.getAttribute("src") === streamUrl) {
      return activeMediaElement;
    }

    if (hlsAdapter?.canUseFor?.(streamUrl, activeMediaElement)) {
      try {
        await hlsAdapter.load(activeMediaElement, streamUrl);
      } catch (error) {
        console.error("Unable to initialize HLS adapter:", error);
        activeMediaElement.src = streamUrl;
        activeMediaElement.load();
      }
    } else {
      activeMediaElement.src = streamUrl;
      activeMediaElement.load();
    }

    return activeMediaElement;
  }

  async function startLivePlayback() {
    try {
      updateDisplayText("Loading");
      const activeMediaElement = await prepareLiveMediaElement();
      if (!activeMediaElement) {
        return;
      }
      await activeMediaElement.play();
    } catch (error) {
      console.error("Error playing live stream:", error);
      updateAuthUi(getFriendlyPlaybackMessage(error));
      updateDisplayText("Live Ready");
    }
  }

  function playNextSong() {
    if (isLivePlaybackActive()) {
      updateDisplayText("Live");
      return;
    }

    if (randomMode) {
      playRandomHistoryNext();
      return;
    }

    const decision = playerEngine.getNextTrackDecision({
      repeatMode,
      currentIndex: currentSongIndex,
      total: currentPlaylist?.songs?.length || 0
    });

    if (decision.action === "none") {
      getActiveMediaElement().pause();
      updateDisplayText("No songs available");
      persistPlayerState("paused");
      return;
    }

    if (decision.action === "finished") {
      getActiveMediaElement().pause();
      updateDisplayText("Finished");
      persistPlayerState("paused");
      return;
    }

    playSong(decision.index, true);
  }

  function playPrevSong() {
    if (isLivePlaybackActive()) {
      updateDisplayText("Live");
      return;
    }

    if (randomMode) {
      const previousRandomIndex = getPreviousRandomHistoryIndex();
      if (Number.isInteger(previousRandomIndex)) {
        playSong(previousRandomIndex, true);
        return;
      }
    }

    const decision = playerEngine.getPreviousTrackDecision({
      currentIndex: currentSongIndex,
      total: currentPlaylist?.songs?.length || 0
    });

    if (decision.action === "none") {
      getActiveMediaElement().pause();
      updateDisplayText("No songs available");
      persistPlayerState("paused");
      return;
    }

    playSong(decision.index, true);
  }

  playlistSelector.addEventListener("change", (event) => {
    refreshRegistry();
    setCurrentPlaylist(event.target.value);
    resetRandomHistory(currentSongIndex);
    playSong(currentSongIndex, false);
  });

  playerAddStarredButton?.addEventListener("click", () => {
    addStarredToExistingPlaylist();
  });

  playerNewStarredButton?.addEventListener("click", () => {
    createPlaylistFromStarred();
  });

  playerManageStarredButton?.addEventListener("click", () => {
    window.location.href = "songlist.html";
  });

  playerClearStarredButton?.addEventListener("click", () => {
    clearTrackSelections();
    renderTrackList();
  });

  trackFilterInput?.addEventListener("input", (event) => {
    trackFilterTerm = normalizeTrackFilter(event.target.value);
    renderTrackList();
  });

  scrollPlayingButton?.addEventListener("click", scrollCurrentTrackIntoView);

  videoResumeButton?.addEventListener("click", () => {
    const position = getCurrentVideoResumePosition();
    if (position >= RESUME_THRESHOLD_SECONDS) {
      playSong(currentSongIndex, true, { resumePosition: position });
    }
  });

  document.addEventListener("keydown", handleGlobalHotkeys);

transportButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.getAttribute("data-action");

    switch (action) {
      case "prev":
        playPrevSong();
        break;

      case "toggle":
        if (isLivePlaybackActive()) {
          const active = getActiveMediaElement();
          if (active && !active.paused) {
            stopAllMediaPlayback();
          } else if (active) {
            startLivePlayback();
          }
          break;
        }

        if (!currentPlaylist || !currentPlaylist.songs.length) return;

        const active = getActiveMediaElement();

        if (active && !active.paused) {
          // currently playing → pause
          stopAllMediaPlayback();
        } else {
          // currently paused → play
          if (activeObjectKey !== getSongIdentity(currentPlaylist.songs[currentSongIndex])) {
            playSong(currentSongIndex, true);
          } else {
            active.play().catch((error) => {
              console.error("Error playing song:", error);
              updateAuthUi(getFriendlyPlaybackMessage(error));
            });
          }
        }
        break;

      case "next":
        playNextSong();
        break;

      case "repeat":
        cycleRepeatMode();
        break;

      case "random":
        toggleRandomMode();
        break;

      default:
        break;
    }
  });
});


  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = authUsername.value.trim();
    const password = authPassword.value;

    if (!username || !password) {
      updateAuthUi("Enter both username and password.");
      return;
    }

    updateAuthUi("Signing in...");

    try {
      await login(username, password);
      authPassword.value = "";
    } catch (error) {
      console.error("Unable to sign in:", error);
      updateAuthUi(error.message);
    }
  });

  authLogoutButton?.addEventListener("click", () => {
    logout();
  });

  diagnosticsButton?.addEventListener("click", () => {
    openDiagnosticsDialog();
  });

  aboutTitle?.addEventListener("click", openAboutDialog);
  aboutLink?.addEventListener("click", openAboutDialog);
  aboutCloseButton?.addEventListener("click", () => aboutDialog?.close());
  aboutDialog?.addEventListener("click", (event) => {
    if (event.target === aboutDialog) aboutDialog.close();
  });
  ambientIdentityController = window.AmbientIdentity?.init({
    titleElement: aboutTitle,
    aboutDialog,
    storagePrefix
  });

  diagnosticsCloseButton?.addEventListener("click", () => diagnosticsDialog?.close());
  diagnosticsDialog?.addEventListener("click", (event) => {
    if (event.target === diagnosticsDialog) diagnosticsDialog.close();
  });

  function bindMediaEvents(mediaElement, label) {
    if (!mediaElement) {
      return;
    }

    mediaElement.addEventListener("ended", () => {
      if (isLivePlaybackActive()) {
        updateDisplayText("Live Ended");
        updateVideoResumeButton();
        return;
      }

      const currentSong = currentPlaylist?.songs?.[currentSongIndex];
      if (currentSong) {
        savePlaybackPosition(currentSong, 0, mediaElement.duration || 0);
      }
      updateVideoResumeButton();
      playNextSong();
    });

    mediaElement.addEventListener("play", () => {
      enforceExclusivePlayback(mediaElement);
      setMediaMode(mediaElement === videoPlayer ? "video" : "audio");
      updateDisplayText("Playing");
      if (isLivePlaybackActive()) {
        updateVideoResumeButton();
        return;
      }
      persistPlayerState("playing");
      updateVideoResumeButton();
    });

    mediaElement.addEventListener("loadedmetadata", () => {
      if (mediaElement !== getActiveMediaElement()) return;
      activeMediaDebug.loadTimeMs = Math.round(performance.now() - mediaLoadStartedAt);
      publishDiagnostics();
    });

    mediaElement.addEventListener("pause", () => {
      if (mediaElement.ended) {
        return;
      }

      updateDisplayText("Paused");
      if (isLivePlaybackActive()) {
        updateVideoResumeButton();
        return;
      }
      persistPlayerState("paused");
      updateVideoResumeButton();
    });

    mediaElement.addEventListener("timeupdate", () => {
      if (mediaElement !== videoPlayer || restoringPosition) {
        return;
      }

      const currentSong = currentPlaylist?.songs?.[currentSongIndex];
      if (!currentSong) {
        return;
      }

      savePlaybackPosition(currentSong, mediaElement.currentTime || 0, mediaElement.duration || 0);
      updateVideoResumeButton();
    });

    mediaElement.addEventListener("error", () => {
      if (isLivePlaybackActive()) {
        const mediaError = mediaElement.error;
        const errorCode = mediaError?.code || 0;
        const messageMap = {
          1: "Live playback was interrupted.",
          2: "Network error while loading live stream.",
          3: "Live stream decoded unsuccessfully.",
          4: "This browser could not play the live stream URL."
        };
        const message = messageMap[errorCode] || "Unable to load live stream.";
        lastPlayerError = message;
        console.error(`${label} live stream error:`, {
          errorCode,
          currentSrc: mediaElement.currentSrc
        });
        updateDisplayText("Playback Error");
        updateAuthUi(message);
        publishDiagnostics();
        return;
      }

      const currentSong = currentPlaylist?.songs?.[currentSongIndex];
      const mediaError = mediaElement.error;
      const errorCode = mediaError?.code || 0;
      const mediaPath = currentSong?.objectKey || currentSong?.file || "";
      const messageMap = {
        1: "Playback was interrupted.",
        2: "Network error while loading media.",
        3: "Media decoded unsuccessfully.",
        4: "The signed media URL did not return playable media."
      };
      const message = messageMap[errorCode] || "Unable to load media.";

      const retryPosition = Math.max(
        mediaElement.currentTime || 0,
        currentSong ? getSavedPlaybackPosition(currentSong) : 0
      );
      const canRetry = mediaElement === videoPlayer
        && currentSong
        && errorRetryCount < ERROR_RETRY_LIMIT
        && (errorCode === 2 || errorCode === 4);

      if (canRetry) {
        errorRetryCount += 1;
        lastPlayerError = "";
        activeMediaDebug.recovery = {
          status: "retrying",
          reason: message,
          retry: errorRetryCount,
          retryLimit: ERROR_RETRY_LIMIT,
          resumePosition: Math.round(retryPosition),
          mediaPath
        };
        updateDisplayText("Reconnecting");
        showPlayerToast("Network interrupted. Retrying from last position...");
        publishDiagnostics();
        console.warn(`${label} network interruption; retrying media load.`, activeMediaDebug.recovery);
        window.setTimeout(() => {
          playSong(currentSongIndex, true, { resumePosition: retryPosition });
        }, 700);
        return;
      }

      lastPlayerError = message;
      console.error(`${label} element error:`, {
        errorCode,
        mediaPath,
        currentSrc: mediaElement.currentSrc
      });
      updateDisplayText("Playback Error");
      persistPlayerState("paused");
      updateAuthUi(message);
      publishDiagnostics();
    });
  }

  bindMediaEvents(audioPlayer, "Audio");
  bindMediaEvents(videoPlayer, "Video");

  setMediaMode("audio");
  updateRepeatModeUi();
  updateRandomModeUi();
  updateMediaSourceBadge("unknown");

  refreshRegistry();
  updateAuthUi();
  authNotice?.watch?.({
    targetSelector: ".hero-meta",
    needsPrivateAccess: true
  });

  if (!playlistRegistry.length) {
    updateDisplayText("No playlists");
    return;
  }

  const savedState = PlaylistStore.loadPlayerState();
  setCurrentPlaylist(savedState.playlistId, {
    songIndex: savedState.songIndex,
    playbackState: savedState.playbackState
  });
  resetRandomHistory(currentSongIndex);

  refreshLiveSessionForPlayer().then((liveSessionActive) => {
    if (!liveSessionActive && currentPlaylist && currentPlaylist.songs.length) {
      playSong(currentSongIndex, savedState.playbackState === "playing", {
        useSavedPosition: savedState.playbackState === "playing"
      });
    }
  });
});
