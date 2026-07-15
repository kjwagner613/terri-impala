package main

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const (
	defaultAddress = "127.0.0.1:8089"
	serviceName    = "Impala Local Library Helper"
)

type track struct {
	ID          string `json:"id"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	Title       string `json:"title"`
	Name        string `json:"name"`
	ObjectKey   string `json:"objectKey"`
	File        string `json:"file"`
	MediaType   string `json:"mediaType"`
	ContentType string `json:"contentType"`
	Source      string `json:"source"`
	path        string
}

type serverState struct {
	mu        sync.RWMutex
	musicRoot string
	tracks    []track
}

func main() {
	address := strings.TrimSpace(os.Getenv("IMPALA_HELPER_ADDR"))
	if address == "" {
		address = defaultAddress
	}

	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatalf("%s could not start on %s: %v", serviceName, address, err)
	}

	state := &serverState{}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", state.healthHandler)
	mux.HandleFunc("/library/list", state.listHandler)
	mux.HandleFunc("/library/file", state.fileHandler)
	mux.HandleFunc("/library/set-root", state.setRootHandler)

	log.Printf("%s listening on http://%s", serviceName, address)
	log.Fatal(http.Serve(listener, mux))
}

func isSupportedMedia(filename string) bool {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".mp3", ".flac", ".wav", ".aac", ".m4a", ".ogg", ".mp4", ".m4v", ".webm", ".mov":
		return true
	default:
		return false
	}
}

func mediaTypeFor(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".mp4", ".m4v", ".webm", ".mov":
		return "video"
	default:
		return "audio"
	}
}

func contentTypeFor(filename string) string {
	if value := mime.TypeByExtension(strings.ToLower(filepath.Ext(filename))); value != "" {
		return value
	}
	if mediaTypeFor(filename) == "video" {
		return "video/mp4"
	}
	return "audio/mpeg"
}

func slashPath(parts ...string) string {
	return strings.ReplaceAll(filepath.Join(parts...), string(filepath.Separator), "/")
}

func cleanTitle(filename string) string {
	withoutExtension := strings.TrimSuffix(filename, filepath.Ext(filename))
	withoutNumber := strings.TrimSpace(withoutExtension)
	withoutNumber = strings.TrimLeft(withoutNumber, "0123456789")
	withoutNumber = strings.TrimLeft(withoutNumber, " -._)")
	if withoutNumber != "" {
		return withoutNumber
	}
	if withoutExtension != "" {
		return withoutExtension
	}
	return filename
}

func (state *serverState) scanLibrary(root string) ([]track, error) {
	rootInfo, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !rootInfo.IsDir() {
		return nil, errors.New("root is not a directory")
	}

	var scanned []track
	artistEntries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}

	for _, artistEntry := range artistEntries {
		if !artistEntry.IsDir() {
			continue
		}

		artist := artistEntry.Name()
		artistPath := filepath.Join(root, artist)
		albumEntries, err := os.ReadDir(artistPath)
		if err != nil {
			continue
		}

		for _, albumEntry := range albumEntries {
			if !albumEntry.IsDir() {
				continue
			}

			album := albumEntry.Name()
			albumPath := filepath.Join(artistPath, album)
			fileEntries, err := os.ReadDir(albumPath)
			if err != nil {
				continue
			}

			for _, fileEntry := range fileEntries {
				if fileEntry.IsDir() || !isSupportedMedia(fileEntry.Name()) {
					continue
				}

				objectKey := slashPath(artist, album, fileEntry.Name())
				fullPath := filepath.Join(albumPath, fileEntry.Name())
				title := cleanTitle(fileEntry.Name())

				scanned = append(scanned, track{
					ID:          objectKey,
					Artist:      artist,
					Album:       album,
					Title:       title,
					Name:        title,
					ObjectKey:   objectKey,
					File:        objectKey,
					MediaType:   mediaTypeFor(fileEntry.Name()),
					ContentType: contentTypeFor(fileEntry.Name()),
					Source:      "local-service",
					path:        fullPath,
				})
			}
		}
	}

	sort.Slice(scanned, func(left, right int) bool {
		return strings.ToLower(scanned[left].ObjectKey) < strings.ToLower(scanned[right].ObjectKey)
	})

	return scanned, nil
}

func allowLocalBrowser(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

func writeJSON(w http.ResponseWriter, value any) {
	allowLocalBrowser(w)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

func (state *serverState) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		allowLocalBrowser(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	state.mu.RLock()
	defer state.mu.RUnlock()

	writeJSON(w, map[string]any{
		"ok":         true,
		"service":    serviceName,
		"root":       state.musicRoot,
		"trackCount": len(state.tracks),
	})
}

func (state *serverState) listHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		allowLocalBrowser(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	state.mu.RLock()
	defer state.mu.RUnlock()

	publicTracks := make([]track, len(state.tracks))
	copy(publicTracks, state.tracks)
	for index := range publicTracks {
		publicTracks[index].path = ""
	}

	writeJSON(w, publicTracks)
}

func (state *serverState) fileHandler(w http.ResponseWriter, r *http.Request) {
	allowLocalBrowser(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	state.mu.RLock()
	var selected track
	for _, candidate := range state.tracks {
		if candidate.ID == id {
			selected = candidate
			break
		}
	}
	state.mu.RUnlock()

	if selected.ID == "" {
		http.Error(w, "track not found", http.StatusNotFound)
		return
	}

	file, err := os.Open(selected.path)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.Error(w, "file unavailable", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", selected.ContentType)
	http.ServeContent(w, r, filepath.Base(selected.path), info.ModTime(), file)
}

func (state *serverState) setRootHandler(w http.ResponseWriter, r *http.Request) {
	allowLocalBrowser(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Root string `json:"root"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	root := strings.TrimSpace(body.Root)
	if root == "" {
		http.Error(w, "missing root", http.StatusBadRequest)
		return
	}

	scanned, err := state.scanLibrary(root)
	if err != nil {
		http.Error(w, "scan failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	state.mu.Lock()
	state.musicRoot = root
	state.tracks = scanned
	state.mu.Unlock()

	writeJSON(w, map[string]any{
		"ok":         true,
		"root":       root,
		"trackCount": len(scanned),
	})
}
