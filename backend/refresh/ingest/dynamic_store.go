package ingest

import "k8s.io/client-go/tools/cache"

// Dynamic notifications run after the partition write and readiness marker.
// A catalog callback can therefore reread the source without a store-lock cycle,
// including an empty initial LIST that produced no per-object sink callbacks.
type dynamicStore struct {
	cache.Store
	changed func(interface{}, bool)
}

func (s dynamicStore) Add(obj interface{}) error    { return s.afterUpsert(obj, s.Store.Add(obj)) }
func (s dynamicStore) Update(obj interface{}) error { return s.afterUpsert(obj, s.Store.Update(obj)) }
func (s dynamicStore) afterUpsert(obj interface{}, err error) error {
	if err != nil {
		return err
	}
	row, exists, err := s.Store.Get(obj)
	if err == nil && exists {
		s.changed(catalogHalf(row), false)
	}
	return err
}
func (s dynamicStore) Delete(obj interface{}) error {
	row, exists, err := s.Store.Get(obj)
	if err != nil {
		return err
	}
	if err := s.Store.Delete(obj); err != nil {
		return err
	}
	if exists {
		s.changed(catalogHalf(row), true)
	}
	return nil
}
func (s dynamicStore) Replace(rows []interface{}, rv string) error {
	if err := s.Store.Replace(rows, rv); err != nil {
		return err
	}
	s.changed(nil, false)
	return nil
}

func (s *ProjectingStore) catalogPartitionSnapshot() ([]interface{}, []string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ready := make([]string, 0, len(s.expectedPartitions))
	for _, namespace := range s.expectedPartitions {
		if _, ok := s.syncedPartitions[namespace]; ok {
			ready = append(ready, namespace)
		}
	}
	rows := make([]interface{}, 0, len(s.rows))
	for _, row := range s.rows {
		if value := catalogHalf(row); value != nil {
			rows = append(rows, value)
		}
	}
	return rows, ready
}
