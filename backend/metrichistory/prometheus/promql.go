// Package prometheus is the Metrics tab's Prometheus provider: PromQL for each graph and
// decoding of Prometheus HTTP API responses. The queries are the ones verified against
// kube-prometheus-stack in Phase 0 (testdata/kube-prometheus-stack).
package prometheus

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// QueryID names one PromQL query in a kind's query set.
type QueryID string

const (
	QueryPodCPUUsage    QueryID = "podCPUUsage"
	QueryPodMemoryUsage QueryID = "podMemoryUsage"
	QueryPodRequests    QueryID = "podRequests"
	QueryPodLimits      QueryID = "podLimits"
)

// Query is one PromQL expression to run over the response grid.
type Query struct {
	ID     QueryID
	PromQL string
}

var labelNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// Matcher is an equality label matcher added to every selector, e.g. cluster="prod-east" when
// one Prometheus serves several clusters. Build it with NewMatcher so the name is always valid.
type Matcher struct {
	name  string
	value string
}

// NewMatcher validates the label name against Prometheus' label-name syntax.
func NewMatcher(name, value string) (Matcher, error) {
	if !labelNamePattern.MatchString(name) {
		return Matcher{}, fmt.Errorf("invalid Prometheus label name %q", name)
	}
	return Matcher{name: name, value: value}, nil
}

func (m Matcher) String() string { return m.name + "=" + quote(m.value) }

// quote renders a PromQL double-quoted string literal, so object names and filter values can
// never close the selector.
func quote(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
	return `"` + replacer.Replace(value) + `"`
}

func podSelector(namespace, pod string, filters []Matcher, extra ...string) string {
	parts := []string{"namespace=" + quote(namespace), "pod=" + quote(pod)}
	for _, filter := range filters {
		parts = append(parts, filter.String())
	}
	parts = append(parts, extra...)
	return "{" + strings.Join(parts, ",") + "}"
}

// duration renders a Prometheus duration: whole minutes as "2m", anything else in seconds.
func duration(window time.Duration) string {
	if window%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(window/time.Minute))
	}
	return fmt.Sprintf("%ds", int(window/time.Second))
}

// PodQueries returns the queries behind a Pod's CPU and memory graphs. Usage is per container
// (the pause container and the pod-level cgroup carry no container label), and requests and
// limits come from kube-state-metrics, one series per resource.
func PodQueries(namespace, pod string, filters []Matcher, rateWindow time.Duration) []Query {
	containers := podSelector(namespace, pod, filters, `container!=""`)
	reservations := podSelector(namespace, pod, filters)
	return []Query{
		{
			ID:     QueryPodCPUUsage,
			PromQL: fmt.Sprintf("sum by (container) (rate(container_cpu_usage_seconds_total%s[%s]))", containers, duration(rateWindow)),
		},
		{
			ID:     QueryPodMemoryUsage,
			PromQL: fmt.Sprintf("sum by (container) (container_memory_working_set_bytes%s)", containers),
		},
		{
			ID:     QueryPodRequests,
			PromQL: fmt.Sprintf("sum by (resource) (kube_pod_container_resource_requests%s)", reservations),
		},
		{
			ID:     QueryPodLimits,
			PromQL: fmt.Sprintf("sum by (resource) (kube_pod_container_resource_limits%s)", reservations),
		},
	}
}
