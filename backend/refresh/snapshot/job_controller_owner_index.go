package snapshot

import (
	"sync"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// JobControllerOwnerIndex is a cluster-scoped, concurrency-safe lookup of a
// Job's controlling CronJob. It is fed from Job bundle delivery and lets Pod
// projection resolve Job ownership without reading the Job ProjectingStore
// while the Pod ProjectingStore is locked.
type JobControllerOwnerIndex struct {
	mu     sync.RWMutex
	owners map[string]JobControllerOwner
}

func NewJobControllerOwnerIndex() *JobControllerOwnerIndex {
	return &JobControllerOwnerIndex{owners: make(map[string]JobControllerOwner)}
}

func jobControllerOwnerKey(namespace, jobName string) string {
	return namespace + "\x00" + jobName
}

func (i *JobControllerOwnerIndex) Lookup(namespace, jobName string) (JobControllerOwner, bool) {
	if i == nil {
		return JobControllerOwner{}, false
	}
	i.mu.RLock()
	owner, ok := i.owners[jobControllerOwnerKey(namespace, jobName)]
	i.mu.RUnlock()
	return owner, ok
}

func (i *JobControllerOwnerIndex) UpsertBundle(bundle ingest.Bundle) {
	if i == nil {
		return
	}
	owner, ok := bundle.Aggregate.(JobControllerOwner)
	if !ok || owner.Job.Namespace == "" || owner.Job.Name == "" {
		return
	}
	key := jobControllerOwnerKey(owner.Job.Namespace, owner.Job.Name)
	i.mu.Lock()
	if owner.Controller.Kind == "" || owner.Controller.Name == "" {
		delete(i.owners, key)
	} else {
		i.owners[key] = owner
	}
	i.mu.Unlock()
}

func (i *JobControllerOwnerIndex) DeleteBundle(bundle ingest.Bundle) {
	if i == nil {
		return
	}
	owner, ok := bundle.Aggregate.(JobControllerOwner)
	if !ok || owner.Job.Namespace == "" || owner.Job.Name == "" {
		return
	}
	i.mu.Lock()
	delete(i.owners, jobControllerOwnerKey(owner.Job.Namespace, owner.Job.Name))
	i.mu.Unlock()
}

func (i *JobControllerOwnerIndex) ReplaceBundles(bundles []ingest.Bundle) {
	if i == nil {
		return
	}
	next := make(map[string]JobControllerOwner, len(bundles))
	for _, bundle := range bundles {
		owner, ok := bundle.Aggregate.(JobControllerOwner)
		if !ok || owner.Job.Namespace == "" || owner.Job.Name == "" || owner.Controller.Kind == "" || owner.Controller.Name == "" {
			continue
		}
		next[jobControllerOwnerKey(owner.Job.Namespace, owner.Job.Name)] = owner
	}
	i.mu.Lock()
	i.owners = next
	i.mu.Unlock()
}

var _ ingest.BundleSink = (*JobControllerOwnerIndex)(nil)
var _ ingest.BundleReplaceSink = (*JobControllerOwnerIndex)(nil)
