package backend

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/updater"
	githubprovider "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// gitHubDownloadTransport serves github.com from the test server under a
// /github.com prefix, so a download built against any other host misses its route.
type gitHubDownloadTransport struct {
	serverHost string
	next       http.RoundTripper
}

func (transport gitHubDownloadTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Host != "github.com" {
		return transport.next.RoundTrip(request)
	}
	rerouted := request.Clone(request.Context())
	rerouted.URL = &url.URL{
		Scheme: "http",
		Host:   transport.serverHost,
		Path:   "/github.com" + request.URL.Path,
	}
	return transport.next.RoundTrip(rerouted)
}

func gitHubDownloadClient(server *httptest.Server) *http.Client {
	return &http.Client{Transport: gitHubDownloadTransport{
		serverHost: server.Listener.Addr().String(),
		next:       server.Client().Transport,
	}}
}

func publicReleaseURL(tag, name string) string {
	return "https://github.com/luxury-yacht/app/releases/download/" + tag + "/" + name
}

// gitHubAssetJSON matches the GitHub API: url is the API resource for the asset,
// and browser_download_url is the public file the signed manifest names.
func gitHubAssetJSON(server *httptest.Server, id int, tag, name string, size int) string {
	return fmt.Sprintf(
		`{"id":%d,"name":%q,"content_type":"application/octet-stream","size":%d,"url":%q,"browser_download_url":%q}`,
		id,
		name,
		size,
		fmt.Sprintf("%s/repos/luxury-yacht/app/releases/assets/%d", server.URL, id),
		publicReleaseURL(tag, name),
	)
}

func TestGitHubManifestProviderDiscoversReleaseAndAuthenticatesSelectedArtifact(t *testing.T) {
	t.Parallel()

	archive := []byte("signed updater archive")
	digest := bytes.Repeat([]byte{0x11}, 64)
	signature := bytes.Repeat([]byte{0x22}, 64)
	var requestedAPIPath string
	var requestedManifest bool
	var requestedArtifact bool

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/repos/luxury-yacht/app/releases/latest":
			requestedAPIPath = request.URL.RequestURI()
			response.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(response, `{
				"tag_name":"v2.0.0",
				"name":"Luxury Yacht v2.0.0",
				"body":"Release notes",
				"draft":false,
				"prerelease":false,
				"published_at":"2026-08-14T18:30:00Z",
				"html_url":%q,
				"assets":[%s,%s]
			}`,
				server.URL+"/release",
				gitHubAssetJSON(server, 1, "v2.0.0", "luxury-yacht-v2.0.0-macos-arm64.dmg", 99),
				gitHubAssetJSON(server, 2, "v2.0.0", "luxury-yacht-v2.0.0-darwin-arm64.zip", len(archive)),
			)
		case "/github.com/luxury-yacht/app/releases/download/v2.0.0/updater.json":
			requestedManifest = true
			response.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(response).Encode(map[string]any{
				"schemaVersion": 1,
				"version":       "2.0.0",
				"channel":       "stable",
				"artifacts": []map[string]any{{
					"url":           publicReleaseURL("v2.0.0", "luxury-yacht-v2.0.0-darwin-arm64.zip"),
					"platform":      "darwin",
					"arch":          "arm64",
					"filename":      "luxury-yacht-v2.0.0-darwin-arm64.zip",
					"filetype":      "zip",
					"size":          len(archive),
					"digestAlgo":    "sha512",
					"digest":        base64.StdEncoding.EncodeToString(digest),
					"signatureAlgo": "ed25519ph",
					"signature":     base64.StdEncoding.EncodeToString(signature),
				}},
			}))
		case "/github.com/luxury-yacht/app/releases/download/v2.0.0/luxury-yacht-v2.0.0-darwin-arm64.zip":
			requestedArtifact = true
			_, _ = response.Write(archive)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	provider, err := newGitHubManifestUpdateProvider(gitHubManifestUpdateProviderConfig{
		Repository: "luxury-yacht/app",
		Current: updateidentity.ReleaseVersion{
			Version: "1.9.0",
			Channel: updateidentity.ChannelStable,
		},
		APIBaseURL: server.URL,
		HTTPClient: gitHubDownloadClient(server),
	})
	require.NoError(t, err)
	require.Equal(t, "github-manifest", provider.Name())

	release, err := provider.Check(context.Background(), updater.CheckRequest{
		CurrentVersion: "1.9.0",
		Platform:       "darwin",
		Arch:           "arm64",
	})
	require.NoError(t, err)
	require.NotNil(t, release)
	require.Equal(t, "/repos/luxury-yacht/app/releases/latest", requestedAPIPath)
	require.True(t, requestedManifest)
	require.Equal(t, "2.0.0", release.Version)
	require.Equal(t, "stable", release.Channel)
	require.Equal(t, "luxury-yacht-v2.0.0-darwin-arm64.zip", release.Artifact.Filename)
	require.Equal(t, int64(len(archive)), release.Artifact.Size)
	require.Equal(t, "sha512", release.Verification.DigestAlgo)
	require.Equal(t, digest, release.Verification.Digest)
	require.Equal(t, "ed25519ph", release.Verification.SignatureAlgo)
	require.Equal(t, signature, release.Verification.Signature)

	var downloaded bytes.Buffer
	require.NoError(t, provider.Download(context.Background(), release, &downloaded, nil))
	require.True(t, requestedArtifact)
	require.Equal(t, archive, downloaded.Bytes())
}

