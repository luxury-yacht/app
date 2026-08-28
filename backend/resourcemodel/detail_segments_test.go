package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDetailSegmentsTextFlattensLabeledSegments(t *testing.T) {
	segments := []DetailSegment{
		{Label: "Type", Value: "ClusterIP"},
		{Label: "Ports", Value: "80/TCP,443/TCP"},
		{Value: "No rules defined"},
	}
	require.Equal(t, "Type: ClusterIP, Ports: 80/TCP,443/TCP, No rules defined", DetailSegmentsText(segments))
	require.Equal(t, "", DetailSegmentsText(nil))
}

// TestAppendDetailSegmentCopies proves the append never writes into the input
// slice's backing array: rows served from a shared maintained store carry the
// same backing array across Builds, so an in-place append would let one
// request's serve-time join clobber another's.
func TestAppendDetailSegmentCopies(t *testing.T) {
	base := make([]DetailSegment, 2, 4) // spare capacity — an in-place append would alias
	base[0] = DetailSegment{Label: "Type", Value: "ClusterIP"}
	base[1] = DetailSegment{Label: "ClusterIP", Value: "10.0.0.1"}

	first := AppendDetailSegment(base, DetailSegment{Label: "Addresses", Value: "1"})
	second := AppendDetailSegment(base, DetailSegment{Label: "Addresses", Value: "2"})

	require.Equal(t, "1", first[2].Value, "first append must not be clobbered by the second")
	require.Equal(t, "2", second[2].Value)
	require.Len(t, base, 2)
}

func TestDetailSlotTextFlattensOnlyTheRequestedSlot(t *testing.T) {
	segments := []DetailSegment{
		{Slot: DetailSlotReference, Value: "nginx"},
		{Slot: DetailSlotAddress, Value: "web.example.com +2", Search: "web.example.com, b.example.com, c.example.com"},
		{Slot: DetailSlotCounts, Label: "Rules", Value: "4"},
	}
	require.Equal(t, "nginx", DetailSlotText(segments, DetailSlotReference))
	require.Equal(t, "web.example.com +2", DetailSlotText(segments, DetailSlotAddress))
	require.Equal(t, "Rules: 4", DetailSlotText(segments, DetailSlotCounts))
	require.Equal(t, "", DetailSlotText(nil, DetailSlotAddress))
}

func TestDetailSegmentsSearchTextExpandsCollapsedLists(t *testing.T) {
	segments := []DetailSegment{
		{Slot: DetailSlotAddress, Label: "Hosts", Value: "web.example.com +2", Search: "web.example.com, b.example.com, c.example.com"},
		{Slot: DetailSlotCounts, Label: "Rules", Value: "4"},
	}
	require.Equal(t, "Hosts: web.example.com, b.example.com, c.example.com, Rules: 4", DetailSegmentsSearchText(segments))
}

func TestFormatPortsSummaryGroupsUniformProtocols(t *testing.T) {
	require.Equal(t, "", FormatPortsSummary(nil))
	require.Equal(t, "443/TCP", FormatPortsSummary([]PortProtocol{{Port: 443, Protocol: "TCP"}}))
	require.Equal(t, "443,80/TCP", FormatPortsSummary([]PortProtocol{{Port: 443, Protocol: "TCP"}, {Port: 80, Protocol: "TCP"}}))
	require.Equal(t, "443/TCP,53/UDP", FormatPortsSummary([]PortProtocol{{Port: 443, Protocol: "TCP"}, {Port: 53, Protocol: "UDP"}}))
}

func TestListDetailSegmentCollapsesToFirstPlusCount(t *testing.T) {
	require.Equal(t, DetailSegment{Slot: DetailSlotAddress, Label: "Hosts", Value: "a.example.com"},
		ListDetailSegment(DetailSlotAddress, "Hosts", []string{"a.example.com"}))
	require.Equal(t, DetailSegment{
		Slot:   DetailSlotAddress,
		Label:  "Hosts",
		Value:  "a.example.com +2",
		Search: "a.example.com, b.example.com, c.example.com",
	}, ListDetailSegment(DetailSlotAddress, "Hosts", []string{"a.example.com", "b.example.com", "c.example.com"}))
	require.Equal(t, DetailSegment{}, ListDetailSegment(DetailSlotAddress, "Hosts", nil))
}

func TestRouteSummarySegments(t *testing.T) {
	parent := ResourceLink{Ref: &ResourceRef{ClusterID: "c1", Group: "gateway.networking.k8s.io", Version: "v1", Kind: "Gateway", Resource: "gateways", Namespace: "default", Name: "edge"}}
	other := ResourceLink{Ref: &ResourceRef{ClusterID: "c1", Group: "gateway.networking.k8s.io", Version: "v1", Kind: "Gateway", Resource: "gateways", Namespace: "default", Name: "other"}}
	facts := RouteCommonFacts{
		ParentRefs: []ResourceLink{parent, other},
		Hostnames:  []string{"a.example.com", "b.example.com"},
		Rules:      []RouteRuleFacts{{}, {}, {}},
	}
	require.Equal(t, []DetailSegment{
		{Slot: DetailSlotReference, Label: "Parent", Value: "edge", Link: &facts.ParentRefs[0], Search: "edge, other"},
		{Slot: DetailSlotAddress, Label: "Hosts", Value: "a.example.com +1", Search: "a.example.com, b.example.com"},
		{Slot: DetailSlotCounts, Label: "Rules", Value: "3"},
	}, RouteSummarySegments(facts))

	// No parents and no hostnames: only the rule count remains.
	require.Equal(t, []DetailSegment{
		{Slot: DetailSlotCounts, Label: "Rules", Value: "0"},
	}, RouteSummarySegments(RouteCommonFacts{}))
}
