package updateidentity_test

import (
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestParseReleaseVersionNormalizesVersionAndSelectsChannel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		input       string
		wantVersion string
		wantChannel updateidentity.Channel
	}{
		{
			name:        "stable release",
			input:       " v2.0.0 ",
			wantVersion: "2.0.0",
			wantChannel: updateidentity.ChannelStable,
		},
		{
			name:        "beta release",
			input:       "V2.0.0-beta.3+build.7",
			wantVersion: "2.0.0-beta.3+build.7",
			wantChannel: updateidentity.ChannelBeta,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			got, err := updateidentity.ParseReleaseVersion(test.input)

			require.NoError(t, err)
			require.Equal(t, test.wantVersion, got.Version)
			require.Equal(t, test.wantChannel, got.Channel)
			require.Equal(t, "v"+test.wantVersion, got.Tag())
		})
	}
}

func TestParseReleaseVersionRejectsNonReleaseIdentity(t *testing.T) {
	t.Parallel()

	for _, input := range []string{
		"",
		"dev",
		"2.0",
		"2.0.0-rc.1",
		"2.0.0-beta.01",
	} {
		t.Run(input, func(t *testing.T) {
			t.Parallel()

			_, err := updateidentity.ParseReleaseVersion(input)

			require.Error(t, err)
		})
	}
}

// Upgrade telemetry reports only when the running release is newer than the
// last reported one, so ordering must follow semver rather than string order.
func TestReleaseVersionCompareUsesSemanticPrecedence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		older string
		newer string
	}{
		{name: "numeric minor", older: "2.9.0", newer: "2.10.0"},
		{name: "beta before stable", older: "2.6.0-beta.1", newer: "v2.6.0"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			older, err := updateidentity.ParseReleaseVersion(test.older)
			require.NoError(t, err)
			newer, err := updateidentity.ParseReleaseVersion(test.newer)
			require.NoError(t, err)

			require.Negative(t, older.Compare(newer))
			require.Positive(t, newer.Compare(older))
			require.Zero(t, newer.Compare(newer))
		})
	}
}
