package prometheus

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/crdfacts"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type Facts struct {
	Conditions []crdfacts.Condition `json:"conditions,omitempty"`
	Monitor    *Monitor             `json:"monitor,omitempty"`
	RuleGroups []RuleGroup          `json:"ruleGroups,omitempty"`
	Instance   *Instance            `json:"instance,omitempty"`
}
type Monitor struct {
	Selector          crdfacts.LabelSelector `json:"selector"`
	NamespaceSelector NamespaceSelector      `json:"namespaceSelector"`
	Endpoints         []Endpoint             `json:"endpoints,omitempty"`
	JobLabel          string                 `json:"jobLabel,omitempty"`
	TargetLabels      []string               `json:"targetLabels,omitempty"`
	PodTargetLabels   []string               `json:"podTargetLabels,omitempty"`
	SampleLimit       *int64                 `json:"sampleLimit,omitempty"`
	TargetLimit       *int64                 `json:"targetLimit,omitempty"`
}
type NamespaceSelector struct {
	Any        bool     `json:"any"`
	MatchNames []string `json:"matchNames,omitempty"`
}
type Endpoint struct {
	Port            string `json:"port,omitempty"`
	TargetPort      string `json:"targetPort,omitempty"`
	PortNumber      *int64 `json:"portNumber,omitempty"`
	Path            string `json:"path,omitempty"`
	Scheme          string `json:"scheme,omitempty"`
	Interval        string `json:"interval,omitempty"`
	ScrapeTimeout   string `json:"scrapeTimeout,omitempty"`
	HonorLabels     *bool  `json:"honorLabels,omitempty"`
	HonorTimestamps *bool  `json:"honorTimestamps,omitempty"`
}
type RuleGroup struct {
	Name     string `json:"name"`
	Interval string `json:"interval,omitempty"`
	Limit    *int64 `json:"limit,omitempty"`
	Rules    []Rule `json:"rules,omitempty"`
}
type Rule struct {
	Alert         string            `json:"alert,omitempty"`
	Record        string            `json:"record,omitempty"`
	Expr          string            `json:"expr"`
	For           string            `json:"for,omitempty"`
	KeepFiringFor string            `json:"keepFiringFor,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
	Annotations   map[string]string `json:"annotations,omitempty"`
}
type Instance struct {
	Version                             string                  `json:"version,omitempty"`
	Replicas                            *int64                  `json:"replicas,omitempty"`
	Shards                              *int64                  `json:"shards,omitempty"`
	AvailableReplicas                   *int64                  `json:"availableReplicas,omitempty"`
	UpdatedReplicas                     *int64                  `json:"updatedReplicas,omitempty"`
	UnavailableReplicas                 *int64                  `json:"unavailableReplicas,omitempty"`
	Paused                              bool                    `json:"paused"`
	Retention                           string                  `json:"retention,omitempty"`
	RetentionSize                       string                  `json:"retentionSize,omitempty"`
	ScrapeInterval                      string                  `json:"scrapeInterval,omitempty"`
	EvaluationInterval                  string                  `json:"evaluationInterval,omitempty"`
	ExternalLabels                      map[string]string       `json:"externalLabels,omitempty"`
	ServiceMonitorSelector              *crdfacts.LabelSelector `json:"serviceMonitorSelector"`
	ServiceMonitorNamespaceSelector     *crdfacts.LabelSelector `json:"serviceMonitorNamespaceSelector"`
	PodMonitorSelector                  *crdfacts.LabelSelector `json:"podMonitorSelector"`
	PodMonitorNamespaceSelector         *crdfacts.LabelSelector `json:"podMonitorNamespaceSelector"`
	RuleSelector                        *crdfacts.LabelSelector `json:"ruleSelector"`
	RuleNamespaceSelector               *crdfacts.LabelSelector `json:"ruleNamespaceSelector"`
	AlertmanagerConfigSelector          *crdfacts.LabelSelector `json:"alertmanagerConfigSelector"`
	AlertmanagerConfigNamespaceSelector *crdfacts.LabelSelector `json:"alertmanagerConfigNamespaceSelector"`
	ConfigSecret                        string                  `json:"configSecret,omitempty"`
	StorageRequest                      string                  `json:"storageRequest,omitempty"`
}

func matches(object *unstructured.Unstructured) bool {
	return object != nil && resourcekind.FamilyForResource(object.GroupVersionKind().Group, object.GetKind(), object.GetNamespace() != "") == resourcekind.PrometheusFamily
}

func BuildFacts(_ string, object *unstructured.Unstructured) *Facts {
	if !matches(object) {
		return nil
	}
	facts := &Facts{Conditions: crdfacts.Conditions(object)}
	switch strings.ToLower(object.GetKind()) {
	case "servicemonitor", "podmonitor":
		facts.Monitor = monitor(object)
	case "prometheusrule":
		facts.RuleGroups = ruleGroups(object)
	case "prometheus", "alertmanager":
		facts.Instance = instance(object)
	}
	return facts
}

func monitor(object *unstructured.Unstructured) *Monitor {
	spec, _, _ := unstructured.NestedMap(object.Object, "spec")
	if spec == nil {
		spec = make(map[string]any)
	}
	endpointKey := "endpoints"
	if strings.EqualFold(object.GetKind(), "PodMonitor") {
		endpointKey = "podMetricsEndpoints"
	}
	endpoints, _, _ := unstructured.NestedSlice(spec, endpointKey)
	normalizeScalarField(endpoints, "targetPort")
	spec["endpoints"] = endpoints
	facts := crdfacts.Read[Monitor](map[string]any{"spec": spec}, "spec")
	if facts == nil {
		facts = &Monitor{}
	}
	return facts
}

func normalizeScalarField(records []any, field string) {
	for _, raw := range records {
		if record, ok := raw.(map[string]any); ok {
			if value, found := record[field]; found {
				record[field] = crdfacts.StringOrNumber(value)
			}
		}
	}
}

func ruleGroups(object *unstructured.Unstructured) []RuleGroup {
	groups, _, _ := unstructured.NestedSlice(object.Object, "spec", "groups")
	var result []RuleGroup
	for _, raw := range groups {
		group, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		rules, _, _ := unstructured.NestedSlice(group, "rules")
		normalizeScalarField(rules, "expr")
		group["rules"] = rules
		if facts := crdfacts.Read[RuleGroup](map[string]any{"group": group}, "group"); facts != nil {
			result = append(result, *facts)
		}
	}
	return result
}

func instance(object *unstructured.Unstructured) *Instance {
	facts := crdfacts.Read[Instance](object.Object, "spec")
	if facts == nil {
		facts = &Instance{}
	}
	facts.AvailableReplicas = crdfacts.Number(object.Object, "status", "availableReplicas")
	facts.UpdatedReplicas = crdfacts.Number(object.Object, "status", "updatedReplicas")
	facts.UnavailableReplicas = crdfacts.Number(object.Object, "status", "unavailableReplicas")
	facts.StorageRequest = crdfacts.Text(object.Object, "spec", "storage", "volumeClaimTemplate", "spec", "resources", "requests", "storage")
	return facts
}

func PrimaryStatus(object *unstructured.Unstructured) (state, label, presentation string, ok bool) {
	if !matches(object) {
		return "", "", "", false
	}
	if paused := crdfacts.Bool(object.Object, "spec", "paused"); paused != nil && *paused {
		return "paused", "Paused", "warning", true
	}
	conditions := crdfacts.Conditions(object)
	if reconciled := crdfacts.FindCondition(conditions, "Reconciled"); reconciled != nil && reconciled.Status == "False" && reconciled.Presentation != "progressing" {
		return "False", "Reconciliation Failed", "error", true
	}
	state, label, presentation = crdfacts.Readiness(conditions, "Available", "Ready", "Reconciled")
	return state, label, presentation, true
}
