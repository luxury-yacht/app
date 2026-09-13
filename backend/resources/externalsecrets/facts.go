package externalsecrets

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/crdfacts"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type Facts struct {
	Conditions            []crdfacts.Condition   `json:"conditions,omitempty"`
	ExternalSecret        *ExternalSecret        `json:"externalSecret,omitempty"`
	Store                 *Store                 `json:"store,omitempty"`
	ClusterExternalSecret *ClusterExternalSecret `json:"clusterExternalSecret,omitempty"`
}
type ExternalSecret struct {
	StoreName       string                      `json:"storeName,omitempty"`
	StoreKind       string                      `json:"storeKind,omitempty"`
	Store           *resourcemodel.ResourceLink `json:"store,omitempty"`
	Target          *resourcemodel.ResourceLink `json:"target,omitempty"`
	TargetName      string                      `json:"targetName,omitempty"`
	RefreshInterval string                      `json:"refreshInterval,omitempty"`
	RefreshPolicy   string                      `json:"refreshPolicy,omitempty"`
	RefreshTime     string                      `json:"refreshTime,omitempty"`
	CreationPolicy  string                      `json:"creationPolicy,omitempty"`
	DeletionPolicy  string                      `json:"deletionPolicy,omitempty"`
	Data            []DataMapping               `json:"data,omitempty"`
	DataFrom        []DataSource                `json:"dataFrom,omitempty"`
}
type DataMapping struct {
	SecretKey string    `json:"secretKey"`
	RemoteRef RemoteRef `json:"remoteRef"`
}
type RemoteRef struct {
	Key                string `json:"key"`
	Property           string `json:"property,omitempty"`
	Version            string `json:"version,omitempty"`
	ConversionStrategy string `json:"conversionStrategy,omitempty"`
	DecodingStrategy   string `json:"decodingStrategy,omitempty"`
}
type DataSource struct {
	Extract   *RemoteRef       `json:"extract,omitempty"`
	Find      *Find            `json:"find,omitempty"`
	SourceRef *GeneratorSource `json:"sourceRef,omitempty"`
}
type Find struct {
	Path string            `json:"path,omitempty"`
	Name *NamePattern      `json:"name,omitempty"`
	Tags map[string]string `json:"tags,omitempty"`
}
type NamePattern struct {
	Regexp string `json:"regexp,omitempty"`
}
type GeneratorSource struct {
	GeneratorRef *GeneratorRef `json:"generatorRef,omitempty"`
}
type GeneratorRef struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Name       string `json:"name,omitempty"`
}
type Store struct {
	Providers       []string             `json:"providers,omitempty"`
	Controller      string               `json:"controller,omitempty"`
	RefreshInterval *int64               `json:"refreshInterval,omitempty"`
	Capabilities    string               `json:"capabilities,omitempty"`
	RetrySettings   *RetrySettings       `json:"retrySettings,omitempty"`
	Conditions      []NamespaceCondition `json:"conditions,omitempty"`
}
type RetrySettings struct {
	MaxRetries    *int64 `json:"maxRetries,omitempty"`
	RetryInterval string `json:"retryInterval,omitempty"`
}
type NamespaceCondition struct {
	Namespaces        []string                `json:"namespaces,omitempty"`
	NamespaceSelector *crdfacts.LabelSelector `json:"namespaceSelector,omitempty"`
	NamespaceRegexes  []string                `json:"namespaceRegexes,omitempty"`
}
type ClusterExternalSecret struct {
	ExternalSecretName    string                   `json:"externalSecretName,omitempty"`
	RefreshTime           string                   `json:"refreshTime,omitempty"`
	NamespaceSelector     *crdfacts.LabelSelector  `json:"namespaceSelector,omitempty"`
	NamespaceSelectors    []crdfacts.LabelSelector `json:"namespaceSelectors,omitempty"`
	Namespaces            []string                 `json:"namespaces,omitempty"`
	ProvisionedNamespaces []string                 `json:"provisionedNamespaces,omitempty"`
	FailedNamespaces      []FailedNamespace        `json:"failedNamespaces,omitempty"`
	Template              *ExternalSecret          `json:"template,omitempty"`
}
type FailedNamespace struct {
	Namespace string `json:"namespace"`
	Reason    string `json:"reason,omitempty"`
}

