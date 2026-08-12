package mage

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestSonarExcludesGeneratedSources(t *testing.T) {
	repoRoot := ".."
	exclusions := readSonarExclusions(t, repoRoot)

	// Wails output does not consistently carry a generated-code header, so keep
	// one representative file in the check alongside header-marked generators.
	assertSonarPathExcluded(t, exclusions, "frontend/bindings/github.com/luxury-yacht/app/backend/models.ts")

	for _, root := range []string{"backend", "frontend/src"} {
		err := filepath.WalkDir(filepath.Join(repoRoot, root), func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}

			contents, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			header := string(contents)
			if len(header) > 256 {
				header = header[:256]
			}
			if !strings.HasPrefix(header, "// Code generated") ||
				!strings.Contains(header, "DO NOT EDIT") {
				return nil
			}

			relativePath, err := filepath.Rel(repoRoot, path)
			if err != nil {
				return err
			}
			assertSonarPathExcluded(t, exclusions, filepath.ToSlash(relativePath))
			return nil
		})
		if err != nil {
			t.Fatalf("scan generated sources under %s: %v", root, err)
		}
	}
}

func readSonarExclusions(t *testing.T, repoRoot string) []string {
	t.Helper()

	contents, err := os.ReadFile(filepath.Join(repoRoot, ".sonarcloud.properties"))
	if err != nil {
		t.Fatalf("read .sonarcloud.properties: %v", err)
	}
	for line := range strings.SplitSeq(string(contents), "\n") {
		value, found := strings.CutPrefix(strings.TrimSpace(line), "sonar.exclusions=")
		if !found {
			continue
		}
		parts := strings.Split(value, ",")
		for index := range parts {
			parts[index] = strings.TrimSpace(parts[index])
		}
		return parts
	}

	t.Fatal("sonar.exclusions is not configured")
	return nil
}

func assertSonarPathExcluded(t *testing.T, exclusions []string, path string) {
	t.Helper()

	for _, pattern := range exclusions {
		if sonarPatternMatches(pattern, path) {
			return
		}
	}
	t.Errorf("generated source %q is not covered by sonar.exclusions", path)
}

func sonarPatternMatches(pattern, path string) bool {
	var expression strings.Builder
	expression.WriteByte('^')
	for index := 0; index < len(pattern); {
		switch {
		case strings.HasPrefix(pattern[index:], "**/"):
			expression.WriteString("(?:.*/)?")
			index += 3
		case strings.HasPrefix(pattern[index:], "**"):
			expression.WriteString(".*")
			index += 2
		case pattern[index] == '*':
			expression.WriteString("[^/]*")
			index++
		default:
			expression.WriteString(regexp.QuoteMeta(pattern[index : index+1]))
			index++
		}
	}
	expression.WriteByte('$')
	return regexp.MustCompile(expression.String()).MatchString(path)
}
