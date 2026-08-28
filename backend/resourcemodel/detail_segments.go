/*
 * backend/resourcemodel/detail_segments.go
 *
 * DetailSegment is the typed presentation contract for a multi-kind table's
 * Details cell. Each kind's stream-summary builder projects its Facts into a
 * small list of labeled segments instead of one preformatted prose string, so
 * the frontend can render labels, values, cross-object links, and status
 * presentation uniformly across kinds. The backend stays the owner of the
 * segment semantics; the frontend only maps presentation tokens to CSS.
 */

package resourcemodel

import (
	"strconv"
	"strings"
)

// Detail slots are the semantic columns a multi-kind table renders segments
// into: the row's classifying reference (type/class/parent/owner), its network
// address(es), and its counts/status chips. Kind builders assign the slot; the
// frontend maps slots to columns.
const (
	DetailSlotReference = "reference"
	DetailSlotAddress   = "address"
	DetailSlotCounts    = "counts"
)

// DetailSegment is one labeled fragment of a table row's Details cells.
type DetailSegment struct {
	// Slot names the semantic column this segment belongs to (DetailSlot*).
	Slot string `json:"slot,omitempty"`
	// Label names the segment (e.g. "Rules", "Ready"); empty when the slot's
	// column header already carries the meaning.
	Label string `json:"label,omitempty"`
	// Value is the segment's display text. Collapsed lists display
	// "first +N" with the full list carried in Search.
	Value string `json:"value"`
	// Search, when set, is the full text behind a collapsed Value; search and
	// tooltips use it so collapsing never hides matches.
	Search string `json:"search,omitempty"`
	// Link, when set, marks the value as an openable cross-object reference.
	Link *ResourceLink `json:"link,omitempty"`
	// Presentation is an optional status-presentation token (e.g. "warning")
	// the frontend maps to CSS at the edge; empty renders as plain text.
	Presentation string `json:"presentation,omitempty"`
}

// DetailSegmentText renders one segment as "Label: Value" ("Value" when unlabeled).
func DetailSegmentText(segment DetailSegment) string {
	if segment.Label == "" {
		return segment.Value
	}
	return segment.Label + ": " + segment.Value
}

// DetailSegmentsText flattens displayed segments into the one-line text used by
// frontend export. Search uses DetailSegmentsSearchText so collapsed values can
// expand, while per-column sort uses DetailSlotText.
func DetailSegmentsText(segments []DetailSegment) string {
	if len(segments) == 0 {
		return ""
	}
	parts := make([]string, 0, len(segments))
	for _, segment := range segments {
		parts = append(parts, DetailSegmentText(segment))
	}
	return strings.Join(parts, ", ")
}

// DetailSegmentsSearchText flattens segments for server-side search, using
// each segment's Search expansion when present so collapsed list values stay
// fully searchable.
func DetailSegmentsSearchText(segments []DetailSegment) string {
	if len(segments) == 0 {
		return ""
	}
	parts := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment.Search != "" {
			expanded := segment.Search
			if segment.Label != "" {
				expanded = segment.Label + ": " + expanded
			}
			parts = append(parts, expanded)
			continue
		}
		parts = append(parts, DetailSegmentText(segment))
	}
	return strings.Join(parts, ", ")
}

// DetailSlotText flattens only the segments of one slot (display values),
// giving each slot column a deterministic server-side sort key.
func DetailSlotText(segments []DetailSegment, slot string) string {
	var parts []string
	for _, segment := range segments {
		if segment.Slot == slot {
			parts = append(parts, DetailSegmentText(segment))
		}
	}
	return strings.Join(parts, ", ")
}

// ListDetailSegment collapses a homogeneous string list into one labeled segment:
// the first value plus a "+N" remainder in the display text, with the full
// list carried in Search. An empty list yields a zero segment (callers skip it).
func ListDetailSegment(slot, label string, values []string) DetailSegment {
	if len(values) == 0 {
		return DetailSegment{}
	}
	if len(values) == 1 {
		return DetailSegment{Slot: slot, Label: label, Value: values[0]}
	}
	return DetailSegment{
		Slot:   slot,
		Label:  label,
		Value:  values[0] + " +" + strconv.Itoa(len(values)-1),
		Search: strings.Join(values, ", "),
	}
}

// PortProtocol is one port/protocol pair for FormatPortsSummary.
type PortProtocol struct {
	Port     int32
	Protocol string
}

// FormatPortsSummary renders a port list compactly for an address-slot
// segment: ports sharing one protocol group as "443,80/TCP"; mixed protocols
// stay per-port "443/TCP,53/UDP".
func FormatPortsSummary(ports []PortProtocol) string {
	if len(ports) == 0 {
		return ""
	}
	protocol := ports[0].Protocol
	uniformProtocol := true
	for _, port := range ports[1:] {
		if port.Protocol != protocol {
			uniformProtocol = false
			break
		}
	}
	parts := make([]string, 0, len(ports))
	for _, port := range ports {
		if uniformProtocol {
			parts = append(parts, strconv.Itoa(int(port.Port)))
		} else {
			parts = append(parts, strconv.Itoa(int(port.Port))+"/"+port.Protocol)
		}
	}
	joined := strings.Join(parts, ",")
	if uniformProtocol {
		return joined + "/" + protocol
	}
	return joined
}

// AppendDetailSegment returns a NEW slice with segment appended; it never
// writes into the input's backing array. Serve-time joins overlay segments
// onto rows served from a shared maintained store, where an in-place append
// would corrupt concurrently served rows.
func AppendDetailSegment(segments []DetailSegment, segment DetailSegment) []DetailSegment {
	out := make([]DetailSegment, len(segments), len(segments)+1)
	copy(out, segments)
	return append(out, segment)
}
