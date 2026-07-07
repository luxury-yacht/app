package snapshot

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

// The anchor rides the same scope-string channel as the continue token, as
// anchor.* params. Parsing yields the full object reference or nil when no
// anchor params are present.
func TestResourceQueryRequestParsesAnchorParams(t *testing.T) {
	values := url.Values{}
	values.Set("anchor.clusterId", "cluster-a")
	values.Set("anchor.group", "apps")
	values.Set("anchor.version", "v1")
	values.Set("anchor.kind", "Deployment")
	values.Set("anchor.namespace", "shop")
	values.Set("anchor.name", "checkout")
	values.Set("anchor.uid", "uid-123")

	request := resourceQueryRequestFromValues("cluster-a", "namespace-workloads", values, ResourceQueryRequest{})
	if request.Anchor == nil {
		t.Fatal("anchor params did not populate request.Anchor")
	}
	want := ResourceQueryAnchor{
		ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment",
		Namespace: "shop", Name: "checkout", UID: "uid-123",
	}
	if *request.Anchor != want {
		t.Fatalf("anchor = %+v, want %+v", *request.Anchor, want)
	}

	// No anchor params → nil (not a zero-value struct).
	plain := resourceQueryRequestFromValues("cluster-a", "namespace-workloads", url.Values{}, ResourceQueryRequest{})
	if plain.Anchor != nil {
		t.Fatalf("no anchor params should yield a nil anchor, got %+v", plain.Anchor)
	}
}

// The anchor contract: a full object reference (clusterId+version+kind+name;
// group may be empty for the core group) on the SAME cluster as the request,
// mutually exclusive with a continue token.
func TestResourceQueryAnchorValidation(t *testing.T) {
	valid := &ResourceQueryAnchor{
		ClusterID: "cluster-a", Group: "", Version: "v1", Kind: "Pod",
		Namespace: "default", Name: "web-1",
	}
	base := ResourceQueryRequest{ClusterID: "cluster-a", Table: "pods"}

	cases := []struct {
		name    string
		mutate  func(r *ResourceQueryRequest)
		wantErr string
	}{
		{"valid core-group anchor", func(r *ResourceQueryRequest) {}, ""},
		{"no anchor is valid", func(r *ResourceQueryRequest) { r.Anchor = nil }, ""},
		{"anchor plus continue", func(r *ResourceQueryRequest) { r.Continue = "token" }, "mutually exclusive"},
		{"cross-cluster anchor", func(r *ResourceQueryRequest) {
			a := *valid
			a.ClusterID = "cluster-b"
			r.Anchor = &a
		}, "cluster"},
		{"missing kind", func(r *ResourceQueryRequest) {
			a := *valid
			a.Kind = ""
			r.Anchor = &a
		}, "kind"},
		{"missing name", func(r *ResourceQueryRequest) {
			a := *valid
			a.Name = ""
			r.Anchor = &a
		}, "name"},
		{"missing version", func(r *ResourceQueryRequest) {
			a := *valid
			a.Version = ""
			r.Anchor = &a
		}, "version"},
		{"missing clusterId", func(r *ResourceQueryRequest) {
			a := *valid
			a.ClusterID = ""
			r.Anchor = &a
		}, "clusterId"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			a := *valid
			r.Anchor = &a
			tc.mutate(&r)
			err := r.validateAnchor()
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tc.wantErr)
			}
		})
	}
}

// An invalid anchor combination must fail the scope parse — the same error
// channel a malformed query string uses.
func TestParseTypedTableQueryScopeRejectsAnchorPlusContinue(t *testing.T) {
	scope := "namespace:all?continue=tok&anchor.clusterId=c1&anchor.version=v1&anchor.kind=Pod&anchor.name=web"
	_, _, err := parseTypedTableQueryScope("c1", scope, "pods", "")
	if err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("anchor+continue parse error = %v, want mutual-exclusion error", err)
	}

	// A valid anchor parses cleanly through the same channel.
	scope = "namespace:all?anchor.clusterId=c1&anchor.version=v1&anchor.kind=Pod&anchor.name=web&anchor.namespace=default"
	_, query, err := parseTypedTableQueryScope("c1", scope, "pods", "")
	if err != nil {
		t.Fatalf("valid anchor scope failed to parse: %v", err)
	}
	if query.Request.Anchor == nil || query.Request.Anchor.Name != "web" {
		t.Fatalf("anchor lost in scope parse: %+v", query.Request.Anchor)
	}
}

// The envelope carries the anchor result and the serve-time page-start rank;
// PageStartRank is a POINTER so rank 0 (page 1) survives omitempty — absent
// means "not computed", never "first page".
func TestResourceQueryEnvelopeCarriesAnchorAndRankZero(t *testing.T) {
	rank := 0
	env := ResourceQueryEnvelope{
		Provider:      ResourceQueryProviderTypedResource,
		Table:         "pods",
		Anchor:        &ResourceQueryAnchorResult{Found: true, Rank: 0},
		PageStartRank: &rank,
	}
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatal(err)
	}
	if string(generic["pageStartRank"]) != "0" {
		t.Fatalf("pageStartRank = %s, want explicit 0", generic["pageStartRank"])
	}
	var anchor ResourceQueryAnchorResult
	if err := json.Unmarshal(generic["anchor"], &anchor); err != nil {
		t.Fatalf("anchor field: %v", err)
	}
	if !anchor.Found || anchor.Rank != 0 {
		t.Fatalf("anchor result round-trip = %+v", anchor)
	}

	// Absent when not computed.
	raw, err = json.Marshal(ResourceQueryEnvelope{Provider: ResourceQueryProviderTypedResource})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "pageStartRank") || strings.Contains(string(raw), "anchor") {
		t.Fatalf("uncomputed rank/anchor leaked into the wire: %s", raw)
	}
}

// StartRank (numbered page jumps) parses from the same scope channel and is
// mutually exclusive with both continue and anchor.
func TestResourceQueryRequestParsesAndValidatesStartRank(t *testing.T) {
	values := url.Values{}
	values.Set("startRank", "40")
	request := resourceQueryRequestFromValues("c", "pods", values, ResourceQueryRequest{})
	if request.StartRank == nil || *request.StartRank != 40 {
		t.Fatalf("startRank = %v, want 40", request.StartRank)
	}
	if err := request.validate(); err != nil {
		t.Fatalf("valid startRank rejected: %v", err)
	}

	// Absent param → nil.
	plain := resourceQueryRequestFromValues("c", "pods", url.Values{}, ResourceQueryRequest{})
	if plain.StartRank != nil {
		t.Fatalf("absent startRank = %v, want nil", plain.StartRank)
	}

	// startRank + continue → error.
	request.Continue = "tok"
	if err := request.validate(); err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("startRank+continue error = %v", err)
	}
	request.Continue = ""

	// startRank + anchor → error.
	request.Anchor = &ResourceQueryAnchor{ClusterID: "c", Version: "v1", Kind: "Pod", Name: "x"}
	if err := request.validate(); err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("startRank+anchor error = %v", err)
	}
	request.Anchor = nil

	// Negative → error.
	negative := -1
	request.StartRank = &negative
	if err := request.validate(); err == nil {
		t.Fatal("negative startRank accepted")
	}
}
