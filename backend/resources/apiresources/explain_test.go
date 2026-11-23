package apiresources

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/openapi"
	"k8s.io/client-go/openapi/openapitest"
)

var deploymentsGVR = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}

func findField(t *testing.T, fields []SchemaField, path ...string) SchemaField {
	t.Helper()
	var found SchemaField
	for _, name := range path {
		matched := false
		for _, field := range fields {
			if field.Name == name {
				found, fields, matched = field, field.Fields, true
				break
			}
		}
		if !matched {
			t.Fatalf("field %q of path %v not found", name, path)
		}
	}
	return found
}

// The Explain tab renders this tree, so the nesting, types and required markers
// must match what `kubectl explain --recursive` prints for the kind.
func TestExplainSchemaBuildsTheKindFieldTree(t *testing.T) {
	kindSchema, err := ExplainSchema(openapitest.NewEmbeddedFileClient(), deploymentsGVR)
	require.NoError(t, err)

	require.Equal(t, "apps", kindSchema.Group)
	require.Equal(t, "v1", kindSchema.Version)
	require.Equal(t, "Deployment", kindSchema.Kind)
	require.Equal(t, "Deployment enables declarative updates for Pods and ReplicaSets.", kindSchema.Description)

	topLevel := make([]string, 0, len(kindSchema.Fields))
	for _, field := range kindSchema.Fields {
		topLevel = append(topLevel, field.Name)
	}
	require.Equal(t, []string{"apiVersion", "kind", "metadata", "spec", "status"}, topLevel)

	selector := findField(t, kindSchema.Fields, "spec", "selector")
	require.Equal(t, "LabelSelector", selector.Type)
	require.True(t, selector.Required)

	maxSurge := findField(t, kindSchema.Fields, "spec", "strategy", "rollingUpdate", "maxSurge")
	require.Equal(t, "IntOrString", maxSurge.Type)
	require.False(t, maxSurge.Required)
	require.Empty(t, maxSurge.Fields)

	// Array items are traversed without a path segment of their own.
	image := findField(t, kindSchema.Fields, "spec", "template", "spec", "containers", "image")
	require.Equal(t, "string", image.Type)
	containers := findField(t, kindSchema.Fields, "spec", "template", "spec", "containers")
	require.Equal(t, "[]Container", containers.Type)
}

func TestExplainSchemaOfACoreKindHasNoGroup(t *testing.T) {
	kindSchema, err := ExplainSchema(openapitest.NewEmbeddedFileClient(), schema.GroupVersionResource{Version: "v1", Resource: "pods"})
	require.NoError(t, err)

	require.Empty(t, kindSchema.Group)
	require.Equal(t, "Pod", kindSchema.Kind)
	require.Equal(t, "string", findField(t, kindSchema.Fields, "spec", "containers", "name").Type)
}

func TestExplainFieldDescribesOneField(t *testing.T) {
	explanation, err := explainCurrentField(t, openapitest.NewEmbeddedFileClient(), deploymentsGVR, []string{"spec", "strategy"})
	require.NoError(t, err)

	require.Equal(t, []string{"spec", "strategy"}, explanation.Path)
	require.Equal(t, "DeploymentStrategy", explanation.Type)
	require.Equal(t,
		"The deployment strategy to use to replace existing pods with new ones.\n"+
			"DeploymentStrategy describes how to replace existing pods with new ones.",
		explanation.Description)
}

func TestExplainFieldWithoutAPathDescribesTheKind(t *testing.T) {
	explanation, err := explainCurrentField(t, openapitest.NewEmbeddedFileClient(), deploymentsGVR, nil)
	require.NoError(t, err)

	require.Empty(t, explanation.Path)
	require.Empty(t, explanation.Type)
	require.Equal(t, "Deployment enables declarative updates for Pods and ReplicaSets.", explanation.Description)
}

// Aggregated APIs and some custom kinds publish no schema; the tab shows that
// as "nothing to explain", not as a failure to reach the cluster.
func TestExplainReportsMissingSchemasAsNotFound(t *testing.T) {
	client := openapitest.NewEmbeddedFileClient()
	cases := map[string]func() error{
		"group version not published": func() error {
			_, err := ExplainSchema(client, schema.GroupVersionResource{Group: "nope.io", Version: "v1", Resource: "widgets"})
			return err
		},
		"resource not in the published document": func() error {
			_, err := ExplainSchema(client, schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "widgets"})
			return err
		},
		"field not in the schema": func() error {
			_, err := explainCurrentField(t, client, deploymentsGVR, []string{"spec", "nope"})
			return err
		},
	}
	for name, run := range cases {
		t.Run(name, func(t *testing.T) {
			err := run()
			require.Error(t, err)
			require.Equal(t, errorstatus.ReasonNotFound, errorstatus.Classify(err).Reason)
		})
	}
}

type failingOpenAPI struct{ err error }

func (f failingOpenAPI) Paths() (map[string]openapi.GroupVersion, error) { return nil, f.err }

