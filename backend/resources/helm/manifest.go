/*
 * backend/resources/helm/manifest.go
 *
 * Release manifest parsing shared by the Details tab resources list and the
 * Manifest/Map refresh domains. Each consumer resolves identities itself.
 */

package helm

import (
	"strings"

	"gopkg.in/yaml.v2"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// ParseManifestResources returns the objects a release manifest names, in
// manifest order. List kinds are flattened (items without an apiVersion inherit
// the List's), entries without a kind or name are skipped, and repeats of the
// same apiVersion/kind/namespace/name are dropped. defaultNamespace fills a
// missing metadata.namespace; NamespaceExplicit records whether one was set.
func ParseManifestResources(manifest, defaultNamespace string) []resourcemodel.HelmManifestResource {
	resources := manifestResourceAccumulator{
		defaultNamespace: defaultNamespace,
		seen:             make(map[manifestResourceKey]struct{}),
	}
	for _, document := range splitManifestDocuments(manifest) {
		if object, ok := parseManifestDocument(document); ok {
			resources.addObject(object)
		}
	}
	return resources.items
}

type manifestResourceKey struct {
	apiVersion string
	kind       string
	namespace  string
	name       string
}

type manifestResourceAccumulator struct {
	defaultNamespace string
	seen             map[manifestResourceKey]struct{}
	items            []resourcemodel.HelmManifestResource
}

func splitManifestDocuments(manifest string) []string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(manifest), "---")
	return strings.Split(trimmed, "\n---")
}

func parseManifestDocument(document string) (map[string]interface{}, bool) {
	document = strings.TrimSpace(document)
	if document == "" || document == "---" {
		return nil, false
	}
	var object map[string]interface{}
	if err := yaml.Unmarshal([]byte(document), &object); err != nil {
		return nil, false
	}
	return object, object != nil
}

func (resources *manifestResourceAccumulator) addObject(object map[string]interface{}) {
	kind, _ := object["kind"].(string)
	if kind == "" {
		return
	}
	// apiVersion is the wire-form "group/version" (or just "version" for core
	// resources), allowing Helm-managed CRDs to retain their complete GVK.
	apiVersion, _ := object["apiVersion"].(string)
	if strings.HasSuffix(kind, "List") {
		resources.addListItems(object, apiVersion)
		return
	}
	resources.addResource(object, apiVersion, kind)
}

func (resources *manifestResourceAccumulator) addListItems(object map[string]interface{}, inheritedAPIVersion string) {
	items, ok := object["items"].([]interface{})
	if !ok {
		return
	}
	for _, item := range items {
		resources.addListItem(item, inheritedAPIVersion)
	}
}

func (resources *manifestResourceAccumulator) addListItem(item interface{}, inheritedAPIVersion string) {
	object, ok := toStringMap(item)
	if !ok {
		return
	}
	kind, _ := object["kind"].(string)
	if kind == "" {
		return
	}
	apiVersion, _ := object["apiVersion"].(string)
	if apiVersion == "" {
		apiVersion = inheritedAPIVersion
	}
	resources.addResource(object, apiVersion, kind)
}

func (resources *manifestResourceAccumulator) addResource(object map[string]interface{}, apiVersion, kind string) {
	name, namespace, namespaceExplicit := extractNameNamespace(object, resources.defaultNamespace)
	if name == "" {
		return
	}
	key := manifestResourceKey{apiVersion: apiVersion, kind: kind, namespace: namespace, name: name}
	if _, exists := resources.seen[key]; exists {
		return
	}
	resources.seen[key] = struct{}{}
	resources.items = append(resources.items, resourcemodel.HelmManifestResource{
		APIVersion:        apiVersion,
		Kind:              kind,
		Namespace:         namespace,
		Name:              name,
		NamespaceExplicit: namespaceExplicit,
	})
}

func extractNameNamespace(obj map[string]interface{}, defaultNamespace string) (string, string, bool) {
	metadata, ok := toStringMap(obj["metadata"])
	if !ok {
		return "", defaultNamespace, false
	}

	name, _ := metadata["name"].(string)
	namespace := defaultNamespace
	namespaceExplicit := false
	if ns, ok := metadata["namespace"].(string); ok && ns != "" {
		namespace = ns
		namespaceExplicit = true
	}
	return name, namespace, namespaceExplicit
}

func toStringMap(value interface{}) (map[string]interface{}, bool) {
	switch typed := value.(type) {
	case map[string]interface{}:
		return typed, true
	case map[interface{}]interface{}:
		result := make(map[string]interface{}, len(typed))
		for k, v := range typed {
			key, ok := k.(string)
			if !ok {
				continue
			}
			result[key] = v
		}
		return result, true
	default:
		return nil, false
	}
}