func matches(object *unstructured.Unstructured) bool {
	return object != nil && resourcekind.FamilyForResource(object.GroupVersionKind().Group, object.GetKind(), object.GetNamespace() != "") == resourcekind.ExternalSecretsFamily
}

func BuildFacts(clusterID string, object *unstructured.Unstructured) *Facts {
	if !matches(object) {
		return nil
	}
	facts := &Facts{Conditions: crdfacts.Conditions(object)}
	switch strings.ToLower(object.GetKind()) {
	case "externalsecret":
		facts.ExternalSecret = externalSecret(clusterID, object, object.GetNamespace(), "spec")
		facts.ExternalSecret.RefreshTime = crdfacts.Text(object.Object, "status", "refreshTime")
	case "secretstore", "clustersecretstore":
		facts.Store = store(object)
	case "clusterexternalsecret":
		facts.ClusterExternalSecret = clusterSecret(clusterID, object)
	}
	return facts
}

func externalSecret(clusterID string, object *unstructured.Unstructured, namespace string, path ...string) *ExternalSecret {
	spec, _, _ := unstructured.NestedMap(object.Object, path...)
	facts := crdfacts.Read[ExternalSecret](map[string]any{"spec": spec}, "spec")
	if facts == nil {
		facts = &ExternalSecret{}
	}
	facts.TargetName = crdfacts.Text(spec, "target", "name")
	if facts.TargetName == "" {
		facts.TargetName = object.GetName()
	}
	facts.Target = crdfacts.Secret(clusterID, namespace, facts.TargetName)
	facts.CreationPolicy = crdfacts.Text(spec, "target", "creationPolicy")
	facts.DeletionPolicy = crdfacts.Text(spec, "target", "deletionPolicy")
	kind := crdfacts.Text(spec, "secretStoreRef", "kind")
	if kind == "" {
		kind = "SecretStore"
	}
	facts.StoreName, facts.StoreKind = crdfacts.Text(spec, "secretStoreRef", "name"), kind
	storeNamespace := namespace
	if kind == "ClusterSecretStore" {
		storeNamespace = ""
	}
	// A cluster template's namespaced store has no concrete namespace yet.
	if kind == "ClusterSecretStore" || storeNamespace != "" {
		facts.Store = crdfacts.Reference(clusterID, "external-secrets.io", kind, storeNamespace, crdfacts.Text(spec, "secretStoreRef", "name"))
	}
	return facts
}

func store(object *unstructured.Unstructured) *Store {
	facts := crdfacts.Read[Store](object.Object, "spec")
	if facts == nil {
		facts = &Store{}
	}
	facts.Providers = crdfacts.Keys(object.Object, "spec", "provider")
	facts.Capabilities = crdfacts.Text(object.Object, "status", "capabilities")
	return facts
}

func clusterSecret(clusterID string, object *unstructured.Unstructured) *ClusterExternalSecret {
	facts := crdfacts.Read[ClusterExternalSecret](object.Object, "spec")
	if facts == nil {
		facts = &ClusterExternalSecret{}
	}
	facts.ProvisionedNamespaces = crdfacts.Strings(object.Object, "status", "provisionedNamespaces")
	status := crdfacts.Read[ClusterExternalSecret](object.Object, "status")
	if status != nil {
		facts.FailedNamespaces = status.FailedNamespaces
	}
	facts.Template = externalSecret(clusterID, object, "", "spec", "externalSecretSpec")
	if facts.ExternalSecretName == "" {
		facts.ExternalSecretName = object.GetName()
	}
	if crdfacts.Text(object.Object, "spec", "externalSecretSpec", "target", "name") == "" {
		facts.Template.TargetName = facts.ExternalSecretName
	}
	return facts
}

func PrimaryStatus(object *unstructured.Unstructured) (state, label, presentation string, ok bool) {
	if !matches(object) {
		return "", "", "", false
	}
	state, label, presentation = crdfacts.Readiness(crdfacts.Conditions(object), "Ready")
	return state, label, presentation, true
}
