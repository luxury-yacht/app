// Package apiresources describes the kinds a cluster serves: their schema as
// `kubectl explain` prints it, read from the cluster's published OpenAPI v3
// documents.
package apiresources

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/openapi"
	explain "k8s.io/kubectl/pkg/explain/v2"
)

// KindSchema is the field tree `kubectl explain --recursive` prints for a kind.
type KindSchema struct {
	Group       string        `json:"group"`
	Version     string        `json:"version"`
	Kind        string        `json:"kind"`
	Description string        `json:"description"`
	Fields      []SchemaField `json:"fields"`
}

// SchemaField is one field of a kind and the fields nested under it.
type SchemaField struct {
	Name     string        `json:"name"`
	Type     string        `json:"type"`
	Required bool          `json:"required,omitempty"`
	Fields   []SchemaField `json:"fields,omitempty"`
}

// FieldExplanation is what `kubectl explain <kind>.<path>` says about one
// field. An empty Path describes the kind itself.
type FieldExplanation struct {
	Path        string   `json:"path"`
	Type        string   `json:"type,omitempty"`
	Description string   `json:"description"`
	Enum        []string `json:"enum,omitempty"`
}

// ExplainSchema returns the complete field tree of the kind served at gvr.
func ExplainSchema(client openapi.Client, gvr schema.GroupVersionResource) (*KindSchema, error) {
	output, err := renderExplain(client, gvr, nil, true)
	if err != nil {
		return nil, err
	}
	sections := splitExplainOutput(output)
	return &KindSchema{
		Group:       sections.header["GROUP"],
		Version:     sections.header["VERSION"],
		Kind:        sections.header["KIND"],
		Description: sections.description,
		Fields:      parseFieldTree(sections.fields),
	}, nil
}

// ExplainField returns the type and description of the field at the dot path
// under the kind served at gvr.
func ExplainField(client openapi.Client, gvr schema.GroupVersionResource, path string) (*FieldExplanation, error) {
	path = strings.TrimSpace(path)
	var fieldPath []string
	if path != "" {
		fieldPath = strings.Split(path, ".")
	}
	output, err := renderExplain(client, gvr, fieldPath, false)
	if err != nil {
		return nil, err
	}
	sections := splitExplainOutput(output)
	return &FieldExplanation{
		Path:        path,
		Type:        sections.fieldType,
		Description: sections.description,
		Enum:        sections.enum,
	}, nil
}

// renderExplain fetches the group version's OpenAPI document and renders the
// kubectl explain text from it. The document is fetched here, not by the
// renderer, so a failure to reach the cluster stays distinguishable from a
// schema that simply does not describe the kind or field.
func renderExplain(client openapi.Client, gvr schema.GroupVersionResource, fieldPath []string, recursive bool) (string, error) {
	paths, err := client.Paths()
	if err != nil {
		return "", fmt.Errorf("fetch OpenAPI index: %w", err)
	}
	documentPath := "api/" + gvr.Version
	if gvr.Group != "" {
		documentPath = "apis/" + gvr.Group + "/" + gvr.Version
	}
	groupVersion, ok := paths[documentPath]
	if !ok {
		return "", errorstatus.NotFound(fmt.Errorf("the cluster publishes no schema for %s", gvr.GroupVersion()))
	}
	document, err := groupVersion.Schema(runtime.ContentTypeJSON)
	if err != nil {
		return "", fmt.Errorf("fetch OpenAPI schema for %s: %w", gvr.GroupVersion(), err)
	}
	if !json.Valid(document) {
		return "", fmt.Errorf("OpenAPI schema for %s is not valid JSON", gvr.GroupVersion())
	}

	var output bytes.Buffer
	fetched := fetchedDocument{path: documentPath, document: document}
	if err := explain.PrintModelDescription(fieldPath, &output, fetched, gvr, recursive, 0, "plaintext"); err != nil {
		// The document is in hand and valid, so the renderer can only fail
		// because the schema has no such kind or field.
		return "", errorstatus.NotFound(err)
	}
	return output.String(), nil
}

