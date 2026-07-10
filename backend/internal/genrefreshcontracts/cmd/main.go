package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/luxury-yacht/app/backend/internal/genrefreshcontracts"
)

func main() {
	out := flag.String("out", "", "generated TypeScript output path")
	flag.Parse()
	if *out == "" {
		fmt.Fprintln(os.Stderr, "-out is required")
		os.Exit(2)
	}

	generated, err := genrefreshcontracts.Render()
	if err != nil {
		fmt.Fprintf(os.Stderr, "render refresh contracts: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, generated, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write refresh contracts: %v\n", err)
		os.Exit(1)
	}
}
