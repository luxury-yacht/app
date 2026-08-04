package sentryreporting

import "regexp"

// KubernetesAction is deliberately closed at the telemetry boundary. It
// describes the API operation without accepting a human-readable message.
type KubernetesAction string

const (
	KubernetesActionGet              KubernetesAction = "get"
	KubernetesActionList             KubernetesAction = "list"
	KubernetesActionWatch            KubernetesAction = "watch"
	KubernetesActionCreate           KubernetesAction = "create"
	KubernetesActionUpdate           KubernetesAction = "update"
	KubernetesActionPatch            KubernetesAction = "patch"
	KubernetesActionDelete           KubernetesAction = "delete"
	KubernetesActionDeleteCollection KubernetesAction = "deletecollection"
	KubernetesActionResolve          KubernetesAction = "resolve"
	KubernetesActionDiscover         KubernetesAction = "discover"
	KubernetesActionEvict            KubernetesAction = "evict"
	KubernetesActionDrain            KubernetesAction = "drain"
	KubernetesActionWildcard         KubernetesAction = "*"
)

// KubernetesScope records only whether an API resource is namespaced. It
// cannot carry the namespace itself.
type KubernetesScope string

const (
	KubernetesScopeNamespaced KubernetesScope = "namespaced"
	KubernetesScopeCluster    KubernetesScope = "cluster"
)

// KubernetesRequest contains structural Kubernetes API data only. There are
// intentionally no Namespace, Name, URL, message, or arbitrary-attribute
// fields in this contract.
type KubernetesRequest struct {
	Action      KubernetesAction
	Group       string
	Version     string
	Resource    string
	Subresource string
	Scope       KubernetesScope
}

type operationKind uint8

const (
	operationKindUnknown operationKind = iota
	operationKindKubernetesRequest
	operationKindKubernetesCapabilityBatch
)

// Operation is opaque outside this package so telemetry producers cannot add
// unreviewed fields. Constructors below are the only way to create one.
type Operation struct {
	kind         operationKind
	request      KubernetesRequest
	checks       []KubernetesRequest
	failureCount int
	totalCount   int
}

func NewKubernetesRequestOperation(request KubernetesRequest) Operation {
	return Operation{kind: operationKindKubernetesRequest, request: request}
}

// NewKubernetesCapabilityBatchOperation retains the failed permission shapes
// without retaining caller IDs, namespaces, or object names.
func NewKubernetesCapabilityBatchOperation(failureCount, totalCount int, checks []KubernetesRequest) Operation {
	return Operation{
		kind:         operationKindKubernetesCapabilityBatch,
		checks:       append([]KubernetesRequest(nil), checks...),
		failureCount: failureCount,
		totalCount:   totalCount,
	}
}

func (o Operation) isZero() bool {
	return o.kind == operationKindUnknown
}

var kubernetesStructuralValuePattern = regexp.MustCompile(`^[a-z0-9*](?:[a-z0-9*.-]{0,251}[a-z0-9*])?$`)

func validKubernetesAction(action KubernetesAction) bool {
	switch action {
	case KubernetesActionGet,
		KubernetesActionList,
		KubernetesActionWatch,
		KubernetesActionCreate,
		KubernetesActionUpdate,
		KubernetesActionPatch,
		KubernetesActionDelete,
		KubernetesActionDeleteCollection,
		KubernetesActionResolve,
		KubernetesActionDiscover,
		KubernetesActionEvict,
		KubernetesActionDrain,
		KubernetesActionWildcard:
		return true
	default:
		return false
	}
}

func validKubernetesScope(scope KubernetesScope) bool {
	return scope == KubernetesScopeNamespaced || scope == KubernetesScopeCluster
}

func validKubernetesStructuralValue(value string) bool {
	return value != "" && len(value) <= 253 && kubernetesStructuralValuePattern.MatchString(value)
}

func kubernetesRequestTelemetryContext(request KubernetesRequest) map[string]any {
	result := map[string]any{}
	if validKubernetesAction(request.Action) {
		result["action"] = string(request.Action)
	}
	if request.Group != "" && validKubernetesStructuralValue(request.Group) {
		result["group"] = request.Group
	}
	if validKubernetesStructuralValue(request.Version) {
		result["version"] = request.Version
	}
	if validKubernetesStructuralValue(request.Resource) {
		result["resource"] = request.Resource
	}
	if validKubernetesStructuralValue(request.Subresource) {
		result["subresource"] = request.Subresource
	}
	if validKubernetesScope(request.Scope) {
		result["scope"] = string(request.Scope)
	}
	return result
}

func (o Operation) telemetryContext() map[string]any {
	switch o.kind {
	case operationKindKubernetesRequest:
		result := kubernetesRequestTelemetryContext(o.request)
		result["type"] = "kubernetes.request"
		return result
	case operationKindKubernetesCapabilityBatch:
		result := map[string]any{"type": "kubernetes.capability_batch"}
		if o.failureCount > 0 {
			result["failure_count"] = o.failureCount
		}
		if o.totalCount > 0 {
			result["total_count"] = o.totalCount
		}
		checks := make([]map[string]any, 0, len(o.checks))
		for _, check := range o.checks {
			checks = append(checks, kubernetesRequestTelemetryContext(check))
		}
		if len(checks) > 0 {
			result["failed_checks"] = checks
		}
		return result
	default:
		return nil
	}
}

func operationTelemetryString(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}

// sanitizeOperationTelemetryContext revalidates the serialized map at the
// final privacy boundary. This keeps API group names useful for custom
// resources without exempting arbitrary strings that happen to use the same
// context key.
func sanitizeOperationTelemetryContext(value any) map[string]any {
	values, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	switch operationTelemetryString(values, "type") {
	case "kubernetes.request":
		return NewKubernetesRequestOperation(KubernetesRequest{
			Action:      KubernetesAction(operationTelemetryString(values, "action")),
			Group:       operationTelemetryString(values, "group"),
			Version:     operationTelemetryString(values, "version"),
			Resource:    operationTelemetryString(values, "resource"),
			Subresource: operationTelemetryString(values, "subresource"),
			Scope:       KubernetesScope(operationTelemetryString(values, "scope")),
		}).telemetryContext()
	case "kubernetes.capability_batch":
		result := map[string]any{"type": "kubernetes.capability_batch"}
		if failureCount, ok := values["failure_count"].(int); ok && failureCount > 0 {
			result["failure_count"] = failureCount
		}
		if totalCount, ok := values["total_count"].(int); ok && totalCount > 0 {
			result["total_count"] = totalCount
		}
		var rawChecks []map[string]any
		switch checks := values["failed_checks"].(type) {
		case []map[string]any:
			rawChecks = checks
		case []any:
			for _, check := range checks {
				if typed, ok := check.(map[string]any); ok {
					rawChecks = append(rawChecks, typed)
				}
			}
		}
		checks := make([]map[string]any, 0, len(rawChecks))
		for _, rawCheck := range rawChecks {
			checks = append(checks, kubernetesRequestTelemetryContext(KubernetesRequest{
				Action:      KubernetesAction(operationTelemetryString(rawCheck, "action")),
				Group:       operationTelemetryString(rawCheck, "group"),
				Version:     operationTelemetryString(rawCheck, "version"),
				Resource:    operationTelemetryString(rawCheck, "resource"),
				Subresource: operationTelemetryString(rawCheck, "subresource"),
				Scope:       KubernetesScope(operationTelemetryString(rawCheck, "scope")),
			}))
		}
		if len(checks) > 0 {
			result["failed_checks"] = checks
		}
		return result
	default:
		return nil
	}
}
