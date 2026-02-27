package backend

import (
	"sort"
	"sync"
	"time"
)

const selectionDiagnosticsSampleLimit = 256

type selectionDiagnosticsState struct {
	mu sync.Mutex

	pending    int
	maxPending int

	total      uint64
	completed  uint64
	failed     uint64
	canceled   uint64
	superseded uint64

	lastUpdatedMs int64
	lastReason    string
	lastError     string
	lastQueueMs   int64
	lastTotalMs   int64

	samples []selectionMutationSample
}

type selectionMutationSample struct {
	queueMs      int64
	totalMs      int64
	intentMs     int64
	commitMs     int64
	clientSyncMs int64
	refreshMs    int64
	catalogMs    int64

	reason     string
	errorText  string
	failed     bool
	canceled   bool
	superseded bool
}

// SelectionDiagnostics summarizes cluster selection mutation performance.
type SelectionDiagnostics struct {
	ActiveQueueDepth int `json:"activeQueueDepth"`
	MaxQueueDepth    int `json:"maxQueueDepth"`
	SampleCount      int `json:"sampleCount"`

	TotalMutations      uint64 `json:"totalMutations"`
	CompletedMutations  uint64 `json:"completedMutations"`
	FailedMutations     uint64 `json:"failedMutations"`
	CanceledMutations   uint64 `json:"canceledMutations"`
	SupersededMutations uint64 `json:"supersededMutations"`

	LastUpdatedMs int64  `json:"lastUpdatedMs,omitempty"`
	LastReason    string `json:"lastReason,omitempty"`
	LastError     string `json:"lastError,omitempty"`
	LastQueueMs   int64  `json:"lastQueueMs,omitempty"`
	LastTotalMs   int64  `json:"lastTotalMs,omitempty"`

	QueueP50Ms int64 `json:"queueP50Ms,omitempty"`
	QueueP95Ms int64 `json:"queueP95Ms,omitempty"`
	TotalP50Ms int64 `json:"totalP50Ms,omitempty"`
	TotalP95Ms int64 `json:"totalP95Ms,omitempty"`

	IntentP50Ms int64 `json:"intentP50Ms,omitempty"`
	IntentP95Ms int64 `json:"intentP95Ms,omitempty"`
	CommitP50Ms int64 `json:"commitP50Ms,omitempty"`
	CommitP95Ms int64 `json:"commitP95Ms,omitempty"`

	ClientSyncP50Ms int64 `json:"clientSyncP50Ms,omitempty"`
	ClientSyncP95Ms int64 `json:"clientSyncP95Ms,omitempty"`
	RefreshP50Ms    int64 `json:"refreshP50Ms,omitempty"`
	RefreshP95Ms    int64 `json:"refreshP95Ms,omitempty"`
	CatalogP50Ms    int64 `json:"catalogP50Ms,omitempty"`
	CatalogP95Ms    int64 `json:"catalogP95Ms,omitempty"`
}

func (a *App) selectionDiagnosticsEnqueue() {
	if a == nil {
		return
	}
	s := &a.selectionDiag
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total++
	s.pending++
	if s.pending > s.maxPending {
		s.maxPending = s.pending
	}
}

func (a *App) selectionDiagnosticsFinalize(sample selectionMutationSample) {
	if a == nil {
		return
	}
	s := &a.selectionDiag
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.pending > 0 {
		s.pending--
	}

	switch {
	case sample.superseded:
		s.superseded++
	case sample.canceled:
		s.canceled++
	case sample.failed:
		s.failed++
	default:
		s.completed++
	}

	s.lastUpdatedMs = time.Now().UnixMilli()
	s.lastReason = sample.reason
	s.lastQueueMs = sample.queueMs
	s.lastTotalMs = sample.totalMs
	if sample.failed {
		if sample.errorText != "" {
			s.lastError = sample.errorText
		} else {
			s.lastError = sample.reason
		}
	} else {
		s.lastError = ""
	}

	s.samples = append(s.samples, sample)
	if len(s.samples) > selectionDiagnosticsSampleLimit {
		s.samples = append([]selectionMutationSample(nil), s.samples[len(s.samples)-selectionDiagnosticsSampleLimit:]...)
	}
}

// GetSelectionDiagnostics returns rolling selection mutation timing and outcome stats.
func (a *App) GetSelectionDiagnostics() (*SelectionDiagnostics, error) {
	diag := &SelectionDiagnostics{}
	if a == nil {
		return diag, nil
	}

	s := &a.selectionDiag
	s.mu.Lock()
	pending := s.pending
	maxPending := s.maxPending
	total := s.total
	completed := s.completed
	failed := s.failed
	canceled := s.canceled
	superseded := s.superseded
	lastUpdatedMs := s.lastUpdatedMs
	lastReason := s.lastReason
	lastError := s.lastError
	lastQueueMs := s.lastQueueMs
	lastTotalMs := s.lastTotalMs
	samples := append([]selectionMutationSample(nil), s.samples...)
	s.mu.Unlock()

	diag.ActiveQueueDepth = pending
	diag.MaxQueueDepth = maxPending
	diag.SampleCount = len(samples)
	diag.TotalMutations = total
	diag.CompletedMutations = completed
	diag.FailedMutations = failed
	diag.CanceledMutations = canceled
	diag.SupersededMutations = superseded
	diag.LastUpdatedMs = lastUpdatedMs
	diag.LastReason = lastReason
	diag.LastError = lastError
	diag.LastQueueMs = lastQueueMs
	diag.LastTotalMs = lastTotalMs

	queueVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.queueMs })
	totalVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.totalMs })
	intentVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.intentMs })
	commitVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.commitMs })
	clientVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.clientSyncMs })
	refreshVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.refreshMs })
	catalogVals := collectMs(samples, func(s selectionMutationSample) int64 { return s.catalogMs })

	diag.QueueP50Ms, diag.QueueP95Ms = percentilePair(queueVals)
	diag.TotalP50Ms, diag.TotalP95Ms = percentilePair(totalVals)
	diag.IntentP50Ms, diag.IntentP95Ms = percentilePair(intentVals)
	diag.CommitP50Ms, diag.CommitP95Ms = percentilePair(commitVals)
	diag.ClientSyncP50Ms, diag.ClientSyncP95Ms = percentilePair(clientVals)
	diag.RefreshP50Ms, diag.RefreshP95Ms = percentilePair(refreshVals)
	diag.CatalogP50Ms, diag.CatalogP95Ms = percentilePair(catalogVals)

	return diag, nil
}

func collectMs(samples []selectionMutationSample, pick func(selectionMutationSample) int64) []int64 {
	values := make([]int64, 0, len(samples))
	for _, sample := range samples {
		value := pick(sample)
		if value <= 0 {
			continue
		}
		values = append(values, value)
	}
	return values
}

func percentilePair(values []int64) (int64, int64) {
	if len(values) == 0 {
		return 0, 0
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	return percentile(sorted, 50), percentile(sorted, 95)
}

func percentile(sorted []int64, p int) int64 {
	if len(sorted) == 0 {
		return 0
	}
	if p <= 0 {
		return sorted[0]
	}
	if p >= 100 {
		return sorted[len(sorted)-1]
	}
	idx := (p * (len(sorted) - 1)) / 100
	return sorted[idx]
}
