package main

import (
	"fmt"
	"strings"

	"github.com/BurntSushi/toml"
)

type toolVersions struct {
	Go           string `toml:"go_version"`
	Node         string `toml:"node_version"`
	NPM          string `toml:"npm_version"`
	Wails        string `toml:"wails_version"`
	WailsRuntime string `toml:"wails_runtime_version"`
	Staticcheck  string `toml:"staticcheck_version"`
	Trivy        string `toml:"trivy_version"`
	NSIS         string `toml:"nsis_version"`
}

func readToolVersions(configPath string) (toolVersions, error) {
	var config struct {
		Tools struct {
			Go          string `toml:"go"`
			Node        string `toml:"node"`
			NPM         string `toml:"npm"`
			Wails       string `toml:"go:github.com/wailsapp/wails/v3/cmd/wails3"`
			Staticcheck string `toml:"go:honnef.co/go/tools/cmd/staticcheck"`
			Trivy       string `toml:"trivy"`
		} `toml:"tools"`
		Vars struct {
			NSIS         string `toml:"nsis_version"`
			WailsRuntime string `toml:"wails_runtime_version"`
		} `toml:"vars"`
	}
	if _, err := toml.DecodeFile(configPath, &config); err != nil {
		return toolVersions{}, fmt.Errorf("read canonical tool versions from %s: %w", configPath, err)
	}
	versions := toolVersions{
		Go:           config.Tools.Go,
		Node:         config.Tools.Node,
		NPM:          config.Tools.NPM,
		Wails:        config.Tools.Wails,
		WailsRuntime: config.Vars.WailsRuntime,
		Staticcheck:  config.Tools.Staticcheck,
		Trivy:        config.Tools.Trivy,
		NSIS:         config.Vars.NSIS,
	}

	required := []struct {
		name    string
		version string
	}{
		{name: "tools.go", version: versions.Go},
		{name: "tools.node", version: versions.Node},
		{name: "tools.npm", version: versions.NPM},
		{name: "tools.go:github.com/wailsapp/wails/v3/cmd/wails3", version: versions.Wails},
		{name: "vars.wails_runtime_version", version: versions.WailsRuntime},
		{name: "tools.go:honnef.co/go/tools/cmd/staticcheck", version: versions.Staticcheck},
		{name: "tools.trivy", version: versions.Trivy},
		{name: "vars.nsis_version", version: versions.NSIS},
	}
	for _, requiredVersion := range required {
		if strings.TrimSpace(requiredVersion.version) == "" {
			return toolVersions{}, fmt.Errorf("read canonical tool versions from %s: %s is required", configPath, requiredVersion.name)
		}
	}

	return versions, nil
}
