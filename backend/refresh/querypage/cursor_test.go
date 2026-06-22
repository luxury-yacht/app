package querypage

import "testing"

func TestCursorRoundTrip(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a",
		Signature: "sig123",
		Sort:      "cpu",
		Direction: Descending,
		Limit:     250,
		Position:  []string{"1500"},
		UID:       "uid-42",
		Revision:  "9001",
	}
	token := c.Encode()
	if token == "" {
		t.Fatal("non-first-page cursor encoded to an empty token")
	}
	got, err := Decode(token)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ClusterID != c.ClusterID || got.Signature != c.Signature || got.Sort != c.Sort ||
		got.Direction != c.Direction || got.Limit != c.Limit || got.UID != c.UID ||
		got.Revision != c.Revision {
		t.Fatalf("round-trip mismatch:\n got  %+v\n want %+v", got, c)
	}
	if len(got.Position) != 1 || got.Position[0] != "1500" {
		t.Fatalf("position lost in round-trip: got %v", got.Position)
	}
}

func TestFirstPageEncodesEmpty(t *testing.T) {
	c := FirstPage("cluster-a", "sig", "name", Ascending, 100)
	if !c.IsFirstPage() {
		t.Fatal("FirstPage cursor not reported as first page")
	}
	if tok := c.Encode(); tok != "" {
		t.Fatalf("first-page cursor encoded to %q, want empty", tok)
	}
	got, err := Decode("")
	if err != nil {
		t.Fatalf("decode empty token: %v", err)
	}
	if !got.IsFirstPage() {
		t.Fatal("empty token did not decode to a first-page cursor")
	}
}

// TestSubsumesTypedCursor models the typed-table cursor (SortField + LastValue +
// LastKey) as a unified cursor and confirms the keyset survives a round-trip.
func TestSubsumesTypedCursor(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a", Signature: "typedsig", Sort: "cpu", Direction: Descending,
		Limit: 250, Position: []string{"1500"}, UID: "uid-7",
	}
	got, err := Decode(c.Encode())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Position) != 1 || got.Position[0] != "1500" || got.UID != "uid-7" {
		t.Fatalf("typed keyset not preserved: %+v", got)
	}
}

// TestSubsumesCatalogCursor models the catalog cursor (sort value + object ref) as a
// unified cursor: the sort value is the Position, the object's UID is the tiebreak.
func TestSubsumesCatalogCursor(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a", Signature: "catsig", Sort: "name", Direction: Ascending,
		Limit: 100, Position: []string{"web-frontend"}, UID: "uid-abc",
	}
	got, err := Decode(c.Encode())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Position) != 1 || got.Position[0] != "web-frontend" || got.UID != "uid-abc" {
		t.Fatalf("catalog keyset not preserved: %+v", got)
	}
}

func TestValidateRejectsMismatch(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a", Signature: "sig", Sort: "cpu", Direction: Descending,
		Limit: 250, Position: []string{"1"}, UID: "u1",
	}
	if err := c.Validate("cluster-a", "sig", "cpu", Descending, 250); err != nil {
		t.Fatalf("matching cursor was rejected: %v", err)
	}
	cases := []struct {
		name    string
		cluster string
		sig     string
		sort    string
		dir     Direction
		limit   int
	}{
		{"cluster", "cluster-b", "sig", "cpu", Descending, 250},
		{"signature", "cluster-a", "other", "cpu", Descending, 250},
		{"sort", "cluster-a", "sig", "name", Descending, 250},
		{"direction", "cluster-a", "sig", "cpu", Ascending, 250},
		{"limit", "cluster-a", "sig", "cpu", Descending, 100},
	}
	for _, tc := range cases {
		if err := c.Validate(tc.cluster, tc.sig, tc.sort, tc.dir, tc.limit); err != ErrCursorMismatch {
			t.Errorf("%s mismatch: expected ErrCursorMismatch, got %v", tc.name, err)
		}
	}
}

func TestValidateFirstPageAlwaysValid(t *testing.T) {
	c := FirstPage("cluster-a", "sig", "cpu", Descending, 250)
	if err := c.Validate("cluster-z", "different", "name", Ascending, 1); err != nil {
		t.Fatalf("a first-page cursor should always validate, got %v", err)
	}
}

func TestDecodeMalformed(t *testing.T) {
	if _, err := Decode("!!!not base64!!!"); err == nil {
		t.Fatal("expected an error for bad base64")
	}
	if _, err := Decode("Zm9vYmFy"); err == nil { // valid base64 of "foobar" (not JSON)
		t.Fatal("expected an error for a bad JSON payload")
	}
}
