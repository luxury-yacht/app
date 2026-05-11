package backend

import (
	"net/http"
	"sort"
	"sync"
	"time"
)

const kubernetesAPIMetricsWindowSeconds = 60

// KubernetesAPIClientDiagnostics reports per-cluster Kubernetes API client usage.
type KubernetesAPIClientDiagnostics struct {
	ClusterID       string  `json:"clusterId"`
	ClusterName     string  `json:"clusterName"`
	ConfiguredQPS   int     `json:"configuredQPS"`
	ConfiguredBurst int     `json:"configuredBurst"`
	QPS1s           float64 `json:"qps1s"`
	QPS10s          float64 `json:"qps10s"`
	QPS60s          float64 `json:"qps60s"`
	PeakQPS1s       int     `json:"peakQPS1s"`
	TotalRequests   int64   `json:"totalRequests"`
	Status2xx       int64   `json:"status2xx"`
	Status3xx       int64   `json:"status3xx"`
	Status4xx       int64   `json:"status4xx"`
	Status5xx       int64   `json:"status5xx"`
	Status429       int64   `json:"status429"`
	Errors          int64   `json:"errors"`
	LastRequestMs   int64   `json:"lastRequestMs,omitempty"`
}

type kubernetesAPIMetricsRegistry struct {
	mu       sync.Mutex
	clusters map[string]*kubernetesAPIMetrics
}

type kubernetesAPIMetrics struct {
	mu              sync.Mutex
	clusterID       string
	clusterName     string
	configuredQPS   int
	configuredBurst int
	buckets         [kubernetesAPIMetricsWindowSeconds]kubernetesAPIMetricsBucket
	peakQPS1s       int64
	totalRequests   int64
	status2xx       int64
	status3xx       int64
	status4xx       int64
	status5xx       int64
	status429       int64
	errors          int64
	lastRequestMs   int64
}

type kubernetesAPIMetricsBucket struct {
	second int64
	count  int64
}

type kubernetesAPIMetricsTransport struct {
	base    http.RoundTripper
	metrics *kubernetesAPIMetrics
}

func newKubernetesAPIMetricsRegistry() *kubernetesAPIMetricsRegistry {
	return &kubernetesAPIMetricsRegistry{clusters: make(map[string]*kubernetesAPIMetrics)}
}

func (r *kubernetesAPIMetricsRegistry) getOrCreate(meta ClusterMeta, qps int, burst int) *kubernetesAPIMetrics {
	if r == nil || meta.ID == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.clusters == nil {
		r.clusters = make(map[string]*kubernetesAPIMetrics)
	}
	metrics := r.clusters[meta.ID]
	if metrics == nil {
		metrics = &kubernetesAPIMetrics{clusterID: meta.ID}
		r.clusters[meta.ID] = metrics
	}
	metrics.mu.Lock()
	defer metrics.mu.Unlock()
	metrics.clusterName = meta.Name
	metrics.configuredQPS = qps
	metrics.configuredBurst = burst
	return metrics
}

func (r *kubernetesAPIMetricsRegistry) remove(clusterID string) {
	if r == nil || clusterID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clusters, clusterID)
}

func (r *kubernetesAPIMetricsRegistry) snapshot(now time.Time) []KubernetesAPIClientDiagnostics {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	rows := make([]KubernetesAPIClientDiagnostics, 0, len(r.clusters))
	for _, metrics := range r.clusters {
		rows = append(rows, metrics.snapshot(now))
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].ClusterName == rows[j].ClusterName {
			return rows[i].ClusterID < rows[j].ClusterID
		}
		return rows[i].ClusterName < rows[j].ClusterName
	})
	return rows
}

func (m *kubernetesAPIMetrics) snapshot(now time.Time) KubernetesAPIClientDiagnostics {
	m.mu.Lock()
	defer m.mu.Unlock()
	nowSecond := now.Unix()
	return KubernetesAPIClientDiagnostics{
		ClusterID:       m.clusterID,
		ClusterName:     m.clusterName,
		ConfiguredQPS:   m.configuredQPS,
		ConfiguredBurst: m.configuredBurst,
		QPS1s:           float64(m.countWindowLocked(nowSecond, 1)),
		QPS10s:          float64(m.countWindowLocked(nowSecond, 10)) / 10,
		QPS60s:          float64(m.countWindowLocked(nowSecond, 60)) / 60,
		PeakQPS1s:       int(m.peakQPS1s),
		TotalRequests:   m.totalRequests,
		Status2xx:       m.status2xx,
		Status3xx:       m.status3xx,
		Status4xx:       m.status4xx,
		Status5xx:       m.status5xx,
		Status429:       m.status429,
		Errors:          m.errors,
		LastRequestMs:   m.lastRequestMs,
	}
}

func (m *kubernetesAPIMetrics) countWindowLocked(nowSecond int64, seconds int64) int64 {
	var total int64
	oldest := nowSecond - seconds + 1
	for _, bucket := range m.buckets {
		if bucket.second >= oldest && bucket.second <= nowSecond {
			total += bucket.count
		}
	}
	return total
}

func (m *kubernetesAPIMetrics) record(statusCode int, requestTime time.Time) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	second := requestTime.Unix()
	index := second % kubernetesAPIMetricsWindowSeconds
	if index < 0 {
		index += kubernetesAPIMetricsWindowSeconds
	}
	bucket := &m.buckets[index]
	if bucket.second != second {
		bucket.second = second
		bucket.count = 0
	}
	bucket.count++
	if bucket.count > m.peakQPS1s {
		m.peakQPS1s = bucket.count
	}
	m.totalRequests++
	m.lastRequestMs = requestTime.UnixMilli()
	switch {
	case statusCode == http.StatusTooManyRequests:
		m.status429++
		m.status4xx++
	case statusCode >= 200 && statusCode < 300:
		m.status2xx++
	case statusCode >= 300 && statusCode < 400:
		m.status3xx++
	case statusCode >= 400 && statusCode < 500:
		m.status4xx++
	case statusCode >= 500 && statusCode < 600:
		m.status5xx++
	case statusCode == 0:
		m.errors++
	}
}

func (t *kubernetesAPIMetricsTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	resp, err := base.RoundTrip(req)
	statusCode := 0
	if resp != nil {
		statusCode = resp.StatusCode
	}
	if t.metrics != nil {
		t.metrics.record(statusCode, time.Now())
	}
	return resp, err
}

func (a *App) ensureKubernetesAPIMetricsRegistry() *kubernetesAPIMetricsRegistry {
	if a == nil {
		return nil
	}
	if a.kubeAPIMetrics != nil {
		return a.kubeAPIMetrics
	}
	a.kubeAPIMetrics = newKubernetesAPIMetricsRegistry()
	return a.kubeAPIMetrics
}

// GetKubernetesAPIClientDiagnostics returns per-cluster Kubernetes API client usage.
func (a *App) GetKubernetesAPIClientDiagnostics() ([]KubernetesAPIClientDiagnostics, error) {
	if a == nil {
		return nil, nil
	}
	registry := a.ensureKubernetesAPIMetricsRegistry()
	return registry.snapshot(time.Now()), nil
}