// A cluster that cannot be reached must not read as "this kind has no schema".
func TestExplainKeepsFetchFailuresDistinctFromMissingSchemas(t *testing.T) {
	fetchErr := errors.New("dial tcp: connection refused")

	_, err := ExplainSchema(failingOpenAPI{err: fetchErr}, deploymentsGVR)

	require.ErrorIs(t, err, fetchErr)
	require.NotEqual(t, errorstatus.ReasonNotFound, errorstatus.Classify(err).Reason)
}

func TestExplainRejectsDocumentsTheRendererCannotInterpret(t *testing.T) {
	client := fetchedDocument{path: "apis/example.io/v1", document: []byte(`[]`)}
	_, err := ExplainSchema(client, widgetsGVR)
	require.Error(t, err)
	require.NotEqual(t, errorstatus.ReasonNotFound, errorstatus.Classify(err).Reason)
}

func TestExplainKeepsIndentationInSchemaDescriptions(t *testing.T) {
	client := fetchedDocument{
		path: "apis/example.io/v1",
		document: []byte(strings.Replace(widgetDocument,
			`Widget is a test kind.`, `Widget is a test kind.\n\n    apiVersion: example.io/v1\n    kind: Widget`, 1)),
	}
	result, err := ExplainSchema(client, widgetsGVR)
	require.NoError(t, err)
	require.Contains(t, result.Description, "\n    apiVersion: example.io/v1\n    kind: Widget")
}

// widgetDocument is a minimal OpenAPI v3 document for example.io/v1 widgets
// with the two shapes client-go's embedded documents lack: an enum field and a
// schema that refers to itself.
const widgetDocument = `{
  "openapi": "3.0.0",
  "paths": {
    "/apis/example.io/v1/namespaces/{namespace}/widgets": {
      "get": {"x-kubernetes-group-version-kind": {"group": "example.io", "version": "v1", "kind": "Widget"}}
    }
  },
  "components": {"schemas": {
    "io.example.v1.Widget": {
      "type": "object",
      "description": "Widget is a test kind.",
      "x-kubernetes-group-version-kind": [{"group": "example.io", "version": "v1", "kind": "Widget"}],
      "properties": {
        "mode": {"type": "string", "description": "How fast the widget runs.", "enum": ["Fast", "Slow"]},
        "root": {"$ref": "#/components/schemas/io.example.v1.Node"},
        "a.b": {"type": "string", "description": "The field literally named a.b."},
        "a": {"type": "object", "properties": {"b": {"type": "string", "description": "The field b nested under a."}}},
        "display name": {"type": "string", "description": "A name with a space in it."}
      }
    },
    "io.example.v1.Node": {
      "type": "object",
      "description": "Node is a tree node.",
      "required": ["name"],
      "properties": {
        "name": {"type": "string", "description": "Node name."},
        "children": {"type": "array", "items": {"$ref": "#/components/schemas/io.example.v1.Node"}}
      }
    }
  }}
}`

var widgetsGVR = schema.GroupVersionResource{Group: "example.io", Version: "v1", Resource: "widgets"}

func widgetClient() openapi.Client {
	return fetchedDocument{path: "apis/example.io/v1", document: []byte(widgetDocument)}
}

func TestExplainFieldListsEnumValues(t *testing.T) {
	explanation, err := explainCurrentField(t, widgetClient(), widgetsGVR, []string{"mode"})
	require.NoError(t, err)

	require.Equal(t, "string", explanation.Type)
	require.Equal(t, []EnumValue{{Value: "Fast"}, {Value: "Slow"}}, explanation.Enum)
	require.Equal(t, "How fast the widget runs.", explanation.Description)
}

// widgetClientWith serves the widget document with one property replaced.
func widgetClientWith(t *testing.T, name string, property map[string]any) openapi.Client {
	t.Helper()
	var document map[string]any
	require.NoError(t, json.Unmarshal([]byte(widgetDocument), &document))
	schemas := document["components"].(map[string]any)["schemas"].(map[string]any)
	schemas["io.example.v1.Widget"].(map[string]any)["properties"].(map[string]any)[name] = property
	updated, err := json.Marshal(document)
	require.NoError(t, err)
	return fetchedDocument{path: "apis/example.io/v1", document: updated}
}

// kubectl wraps descriptions at 76 columns for a terminal. The tab fits text
// to the panel, so descriptions arrive as the schema wrote them: line breaks
// only where the author put them.
func TestExplainKeepsDescriptionsAsWritten(t *testing.T) {
	written := "Notes about the widget, long enough to run well past the seventy-six columns a terminal wraps at. See https://example.io/docs/widgets/notes-and-other-long-paths for more.\n\n" +
		"A second paragraph with a list:\n - the first item, which is also long enough to be wrapped by a terminal at seventy-six columns\n - the second item"
	client := widgetClientWith(t, "notes", map[string]any{"type": "string", "description": written})

	explanation, err := explainCurrentField(t, client, widgetsGVR, []string{"notes"})
	require.NoError(t, err)
	require.Equal(t, written, explanation.Description)
}

