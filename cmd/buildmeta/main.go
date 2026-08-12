package main

import (
	"fmt"
	"os"

	"github.com/luxury-yacht/app/internal/buildmeta"
)

func main() {
	_, err := buildmeta.Generate(buildmeta.Options{
		ConfigPath: "build/config.yml",
		EnvPath:    ".env",
		OutputPath: "backend/buildinfo/generated.json",
		Summary:    os.Stdout,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
