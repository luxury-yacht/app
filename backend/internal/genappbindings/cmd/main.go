// Command genappbindings writes the generated App.Get<Kind> bindings.
// Invoked via `go generate ./backend`.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/luxury-yacht/app/backend/internal/genappbindings"
)

func main() {
	out := flag.String("out", "", "output file path (stdout if empty)")
	flag.Parse()

	src, err := genappbindings.Render()
	if err != nil {
		fmt.Fprintln(os.Stderr, "genappbindings:", err)
		os.Exit(1)
	}
	if *out == "" {
		os.Stdout.Write(src)
		return
	}
	if err := os.WriteFile(*out, src, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "genappbindings:", err)
		os.Exit(1)
	}
}
