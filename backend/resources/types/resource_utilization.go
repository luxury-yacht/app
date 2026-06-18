/*
 * backend/resources/types/resource_utilization.go
 *
 * Shared per-pod resource-utilization fields embedded in workload detail DTOs.
 * Declared once and projected by a single helper instead of being repeated in
 * each workload DTO and builder.
 */

package types

// ResourceUtilization holds display-ready average per-pod resource utilization.
// Embed it (anonymously) in a detail DTO; Wails flattens the embedded fields
// into the generated TypeScript, so the wire/TS shape is identical to declaring
// the six fields inline.
type ResourceUtilization struct {
	CPURequest string `json:"cpuRequest,omitempty"`
	CPULimit   string `json:"cpuLimit,omitempty"`
	CPUUsage   string `json:"cpuUsage,omitempty"`
	MemRequest string `json:"memRequest,omitempty"`
	MemLimit   string `json:"memLimit,omitempty"`
	MemUsage   string `json:"memUsage,omitempty"`
}
