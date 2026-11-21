// Package apiresources describes the kinds a cluster serves: their schema as
// `kubectl explain` prints it, read from the cluster's published OpenAPI v3
// documents.
package apiresources

import (
	"bytes"
	"crypto/sha256"
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
	Revision    string        `json:"revision"`
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
// field. Path is the field's name under each of its ancestors, one segment per
// level, because a field name may itself contain a dot. An empty Path
// describes the kind itself.
type FieldExplanation struct {
	Path        []string `json:"path"`
	Type        string   `json:"type,omitempty"`
	Description string   `json:"description"`
	Enum        []string `json:"enum,omitempty"`
}

// ExplainSchema returns the complete field tree of the kind served at gvr.
func ExplainSchema(client openapi.Client, gvr schema.GroupVersionResource) (*KindSchema, error) {
	document, err := loadExplainDocument(client, gvr)
	if err != nil {
		return nil, err
	}
	output, err := renderExplain(document, gvr, nil, true)
	if err != nil {
		return nil, err
	}
	sections := splitExplainOutput(output)
	return &KindSchema{
		Revision:    document.revision(),
		Group:       sections.header["GROUP"],
		Version:     sections.header["VERSION"],
		Kind:        sections.header["KIND"],
		Description: sections.description,
		Fields:      parseFieldTree(sections.fields),
	}, nil
}

// ExplainField returns the type and description of the field reached by
// following fieldPath in the same schema revision as the caller's field tree.
func ExplainField(client openapi.Client, gvr schema.GroupVersionResource, fieldPath []string, revision string) (*FieldExplanation, error) {
	if revision == "" {
		return nil, errorstatus.BadRequest(fmt.Errorf("schema revision is required to explain a field"))
	}
	document, err := loadExplainDocument(client, gvr)
	if err != nil {
		if errorstatus.Classify(err).Reason == errorstatus.ReasonNotFound {
			return nil, errorstatus.Conflict(err)
		}
		return nil, err
	}
	if document.revision() != revision {
		return nil, errorstatus.Conflict(fmt.Errorf("the OpenAPI schema for %s changed", gvr.GroupVersion()))
	}
	output, err := renderExplain(document, gvr, fieldPath, false)
	if err != nil {
		return nil, err
	}
	sections := splitExplainOutput(output)
	return &FieldExplanation{
		Path:        append([]string{}, fieldPath...),
		Type:        sections.fieldType,
		Description: sections.description,
		Enum:        sections.enum,
	}, nil
}

// loadExplainDocument keeps OpenAPI fetch failures distinct from missing kinds or fields.
func loadExplainDocument(client openapi.Client, gvr schema.GroupVersionResource) (fetchedDocument, error) {
	paths, err := client.Paths()
	if err != nil {
		return fetchedDocument{}, fmt.Errorf("fetch OpenAPI index: %w", err)
	}
	documentPath := "api/" + gvr.Version
	if gvr.Group != "" {
		documentPath = "apis/" + gvr.Group + "/" + gvr.Version
	}
	groupVersion, ok := paths[documentPath]
	if !ok {
		return fetchedDocument{}, errorstatus.NotFound(fmt.Errorf("the cluster publishes no schema for %s", gvr.GroupVersion()))
	}
	document, err := groupVersion.Schema(runtime.ContentTypeJSON)
	if err != nil {
		return fetchedDocument{}, fmt.Errorf("fetch OpenAPI schema for %s: %w", gvr.GroupVersion(), err)
	}
	if !json.Valid(document) {
		return fetchedDocument{}, fmt.Errorf("OpenAPI schema for %s is not valid JSON", gvr.GroupVersion())
	}
	return fetchedDocument{path: documentPath, document: document}, nil
}

func renderExplain(document fetchedDocument, gvr schema.GroupVersionResource, fieldPath []string, recursive bool) (string, error) {
	var output bytes.Buffer
	if err := explain.PrintModelDescription(fieldPath, &output, document, gvr, recursive, 0, "plaintext"); err != nil {
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

func (d fetchedDocument) revision() string { return fmt.Sprintf("%x", sha256.Sum256(d.document)) }

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
	// brackets, and the required marker when the parent requires the field. The
	// tab ends the name, which may contain dots and spaces.
	fieldListPattern = regexp.MustCompile(`^( +)([^\t]+)\t<(.+?)>( -required-)?$`)
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
