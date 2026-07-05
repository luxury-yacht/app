package backend

import "testing"

func TestCompareVersions(t *testing.T) {
	t.Run("detects older current version", func(t *testing.T) {
		result, err := compareVersions("1.2.3", "1.3.0")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result >= 0 {
			t.Fatalf("expected current version to be older, got %d", result)
		}
	})

	t.Run("treats v-prefixed tags as equal", func(t *testing.T) {
		result, err := compareVersions("1.2.3", "v1.2.3")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result != 0 {
			t.Fatalf("expected versions to be equal, got %d", result)
		}
	})
}

func TestParseVersionParts(t *testing.T) {
	parts, err := parseVersionParts("1.2.3-beta+build.7")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(parts) < 3 || parts[0] != 1 || parts[1] != 2 || parts[2] != 3 {
		t.Fatalf("unexpected parts: %#v", parts)
	}

	_, err = parseVersionParts("dev")
	if err == nil {
		t.Fatalf("expected parse error for dev version")
	}
}

func TestIsDevVersion(t *testing.T) {
	cases := map[string]bool{
		"dev":         true,
		"1.0.0":       false,
		"1.0.0 (dev)": true,
		"":            true,
	}

	for value, expected := range cases {
		if got := isDevVersion(value); got != expected {
			t.Fatalf("isDevVersion(%q) = %v, want %v", value, got, expected)
		}
	}
}

func TestBuildReleaseUpdateInfo(t *testing.T) {
	release := &githubRelease{
		TagName:     "v1.10.1",
		Name:        "Luxury Yacht 1.10.1",
		PublishedAt: "2026-07-05T00:00:00Z",
		Body:        "- Fixed metrics permission notice\n- Moved the update chip",
	}

	info := buildReleaseUpdateInfo("1.10.0", "2026-07-05T12:00:00Z", release)

	// The release body carries the notes shown in the tooltip — the whole point
	// of this change; it must be mapped through, not discarded.
	if info.ReleaseNotes != release.Body {
		t.Fatalf("ReleaseNotes = %q, want %q", info.ReleaseNotes, release.Body)
	}
	if info.LatestVersion != "v1.10.1" {
		t.Fatalf("LatestVersion = %q, want v1.10.1", info.LatestVersion)
	}
	if info.ReleaseName != "Luxury Yacht 1.10.1" {
		t.Fatalf("ReleaseName = %q", info.ReleaseName)
	}
	if info.PublishedAt != "2026-07-05T00:00:00Z" {
		t.Fatalf("PublishedAt = %q", info.PublishedAt)
	}
	if !info.IsUpdateAvailable {
		t.Fatalf("expected IsUpdateAvailable for 1.10.0 -> v1.10.1")
	}

	// Same version: no update, notes still mapped.
	same := buildReleaseUpdateInfo("1.10.1", "2026-07-05T12:00:00Z", release)
	if same.IsUpdateAvailable {
		t.Fatalf("expected no update when current == latest")
	}
	if same.ReleaseNotes != release.Body {
		t.Fatalf("ReleaseNotes should map even when up to date")
	}

	// The New-version release date must map through for the tooltip's
	// "New: <version> released <date>" row.
	if info.PublishedAt != release.PublishedAt {
		t.Fatalf("PublishedAt = %q, want %q", info.PublishedAt, release.PublishedAt)
	}
}

func TestReleaseTagForVersion(t *testing.T) {
	cases := []struct {
		version      string
		referenceTag string
		want         string
	}{
		// The reference tag is v-prefixed → the current tag must be too, even when
		// the build Version has no prefix.
		{"1.10.0", "v1.10.1", "v1.10.0"},
		{"v1.10.0", "v1.10.1", "v1.10.0"},
		{" V1.10.0 ", "v1.10.1", "v1.10.0"},
		// Bare reference tag → bare current tag.
		{"1.10.0", "1.10.1", "1.10.0"},
		{"v1.10.0", "1.10.1", "1.10.0"},
		// No usable version → empty (caller skips the fetch).
		{"", "v1.10.1", ""},
		{"v", "v1.10.1", ""},
	}

	for _, tc := range cases {
		if got := releaseTagForVersion(tc.version, tc.referenceTag); got != tc.want {
			t.Fatalf("releaseTagForVersion(%q, %q) = %q, want %q",
				tc.version, tc.referenceTag, got, tc.want)
		}
	}
}
