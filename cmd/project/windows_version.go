package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var semanticVersionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$`)
var trailingNumberPattern = regexp.MustCompile(`(\d+)$`)

func windowsNumericVersion(version string) (string, error) {
	parts := semanticVersionPattern.FindStringSubmatch(strings.TrimSpace(version))
	if parts == nil {
		return "", fmt.Errorf("invalid semantic version %q", version)
	}
	build := 1000
	if parts[4] != "" {
		build = 0
		if match := trailingNumberPattern.FindStringSubmatch(parts[4]); match != nil {
			build, _ = strconv.Atoi(match[1])
		}
	}
	return fmt.Sprintf("%s.%s.%s.%d", parts[1], parts[2], parts[3], build), nil
}
