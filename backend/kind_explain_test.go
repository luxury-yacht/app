package backend

import (
	"testing"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/openapi"
	"k8s.io/client-go/openapi/openapitest"
)

// schemaCountingOpenAPI counts group-version document downloads.
type schemaCountingOpenAPI struct {
	openapi.Client
	downloads *int
}

func (c schemaCountingOpenAPI) Paths() (map[string]openapi.GroupVersion, error) {
	paths, err := c.Client.Paths()
	if err != nil {
		return nil, err
	}
	counted := make(map[string]openapi.GroupVersion, len(paths))
	for path, groupVersion := range paths {
		counted[path] = schemaCountingGroupVersion{GroupVersion: groupVersion, downloads: c.downloads}
	}
	return counted, nil
}

type schemaCountingGroupVersion struct {
	openapi.GroupVersion
	downloads *int
}

func (g schemaCountingGroupVersion) Schema(contentType string) ([]byte, error) {
	*g.downloads++
	return g.GroupVersion.Schema(contentType)
}

func explainGatewayFixture(t *testing.T) (*resourceGatewayFixture, *int) {
	t.Helper()
	fixture := newResourceGatewayFixture()
	fixture.setCluster("cluster-a", &clusterClients{meta: ClusterMeta{ID: "cluster-a", Name: "Cluster A"}})
	downloads := 0
	fixture.gateway.openAPIClientFn = func(common.Dependencies) (openapi.Client, error) {
		return schemaCountingOpenAPI{Client: openapitest.NewEmbeddedFileClient(), downloads: &downloads}, nil
	}
	return fixture, &downloads
}

var deploymentKindRef = resourcemodel.ResourceRef{
	ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments",
}

// Opening Explain and then selecting fields reads the same schema document;
// it is downloaded from the cluster once.
func TestExplainKindReadsTheSchemaAndItsFieldsFromOneDownload(t *testing.T) {
	fixture, downloads := explainGatewayFixture(t)

	kindSchema, err := fixture.gateway.ExplainKindSchema(deploymentKindRef)
	require.NoError(t, err)
	require.Equal(t, "Deployment", kindSchema.Kind)
	require.NotEmpty(t, kindSchema.Fields)

	explanation, err := fixture.gateway.ExplainKindField(deploymentKindRef, "spec.strategy")
	require.NoError(t, err)
	require.Equal(t, "DeploymentStrategy", explanation.Type)
	require.Equal(t, 1, *downloads)
}

func TestExplainKindRejectsIncompleteKindIdentity(t *testing.T) {
	fixture, _ := explainGatewayFixture(t)
	for name, change := range map[string]func(*resourcemodel.ResourceRef){
		"no version":  func(ref *resourcemodel.ResourceRef) { ref.Version = "" },
		"no resource": func(ref *resourcemodel.ResourceRef) { ref.Resource = "" },
	} {
		t.Run(name, func(t *testing.T) {
			target := deploymentKindRef
			change(&target)
			_, err := fixture.gateway.ExplainKindSchema(target)
			require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
			_, err = fixture.gateway.ExplainKindField(target, "spec")
			require.Equal(t, errorstatus.ReasonBadRequest, errorstatus.Classify(err).Reason)
		})
	}
}

// A kind whose group publishes no schema is an answer, not a failure.
func TestExplainKindReportsAKindWithoutASchemaAsNotFound(t *testing.T) {
	fixture, _ := explainGatewayFixture(t)

	_, err := fixture.gateway.ExplainKindSchema(resourcemodel.ResourceRef{
		ClusterID: "cluster-a", Group: "metrics.k8s.io", Version: "v1beta1", Kind: "NodeMetrics", Resource: "nodes",
	})

	require.Equal(t, errorstatus.ReasonNotFound, errorstatus.Classify(err).Reason)
}
