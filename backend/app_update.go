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
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
)

const (
	updateRepoAPIBase    = "https://api.github.com/repos/luxury-yacht/app"
	updateRepoReleaseURL = updateRepoAPIBase + "/releases/latest"
	updateDownloadsURL   = "https://luxury-yacht.app/#downloads"
	updateUserAgent      = "LuxuryYachtUpdateCheck/1.0"
)

type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	ReleaseURL     string `json:"releaseUrl"`
	ReleaseName    string `json:"releaseName,omitempty"`
	PublishedAt    string `json:"publishedAt,omitempty"`
	// CurrentPublishedAt is the release date of the currently-installed version,
	// fetched separately by tag (the latest-release response only covers New).
	CurrentPublishedAt string `json:"currentPublishedAt,omitempty"`
	CheckedAt          string `json:"checkedAt,omitempty"`
	IsUpdateAvailable  bool   `json:"isUpdateAvailable"`
	// ReleaseNotes is the raw release body (markdown) shown as a preview in the
	// update chip's tooltip; the full rendered notes live at the release tag page.
	ReleaseNotes string `json:"releaseNotes,omitempty"`
	Error        string `json:"error,omitempty"`
}

type githubRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	PublishedAt string `json:"published_at"`
	Body        string `json:"body"`
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

	checkedAt := time.Now().Format(time.RFC3339)
	release, err := fetchLatestRelease()
	if err != nil {
		a.storeUpdateInfo(&UpdateInfo{
			CurrentVersion: currentVersion,
			CheckedAt:      checkedAt,
			Error:          err.Error(),
		})
		return
	}

	info := buildReleaseUpdateInfo(currentVersion, checkedAt, release)
	// The tooltip shows the current version's release date next to the new one.
	// That date lives in a separate release resource, so fetch it by tag — but
	// only when an update is available (the only time the tooltip shows), and
	// never let its absence fail the whole check.
	if info.IsUpdateAvailable {
		if currentTag := releaseTagForVersion(currentVersion, release.TagName); currentTag != "" {
			currentRelease, tagErr := fetchReleaseByTag(currentTag)
			if tagErr != nil {
				a.logger.Warn(
					fmt.Sprintf("update check: could not fetch current release %q: %v", currentTag, tagErr),
					logsources.UpdateCheck,
				)
			} else {
				info.CurrentPublishedAt = currentRelease.PublishedAt
			}
		}
	}
	a.storeUpdateInfo(info)
}

// releaseTagForVersion derives the GitHub tag for a version, matching the prefix
// convention of a reference tag (the latest release's tag). The build Version
// format is not guaranteed, so the reference tag is the source of truth: a
// "v"-prefixed repo yields "vX.Y.Z", a bare repo yields "X.Y.Z". Empty when the
// version has no usable digits.
func releaseTagForVersion(version, referenceTag string) string {
	normalized := strings.TrimSpace(version)
	normalized = strings.TrimPrefix(normalized, "v")
	normalized = strings.TrimPrefix(normalized, "V")
	if normalized == "" {
		return ""
	}
	ref := strings.TrimSpace(referenceTag)
	if strings.HasPrefix(ref, "v") || strings.HasPrefix(ref, "V") {
		return "v" + normalized
	}
	return normalized
}

// buildReleaseUpdateInfo maps a fetched GitHub release onto the UpdateInfo the
// frontend consumes, including the release notes body. Kept pure (no network,
// no App) so the mapping — especially the release-notes wiring and the
// update-available comparison — is unit-testable.
func buildReleaseUpdateInfo(currentVersion, checkedAt string, release *githubRelease) *UpdateInfo {
	info := &UpdateInfo{
		CurrentVersion: currentVersion,
		CheckedAt:      checkedAt,
		LatestVersion:  release.TagName,
		ReleaseURL:     updateDownloadsURL,
		ReleaseName:    release.Name,
		PublishedAt:    release.PublishedAt,
		ReleaseNotes:   release.Body,
	}

	compare, compareErr := compareVersions(currentVersion, release.TagName)
	if compareErr != nil {
		info.Error = compareErr.Error()
		return info
	}
	info.IsUpdateAvailable = compare < 0
	return info
}

func (a *App) storeUpdateInfo(info *UpdateInfo) {
	if a == nil || info == nil {
		return
	}
	a.updateCheckMu.Lock()
	a.updateInfo = info
	a.updateCheckMu.Unlock()
	if info.Error != "" {
		a.logger.Warn(info.Error, logsources.UpdateCheck)
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
	return fetchRelease(updateRepoReleaseURL)
}

// fetchReleaseByTag fetches a specific release by its git tag.
func fetchReleaseByTag(tag string) (*githubRelease, error) {
	return fetchRelease(updateRepoAPIBase + "/releases/tags/" + url.PathEscape(tag))
}

func fetchRelease(releaseURL string) (*githubRelease, error) {
	client := &http.Client{Timeout: config.AppUpdateRequestTimeout}
	req, err := http.NewRequest(http.MethodGet, releaseURL, nil)
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
