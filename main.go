package main

import (
	"embed"

	"github.com/luxury-yacht/app/internal/bootstrap"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	bootstrap.Run(assets)
}
