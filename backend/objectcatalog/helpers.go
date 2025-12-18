package objectcatalog

import (
	"fmt"
	"hash/fnv"
	"math"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
)

// cloneSet creates a shallow copy of a string set.
func cloneSet(src map[string]struct{}) map[string]struct{} {
	if len(src) == 0 {
		return nil
	}
	copySet := make(map[string]struct{}, len(src))
	for key := range src {
		copySet[key] = struct{}{}
	}
	return copySet
}

// toMetaObjects converts a slice of typed objects to a slice of metav1.Object.
func toMetaObjects[T metav1.Object](items []T) []metav1.Object {
	result := make([]metav1.Object, len(items))
	for i, item := range items {
		result[i] = item
	}
	return result
}

// listTargets returns the target namespaces for a descriptor.
func listTargets(desc resourceDescriptor, namespaces []string) []string {
	if desc.Namespaced {
		if len(namespaces) > 0 {
			return uniqueNamespaces(namespaces)
		}
		return []string{metav1.NamespaceAll}
	}
	return []string{""}
}

// resourceInterfaceForTarget returns the appropriate resource interface for a target namespace.
func resourceInterfaceForTarget(namespaceable dynamic.NamespaceableResourceInterface, namespaced bool, target string) dynamic.ResourceInterface {
	if !namespaced {
		return namespaceable
	}
	ns := target
	if ns == "" {
		ns = metav1.NamespaceAll
	}
	return namespaceable.Namespace(ns)
}

// shouldRetryList returns true if the error is retryable for list operations.
func shouldRetryList(err error) bool {
	return isRetryableListError(err)
}

// listRetryBackoff calculates exponential backoff for list retries.
func listRetryBackoff(attempt int) time.Duration {
	if attempt <= 0 {
		return listRetryInitialBackoff
	}
	factor := math.Pow(2, float64(attempt))
	backoff := time.Duration(float64(listRetryInitialBackoff) * factor)
	if backoff > listRetryMaxBackoff {
		return listRetryMaxBackoff
	}
	return backoff
}

// uniqueNamespaces deduplicates and sorts namespace names.
func uniqueNamespaces(namespaces []string) []string {
	if len(namespaces) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, len(namespaces))
	for _, ns := range namespaces {
		value := strings.TrimSpace(ns)
		if value == "" || strings.EqualFold(value, "cluster") {
			continue
		}
		lower := strings.ToLower(value)
		if _, ok := seen[lower]; ok {
			continue
		}
		seen[lower] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

// exportDescriptor converts an internal resourceDescriptor to an exported Descriptor.
func exportDescriptor(in resourceDescriptor) Descriptor {
	return Descriptor{
		Group:      in.Group,
		Version:    in.Version,
		Resource:   in.Resource,
		Kind:       in.Kind,
		Scope:      in.Scope,
		Namespaced: in.Namespaced,
	}
}

// catalogKey generates a unique key for a catalog item.
func catalogKey(desc resourceDescriptor, namespace, name string) string {
	if desc.Namespaced {
		return desc.GVR.String() + "/" + namespace + "/" + name
	}
	return desc.GVR.String() + "//" + name
}

// labelsDigest computes a hash digest of labels for change detection.
func labelsDigest(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	hash := fnv.New64a()
	for _, key := range keys {
		hash.Write([]byte(key))
		hash.Write([]byte("="))
		hash.Write([]byte(labels[key]))
		hash.Write([]byte("\n"))
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}

// containsVerb checks if a verb exists in a list of verbs.
func containsVerb(verbs []string, target string) bool {
	for _, verb := range verbs {
		if strings.EqualFold(verb, target) {
			return true
		}
	}
	return false
}

// sortSummaries sorts summaries by kind, namespace, and name.
func sortSummaries(items []Summary) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Kind != items[j].Kind {
			return items[i].Kind < items[j].Kind
		}
		if items[i].Namespace != items[j].Namespace {
			return items[i].Namespace < items[j].Namespace
		}
		return items[i].Name < items[j].Name
	})
}