func TestGitHubManifestProviderUsesPrereleaseDiscoveryForBetaBuilds(t *testing.T) {
	t.Parallel()

	var requestedURI string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/repos/luxury-yacht/app/releases":
			requestedURI = request.URL.RequestURI()
			response.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(response, `[{
				"tag_name":"v2.0.0-beta.2",
				"name":"Luxury Yacht v2.0.0-beta.2",
				"body":"Beta notes",
				"draft":false,
				"prerelease":true,
				"published_at":"2026-08-14T18:30:00Z",
				"html_url":%q,
				"assets":[%s]
			}]`, server.URL+"/release", gitHubAssetJSON(server, 2, "v2.0.0-beta.2", "luxury-yacht-v2.0.0-beta.2-darwin-arm64.zip", 8))
		case "/github.com/luxury-yacht/app/releases/download/v2.0.0-beta.2/updater.json":
			response.Header().Set("Content-Type", "application/json")
			encoded := base64.StdEncoding.EncodeToString(make([]byte, 64))
			_, _ = fmt.Fprintf(response, `{
				"schemaVersion":1,
				"version":"2.0.0-beta.2",
				"channel":"beta",
				"artifacts":[{
					"url":%q,
					"platform":"darwin",
					"arch":"arm64",
					"size":8,
					"digestAlgo":"sha512",
					"digest":%q,
					"signatureAlgo":"ed25519ph",
					"signature":%q
				}]
			}`, publicReleaseURL("v2.0.0-beta.2", "luxury-yacht-v2.0.0-beta.2-darwin-arm64.zip"), encoded, encoded)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	provider, err := newGitHubManifestUpdateProvider(gitHubManifestUpdateProviderConfig{
		Repository: "luxury-yacht/app",
		Current: updateidentity.ReleaseVersion{
			Version: "2.0.0-beta.1",
			Channel: updateidentity.ChannelBeta,
		},
		APIBaseURL: server.URL,
		HTTPClient: gitHubDownloadClient(server),
	})
	require.NoError(t, err)

	release, err := provider.Check(context.Background(), updater.CheckRequest{
		CurrentVersion: "2.0.0-beta.1",
		Platform:       "darwin",
		Arch:           "arm64",
	})
	require.NoError(t, err)
	require.NotNil(t, release)
	require.Equal(t, "/repos/luxury-yacht/app/releases?per_page=10", requestedURI)
	require.Equal(t, "beta", release.Channel)
}

