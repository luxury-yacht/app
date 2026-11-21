package apiresources

import (
	"errors"
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
	explanation, err := ExplainField(openapitest.NewEmbeddedFileClient(), deploymentsGVR, "spec.strategy")
	require.NoError(t, err)

	require.Equal(t, "spec.strategy", explanation.Path)
	require.Equal(t, "DeploymentStrategy", explanation.Type)
	require.Equal(t,
		"The deployment strategy to use to replace existing pods with new ones.\n"+
			"DeploymentStrategy describes how to replace existing pods with new ones.",
		explanation.Description)
}

func TestExplainFieldWithoutAPathDescribesTheKind(t *testing.T) {
	explanation, err := ExplainField(openapitest.NewEmbeddedFileClient(), deploymentsGVR, "")
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
			_, err := ExplainField(client, deploymentsGVR, "spec.nope")
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
        "root": {"$ref": "#/components/schemas/io.example.v1.Node"}
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
	explanation, err := ExplainField(widgetClient(), widgetsGVR, "mode")
	require.NoError(t, err)

	require.Equal(t, "string", explanation.Type)
	require.Equal(t, []string{"Fast", "Slow"}, explanation.Enum)
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
