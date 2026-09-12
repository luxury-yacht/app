package argocd

import (
	"context"
	"encoding/base64"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
)

const clusterSecretSelector = "argocd.argoproj.io/secret-type=cluster"

// DestinationResolver belongs to one cluster and one hydration/detail request.
// Only names and servers survive a Secret read; credentials are never projected.
type DestinationResolver struct {
	clusterID  string
	client     dynamic.Interface
	mu         sync.Mutex
	namespaces map[string]*destinationNames
}

type destinationNames struct {
	once     sync.Once
	byServer map[string]string
}

func NewDestinationResolver(clusterID string, client dynamic.Interface) *DestinationResolver {
	return &DestinationResolver{clusterID: clusterID, client: client, namespaces: make(map[string]*destinationNames)}
}

func (d Destination) DisplayName() string {
	if d.Name != "" {
		return d.Name
	}
	if d.ResolvedName != "" {
		return d.ResolvedName
	}
	return d.Server
}

// TableDestination enriches only the destination shown by Application and
// ApplicationSet rows. AppProject destinations remain in its policy overview.
func (r *DestinationResolver) TableDestination(ctx context.Context, object *unstructured.Unstructured) string {
	var destination *Destination
	switch strings.ToLower(object.GetKind()) {
	case "application":
		destination = read[Destination](object.Object, "spec", "destination")
	case "applicationset":
		destination = read[Destination](object.Object, "spec", "template", "spec", "destination")
	}
	if destination == nil {
		return ""
	}
	r.resolve(ctx, controllerNamespace(object), destination)
	return destination.DisplayName()
}

func (r *DestinationResolver) EnrichFacts(ctx context.Context, object *unstructured.Unstructured, facts *Facts) {
	if facts == nil {
		return
	}
	namespace := controllerNamespace(object)
	if facts.Application != nil {
		r.resolve(ctx, namespace, &facts.Application.Spec.Destination)
	}
	if facts.ApplicationSet != nil {
		r.resolve(ctx, namespace, &facts.ApplicationSet.Template.Destination)
	}
	if facts.Project != nil {
		for i := range facts.Project.Destinations {
			r.resolve(ctx, namespace, &facts.Project.Destinations[i])
		}
	}
}

func controllerNamespace(object *unstructured.Unstructured) string {
	if namespace := text(object.Object, "status", "controllerNamespace"); namespace != "" {
		return namespace
	}
	// Same-namespace installations (including older Argo CD versions) need no
	// controllerNamespace status field. Never search other installations.
	return object.GetNamespace()
}

func (r *DestinationResolver) resolve(ctx context.Context, namespace string, destination *Destination) {
	if destination.Name != "" || destination.Server == "" || strings.ContainsAny(destination.Server, "*?{}[]!") {
		return
	}
	if r.clusterID == "" || r.client == nil || namespace == "" || ctx.Err() != nil {
		return
	}
	names := r.namesForNamespace(namespace)
	names.once.Do(func() { names.byServer = r.readNames(ctx, namespace) })
	destination.ResolvedName = names.byServer[strings.TrimRight(destination.Server, "/")]
}

func (r *DestinationResolver) namesForNamespace(namespace string) *destinationNames {
	r.mu.Lock()
	defer r.mu.Unlock()
	if names := r.namespaces[namespace]; names != nil {
		return names
	}
	names := &destinationNames{}
	r.namespaces[namespace] = names
	return names
}

func (r *DestinationResolver) readNames(ctx context.Context, namespace string) map[string]string {
	// Optional display enrichment must not hold up the resource request when
	// Secret access is unavailable. Failed reads are shared for this request too.
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	secrets, err := r.client.Resource(corev1.SchemeGroupVersion.WithResource("secrets")).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: clusterSecretSelector})
	if err != nil {
		return nil
	}
	names := make(map[string]string)
	for i := range secrets.Items {
		server := strings.TrimRight(secretText(&secrets.Items[i], "server"), "/")
		name := secretText(&secrets.Items[i], "name")
		if server == "" || name == "" {
			continue
		}
		if previous, exists := names[server]; exists && previous != name {
			name = "" // Conflicting registrations must not pick an arbitrary name.
		}
		names[server] = name
	}
	// Argo CD provides this registration implicitly unless a Secret overrides it.
	const localServer = "https://kubernetes.default.svc"
	if _, registered := names[localServer]; !registered {
		names[localServer] = "in-cluster"
	}
	return names
}

func secretText(secret *unstructured.Unstructured, key string) string {
	decoded, err := base64.StdEncoding.DecodeString(text(secret.Object, "data", key))
	if err != nil {
		return ""
	}
	return string(decoded)
}
