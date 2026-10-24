// Command genpreferences writes the frontend's app-preference contract and its
// parity vectors. Invoked via `go generate ./backend`.
package main

import (
	"flag"
	"log"
	"os"

	"github.com/luxury-yacht/app/backend/internal/genpreferences"
)

func main() {
	out := flag.String("out", "", "generated TypeScript output path")
	vectorsOut := flag.String("vectors-out", "", "generated parity-vector JSON output path")
	flag.Parse()
	if *out == "" || *vectorsOut == "" {
		log.Fatal("-out and -vectors-out are required")
	}
	contract, err := genpreferences.Render()
	if err != nil {
		log.Fatal(err)
	}
	vectors, err := genpreferences.RenderParityVectors()
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, contract, 0o644); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*vectorsOut, vectors, 0o644); err != nil {
		log.Fatal(err)
	}
}
