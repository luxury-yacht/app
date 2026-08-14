package backend

import (
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

const updateManifestURL = "https://luxury-yacht.app/updates/{{channel}}.json"

func newEndpointUpdateProvider(
	manifestURL string,
	release updateidentity.ReleaseVersion,
	client *http.Client,
) (*endpoint.Provider, error) {
	parsed, err := updateidentity.ParseReleaseVersion(release.Version)
	if err != nil {
		return nil, err
	}
	if parsed != release {
		return nil, fmt.Errorf("release channel %q does not match version %q", release.Channel, release.Version)
	}
	return endpoint.New(endpoint.Config{
		URL:        manifestURL,
		Channel:    string(release.Channel),
		HTTPClient: client,
	})
}
