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

func runReleaseUpdaterManifestPreparation() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	facts := deriveProjectFacts(metadata, time.Now().UTC(), gitRevParse())
	return prepareReleaseUpdaterManifest(metadata, facts, os.Getenv, runCommand)
}
