/*
 * backend/app_update.go
 *
 * Handles application update checks and version management.
 */

package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	updateRepoReleaseURL = "https://api.github.com/repos/luxury-yacht/app/releases/latest"
	updateUserAgent      = "LuxuryYachtUpdateCheck/1.0"
)

type UpdateInfo struct {
	CurrentVersion    string `json:"currentVersion"`
	LatestVersion     string `json:"latestVersion"`
	ReleaseURL        string `json:"releaseUrl"`
	ReleaseName       string `json:"releaseName,omitempty"`
	PublishedAt       string `json:"publishedAt,omitempty"`
	CheckedAt         string `json:"checkedAt,omitempty"`
	IsUpdateAvailable bool   `json:"isUpdateAvailable"`
	Error             string `json:"error,omitempty"`
}

type githubRelease struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	Name        string `json:"name"`
	PublishedAt string `json:"published_at"`
}

func (a *App) startUpdateCheck() {
	if a == nil {
		return
	}
	a.updateCheckOnce.Do(func() {
		// Snapshot build metadata before launching the background goroutine so
		// tests (and future runtime changes) don't race on package-level vars.
		currentVersion := strings.TrimSpace(Version)
		go a.runUpdateCheck(currentVersion)
	})
}

func (a *App) runUpdateCheck(currentVersion string) {
	if isDevVersion(currentVersion) {
		a.storeUpdateInfo(&UpdateInfo{
			CurrentVersion: currentVersion,
			CheckedAt:      time.Now().Format(time.RFC3339),
			Error:          "update checks are disabled for dev builds",
		})
		return
	}

	release, err := fetchLatestRelease()
	info := &UpdateInfo{
		CurrentVersion: currentVersion,
		CheckedAt:      time.Now().Format(time.RFC3339),
	}
	if err != nil {
		info.Error = err.Error()
		a.storeUpdateInfo(info)
		return
	}

	info.LatestVersion = release.TagName
	info.ReleaseURL = release.HTMLURL
	info.ReleaseName = release.Name
	info.PublishedAt = release.PublishedAt

	compare, compareErr := compareVersions(currentVersion, release.TagName)
	if compareErr != nil {
		info.Error = compareErr.Error()
		a.storeUpdateInfo(info)
		return
	}
	info.IsUpdateAvailable = compare < 0
	a.storeUpdateInfo(info)
}

func (a *App) storeUpdateInfo(info *UpdateInfo) {
	if a == nil || info == nil {
		return
	}
	a.updateCheckMu.Lock()
	a.updateInfo = info
	a.updateCheckMu.Unlock()
	if info.Error != "" && a.logger != nil {
		a.logger.Warn(info.Error, "UpdateCheck")
	}
	// Notify the frontend so views can update without polling.
	a.emitEvent("app-update", info)
}

func (a *App) getUpdateInfo() *UpdateInfo {
	if a == nil {
		return nil
	}
	a.updateCheckMu.RLock()
	defer a.updateCheckMu.RUnlock()
	if a.updateInfo == nil {
		return nil
	}
	cloned := *a.updateInfo
	return &cloned
}

func fetchLatestRelease() (*githubRelease, error) {
	client := &http.Client{Timeout: 6 * time.Second}
	req, err := http.NewRequest(http.MethodGet, updateRepoReleaseURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", updateUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("update check failed with status %s", resp.Status)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}

	if strings.TrimSpace(release.TagName) == "" {
		return nil, fmt.Errorf("update check returned an empty tag")
	}
	if strings.TrimSpace(release.HTMLURL) == "" {
		return nil, fmt.Errorf("update check returned an empty release url")
	}

	return &release, nil
}

func compareVersions(current, latest string) (int, error) {
	currentParsed, err := parseVersionParts(current)
	if err != nil {
		return 0, fmt.Errorf("unable to parse current version: %w", err)
	}
	latestParsed, err := parseVersionParts(latest)
	if err != nil {
		return 0, fmt.Errorf("unable to parse latest version: %w", err)
	}

	maxLen := len(currentParsed)
	if len(latestParsed) > maxLen {
		maxLen = len(latestParsed)
	}

	for i := 0; i < maxLen; i++ {
		currentValue := 0
		if i < len(currentParsed) {
			currentValue = currentParsed[i]
		}
		latestValue := 0
		if i < len(latestParsed) {
			latestValue = latestParsed[i]
		}
		if currentValue == latestValue {
			continue
		}
		if currentValue < latestValue {
			return -1, nil
		}
		return 1, nil
	}

	return 0, nil
}

func parseVersionParts(value string) ([]int, error) {
	clean := strings.TrimSpace(value)
	if clean == "" {
		return nil, fmt.Errorf("version is empty")
	}
	clean = strings.TrimPrefix(clean, "v")
	clean = strings.TrimPrefix(clean, "V")
	clean = strings.SplitN(clean, " ", 2)[0]
	clean = strings.SplitN(clean, "-", 2)[0]
	clean = strings.SplitN(clean, "+", 2)[0]

	parts := strings.Split(clean, ".")
	if len(parts) == 0 {
		return nil, fmt.Errorf("no version segments found")
	}

	values := make([]int, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			values = append(values, 0)
			continue
		}
		parsed, err := strconv.Atoi(part)
		if err != nil {
			return nil, fmt.Errorf("invalid version segment %q", part)
		}
		values = append(values, parsed)
	}

	return values, nil
}

func isDevVersion(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "" || normalized == "dev" || strings.Contains(normalized, "(dev)")
}
