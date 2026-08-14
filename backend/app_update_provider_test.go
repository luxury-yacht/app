package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestEndpointProviderSelectsBuildChannelAndAcceptsStableReleaseForBeta(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		current         updateidentity.ReleaseVersion
		manifestChannel updateidentity.Channel
		wantPath        string
		wantRelease     bool
	}{
		{
			name:            "stable build",
			current:         updateidentity.ReleaseVersion{Version: "1.9.0", Channel: updateidentity.ChannelStable},
			manifestChannel: updateidentity.ChannelStable,
			wantPath:        "/updates/stable.json",
			wantRelease:     true,
		},
		{
			name:            "beta build converges to stable release through beta manifest",
			current:         updateidentity.ReleaseVersion{Version: "2.0.0-beta.3", Channel: updateidentity.ChannelBeta},
			manifestChannel: updateidentity.ChannelBeta,
			wantPath:        "/updates/beta.json",
			wantRelease:     true,
		},
		{
			name:            "mismatched manifest channel is ignored",
			current:         updateidentity.ReleaseVersion{Version: "1.9.0", Channel: updateidentity.ChannelStable},
			manifestChannel: updateidentity.ChannelBeta,
			wantPath:        "/updates/stable.json",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			var requestedPath string
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				requestedPath = request.URL.Path
				response.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(response,
					`{"schemaVersion":1,"version":"2.0.0","channel":%q,"artifacts":[{"url":"https://example.invalid/luxury-yacht-v2.0.0-darwin-arm64.zip","platform":"darwin","arch":"arm64"}]}`,
					test.manifestChannel,
				)
			}))
			defer server.Close()

			provider, err := newEndpointUpdateProvider(
				server.URL+"/updates/{{channel}}.json",
				test.current,
				server.Client(),
			)
			require.NoError(t, err)

			release, err := provider.Check(context.Background(), updater.CheckRequest{
				CurrentVersion: test.current.Version,
				Platform:       "darwin",
				Arch:           "arm64",
			})

			require.NoError(t, err)
			require.Equal(t, test.wantPath, requestedPath)
			if test.wantRelease {
				require.NotNil(t, release)
				require.Equal(t, "2.0.0", release.Version)
				require.Equal(t, string(test.manifestChannel), release.Channel)
				return
			}
			require.Nil(t, release)
		})
	}
}
