package backend

import (
	"context"
	"crypto/ed25519"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/updater"
	githubprovider "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	updateRepository        = "luxury-yacht/app"
	updateManifestAssetName = "updater.json"
	maxUpdateManifestBytes  = 1 << 20
)

type gitHubManifestUpdateProviderConfig struct {
	Repository string
	Current    updateidentity.ReleaseVersion
	APIBaseURL string
	HTTPClient *http.Client
}

type gitHubManifestUpdateProvider struct {
	releases *githubprovider.Provider
	client   *http.Client
}

type releaseUpdateManifest struct {
	SchemaVersion int                             `json:"schemaVersion"`
	Version       string                          `json:"version"`
	Channel       string                          `json:"channel"`
	Artifacts     []releaseUpdateManifestArtifact `json:"artifacts"`
}

type releaseUpdateManifestArtifact struct {
	URL           string `json:"url"`
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	Filename      string `json:"filename,omitempty"`
	Filetype      string `json:"filetype,omitempty"`
	Size          int64  `json:"size"`
	DigestAlgo    string `json:"digestAlgo"`
	Digest        string `json:"digest"`
	SignatureAlgo string `json:"signatureAlgo"`
	Signature     string `json:"signature"`
}

func newGitHubManifestUpdateProvider(
	config gitHubManifestUpdateProviderConfig,
) (*gitHubManifestUpdateProvider, error) {
	parsed, err := updateidentity.ParseReleaseVersion(config.Current.Version)
	if err != nil {
		return nil, err
	}
	if parsed != config.Current {
		return nil, fmt.Errorf(
			"release channel %q does not match version %q",
			config.Current.Channel,
			config.Current.Version,
		)
	}
	repository := strings.TrimSpace(config.Repository)
	if repository == "" {
		return nil, fmt.Errorf("update repository is required")
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	releases, err := githubprovider.New(githubprovider.Config{
		Repository:   repository,
		Prerelease:   config.Current.Channel == updateidentity.ChannelBeta,
		BaseURL:      strings.TrimSpace(config.APIBaseURL),
		AssetMatcher: matchUpdaterReleaseAsset,
		HTTPClient:   client,
	})
	if err != nil {
		return nil, err
	}
	return &gitHubManifestUpdateProvider{releases: releases, client: client}, nil
}

func (provider *gitHubManifestUpdateProvider) Name() string {
	return "github-manifest"
}

func (provider *gitHubManifestUpdateProvider) Check(
	ctx context.Context,
	request updater.CheckRequest,
) (*updater.Release, error) {
	release, err := provider.releases.Check(ctx, request)
	if err != nil || release == nil {
		return release, err
	}
	selectedURL, ok := release.Metadata["github.asset.url"].(string)
	if !ok || strings.TrimSpace(selectedURL) == "" {
		return nil, fmt.Errorf("GitHub release is missing the selected updater artifact URL")
	}
	manifestURL, err := siblingReleaseAssetURL(selectedURL, updateManifestAssetName)
	if err != nil {
		return nil, err
	}
	manifest, err := provider.fetchManifest(ctx, manifestURL)
	if err != nil {
		return nil, err
	}
	artifact, verification, channel, err := validateReleaseUpdateManifest(
		manifest,
		release,
		request,
		selectedURL,
	)
	if err != nil {
		return nil, err
	}
	release.Channel = channel
	release.Artifact = artifact
	release.Verification = verification
	return release, nil
}

func (provider *gitHubManifestUpdateProvider) Download(
	ctx context.Context,
	release *updater.Release,
	destination io.Writer,
	onProgress func(written, total int64),
) error {
	return provider.releases.Download(ctx, release, destination, onProgress)
}

func matchUpdaterReleaseAsset(
	request updater.CheckRequest,
	assets []githubprovider.ReleaseAsset,
) int {
	extension := map[string]string{
		"darwin":  ".zip",
		"windows": ".exe",
		"linux":   ".tar.gz",
	}[strings.ToLower(strings.TrimSpace(request.Platform))]
	if extension == "" {
		return -1
	}
	suffix := "-" + strings.ToLower(strings.TrimSpace(request.Platform)) +
		"-" + strings.ToLower(strings.TrimSpace(request.Arch)) + extension
	for index, asset := range assets {
		name := strings.ToLower(strings.TrimSpace(asset.Name))
		if strings.HasPrefix(name, "luxury-yacht-v") && strings.HasSuffix(name, suffix) {
			return index
		}
	}
	return -1
}

func siblingReleaseAssetURL(selectedURL, siblingName string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(selectedURL))
	if err != nil {
		return "", fmt.Errorf("parse selected updater artifact URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("selected updater artifact URL must use HTTP(S)")
	}
	parsed.Path = path.Join(path.Dir(parsed.Path), siblingName)
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func (provider *gitHubManifestUpdateProvider) fetchManifest(
	ctx context.Context,
	manifestURL string,
) (releaseUpdateManifest, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return releaseUpdateManifest{}, fmt.Errorf("create updater manifest request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return releaseUpdateManifest{}, fmt.Errorf("download updater manifest: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return releaseUpdateManifest{}, fmt.Errorf("download updater manifest: HTTP %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxUpdateManifestBytes+1))
	if err != nil {
		return releaseUpdateManifest{}, fmt.Errorf("read updater manifest: %w", err)
	}
	if len(raw) > maxUpdateManifestBytes {
		return releaseUpdateManifest{}, fmt.Errorf("updater manifest exceeds %d bytes", maxUpdateManifestBytes)
	}
	var manifest releaseUpdateManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return releaseUpdateManifest{}, fmt.Errorf("decode updater manifest: %w", err)
	}
	return manifest, nil
}

func validateReleaseUpdateManifest(
	manifest releaseUpdateManifest,
	release *updater.Release,
	request updater.CheckRequest,
	selectedURL string,
) (updater.Artifact, *updater.Verification, string, error) {
	if manifest.SchemaVersion != 1 {
		return updater.Artifact{}, nil, "", fmt.Errorf(
			"updater manifest schemaVersion %d is not supported",
			manifest.SchemaVersion,
		)
	}
	if manifest.Version != release.Version {
		return updater.Artifact{}, nil, "", fmt.Errorf(
			"updater manifest version %q does not match GitHub release %q",
			manifest.Version,
			release.Version,
		)
	}
	channel := string(updateidentity.ChannelStable)
	if release.Channel == "prerelease" {
		channel = string(updateidentity.ChannelBeta)
	}
	if manifest.Channel != channel {
		return updater.Artifact{}, nil, "", fmt.Errorf(
			"updater manifest channel %q does not match GitHub release channel %q",
			manifest.Channel,
			channel,
		)
	}
	var matches []releaseUpdateManifestArtifact
	for _, artifact := range manifest.Artifacts {
		if artifact.Platform == request.Platform && artifact.Arch == request.Arch {
			matches = append(matches, artifact)
		}
	}
	if len(matches) != 1 {
		return updater.Artifact{}, nil, "", fmt.Errorf(
			"updater manifest requires exactly one artifact for %s/%s, found %d",
			request.Platform,
			request.Arch,
			len(matches),
		)
	}
	match := matches[0]
	if match.URL != selectedURL {
		return updater.Artifact{}, nil, "", fmt.Errorf("updater manifest artifact URL does not match the selected GitHub release asset")
	}
	filename := match.Filename
	if filename == "" {
		parsed, err := url.Parse(match.URL)
		if err != nil {
			return updater.Artifact{}, nil, "", fmt.Errorf("parse updater manifest artifact URL: %w", err)
		}
		filename = path.Base(parsed.Path)
	}
	if filename != release.Artifact.Filename {
		return updater.Artifact{}, nil, "", fmt.Errorf("updater manifest filename does not match the selected GitHub release asset")
	}
	if match.Size <= 0 || match.Size != release.Artifact.Size {
		return updater.Artifact{}, nil, "", fmt.Errorf("updater manifest size does not match the selected GitHub release asset")
	}
	if match.DigestAlgo != "sha512" || match.SignatureAlgo != "ed25519ph" {
		return updater.Artifact{}, nil, "", fmt.Errorf("updater manifest requires sha512 and ed25519ph verification")
	}
	digest, err := base64.StdEncoding.DecodeString(match.Digest)
	if err != nil || len(digest) != sha512.Size {
		return updater.Artifact{}, nil, "", fmt.Errorf("updater manifest digest must be a base64 SHA-512 digest")
	}
	signature, err := base64.StdEncoding.DecodeString(match.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return updater.Artifact{}, nil, "", fmt.Errorf("updater manifest signature must be a base64 Ed25519 signature")
	}
	return updater.Artifact{
			Filename: filename,
			Filetype: match.Filetype,
			Size:     match.Size,
			Platform: match.Platform,
			Arch:     match.Arch,
		}, &updater.Verification{
			DigestAlgo:    match.DigestAlgo,
			Digest:        digest,
			SignatureAlgo: match.SignatureAlgo,
			Signature:     signature,
		}, channel, nil
}