// fetchedDocument serves one already-fetched OpenAPI document to the renderer.
type fetchedDocument struct {
	path     string
	document []byte
}

func (d fetchedDocument) Paths() (map[string]openapi.GroupVersion, error) {
	return map[string]openapi.GroupVersion{d.path: d}, nil
}

func (d fetchedDocument) Schema(string) ([]byte, error) { return d.document, nil }

func (d fetchedDocument) ServerRelativeURL() string { return d.path }

// explainSections is the kubectl explain text split into its parts.
type explainSections struct {
	header      map[string]string
	fieldType   string
	enum        []string
	description string
	fields      []string
}

// Section markers start at column zero; their bodies are indented.
const (
	sectionDescription = "DESCRIPTION:"
	sectionEnum        = "ENUM:"
	sectionFields      = "FIELDS:"
	fieldLinePrefix    = "FIELD: "
)

var (
	headerLinePattern = regexp.MustCompile(`^([A-Z]+):\s+(\S.*)$`)
	fieldTypePattern  = regexp.MustCompile(`<(.+)>\s*$`)
	// A field list line: indentation, the name, a tab, the type in angle
	// brackets, and the required marker when the parent requires the field.
	fieldListPattern = regexp.MustCompile(`^( +)(\S+)\t<(.+?)>( -required-)?$`)
)

func splitExplainOutput(output string) explainSections {
	sections := explainSections{header: make(map[string]string)}
	var description []string
	section := ""
	for _, line := range strings.Split(output, "\n") {
		if next, ok := explainSectionStart(line); ok {
			section = next
			sections.readFieldLine(line)
			continue
		}
		if section == sectionDescription {
			description = append(description, strings.TrimSpace(line))
			continue
		}
		sections.readSectionLine(section, line)
	}
	sections.description = strings.TrimSpace(strings.Join(description, "\n"))
	return sections
}

// readFieldLine takes the type from a `FIELD: name <type>` line.
func (s *explainSections) readFieldLine(line string) {
	if !strings.HasPrefix(line, fieldLinePrefix) {
		return
	}
	if match := fieldTypePattern.FindStringSubmatch(line); match != nil {
		s.fieldType = match[1]
	}
}

// readSectionLine files one body line under the section it belongs to.
func (s *explainSections) readSectionLine(section, line string) {
	switch section {
	case "":
		if match := headerLinePattern.FindStringSubmatch(line); match != nil {
			s.header[match[1]] = match[2]
		}
	case sectionEnum:
		if value := strings.TrimSpace(line); value != "" {
			s.enum = append(s.enum, value)
		}
	case sectionFields:
		s.fields = append(s.fields, line)
	}
}

// explainSectionStart reports the section a column-zero marker line opens.
// Unknown markers (EXTERNAL DOCS) open a section whose body is ignored.
func explainSectionStart(line string) (string, bool) {
	if line == "" || strings.HasPrefix(line, " ") {
		return "", false
	}
	if strings.HasPrefix(line, fieldLinePrefix) {
		return fieldLinePrefix, true
	}
	if headerLinePattern.MatchString(line) {
		return "", false
	}
	return strings.TrimSpace(line), true
}

// parseFieldTree rebuilds the nesting of a recursive field list from its
// indentation: two spaces per level, starting at one level.
func parseFieldTree(lines []string) []SchemaField {
	root := &SchemaField{}
	// ancestors[depth] is the field new fields at that depth are added under.
	ancestors := []*SchemaField{root}
	for _, line := range lines {
		match := fieldListPattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		depth := len(match[1])/2 - 1
		if depth < 0 || depth >= len(ancestors) {
			continue
		}
		parent := ancestors[depth]
		parent.Fields = append(parent.Fields, SchemaField{Name: match[2], Type: match[3], Required: match[4] != ""})
		ancestors = append(ancestors[:depth+1], &parent.Fields[len(parent.Fields)-1])
	}
	return root.Fields
}
