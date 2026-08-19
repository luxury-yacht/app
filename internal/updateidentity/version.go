// Package updateidentity owns the release and installation identity used by
// both the running application and release tooling.
package updateidentity

import (
	"fmt"
	"strings"

	"golang.org/x/mod/semver"
)

// Channel identifies one supported application update stream.
type Channel string

const (
	ChannelStable Channel = "stable"
	ChannelBeta   Channel = "beta"
)

// ReleaseVersion is the normalized release identity supplied to Wails and
// embedded in the signed metadata for one GitHub Release.
type ReleaseVersion struct {
	Version string
	Channel Channel
}

func (version ReleaseVersion) Tag() string {
	if version.Version == "" {
		return ""
	}
	return "v" + version.Version
}

func HasUpdaterTarget(targets []string, platform Platform, architecture string) bool {
	want := strings.ToLower(strings.TrimSpace(string(platform))) + "/" +
		strings.ToLower(strings.TrimSpace(architecture))
	for _, target := range targets {
		if strings.ToLower(strings.TrimSpace(target)) == want {
			return true
		}
	}
	return false
}

// ParseReleaseVersion validates the configured release version, removes its
// conventional tag prefix, and resolves the only channels the application
// publishes. Development versions and non-beta prereleases are not release
// identities.
func ParseReleaseVersion(value string) (ReleaseVersion, error) {
	normalized := strings.TrimSpace(value)
	if strings.HasPrefix(normalized, "v") || strings.HasPrefix(normalized, "V") {
		normalized = normalized[1:]
	}
	canonical := "v" + normalized
	core := normalized
	if before, _, found := strings.Cut(core, "-"); found {
		core = before
	}
	if before, _, found := strings.Cut(core, "+"); found {
		core = before
	}
	if normalized == "" || len(strings.Split(core, ".")) != 3 || !semver.IsValid(canonical) {
		return ReleaseVersion{}, fmt.Errorf("invalid release version %q", value)
	}

	prerelease := strings.TrimPrefix(semver.Prerelease(canonical), "-")
	if prerelease == "" {
		return ReleaseVersion{Version: normalized, Channel: ChannelStable}, nil
	}
	identifier, _, _ := strings.Cut(prerelease, ".")
	if !strings.EqualFold(identifier, string(ChannelBeta)) {
		return ReleaseVersion{}, fmt.Errorf("unsupported release channel in version %q", value)
	}

	return ReleaseVersion{Version: normalized, Channel: ChannelBeta}, nil
}
