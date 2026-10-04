package objectcatalog

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Attention's backend-only catalog subsets: objects blocked on finalizers and objects
// that report a status for Attention to classify.

// FinalizerBlockers returns a deterministic copy of the catalog objects that
// are both deleting and still carry a finalizer.
func (s *Service) FinalizerBlockers() []FinalizerBlocker {
	if s == nil {
		return nil
	}
	return s.finalizerBlockers.snapshot()
}

// SubscribeFinalizerBlockers registers a coalescing lifecycle subscriber and
// immediately sends the current revision.
func (s *Service) SubscribeFinalizerBlockers() (<-chan SubsetUpdate, func()) {
	return s.finalizerBlockers.subscribe()
}

// ReportedStatuses returns a deterministic copy of every catalog object that reports
// a status for Attention to classify, whatever that status currently is.
func (s *Service) ReportedStatuses() []ReportedStatus {
	if s == nil {
		return nil
	}
	return s.reportedStatuses.snapshot()
}

// SubscribeReportedStatuses registers a coalescing subscriber for reported statuses and
// immediately sends the current revision.
func (s *Service) SubscribeReportedStatuses() (<-chan SubsetUpdate, func()) {
	return s.reportedStatuses.subscribe()
}

func (b FinalizerBlocker) subsetRef() resourcemodel.ResourceRef { return b.Ref }

func (r ReportedStatus) subsetRef() resourcemodel.ResourceRef { return r.Ref }

// replaceAttentionSubsets and updateAttentionSubsets publish every Attention subset
// at the same catalog publication points, so they always describe the same rows.
func (s *Service) replaceAttentionSubsets(items map[string]Summary) {
	if s == nil {
		return
	}
	s.finalizerBlockers.replace(items, Summary.FinalizerBlocker)
	s.reportedStatuses.replace(items, Summary.ReportedStatus)
}

func (s *Service) updateAttentionSubsets(changes []catalogChange) {
	if s == nil {
		return
	}
	s.finalizerBlockers.update(changes, Summary.FinalizerBlocker)
	s.reportedStatuses.update(changes, Summary.ReportedStatus)
}