// A field the schema does not describe has no description, not kubectl's
// "<empty>" placeholder.
func TestExplainLeavesUndescribedFieldsWithoutADescription(t *testing.T) {
	client := widgetClientWith(t, "blank", map[string]any{"type": "string"})

	explanation, err := explainCurrentField(t, client, widgetsGVR, []string{"blank"})
	require.NoError(t, err)
	require.Empty(t, explanation.Description)
}

// Kubernetes appends what each enum value means to the field's description.
// The meanings belong to the values, so they are listed with them once.
func TestExplainFieldDescribesEachEnumValue(t *testing.T) {
	client := widgetClientWith(t, "mode", map[string]any{
		"type": "string",
		"enum": []string{"Fast", "Slow", "Off"},
		"description": "How fast the widget runs.\n\nPossible enum values:\n" +
			" - `\"Fast\"` runs at full speed, which is the default and the reason anyone buys a widget at all.\n" +
			" - `\"Slow\"` saves power.",
	})

	explanation, err := explainCurrentField(t, client, widgetsGVR, []string{"mode"})
	require.NoError(t, err)
	require.Equal(t, []EnumValue{
		{Value: "Fast", Description: "runs at full speed, which is the default and the reason anyone buys a widget at all."},
		{Value: "Slow", Description: "saves power."},
		{Value: "Off"},
	}, explanation.Enum)
	require.Equal(t, "How fast the widget runs.", explanation.Description)
}

// CustomResourceDefinition and many custom kinds have schemas that refer to
// themselves; the tree must end at the repeat instead of growing without bound.
func TestExplainSchemaStopsAtSelfReferentialFields(t *testing.T) {
	kindSchema, err := ExplainSchema(widgetClient(), widgetsGVR)
	require.NoError(t, err)

	root := findField(t, kindSchema.Fields, "root")
	require.Equal(t, "Node", root.Type)
	require.True(t, findField(t, kindSchema.Fields, "root", "name").Required)
	children := findField(t, kindSchema.Fields, "root", "children")
	require.Equal(t, "[]Node", children.Type)
	require.Empty(t, children.Fields)
}

// Schemas may name a property with dots (label-style keys are common in custom
// kinds). That field and a same-spelled nested path are different fields and
// must be explained separately.
func TestExplainFieldTellsADottedNameFromANestedPath(t *testing.T) {
	literal, err := explainCurrentField(t, widgetClient(), widgetsGVR, []string{"a.b"})
	require.NoError(t, err)
	require.Equal(t, "The field literally named a.b.", literal.Description)

	nested, err := explainCurrentField(t, widgetClient(), widgetsGVR, []string{"a", "b"})
	require.NoError(t, err)
	require.Equal(t, "The field b nested under a.", nested.Description)
}

// Field names are whatever the schema says; the tree must keep a name with a
// dot or a space as one field rather than dropping or splitting it.
func TestExplainSchemaKeepsUnusualFieldNamesWhole(t *testing.T) {
	kindSchema, err := ExplainSchema(widgetClient(), widgetsGVR)
	require.NoError(t, err)

	require.Equal(t, "string", findField(t, kindSchema.Fields, "a.b").Type)
	require.Equal(t, "string", findField(t, kindSchema.Fields, "a", "b").Type)
	require.Equal(t, "string", findField(t, kindSchema.Fields, "display name").Type)
}

func explainCurrentField(t *testing.T, client openapi.Client, gvr schema.GroupVersionResource, path []string) (*FieldExplanation, error) {
	t.Helper()
	document, err := loadExplainDocument(client, gvr)
	require.NoError(t, err)
	kind := "Widget"
	if gvr == deploymentsGVR {
		kind = "Deployment"
	}
	return ExplainField(client, gvr, kind, path, document.revision())
}

func TestExplainFieldRequiresTheTreesSchemaRevision(t *testing.T) {
	old, err := ExplainSchema(widgetClient(), widgetsGVR)
	require.NoError(t, err)
	updated := fetchedDocument{
		path:     "apis/example.io/v1",
		document: []byte(strings.Replace(widgetDocument, `"mode":`, `"speed":`, 1)),
	}
	field, err := ExplainField(updated, widgetsGVR, "Widget", []string{"mode"}, old.Revision)
	require.Nil(t, field)
	require.Equal(t, errorstatus.ReasonConflict, errorstatus.Classify(err).Reason)
	_, err = ExplainField(fetchedDocument{}, widgetsGVR, "Widget", []string{"mode"}, old.Revision)
	require.Equal(t, errorstatus.ReasonConflict, errorstatus.Classify(err).Reason)
	_, err = ExplainField(updated, widgetsGVR, "Widget", []string{"speed"}, "")
	require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)

	current, err := ExplainSchema(updated, widgetsGVR)
	require.NoError(t, err)
	require.NotEqual(t, old.Revision, current.Revision)
	field, err = ExplainField(updated, widgetsGVR, "Widget", []string{"speed"}, current.Revision)
	require.NoError(t, err)
	require.Equal(t, "How fast the widget runs.", field.Description)
}
