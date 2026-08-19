package main

import (
	"context"
	"os"
	"time"
)

func runMacOSUpdaterArchiveValidation() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	return validateConfiguredMacOSUpdaterArchive(
		context.Background(), metadata, os.Getenv("UPDATER_ARTIFACT"), os.Getenv("GOARCH"), runCommand,
	)
}

func runLinuxUpdaterArchiveValidation() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	return validateConfiguredLinuxUpdaterArchive(
		context.Background(), metadata, os.Getenv("UPDATER_ARTIFACT"), os.Getenv("GOARCH"),
	)
}

func runWindowsUpdaterExecutableValidation() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	return validateConfiguredWindowsUpdaterExecutable(
		metadata, os.Getenv("UPDATER_ARTIFACT"), os.Getenv("WINDOWS_ARCH"),
	)
}

func runCreateWindowsUpdaterArtifact() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	_, err = createWindowsUpdaterArtifact(
		metadata,
		os.Getenv("WINDOWS_BINARY"),
		os.Getenv("WINDOWS_UPDATER_OUTPUT_DIR"),
		os.Getenv("WINDOWS_ARCH"),
	)
	return err
}

func runReleaseUpdaterManifestPreparation() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	facts := deriveProjectFacts(metadata, time.Now().UTC(), gitRevParse())
	return prepareReleaseUpdaterManifest(metadata, facts, os.Getenv, runCommand)
}
