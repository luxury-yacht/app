package main

import (
	"fmt"
	"html"
	"io/fs"
	"net/url"
	"os"
	"path"
	"strings"
	"testing"
	"testing/fstest"
	"unicode"

	"github.com/russross/blackfriday/v2"
	"github.com/stretchr/testify/require"
)

// Guard the destinations agents use to retrieve contracts, including new,
// untracked docs while leaving ignored memory and generated files out of scope.
func TestRepositoryMarkdownLinks(t *testing.T) {
	t.Chdir(repositoryPath())
	output, err := commandOutput("git", "ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z", "--", "*.md")
	require.NoError(t, err)
	require.NotEmpty(t, output)
	files := strings.Split(strings.TrimSuffix(output, "\x00"), "\x00")
	for _, problem := range markdownLinkProblems(os.DirFS("."), files) {
		t.Error(problem)
	}
}

func TestMarkdownLinksRejectBrokenGuidanceRoutes(t *testing.T) {
	for _, tt := range []struct {
		name   string
		link   string
		target string
	}{
		{"renamed heading", "guide.md#old-heading", "# New heading\n"},
		{"removed document", "removed.md", "# New heading\n"},
		{"missing code landmark", "../missing.go", "# New heading\n"},
		{"invalid URL escape", "guide%GG.md", "# New heading\n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			files := fstest.MapFS{
				"docs/router.md": {Data: []byte("[contract](" + tt.link + ")\n")},
				"docs/guide.md":  {Data: []byte(tt.target)},
			}
			problems := markdownLinkProblems(files, []string{"docs/router.md"})
			require.Len(t, problems, 1)
			require.Contains(t, problems[0], "docs/router.md")
			require.Contains(t, problems[0], tt.link)
		})
	}
}

func TestMarkdownLinksResolveRenderedHeadingsAndRelativeTargets(t *testing.T) {
	files := fstest.MapFS{
		"docs/router.md": {Data: []byte("# Own heading\n" +
			"[inline](guide%20one.md#cache--refresh-v2)\n" +
			"[reference][route]\n\n[route]: guide%20one.md#state-2\n\n" +
			"[collision](guide%20one.md#state-1-1)\n" +
			"[self](#own-heading) [root](/docs/guide%20one.md#state)\n" +
			"[source](../owner.go) ![image](../image.png)\n" +
			"[external](https://example.invalid/no-such-page#heading) [email](mailto:agent@example.invalid)\n" +
			"`[example](missing.md)`\n\n```md\n# Phantom\n[example](missing.md)\n```\n")},
		"docs/guide one.md": {Data: []byte("# Cache & *Refresh* (`v2`)\n\n# State\n\n# State\n\n# State-1\n\n# State\n")},
		"owner.go":          {Data: []byte("package owner\n")},
		"image.png":         {Data: []byte("fixture")},
	}
	require.Empty(t, markdownLinkProblems(files, []string{"docs/router.md", "docs/guide one.md", "deleted.md"}))
}

func TestMarkdownLinksDoNotResolveHeadingsInsideCodeExamples(t *testing.T) {
	files := fstest.MapFS{
		"router.md": {Data: []byte("[example](#phantom)\n\n```md\n# Phantom\n```\n")},
	}
	require.Len(t, markdownLinkProblems(files, []string{"router.md"}), 1)
}

func TestMarkdownLinksCheckStaticLinksAlongsideTemplateDestinations(t *testing.T) {
	files := fstest.MapFS{
		"template.md": {Data: []byte("[commit]({{.RepoURL}}/commit/{{.Commit}})\n[contract](missing.md)\n")},
	}
	problems := markdownLinkProblems(files, []string{"template.md"})
	require.Len(t, problems, 1)
	require.Contains(t, problems[0], "missing.md")
}

type markdownLinkDocument struct {
	links   []string
	anchors map[string]bool
}

type markdownLinkChecker struct {
	files     fs.FS
	documents map[string]markdownLinkDocument
}

