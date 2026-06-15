// Command gengatewaybindings writes the generated gateway-API App.Get bindings.
// Invoked via `go generate ./backend`.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/luxury-yacht/app/backend/internal/gengatewaybindings"
)

func main() {
	out := flag.String("out", "", "output file path (stdout if empty)")
	flag.Parse()

	src, err := gengatewaybindings.Render()
	if err != nil {
		fmt.Fprintln(os.Stderr, "gengatewaybindings:", err)
		os.Exit(1)
	}
	if *out == "" {
		os.Stdout.Write(src)
		return
	}
	if err := os.WriteFile(*out, src, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "gengatewaybindings:", err)
		os.Exit(1)
	}
}
