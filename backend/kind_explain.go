/*
 * backend/kind_explain.go
 *
 * `kubectl explain` for a kind the cluster serves: its field tree and the
 * description of one field, read from the cluster's OpenAPI v3 documents.
 */

package backend

import (
	"errors"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/apiresources"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/openapi"
)

// explainDocumentCacheSize bounds the OpenAPI group-version documents kept for
// Explain across all clusters. A document can be a few megabytes.
const explainDocumentCacheSize = 4

// ExplainKindSchema returns the field tree of the kind target names. The target
// is a kind, not an object: cluster, group, version, and plural resource.
func (g *ResourceGateway) ExplainKindSchema(target resourcemodel.ResourceRef) (*apiresources.KindSchema, error) {
	client, gvr, err := g.explainClient(target)
	if err != nil {
		return nil, err
	}
	return apiresources.ExplainSchema(client, gvr)
}

// ExplainKindField describes the field reached by following fieldPath, one
// field name per level, under the kind target names; an empty path describes
// the kind itself.
func (g *ResourceGateway) ExplainKindField(target resourcemodel.ResourceRef, fieldPath []string, revision string) (*apiresources.FieldExplanation, error) {
	client, gvr, err := g.explainClient(target)
	if err != nil {
		return nil, err
	}
	return apiresources.ExplainField(client, gvr, fieldPath, revision)
}

// explainClient validates the kind identity and returns the cluster's OpenAPI
// client, with its documents cached, and the resource to explain.
func (g *ResourceGateway) explainClient(target resourcemodel.ResourceRef) (openapi.Client, schema.GroupVersionResource, error) {
	gvr := schema.GroupVersionResource{
		Group:    strings.TrimSpace(target.Group),
		Version:  strings.TrimSpace(target.Version),
		Resource: strings.TrimSpace(target.Resource),
	}
	if gvr.Version == "" || gvr.Resource == "" {
		return nil, gvr, errorstatus.BadRequest(fmt.Errorf("version and resource are required to explain a kind"))
	}
	deps, _, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return nil, gvr, err
	}
	client, err := g.openAPIClientFn(deps)
	if err != nil {
		return nil, gvr, err
	}
	return g.explainDocuments.Client(target.ClusterID, client), gvr, nil
}

// clusterOpenAPIClient is the production OpenAPI v3 client: the cluster's
// discovery client.
func clusterOpenAPIClient(deps common.Dependencies) (openapi.Client, error) {
	if deps.KubernetesClient == nil {
		return nil, errorstatus.ClusterNotReady(errors.New("kubernetes client is not available"))
	}
	return deps.KubernetesClient.Discovery().OpenAPIV3(), nil
}
