/*
 * backend/objectcatalog/collect.go
 *
 * Catalog collection and informer integration.
 */

package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	kruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicinformer "k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"
)

var errInformerNotSynced = errors.New("catalog informer cache not yet synced")

func (s *Service) collectResource(ctx context.Context, index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, error) {
	if summaries, handled, err := s.collectViaSharedInformer(index, desc, namespaces, agg); handled {
		return summaries, err
	}
	if promoted := s.getPromotedDescriptor(desc.GVR.String()); promoted != nil {
		if summaries, err := s.collectFromInformer(index, desc, promoted, agg); err == nil {
			return summaries, nil
		} else if !errors.Is(err, errInformerNotSynced) {
			s.logWarn(fmt.Sprintf("catalog informer for %s unavailable (%v); falling back to list", desc.GVR.String(), err))
		}
	}

	summaries, err := s.listResource(ctx, index, desc, namespaces, agg)
	if err != nil {
		return nil, err
	}
	s.maybePromote(ctx, desc, len(summaries))
	return summaries, nil
}

func (s *Service) collectViaSharedInformer(index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	factory := s.deps.InformerFactory
	if factory == nil {
		return emitSummaries(index, agg, nil, nil, false)
	}

	gr := desc.GVR.GroupResource()
	if gr == (schema.GroupResource{Group: "", Resource: "endpoints"}) {
		if agg != nil {
			agg.complete(index)
		}
		return nil, true, nil
	}

	// Check permissions before accessing shared informer listers to avoid triggering
	// lazy informer creation for resources the user cannot list/watch.
	if s.deps.PermissionChecker != nil && !s.deps.PermissionChecker.CanListWatch(gr.Group, gr.Resource) {
		// No permission - fall back to listResource which handles 403 gracefully
		return emitSummaries(index, agg, nil, nil, false)
	}

	if gr == (schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}) {
		if s.deps.APIExtensionsInformerFactory == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		lister := s.deps.APIExtensionsInformerFactory.Apiextensions().V1().CustomResourceDefinitions().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	}

	builder, ok := sharedInformerListers[gr]
	if !ok {
		return emitSummaries(index, agg, nil, nil, false)
	}
	listFn := builder(factory)
	if listFn == nil {
		return emitSummaries(index, agg, nil, nil, false)
	}
	summaries, err := s.collectFromNamespacedLister(desc, namespaces, listFn)
	return emitSummaries(index, agg, summaries, err, true)
}

func (s *Service) collectFromNamespacedLister(desc resourceDescriptor, namespaces []string, list func(namespace string) ([]metav1.Object, error)) ([]Summary, error) {
	targets := listTargets(desc, namespaces)
	summaries := make([]Summary, 0)
	for _, ns := range targets {
		objects, err := list(ns)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, s.summariesFromObjects(desc, objects)...)
	}
	return summaries, nil
}

func (s *Service) summariesFromObjects(desc resourceDescriptor, objs []metav1.Object) []Summary {
	if len(objs) == 0 {
		return nil
	}
	result := make([]Summary, 0, len(objs))
	for _, obj := range objs {
		if obj == nil {
			continue
		}
		result = append(result, s.buildSummary(desc, obj))
	}
	return result
}

func (s *Service) listResource(ctx context.Context, index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, error) {
	dynamicClient := s.deps.Common.DynamicClient
	if dynamicClient == nil {
		return nil, errors.New("dynamic client not available")
	}

	namespaceable := dynamicClient.Resource(desc.GVR)
	var targets []string
	if desc.Namespaced && len(namespaces) > 0 {
		targets = uniqueNamespaces(namespaces)
		if len(targets) == 0 {
			if agg != nil {
				agg.complete(index)
			}
			return nil, nil
		}
	} else if desc.Namespaced {
		targets = []string{metav1.NamespaceAll}
	} else {
		targets = []string{""}
	}

	if len(targets) == 0 {
		if agg != nil {
			agg.complete(index)
		}
		return nil, nil
	}

	if desc.Namespaced && len(targets) > 1 && s.namespaceWorkerLimit(len(targets)) > 1 {
		return s.listResourceNamespacedParallel(ctx, index, namespaceable, desc, targets, agg)
	}

	return s.listResourceSequential(ctx, index, namespaceable, desc, targets, agg)
}

