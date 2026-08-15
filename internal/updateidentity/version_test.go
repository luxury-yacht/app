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
