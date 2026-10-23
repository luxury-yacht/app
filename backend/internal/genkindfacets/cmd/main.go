// Command genkindfacets writes the frontend's per-kind facet table. Invoked via
// `go generate ./backend`.
package main

import (
	"flag"
	"log"
	"os"

	"github.com/luxury-yacht/app/backend/internal/genkindfacets"
)

func main() {
	out := flag.String("out", "", "generated TypeScript output path")
	flag.Parse()
	if *out == "" {
		log.Fatal("-out is required")
	}
	generated, err := genkindfacets.Render()
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, generated, 0o644); err != nil {
		log.Fatal(err)
	}
}
