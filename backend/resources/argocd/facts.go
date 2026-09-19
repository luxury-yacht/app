package argocd

import (
	"github.com/luxury-yacht/app/backend/resources/crdfacts"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
)

// Facts contains only display data; repository credentials, Helm values, and
// project JWT tokens are deliberately absent from these projections.
type Facts struct {
	Application    *ApplicationFacts    `json:"application,omitempty"`
	ApplicationSet *ApplicationSetFacts `json:"applicationSet,omitempty"`
	Project        *ProjectFacts        `json:"project,omitempty"`
	Conditions     []Condition          `json:"conditions,omitempty"`
}

type ApplicationSpec struct {
	Project     string      `json:"project,omitempty"`
	Destination Destination `json:"destination"`
	Source      *Source     `json:"source,omitempty"`
	Sources     []Source    `json:"sources,omitempty"`
	SyncPolicy  *SyncPolicy `json:"syncPolicy,omitempty"`
}
type Destination struct {
	Name         string `json:"name,omitempty"`
	Server       string `json:"server,omitempty"`
	Namespace    string `json:"namespace,omitempty"`
	ResolvedName string `json:"resolvedName,omitempty"`
}
type Source struct {
	RepoURL        string `json:"repoURL,omitempty"`
	Path           string `json:"path,omitempty"`
	Chart          string `json:"chart,omitempty"`
	TargetRevision string `json:"targetRevision,omitempty"`
	Ref            string `json:"ref,omitempty"`
	Name           string `json:"name,omitempty"`
}
type SyncPolicy struct {
	Automated   *AutomatedSync `json:"automated,omitempty"`
	SyncOptions []string       `json:"syncOptions,omitempty"`
}
type AutomatedSync struct {
	Enabled    *bool `json:"enabled,omitempty"`
	Prune      bool  `json:"prune"`
	SelfHeal   bool  `json:"selfHeal"`
	AllowEmpty bool  `json:"allowEmpty"`
}
type ApplicationFacts struct {
	Spec               ApplicationSpec             `json:"spec"`
	Sync               string                      `json:"sync,omitempty"`
	SyncPresentation   string                      `json:"syncPresentation,omitempty"`
	Health             string                      `json:"health,omitempty"`
	HealthPresentation string                      `json:"healthPresentation,omitempty"`
	HealthMessage      string                      `json:"healthMessage,omitempty"`
	Revisions          []string                    `json:"revisions,omitempty"`
	Operation          *Operation                  `json:"operation,omitempty"`
	ApplicationSet     *resourcemodel.ResourceLink `json:"applicationSet,omitempty"`
	ResourceCount      *int64                      `json:"resourceCount,omitempty"`
}
type Operation struct {
	Phase             string `json:"phase,omitempty"`
	PhasePresentation string `json:"phasePresentation,omitempty"`
	Message           string `json:"message,omitempty"`
	StartedAt         string `json:"startedAt,omitempty"`
	FinishedAt        string `json:"finishedAt,omitempty"`
}
type ApplicationSetFacts struct {
	TemplateName                string          `json:"templateName,omitempty"`
	Template                    ApplicationSpec `json:"template"`
	Generators                  []Generator     `json:"generators,omitempty"`
	Strategy                    string          `json:"strategy,omitempty"`
	ApplicationsSync            string          `json:"applicationsSync,omitempty"`
	PreserveResourcesOnDeletion *bool           `json:"preserveResourcesOnDeletion,omitempty"`
	GoTemplate                  *bool           `json:"goTemplate,omitempty"`
}
type Generator struct {
	Type     string `json:"type"`
	RepoURL  string `json:"repoURL,omitempty"`
	Revision string `json:"revision,omitempty"`
}
type ProjectFacts struct {
	Description                string                `json:"description,omitempty"`
	SourceRepos                []string              `json:"sourceRepos,omitempty"`
	SourceNamespaces           []string              `json:"sourceNamespaces,omitempty"`
	Destinations               []Destination         `json:"destinations,omitempty"`
	ClusterResourceWhitelist   []ResourceRestriction `json:"clusterResourceWhitelist,omitempty"`
	ClusterResourceBlacklist   []ResourceRestriction `json:"clusterResourceBlacklist,omitempty"`
	NamespaceResourceWhitelist []ResourceRestriction `json:"namespaceResourceWhitelist,omitempty"`
	NamespaceResourceBlacklist []ResourceRestriction `json:"namespaceResourceBlacklist,omitempty"`
	Roles                      []ProjectRole         `json:"roles,omitempty"`
	SyncWindows                []SyncWindow          `json:"syncWindows,omitempty"`
}
type ResourceRestriction struct {
	Group string `json:"group"`
	Kind  string `json:"kind"`
	Name  string `json:"name,omitempty"`
}
type ProjectRole struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Groups      []string `json:"groups,omitempty"`
	Policies    []string `json:"policies,omitempty"`
}
type SyncWindow struct {
	Kind         string   `json:"kind"`
	Schedule     string   `json:"schedule"`
	Duration     string   `json:"duration"`
	TimeZone     string   `json:"timeZone,omitempty"`
	Applications []string `json:"applications,omitempty"`
	Namespaces   []string `json:"namespaces,omitempty"`
	Clusters     []string `json:"clusters,omitempty"`
	ManualSync   bool     `json:"manualSync"`
	AndOperator  bool     `json:"andOperator"`
}
type Condition struct {
	Type               string `json:"type"`
	Status             string `json:"status,omitempty"`
	Presentation       string `json:"presentation"`
	Message            string `json:"message,omitempty"`
	Reason             string `json:"reason,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

func BuildFacts(clusterID string, object *unstructured.Unstructured) *Facts {
	if !isArgoCD(object) {
		return nil
	}
	facts := &Facts{Conditions: conditions(object)}
	switch strings.ToLower(object.GetKind()) {
	case "application":
		facts.Application = applicationFacts(clusterID, object)
	case "applicationset":
		facts.ApplicationSet = applicationSetFacts(object)
	case "appproject":
		facts.Project = read[ProjectFacts](object.Object, "spec")
	}
	return facts
}

func isArgoCD(object *unstructured.Unstructured) bool {
	return object != nil && resourcekind.FamilyForResource(object.GroupVersionKind().Group, object.GetKind(), object.GetNamespace() != "") == resourcekind.ArgoCDFamily
}

func applicationFacts(clusterID string, object *unstructured.Unstructured) *ApplicationFacts {
	facts := &ApplicationFacts{Spec: applicationSpec(object.Object, "spec"), Sync: statusOrUnknown(crdfacts.Text(object.Object, "status", "sync", "status")), Health: statusOrUnknown(crdfacts.Text(object.Object, "status", "health", "status")), HealthMessage: crdfacts.Text(object.Object, "status", "health", "message"), Operation: read[Operation](object.Object, "status", "operationState")}
	facts.SyncPresentation = statusPresentation(facts.Sync)
	facts.HealthPresentation = statusPresentation(facts.Health)
	if facts.Operation != nil {
		facts.Operation.PhasePresentation = statusPresentation(facts.Operation.Phase)
	}
	facts.Revisions, _, _ = unstructured.NestedStringSlice(object.Object, "status", "sync", "revisions")
	if len(facts.Revisions) == 0 {
		if revision := crdfacts.Text(object.Object, "status", "sync", "revision"); revision != "" {
			facts.Revisions = []string{revision}
		}
	}
	if resources, found, _ := unstructured.NestedSlice(object.Object, "status", "resources"); found {
		count := int64(len(resources))
		facts.ResourceCount = &count
	}
	facts.ApplicationSet = applicationSetOwner(clusterID, object)
	return facts
}

func applicationSetOwner(clusterID string, object *unstructured.Unstructured) *resourcemodel.ResourceLink {
	links := crdfacts.Owners(clusterID, object, "argoproj.io", "ApplicationSet")
	if len(links) == 0 {
		return nil
	}
	return &links[0]
}

func applicationSetFacts(object *unstructured.Unstructured) *ApplicationSetFacts {
	facts := &ApplicationSetFacts{TemplateName: crdfacts.Text(object.Object, "spec", "template", "metadata", "name"), Template: applicationSpec(object.Object, "spec", "template", "spec"), Strategy: crdfacts.Text(object.Object, "spec", "strategy", "type"), ApplicationsSync: crdfacts.Text(object.Object, "spec", "syncPolicy", "applicationsSync")}
	facts.PreserveResourcesOnDeletion = crdfacts.Bool(object.Object, "spec", "syncPolicy", "preserveResourcesOnDeletion")
	facts.GoTemplate = crdfacts.Bool(object.Object, "spec", "goTemplate")
	generators, _, _ := unstructured.NestedSlice(object.Object, "spec", "generators")
	facts.Generators = generatorFacts(generators)
	return facts
}

func generatorFacts(generators []any) []Generator {
	var result []Generator
	for _, raw := range generators {
		generator, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		keys := make([]string, 0, len(generator))
		for key := range generator {
			if key != "selector" && key != "template" {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, kind := range keys {
			result = append(result, Generator{Type: kind, RepoURL: crdfacts.Text(generator, kind, "repoURL"), Revision: crdfacts.Text(generator, kind, "revision")})
			nested, _, _ := unstructured.NestedSlice(generator, kind, "generators")
			result = append(result, generatorFacts(nested)...)
		}
	}
	return result
}

func applicationSpec(object map[string]any, path ...string) ApplicationSpec {
	if spec := read[ApplicationSpec](object, path...); spec != nil {
		return *spec
	}
	return ApplicationSpec{}
}
func read[T any](object map[string]any, path ...string) *T {
	value, found, err := unstructured.NestedFieldNoCopy(object, path...)
	if !found || err != nil {
		return nil
	}
	record, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	var result T
	if runtime.DefaultUnstructuredConverter.FromUnstructured(record, &result) != nil {
		return nil
	}
	return &result
}
