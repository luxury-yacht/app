package main

import (
	"errors"
	"fmt"
	"io/fs"

	"github.com/joho/godotenv"
)

// LoadDotEnv adds values from path to the process environment without
// replacing variables already provided by the shell or CI.
func LoadDotEnv(path string) error {
	if err := godotenv.Load(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("load environment from %s: %w", path, err)
	}
	return nil
}

// NewBuildConfigFromDotEnv loads local build variables before capturing the
// environment-backed fields in BuildConfig.
func NewBuildConfigFromDotEnv(path string) (BuildConfig, error) {
	if err := LoadDotEnv(path); err != nil {
		return BuildConfig{}, err
	}
	return NewBuildConfig()
}