func (s *Service) listResourceSequential(ctx context.Context, index int, namespaceable dynamic.NamespaceableResourceInterface, desc resourceDescriptor, targets []string, agg *streamingAggregator) ([]Summary, error) {
	results := make([]Summary, 0)
	for _, target := range targets {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		resourceInterface := resourceInterfaceForTarget(namespaceable, desc.Namespaced, target)
		items, err := s.listNamespaceItems(ctx, index, desc, resourceInterface, agg)
		if err != nil {
			return nil, err
		}
		if len(items) > 0 {
			results = append(results, items...)
		}
	}
	if len(results) == 0 && agg != nil {
		agg.complete(index)
	}
	return results, nil
}

func (s *Service) listResourceNamespacedParallel(ctx context.Context, index int, namespaceable dynamic.NamespaceableResourceInterface, desc resourceDescriptor, targets []string, agg *streamingAggregator) ([]Summary, error) {
	results := make([]Summary, 0)
	var mu sync.Mutex
	limit := s.namespaceWorkerLimit(len(targets))
	err := parallel.ForEach(ctx, targets, limit, func(taskCtx context.Context, target string) error {
		resourceInterface := resourceInterfaceForTarget(namespaceable, true, target)
		items, err := s.listNamespaceItems(taskCtx, index, desc, resourceInterface, agg)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		mu.Lock()
		results = append(results, items...)
		mu.Unlock()
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(results) == 0 && agg != nil {
		agg.complete(index)
	}
	return results, nil
}

func (s *Service) listNamespaceItems(ctx context.Context, index int, desc resourceDescriptor, resourceInterface dynamic.ResourceInterface, agg *streamingAggregator) ([]Summary, error) {
	batchSize := s.opts.PageSize
	if s.opts.StreamingBatchSize > 0 && s.opts.StreamingBatchSize < batchSize {
		batchSize = s.opts.StreamingBatchSize
	}
	options := metav1.ListOptions{Limit: int64(batchSize)}
	results := make([]Summary, 0)
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		var list *unstructuredv1.UnstructuredList
		var err error
		for attempt := 0; attempt < listRetryMaxAttempts; attempt++ {
			list, err = resourceInterface.List(ctx, options)
			if err == nil {
				break
			}
			if apierrors.IsForbidden(err) {
				s.logDebug(fmt.Sprintf("permission denied listing %s, skipping", desc.GVR.String()))
				return results, nil
			}
			if !shouldRetryList(err) || attempt == listRetryMaxAttempts-1 {
				return nil, err
			}
			delay := listRetryBackoff(attempt)
			s.logDebug(fmt.Sprintf("retrying list for %s after error: %v (backoff=%s)", desc.GVR.String(), err, delay))
			if err := timeutil.SleepWithContext(ctx, delay); err != nil {
				return nil, err
			}
		}
		if list == nil {
			return results, nil
		}

		page := make([]Summary, 0, len(list.Items))
		for i := range list.Items {
			item := &list.Items[i]
			page = append(page, s.buildSummary(desc, item))
		}
		if len(page) > 0 {
			results = append(results, page...)
			if agg != nil {
				agg.emit(index, page)
			}
		}

		cont := list.GetContinue()
		if cont == "" {
			break
		}
		options.Continue = cont
	}
	return results, nil
}

func (s *Service) namespaceWorkerLimit(targetCount int) int {
	if targetCount <= 1 {
		return 1
	}
	limit := s.opts.NamespaceWorkers
	if limit <= 0 || limit > targetCount {
		limit = targetCount
	}
	if limit < 1 {
		return 1
	}
	return limit
}

func (s *Service) maybePromote(ctx context.Context, desc resourceDescriptor, itemCount int) {
	if s.opts.InformerPromotionThreshold <= 0 {
		return
	}
	if itemCount < s.opts.InformerPromotionThreshold {
		return
	}
	if s.deps.Common.DynamicClient == nil {
		return
	}
	key := desc.GVR.String()
	if s.getPromotedDescriptor(key) != nil {
		return
	}

	genericInformer := dynamicinformer.NewFilteredDynamicInformer(
		s.deps.Common.DynamicClient,
		desc.GVR,
		metav1.NamespaceAll,
		0,
		cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc},
		nil,
	)
	informer := genericInformer.Informer()
	stopCh := make(chan struct{})
	promoted := &promotedDescriptor{informer: informer, stopCh: stopCh}

	s.promotedMu.Lock()
	if _, exists := s.promoted[key]; exists {
		s.promotedMu.Unlock()
		promoted.stop()
		return
	}
	s.promoted[key] = promoted
	s.promotedMu.Unlock()

	go informer.Run(stopCh)
	if !cache.WaitForCacheSync(ctx.Done(), informer.HasSynced) {
		s.logWarn(fmt.Sprintf("catalog informer promotion failed to sync for %s", key))
		promoted.stop()
		s.promotedMu.Lock()
		delete(s.promoted, key)
		s.promotedMu.Unlock()
		return
	}
	s.logInfo(fmt.Sprintf("catalog descriptor %s promoted to informer", key))
}