// snapshotSortedKeys returns a sorted slice of keys from a set.
func snapshotSortedKeys(set map[string]struct{}) []string {
	if len(set) == 0 {
		return nil
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

// clampQueryLimit constrains a query limit to valid bounds.
func clampQueryLimit(limit int) int {
	if limit <= 0 {
		return defaultQueryLimit
	}
	if limit > maxQueryLimit {
		return maxQueryLimit
	}
	return limit
}

// parseContinueToken parses a pagination continue token.
func parseContinueToken(token string, total int) int {
	if token == "" {
		return 0
	}
	value, err := strconv.Atoi(token)
	if err != nil || value < 0 {
		return 0
	}
	if value > total {
		return total
	}
	return value
}

// countMatchingDescriptors counts descriptors that match the kind filter.
func countMatchingDescriptors(descriptors []Descriptor, matcher kindMatcher) int {
	if matcher == nil {
		return len(descriptors)
	}
	count := 0
	for _, desc := range descriptors {
		if matcher(desc.Kind, desc.Group, desc.Version, desc.Resource) {
			count++
		}
	}
	return count
}

// removeDisallowedEntries removes items from maps that are not in the allowed set.
func removeDisallowedEntries(items map[string]Summary, seen map[string]time.Time, allowed map[string]resourceDescriptor) {
	if len(items) == 0 {
		return
	}
	for key := range items {
		if _, ok := allowed[descriptorKeyFromItemKey(key)]; !ok {
			delete(items, key)
			delete(seen, key)
		}
	}
}

// removeDescriptorEntries removes all entries for a specific GVR.
func removeDescriptorEntries(items map[string]Summary, seen map[string]time.Time, gvr string) {
	if gvr == "" {
		return
	}
	prefix := gvr + "/"
	for key := range items {
		if strings.HasPrefix(key, prefix) {
			delete(items, key)
			delete(seen, key)
		}
	}
}

// toDescriptorSlice converts internal descriptors to exported slice.
func toDescriptorSlice(resources []resourceDescriptor) []Descriptor {
	if len(resources) == 0 {
		return nil
	}
	result := make([]Descriptor, 0, len(resources))
	for _, res := range resources {
		result = append(result, Descriptor{
			Group:      res.Group,
			Version:    res.Version,
			Resource:   res.Resource,
			Kind:       res.Kind,
			Scope:      res.Scope,
			Namespaced: res.Namespaced,
		})
	}
	return result
}

// descriptorKeyFromItemKey extracts the GVR portion from an item key.
func descriptorKeyFromItemKey(key string) string {
	if idx := strings.Index(key, "/"); idx >= 0 {
		return key[:idx]
	}
	return key
}

// restoreDescriptorEntries restores entries from previous state for a specific GVR.
func restoreDescriptorEntries(items map[string]Summary, seen map[string]time.Time, previousItems map[string]Summary, previousSeen map[string]time.Time, gvr string) {
	if previousItems == nil {
		return
	}
	prefix := gvr + "/"
	for key, summary := range previousItems {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		items[key] = summary
		if previousSeen != nil {
			if ts, ok := previousSeen[key]; ok {
				seen[key] = ts
			}
		}
	}
}

// cloneSummaryMap creates a shallow copy of a summary map.
func cloneSummaryMap(src map[string]Summary) map[string]Summary {
	if len(src) == 0 {
		return make(map[string]Summary)
	}
	dst := make(map[string]Summary, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

// cloneTimeMap creates a shallow copy of a time map.
func cloneTimeMap(src map[string]time.Time) map[string]time.Time {
	if len(src) == 0 {
		return make(map[string]time.Time)
	}
	dst := make(map[string]time.Time, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

// adjustedListWorkers calculates the number of list workers based on CPU count.
func adjustedListWorkers() int {
	cpu := runtime.NumCPU()
	if cpu <= 0 {
		cpu = 1
	}
	workers := cpu * 4
	if workers < defaultListWorkers {
		workers = defaultListWorkers
	}
	if workers > 128 {
		workers = 128
	}
	return workers
}

// descriptorStreamingPriority returns the streaming priority for a resource descriptor.
func descriptorStreamingPriority(desc resourceDescriptor) int {
	priority := 100
	key := strings.ToLower(desc.Resource)
	if value, ok := streamingResourcePriority[key]; ok {
		priority = value
	}
	if desc.Scope == ScopeCluster {
		priority -= 10
	}
	if priority < 0 {
		priority = 0
	}
	return priority*10 + len(desc.Resource)
}

// isRetryableListError checks if an error should trigger a retry.
func isRetryableListError(err error) bool {
	return apierrors.IsTooManyRequests(err) ||
		apierrors.IsTimeout(err) ||
		apierrors.IsServerTimeout(err) ||
		apierrors.IsInternalError(err) ||
		apierrors.IsServiceUnavailable(err)
}
