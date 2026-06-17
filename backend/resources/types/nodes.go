/*
 * backend/resources/types/nodes.go
 *
 * Type definitions for Node resources.
 * - Shared data structures for API responses.
 */

package types

// DrainNodeOptions contains options for draining a node.
type DrainNodeOptions struct {
	GracePeriodSeconds         *int `json:"gracePeriodSeconds,omitempty"`
	TimeoutSeconds             *int `json:"timeoutSeconds,omitempty"`
	IgnoreDaemonSets           bool `json:"ignoreDaemonSets"`
	DeleteEmptyDirData         bool `json:"deleteEmptyDirData"`
	Force                      bool `json:"force"`
	DisableEviction            bool `json:"disableEviction"`
	SkipWaitForPodsToTerminate bool `json:"skipWaitForPodsToTerminate"`
}
