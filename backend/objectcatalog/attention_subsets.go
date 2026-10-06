package objectcatalog

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Attention's backend-only catalog subsets: objects blocked on finalizers and objects
// that report a status for Attention to classify.

// FinalizerBlockers returns a deterministic copy of the catalog objects that
// are both deleting and still carry a finalizer.
func (s *Service) FinalizerBlockers() []FinalizerBlocker {
	return s.finalizerBlockers.snapshot()
}

// SubscribeFinalizerBlockers registers a coalescing lifecycle subscriber. It is first
// notified with the catalog's first full sync, or at once when that has happened.
func (s *Service) SubscribeFinalizerBlockers() (<-chan SubsetUpdate, func()) {
	return s.finalizerBlockers.subscribe()
}

// ReportedStatuses returns a deterministic copy of every catalog object that reports
// a status for Attention to classify, whatever that status currently is.
func (s *Service) ReportedStatuses() []ReportedStatus {
	return s.reportedStatuses.snapshot()
}

// SubscribeReportedStatuses registers a coalescing subscriber for reported statuses. It is
// first notified with the catalog's first full sync, or at once when that has happened.
func (s *Service) SubscribeReportedStatuses() (<-chan SubsetUpdate, func()) {
	return s.reportedStatuses.subscribe()
}

func (b FinalizerBlocker) objectRef() resourcemodel.ResourceRef { return b.Ref }

func (r ReportedStatus) objectRef() resourcemodel.ResourceRef { return r.Ref }

// replaceAttentionSubsets and updateAttentionSubsets publish every Attention subset
// at the same catalog publication points, so they always describe the same rows.
func (s *Service) replaceAttentionSubsets(items map[string]Summary) {
	s.finalizerBlockers.replace(items, Summary.FinalizerBlocker)
	s.reportedStatuses.replace(items, Summary.ReportedStatus)
}

func (s *Service) updateAttentionSubsets(changes []catalogChange) {
	s.finalizerBlockers.update(changes, Summary.FinalizerBlocker)
	s.reportedStatuses.update(changes, Summary.ReportedStatus)
}

// publishSyncedAttentionSubsets publishes the subsets from a completed full sync. The
// first one starts publication: earlier views are partial and stay unpublished.
func (s *Service) publishSyncedAttentionSubsets(items map[string]Summary) {
	s.replaceAttentionSubsets(items)
	s.finalizerBlockers.markSynced()
	s.reportedStatuses.markSynced()
}