func (s *Service) collectFromInformer(index int, desc resourceDescriptor, promoted *promotedDescriptor, agg *streamingAggregator) ([]Summary, error) {
	if promoted == nil {
		return nil, errors.New("no informer")
	}
	if !promoted.informer.HasSynced() {
		return nil, errInformerNotSynced
	}
	objects := promoted.informer.GetStore().List()
	results := make([]Summary, 0, len(objects))
	for _, obj := range objects {
		runtimeObj, ok := obj.(kruntime.Object)
		if !ok {
			continue
		}
		accessor, err := meta.Accessor(runtimeObj)
		if err != nil {
			continue
		}
		unstructuredObj := &unstructuredv1.Unstructured{}
		if u, ok := runtimeObj.(*unstructuredv1.Unstructured); ok {
			unstructuredObj = u
		} else {
			unstructuredObj.SetNamespace(accessor.GetNamespace())
			unstructuredObj.SetName(accessor.GetName())
			unstructuredObj.SetUID(accessor.GetUID())
			unstructuredObj.SetResourceVersion(accessor.GetResourceVersion())
			unstructuredObj.SetCreationTimestamp(accessor.GetCreationTimestamp())
			unstructuredObj.SetGroupVersionKind(schema.GroupVersionKind{
				Group:   desc.Group,
				Version: desc.Version,
				Kind:    desc.Kind,
			})
		}
		results = append(results, s.buildSummary(desc, unstructuredObj))
	}
	if agg != nil && len(results) > 0 {
		agg.emit(index, results)
	}
	if agg != nil && len(results) == 0 {
		agg.complete(index)
	}
	return results, nil
}

func (s *Service) getPromotedDescriptor(key string) *promotedDescriptor {
	s.promotedMu.RLock()
	defer s.promotedMu.RUnlock()
	return s.promoted[key]
}

func (s *Service) stopPromotedInformers() {
	s.promotedMu.Lock()
	defer s.promotedMu.Unlock()
	for key, promoted := range s.promoted {
		if promoted != nil {
			promoted.stop()
		}
		delete(s.promoted, key)
	}
}

func (s *Service) buildSummary(desc resourceDescriptor, item metav1.Object) Summary {
	creationTimestamp := ""
	if ts := item.GetCreationTimestamp(); !ts.IsZero() {
		creationTimestamp = ts.UTC().Format(time.RFC3339)
	}

	summary := Summary{
		ClusterID:         s.clusterID,
		ClusterName:       s.clusterName,
		Kind:              desc.Kind,
		Group:             desc.Group,
		Version:           desc.Version,
		Resource:          desc.Resource,
		Namespace:         item.GetNamespace(),
		Name:              item.GetName(),
		UID:               string(item.GetUID()),
		ResourceVersion:   item.GetResourceVersion(),
		CreationTimestamp: creationTimestamp,
		Scope:             desc.Scope,
	}

	if digest := labelsDigest(item.GetLabels()); digest != "" {
		summary.LabelsDigest = digest
	}

	return summary
}

type promotedDescriptor struct {
	informer cache.SharedIndexInformer
	stopCh   chan struct{}
	stopOnce sync.Once
}

func (p *promotedDescriptor) stop() {
	if p == nil {
		return
	}
	p.stopOnce.Do(func() {
		close(p.stopCh)
	})
}
