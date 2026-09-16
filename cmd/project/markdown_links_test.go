package main

import (
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path"
	"strings"
	"testing"
	"testing/fstest"
	"unicode"

	"github.com/stretchr/testify/require"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
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

func TestMarkdownLinksResolveCommonMarkHeadings(t *testing.T) {
	for _, tt := range []struct {
		name string
		body string
	}{
		{"indented heading", "   # Readiness\n"},
		{"heading interrupts paragraph", "Introductory text\n# Readiness\n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			files := fstest.MapFS{
				"guide.md": {Data: []byte(tt.body + "\n[contract](#readiness)\n")},
			}
			require.Empty(t, markdownLinkProblems(files, []string{"guide.md"}))
		})
	}
}

func TestMarkdownLinksIgnoreIndentedFencedExamples(t *testing.T) {
	files := fstest.MapFS{
		"guide.md": {Data: []byte("   ```markdown\n   [example](missing.md)\n   ```\n")},
	}
	require.Empty(t, markdownLinkProblems(files, []string{"guide.md"}))
}

func TestMarkdownLinksResolveEscapedDestinations(t *testing.T) {
	files := fstest.MapFS{
		"router.md":   {Data: []byte("[escaped](guide\\(1\\).md#topic) [entity](a&amp;b.md#topic)\n")},
		"guide(1).md": {Data: []byte("# Topic\n")},
		"a&b.md":      {Data: []byte("# Topic\n")},
	}
	require.Empty(t, markdownLinkProblems(files, []string{"router.md"}))
}

func TestMarkdownLinksKeepCodeSpanEntitiesLiteralInHeadingAnchors(t *testing.T) {
	files := fstest.MapFS{
		"guide.md": {Data: []byte("# &#65; &amp; `&#66;`\n\n[contract](#a--66)\n")},
	}
	require.Empty(t, markdownLinkProblems(files, []string{"guide.md"}))
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
	parser := goldmark.New(goldmark.WithExtensions(extension.GFM)).Parser()
	_ = ast.Walk(parser.Parse(text.NewReader(data)), func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch node := node.(type) {
		case *ast.Link:
			document.links = append(document.links, markdownTextValue(node.Destination, false))
		case *ast.Image:
			document.links = append(document.links, markdownTextValue(node.Destination, false))
		case *ast.Heading:
			base := markdownHeadingSlug(node, data)
			anchor := base
			for suffix := 1; document.anchors[anchor]; suffix++ {
				anchor = fmt.Sprintf("%s-%d", base, suffix)
			}
			document.anchors[anchor] = true
		}
		return ast.WalkContinue, nil
	})
	return document
}

func markdownHeadingSlug(heading *ast.Heading, source []byte) string {
	var value strings.Builder
	_ = ast.Walk(heading, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch node := node.(type) {
		case *ast.Text:
			value.WriteString(markdownTextValue(node.Value(source), node.IsRaw()))
		case *ast.String:
			value.WriteString(markdownTextValue(node.Value, node.IsRaw() || node.IsCode()))
		case *ast.AutoLink:
			value.Write(node.Label(source))
		}
		return ast.WalkContinue, nil
	})
	return strings.Map(markdownHeadingRune, strings.ToLower(value.String()))
}

func markdownTextValue(value []byte, raw bool) string {
	if raw {
		return string(value)
	}
	value = util.UnescapePunctuations(value)
	value = util.ResolveNumericReferences(value)
	return string(util.ResolveEntityNames(value))
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
