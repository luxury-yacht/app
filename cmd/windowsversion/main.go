package main

import (
	"fmt"
	"os"

	"github.com/luxury-yacht/app/internal/buildmeta"
	"gopkg.in/yaml.v3"
)

func main() {
	data, err := os.ReadFile("build/config.yml")
	if err != nil {
		fail(err)
	}
	var config struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
	}
	if err := yaml.Unmarshal(data, &config); err != nil {
		fail(err)
	}
	version, err := buildmeta.WindowsNumericVersion(config.Info.Version)
	if err != nil {
		fail(err)
	}
	fmt.Println(version)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
