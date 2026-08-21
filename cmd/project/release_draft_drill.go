package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	releaseDraftDrillConfirmation    = "create-and-delete-disposable-draft"
	releaseDraftDrillConfirmationEnv = "RELEASE_DRAFT_DRILL_CONFIRM"
	releaseDraftDrillRepositoryEnv   = "RELEASE_DRAFT_DRILL_REPOSITORY"
	releaseDraftDrillTagPrefix       = "draft-recovery-drill-"
)

var errInjectedDraftPublishFailure = errors.New("injected failure before draft publication")

type releaseDraftDrillConfig struct {
	repository   string
	tag          string
	confirmation string
}

type releaseOutputRunner func(string, ...string) (string, error)

func configuredReleaseDraftDrill(now time.Time) releaseDraftDrillConfig {
	return releaseDraftDrillConfig{
		repository:   strings.TrimSpace(os.Getenv(releaseDraftDrillRepositoryEnv)),
		tag:          releaseDraftDrillTagPrefix + now.UTC().Format("20060102T150405.000000000Z"),
		confirmation: os.Getenv(releaseDraftDrillConfirmationEnv),
	}
}

func validateReleaseDraftDrillConfig(cfg releaseDraftDrillConfig) error {
	if cfg.confirmation != releaseDraftDrillConfirmation {
		return fmt.Errorf(
			"failed-draft drill requires explicit confirmation: set %s=%s",
			releaseDraftDrillConfirmationEnv,
			releaseDraftDrillConfirmation,
		)
	}
	repository := strings.TrimSpace(cfg.repository)
	ownerAndName := strings.Split(repository, "/")
	if len(ownerAndName) != 2 || strings.TrimSpace(ownerAndName[0]) == "" || strings.TrimSpace(ownerAndName[1]) == "" {
		return fmt.Errorf("failed-draft drill repository must use owner/repository form: %q", cfg.repository)
	}
	if strings.EqualFold(repository, projectReleaseRepo) {
		return fmt.Errorf("failed-draft drill must not use the production release repository %s", projectReleaseRepo)
	}
	if !strings.HasPrefix(cfg.tag, releaseDraftDrillTagPrefix) {
		return fmt.Errorf("failed-draft drill tag must start with %q", releaseDraftDrillTagPrefix)
	}
	return nil
}

func inspectReleaseDraft(repo, tag string, output releaseOutputRunner) (bool, error) {
	value, err := output(
		"gh",
		"release", "view", tag,
		gitHubRepositoryFlag, repo,
		"--json", "isDraft",
		"--jq", ".isDraft",
	)
	if err != nil {
		return false, err
	}
	switch strings.TrimSpace(value) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("unexpected isDraft value %q for release %s", value, tag)
	}
}

func isReleaseCommand(args []string, action string) bool {
	return len(args) >= 3 && args[0] == "release" && args[1] == action
}

func writeReleaseDraftDrillFile(pattern, contents string) (string, error) {
	file, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	path := file.Name()
	if _, err := file.WriteString(contents); err != nil {
		file.Close()
		os.Remove(path)
		return "", err
	}
	if err := file.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// runReleaseDraftDrill creates a real draft in a disposable repository, blocks
// the publish command locally, verifies that GitHub still reports a draft, and
// deletes it before returning.
func runReleaseDraftDrill(
	cfg releaseDraftDrillConfig,
	run releaseCommandRunner,
	output releaseOutputRunner,
) (resultErr error) {
	if err := validateReleaseDraftDrillConfig(cfg); err != nil {
		return err
	}
	if _, err := inspectReleaseDraft(cfg.repository, cfg.tag, output); err == nil {
		return validateReleaseDoesNotAlreadyExist(true, cfg.tag)
	}

	notesFile, err := writeReleaseDraftDrillFile("release-draft-drill-notes-*.md", "Disposable failed-draft recovery drill.\n")
	if err != nil {
		return fmt.Errorf("create failed-draft drill notes: %w", err)
	}
	defer os.Remove(notesFile)

	asset, err := writeReleaseDraftDrillFile("release-draft-drill-asset-*.txt", "disposable release asset\n")
	if err != nil {
		return fmt.Errorf("create failed-draft drill asset: %w", err)
	}
	defer os.Remove(asset)

	draftCreated := false
	defer func() {
		if !draftCreated {
			return
		}
		if err := run(
			"gh",
			"release", "delete", cfg.tag,
			"--yes",
			gitHubRepositoryFlag, cfg.repository,
		); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf(
				"delete disposable draft %s: %w; remove it manually before retrying",
				cfg.tag,
				err,
			))
		}
	}()

	faultInjectingRunner := func(name string, args ...string) error {
		if isReleaseCommand(args, "edit") {
			return errInjectedDraftPublishFailure
		}
		err := run(name, args...)
		if err == nil && isReleaseCommand(args, "create") {
			draftCreated = true
		}
		return err
	}
	releaseErr := createRelease(releaseConfig{
		version:     cfg.tag,
		releaseRepo: cfg.repository,
	}, notesFile, []string{asset}, false, faultInjectingRunner)
	if !errors.Is(releaseErr, errInjectedDraftPublishFailure) {
		return fmt.Errorf("failed-draft drill did not reach the injected publish failure: %w", releaseErr)
	}

	isDraft, err := inspectReleaseDraft(cfg.repository, cfg.tag, output)
	if err != nil {
		return fmt.Errorf("inspect disposable failed draft %s: %w", cfg.tag, err)
	}
	if !isDraft {
		return fmt.Errorf("disposable release %s became public despite the injected publish failure", cfg.tag)
	}

	fmt.Printf("\n✅ Verified release %s remains a draft after the injected publish failure.\n", cfg.tag)
	return nil
}

func runConfiguredReleaseDraftDrill() error {
	if err := checkGhCli(); err != nil {
		return err
	}
	return runReleaseDraftDrill(
		configuredReleaseDraftDrill(time.Now()),
		runCommand,
		commandOutput,
	)
}
