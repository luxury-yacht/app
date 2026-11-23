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
	"slices"
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
	Path        []string    `json:"path"`
	Type        string      `json:"type,omitempty"`
	Description string      `json:"description"`
	Enum        []EnumValue `json:"enum,omitempty"`
}

// EnumValue is one value a field allows and, when the schema says, what it
// means.
type EnumValue struct {
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
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
func ExplainField(client openapi.Client, gvr schema.GroupVersionResource, expectedKind string, fieldPath []string, revision string) (*FieldExplanation, error) {
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
	if kind := sections.header["KIND"]; kind != expectedKind {
		return nil, errorstatus.Conflict(fmt.Errorf("%s now serves kind %s instead of %s", gvr, kind, expectedKind))
	}
	explanation := &FieldExplanation{
		Path:        append([]string{}, fieldPath...),
		Type:        sections.fieldType,
		Description: sections.description,
	}
	if len(sections.enum) > 0 {
		description, meanings := splitEnumMeanings(sections.description)
		explanation.Description = description
		explanation.Enum = make([]EnumValue, 0, len(sections.enum))
		for _, value := range sections.enum {
			explanation.Enum = append(explanation.Enum, EnumValue{Value: value, Description: meanings[value]})
		}
	}
	return explanation, nil
}

const enumMeaningsHeading = "Possible enum values:"

// enumMeaningPattern matches one line of the list Kubernetes' API generator
// appends to an enum field's description: " - `"Value"` what it means".
var enumMeaningPattern = regexp.MustCompile("^ - `\"(.*?)\"`(?: (.*))?$")

// splitEnumMeanings takes the generated "Possible enum values:" list out of a
// description and returns what it says each value means.
func splitEnumMeanings(description string) (string, map[string]string) {
	lines := strings.Split(description, "\n")
	start := slices.Index(lines, enumMeaningsHeading)
	if start < 0 || (start > 0 && lines[start-1] != "") {
		return description, nil
	}
	meanings := make(map[string]string)
	end := start + 1
	for ; end < len(lines); end++ {
		match := enumMeaningPattern.FindStringSubmatch(lines[end])
		if match == nil {
			break
		}
		meanings[match[1]] = match[2]
	}
	if len(meanings) == 0 {
		return description, nil
	}
	remaining := append(slices.Clone(lines[:start]), lines[end:]...)
	return strings.Trim(strings.Join(remaining, "\n"), "\n"), meanings
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
	if !json.Valid(document) || !bytes.HasPrefix(bytes.TrimSpace(document), []byte("{")) {
		return fetchedDocument{}, fmt.Errorf("OpenAPI schema for %s is not a JSON object", gvr.GroupVersion())
	}
	return fetchedDocument{path: documentPath, document: document}, nil
}

// noBreakSpace stands in for every space in schema descriptions while kubectl
// renders them. Its plaintext template wraps descriptions at 76 columns for a
// terminal, and its word wrapper never breaks a line at U+00A0, so the text
// comes back with line breaks only where the schema has them.
const noBreakSpace = "\u00a0"

func renderExplain(document fetchedDocument, gvr schema.GroupVersionResource, fieldPath []string, recursive bool) (string, error) {
	unwrapped, err := document.withUnbreakableDescriptions()
	if err != nil {
		return "", fmt.Errorf("render OpenAPI schema for %s: %w", gvr, err)
	}
	var output bytes.Buffer
	if err := explain.PrintModelDescription(fieldPath, &output, unwrapped, gvr, recursive, 0, "plaintext"); err != nil {
		if missingExplainTarget(err) {
			return "", errorstatus.NotFound(err)
		}
		return "", fmt.Errorf("render OpenAPI schema for %s: %w", gvr, err)
	}
	return output.String(), nil
}

func missingExplainTarget(err error) bool {
	// Kubectl unwraps its template's missing-target messages but does not
	// export their error type. Other renderer failures remain errors.
	message := err.Error()
	switch {
	case strings.HasPrefix(message, "error: GVR "), strings.HasPrefix(message, "error: GVK "):
		return strings.HasSuffix(message, " not found in OpenAPI schema")
	case strings.HasPrefix(message, `error: field "`):
		return strings.HasSuffix(message, `" does not exist`)
	default:
		return false
	}
}

// fetchedDocument serves one already-fetched OpenAPI document to the renderer.
type fetchedDocument struct {
	path     string
	document []byte
}

func (d fetchedDocument) revision() string { return fmt.Sprintf("%x", sha256.Sum256(d.document)) }

// withUnbreakableDescriptions returns a copy for rendering whose description
// strings use noBreakSpace for spaces. Numbers decode as json.Number so the
// copy keeps them exactly.
func (d fetchedDocument) withUnbreakableDescriptions() (fetchedDocument, error) {
	decoder := json.NewDecoder(bytes.NewReader(d.document))
	decoder.UseNumber()
	var parsed any
	if err := decoder.Decode(&parsed); err != nil {
		return fetchedDocument{}, err
	}
	protectDescriptionSpaces(parsed)
	document, err := json.Marshal(parsed)
	if err != nil {
		return fetchedDocument{}, err
	}
	return fetchedDocument{path: d.path, document: document}, nil
}

func protectDescriptionSpaces(node any) {
	switch value := node.(type) {
	case map[string]any:
		for key, child := range value {
			if text, ok := child.(string); ok && key == "description" {
				value[key] = strings.ReplaceAll(text, " ", noBreakSpace)
				continue
			}
			protectDescriptionSpaces(child)
		}
	case []any:
		for _, child := range value {
			protectDescriptionSpaces(child)
		}
	}
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
			description = append(description, strings.TrimPrefix(line, "    "))
			continue
		}
		sections.readSectionLine(section, line)
	}
	sections.description = strings.ReplaceAll(strings.Trim(strings.Join(description, "\n"), "\n"), noBreakSpace, " ")
	// kubectl prints this placeholder for a schema without a description.
	if sections.description == "<empty>" {
		sections.description = ""
	}
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
		if value := strings.TrimPrefix(line, "    "); value != "" {
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
