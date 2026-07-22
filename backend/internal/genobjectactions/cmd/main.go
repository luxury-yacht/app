package main

import (
	"flag"
	"log"
	"os"

	"github.com/luxury-yacht/app/backend/internal/genobjectactions"
)

func main() {
	out := flag.String("out", "", "generated TypeScript output path")
	flag.Parse()
	if *out == "" {
		log.Fatal("-out is required")
	}
	generated, err := genobjectactions.Render()
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, generated, 0o644); err != nil {
		log.Fatal(err)
	}
}
