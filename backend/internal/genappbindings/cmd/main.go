// Command genappbindings writes the generated App.Get<Kind> bindings and the
// object-panel detail-fetcher dispatch map. Invoked via `go generate ./backend`.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/luxury-yacht/app/backend/internal/genappbindings"
)

func main() {
	out := flag.String("out", "", "App.Get bindings output file path (stdout if empty and no other output requested)")
	fetchersOut := flag.String("fetchers-out", "", "objectDetailFetchers output file path")
	flag.Parse()

	if *fetchersOut != "" {
		writeRendered(genappbindings.RenderDetailFetchers, *fetchersOut)
	}
	if *out != "" || *fetchersOut == "" {
		writeRendered(genappbindings.Render, *out)
	}
}

// writeRendered renders source with the given renderer and writes it to path, or
// to stdout when path is empty.
func writeRendered(render func() ([]byte, error), path string) {
	src, err := render()
	if err != nil {
		fmt.Fprintln(os.Stderr, "genappbindings:", err)
		os.Exit(1)
	}
	if path == "" {
		os.Stdout.Write(src)
		return
	}
	if err := os.WriteFile(path, src, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "genappbindings:", err)
		os.Exit(1)
	}
}