func TestGitHubManifestProviderLetsBetaBuildConvergeToStableRelease(t *testing.T) {
	t.Parallel()

	encoded := base64.StdEncoding.EncodeToString(make([]byte, 64))
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/repos/luxury-yacht/app/releases":
			response.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(response, `[{
				"tag_name":"v2.0.0",
				"name":"Luxury Yacht v2.0.0",
				"body":"Stable notes",
				"draft":false,
				"prerelease":false,
				"published_at":"2026-08-14T18:30:00Z",
				"html_url":%q,
				"assets":[%s]
			}]`, server.URL+"/release", gitHubAssetJSON(server, 2, "v2.0.0", "luxury-yacht-v2.0.0-darwin-arm64.zip", 8))
		case "/github.com/luxury-yacht/app/releases/download/v2.0.0/updater.json":
			response.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(response, `{
				"schemaVersion":1,
				"version":"2.0.0",
				"channel":"stable",
				"artifacts":[{
					"url":%q,
					"platform":"darwin",
					"arch":"arm64",
					"size":8,
					"digestAlgo":"sha512",
					"digest":%q,
					"signatureAlgo":"ed25519ph",
					"signature":%q
				}]
			}`, publicReleaseURL("v2.0.0", "luxury-yacht-v2.0.0-darwin-arm64.zip"), encoded, encoded)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	provider, err := newGitHubManifestUpdateProvider(gitHubManifestUpdateProviderConfig{
		Repository: "luxury-yacht/app",
		Current: updateidentity.ReleaseVersion{
			Version: "2.0.0-beta.4",
			Channel: updateidentity.ChannelBeta,
		},
		APIBaseURL: server.URL,
		HTTPClient: gitHubDownloadClient(server),
	})
	require.NoError(t, err)

	release, err := provider.Check(context.Background(), updater.CheckRequest{
		CurrentVersion: "2.0.0-beta.4",
		Platform:       "darwin",
		Arch:           "arm64",
	})

	require.NoError(t, err)
	require.NotNil(t, release)
	require.Equal(t, "2.0.0", release.Version)
	require.Equal(t, "stable", release.Channel)
}

func TestGitHubManifestProviderOffersNewerReleaseOnlyWithItsManifest(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name              string
		current           string
		requestedManifest bool
		wantError         bool
	}{
		{name: "current build stops before the manifest", current: "2.0.0"},
		{name: "newer release without a manifest fails closed", current: "1.9.0", requestedManifest: true, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			var requestedManifest bool
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch request.URL.Path {
				case "/repos/luxury-yacht/app/releases/latest":
					response.Header().Set("Content-Type", "application/json")
					_, _ = fmt.Fprintf(response, `{"tag_name":"v2.0.0","assets":[%s]}`,
						gitHubAssetJSON(server, 2, "v2.0.0", "luxury-yacht-v2.0.0-darwin-arm64.zip", 8))
				case "/github.com/luxury-yacht/app/releases/download/v2.0.0/updater.json":
					requestedManifest = true
					http.NotFound(response, request)
				default:
					http.NotFound(response, request)
				}
			}))
			defer server.Close()

			provider, err := newGitHubManifestUpdateProvider(gitHubManifestUpdateProviderConfig{
				Repository: "luxury-yacht/app",
				Current:    updateidentity.ReleaseVersion{Version: test.current, Channel: updateidentity.ChannelStable},
				APIBaseURL: server.URL,
				HTTPClient: gitHubDownloadClient(server),
			})
			require.NoError(t, err)

			release, err := provider.Check(context.Background(), updater.CheckRequest{
				CurrentVersion: test.current,
				Platform:       "darwin",
				Arch:           "arm64",
			})

			require.Nil(t, release)
			require.Equal(t, test.requestedManifest, requestedManifest)
			if test.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestMatchUpdaterReleaseAssetSelectsOnlyReplaceablePlatformPayload(t *testing.T) {
	t.Parallel()

	assets := []githubprovider.ReleaseAsset{
		{Name: "luxury-yacht-v2.0.0-macos-arm64.dmg"},
		{Name: "luxury-yacht-v2.0.0-darwin-arm64.zip"},
		{Name: "luxury-yacht-v2.0.0-windows-amd64-installer.exe"},
		{Name: "luxury-yacht-v2.0.0-windows-amd64.exe"},
		{Name: "luxury-yacht-v2.0.0-linux-arm64.deb"},
		{Name: "luxury-yacht-v2.0.0-linux-arm64-portable.tar.gz"},
		{Name: "luxury-yacht-v2.0.0-linux-arm64-updater.tar.gz"},
	}

	require.Equal(t, 1, matchUpdaterReleaseAsset(updater.CheckRequest{Platform: "darwin", Arch: "arm64"}, assets))
	require.Equal(t, 3, matchUpdaterReleaseAsset(updater.CheckRequest{Platform: "windows", Arch: "amd64"}, assets))
	require.Equal(t, 6, matchUpdaterReleaseAsset(updater.CheckRequest{Platform: "linux", Arch: "arm64"}, assets))
	require.Equal(t, -1, matchUpdaterReleaseAsset(updater.CheckRequest{Platform: "freebsd", Arch: "amd64"}, assets))
}

