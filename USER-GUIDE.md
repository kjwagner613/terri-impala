# Impala Streamer Developer Guide

This guide is for developers and maintainers. The user-facing guide lives in `userGuide/userGuide.html`.

## 1) Current Release Snapshot

Version: `v1.0.0` (pilot)

Core additions in this release:

1. Dedicated sign-in page and auth guard redirect flow.
2. Diagnostics subsystem with snapshot publishing and rolling error logs.
3. Playlist registry that supports built-in, custom, and local-library modes.
4. Persistent repeat mode and playback position recovery.
5. Local media roots + Local Library JSON override.
6. Video playback support and hardened media resolution.

## 2) App Topology

Frontend pages:

1. `signin.html`: obtains auth session and stores it in browser storage.
2. `index.html`: main player UI.
3. `songlist.html`: playlist editor + S4 browser + optional admin index rebuild.
4. `preferences.html`: palette/customization/local media/local JSON settings.
5. `diagnostics.html`: runtime health and debug view.
6. `userGuide/userGuide.html`: user documentation.

Core runtime modules:

1. `app-config.js`: environment and behavior flags.
2. `auth-guard.js`: redirects unauthenticated users to sign-in.
3. `script.js`: main player orchestration.
4. `player-engine.js`: playback actions and state machine behavior.
5. `media-resolver.js`: media kind inference + local/cloud URL resolution helpers.
6. `playlist-store.js`: built-in/custom/local playlist registry and persistence.
7. `ui-preferences.js`: preferences normalization, save/load, and DOM application.
8. `diagnostics-store.js`: diagnostics snapshot + storage write telemetry + error capture.
9. `diagnostics.js`: diagnostics page renderer.
10. `songlist.js`: playlist editing and S4 browsing/import tools.

Signer backend (separate service):

1. `services/heroku-signer/server.js`
2. `services/heroku-signer/library-index.js`
3. `services/heroku-signer/index-builder.js`

## 3) Authentication Flow

Storage key default: `<activeStoragePrefix>.authSession`. The active prefix comes from `playlistStoragePrefix` plus optional `instanceStorageId` in `app-config.js`.

Lifecycle:

1. User signs in on `signin.html`.
2. Session token payload is stored in localStorage.
3. Protected routes run `auth-guard.js` and redirect to `signin.html` if missing/expired.
4. API requests include `Authorization: Bearer <token>`.
5. On `401`, frontend clears session and redirects back to sign-in.

## 4) Playlist Modes and Registry Behavior

`PlaylistStore.getPlaylistRegistry()` composes the player source list using this priority:

1. Local library playlists (if Local Library JSON parses and has entries).
2. Built-in playlists (`songsKw`, `songs`) when local library is absent/empty.
3. Custom playlists (always appended).

Kinds used in runtime:

1. `built-in`
2. `local`
3. `custom`

Track selection behavior:

1. Star selections are transient and stored in sessionStorage.
2. Starred actions support append-to-existing and create-new custom playlist.
3. Dedupe logic uses `objectKey`/`file` identity when available.

## 5) Media Resolution and Playback

Resolution order in player flow:

1. Attempt local URL via configured local media roots.
2. Fallback to direct local path if present.
3. If song has `objectKey`, request signed URL from signer API.

Additional behavior:

1. Audio and video mode are auto-selected from media metadata/path.
2. Playback keeps media elements mutually exclusive.
3. Repeat mode cycles `off -> one -> all` and persists in localStorage.
4. Video resume button appears only when saved position crosses threshold.

## 6) Preferences Contract

Preferences storage key: `<activeStoragePrefix>.uiPreferences`

Default fields:

1. `palette`
2. `customNote`
3. `medallionSrc`
4. `localAudioDir`
5. `localVideoDir`
6. `localLibraryJson`
7. `cloudApiBaseUrl`
8. `instanceId`

Validation highlights:

1. `javascript:` URIs are rejected for medallion and local directories.
2. Local directory paths are normalized (trimmed, trailing slash removed).
3. Local JSON is stored as raw trimmed text; parsing happens where consumed.

## 7) Local Storage and Session Storage Keys

Given `playlistStoragePrefix = impalaStreamer` and empty `instanceStorageId`, keys include:

1. `impalaStreamer.authSession` (auth session payload)
2. `impalaStreamer.uiPreferences` (palette/content/local settings)
3. `impalaStreamer.customPlaylists`
4. `impalaStreamer.playerState`
5. `impalaStreamer.playStates.<playlistId>`
6. `impalaStreamer.playbackPositions`
7. `impalaStreamer.repeatMode`

Session storage:

1. `impalaStreamer.transientTrackSelections`

If `instanceStorageId = artistPilot`, the active prefix becomes `impalaStreamer.artistPilot`, and browser-local keys use that prefix instead. This isolates cloned/static Impala instances on the same browser.

## 8) Diagnostics Model

The diagnostics store is intentionally non-blocking and should never prevent playback.

Published snapshot groups:

1. `player`: active playlist/song index, playback intent, repeat mode, last error.
2. `registry`: built-in/custom/local counts and active mode.
3. `media`: current URL/source/mime debug information.
4. storage write success/failure tracking.
5. rolling error log with classified categories.

Use `diagnostics.html` during QA and incident triage.

## 9) Local Library JSON Shape

Supported top-level shapes:

1. Array of entries.
2. Object with one or more of:
	 - `audio`
	 - `video`
	 - `audioEntries`
	 - `videoEntries`
	 - `entries`
	 - `files`
	 - `items`

Entry examples:

```json
{
	"audio": [
		{
			"name": "Track Name",
			"artist": "Artist",
			"album": "Album",
			"file": "Artist/Album/01 Track.mp3"
		}
	],
	"video": [
		{
			"name": "Clip Name",
			"file": "videos/Artist/Clip.mp4",
			"mediaType": "video"
		}
	]
}
```

Accepted fields per entry:

1. `name` or `title`
2. `artist`
3. `album`
4. `file` or `path`
5. `objectKey`
6. `mediaType` or `kind`
7. `contentType`

## 10) Dev Runbook

Local frontend:

1. Serve project root with any static server.
2. Ensure `app-config.js` points to the signer service.
3. Sign in through `signin.html`.

Signer service:

1. Run from `services/heroku-signer`.
2. Required env vars include session secret, S4 credentials, and allowed users JSON.
3. Use existing tests in `services/heroku-signer/*.test.js` before deployment.

## 11) QA Checklist (Minimum)

1. Sign-in success, sign-out, and expired-session redirect behavior.
2. Playback for both audio and video media.
3. Repeat mode persistence after reload.
4. Starred-to-playlist workflows (new + add existing).
5. Local media roots fallback behavior.
6. Local library JSON parse error handling and valid override behavior.
7. Diagnostics page refresh and snapshot updates while player is active.

## 12) Known Constraints

1. Browser restrictions can block direct probing of `file://` roots from hosted pages.
2. A failed local root probe does not always mean file playback will fail.
3. Local library JSON override can intentionally hide built-in playlists when valid entries exist.