func markdownLinkProblems(files fs.FS, sources []string) []string {
	checker := markdownLinkChecker{files: files, documents: make(map[string]markdownLinkDocument)}
	var problems []string
	for _, source := range sources {
		document, err := checker.document(source)
		if os.IsNotExist(err) {
			// Git still lists a tracked document deleted in the worktree. Incoming
			// links to it must fail, but it is no longer a source to enumerate.
			continue
		}
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", source, err))
			continue
		}
		for _, destination := range document.links {
			if err := checker.checkTarget(source, destination); err != nil {
				problems = append(problems, fmt.Sprintf("%s: link %q: %v", source, destination, err))
			}
		}
	}
	return problems
}

func (checker *markdownLinkChecker) document(name string) (markdownLinkDocument, error) {
	if document, ok := checker.documents[name]; ok {
		return document, nil
	}
	data, err := fs.ReadFile(checker.files, name)
	if err != nil {
		return markdownLinkDocument{}, err
	}
	document := parseMarkdownLinks(data)
	checker.documents[name] = document
	return document, nil
}

func (checker *markdownLinkChecker) checkTarget(source, destination string) error {
	// Release-template destinations only become resolvable after rendering.
	if strings.Contains(destination, "{{") && strings.Contains(destination, "}}") {
		return nil
	}
	link, err := url.Parse(destination)
	if err != nil {
		return err
	}
	if link.Scheme != "" || link.Host != "" {
		return nil
	}
	target := markdownLinkPath(source, link.Path)
	if _, err := fs.Stat(checker.files, target); err != nil {
		return err
	}
	if link.Fragment == "" || !strings.EqualFold(path.Ext(target), ".md") {
		return nil
	}
	document, err := checker.document(target)
	if err != nil {
		return err
	}
	if !document.anchors[link.Fragment] {
		return fmt.Errorf("heading anchor %q does not exist in %s", link.Fragment, target)
	}
	return nil
}

func markdownLinkPath(source, target string) string {
	if target == "" {
		return source
	}
	if strings.HasPrefix(target, "/") {
		return strings.TrimPrefix(path.Clean(target), "/")
	}
	return path.Join(path.Dir(source), target)
}

func parseMarkdownLinks(data []byte) markdownLinkDocument {
	document := markdownLinkDocument{anchors: make(map[string]bool)}
	parser := blackfriday.New(blackfriday.WithExtensions(blackfriday.FencedCode | blackfriday.Tables |
		blackfriday.Strikethrough | blackfriday.NoIntraEmphasis | blackfriday.SpaceHeadings))
	parser.Parse(data).Walk(func(node *blackfriday.Node, entering bool) blackfriday.WalkStatus {
		if !entering {
			return blackfriday.GoToNext
		}
		switch node.Type {
		case blackfriday.Link, blackfriday.Image:
			document.links = append(document.links, string(node.Destination))
		case blackfriday.Heading:
			base := markdownHeadingSlug(node)
			anchor := base
			for suffix := 1; document.anchors[anchor]; suffix++ {
				anchor = fmt.Sprintf("%s-%d", base, suffix)
			}
			document.anchors[anchor] = true
		}
		return blackfriday.GoToNext
	})
	return document
}

func markdownHeadingSlug(heading *blackfriday.Node) string {
	var text strings.Builder
	heading.Walk(func(node *blackfriday.Node, entering bool) blackfriday.WalkStatus {
		if entering && (node.Type == blackfriday.Text || node.Type == blackfriday.Code) {
			text.Write(node.Literal)
		}
		return blackfriday.GoToNext
	})
	return strings.Map(markdownHeadingRune, strings.ToLower(html.UnescapeString(text.String())))
}

func markdownHeadingRune(r rune) rune {
	if r == ' ' {
		return '-'
	}
	if r == '-' || r == '_' || unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r) {
		return r
	}
	return -1
}