func TestValidateReleaseUpdateManifestFailsClosed(t *testing.T) {
	t.Parallel()

	selectedURL := "https://github.com/luxury-yacht/app/releases/download/v2.0.0/luxury-yacht-v2.0.0-darwin-arm64.zip"
	validArtifact := releaseUpdateManifestArtifact{
		URL: selectedURL, Platform: "darwin", Arch: "arm64",
		Filename: "luxury-yacht-v2.0.0-darwin-arm64.zip", Filetype: "zip", Size: 8,
		DigestAlgo: "sha512", Digest: base64.StdEncoding.EncodeToString(make([]byte, 64)),
		SignatureAlgo: "ed25519ph", Signature: base64.StdEncoding.EncodeToString(make([]byte, 64)),
	}
	validManifest := releaseUpdateManifest{
		SchemaVersion: 1,
		Version:       "2.0.0",
		Channel:       "stable",
		Artifacts:     []releaseUpdateManifestArtifact{validArtifact},
	}
	validRelease := &updater.Release{
		Version: "2.0.0", Channel: "stable",
		Artifact: updater.Artifact{Filename: validArtifact.Filename, Size: validArtifact.Size},
	}
	request := updater.CheckRequest{Platform: "darwin", Arch: "arm64"}

	for _, test := range []struct {
		name   string
		mutate func(*releaseUpdateManifest)
		want   string
	}{
		{name: "schema", mutate: func(manifest *releaseUpdateManifest) { manifest.SchemaVersion = 2 }, want: "schemaVersion 2"},
		{name: "version", mutate: func(manifest *releaseUpdateManifest) { manifest.Version = "2.0.1" }, want: "does not match GitHub release"},
		{name: "channel", mutate: func(manifest *releaseUpdateManifest) { manifest.Channel = "beta" }, want: "does not match GitHub release channel"},
		{name: "missing target", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].Arch = "amd64" }, want: "exactly one artifact"},
		{name: "duplicate target", mutate: func(manifest *releaseUpdateManifest) {
			manifest.Artifacts = append(manifest.Artifacts, manifest.Artifacts[0])
		}, want: "exactly one artifact"},
		{name: "URL", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].URL += ".other" }, want: "artifact URL"},
		{name: "filename", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].Filename = "other.zip" }, want: "filename"},
		{name: "size", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].Size++ }, want: "size"},
		{name: "algorithms", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].SignatureAlgo = "ed25519" }, want: "sha512 and ed25519ph"},
		{name: "digest", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].Digest = "invalid" }, want: "base64 SHA-512"},
		{name: "signature", mutate: func(manifest *releaseUpdateManifest) { manifest.Artifacts[0].Signature = "invalid" }, want: "base64 Ed25519"},
	} {
		t.Run(test.name, func(t *testing.T) {
			manifest := validManifest
			manifest.Artifacts = append([]releaseUpdateManifestArtifact(nil), validManifest.Artifacts...)
			test.mutate(&manifest)

			_, _, _, err := validateReleaseUpdateManifest(manifest, validRelease, request, selectedURL)

			require.ErrorContains(t, err, test.want)
		})
	}
}
