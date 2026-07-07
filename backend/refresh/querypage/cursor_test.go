package querypage

import (
	"encoding/base64"
	"testing"
)

func TestCursorRoundTrip(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a",
		Signature: "sig123",
		Sort:      "cpu",
		Direction: Descending,
		Limit:     250,
		Position:  "1500",
		UID:       "uid-42",
	}
	token := c.Encode()
	if token == "" {
		t.Fatal("non-first-page cursor encoded to an empty token")
	}
	got, err := Decode(token)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got != c {
		t.Fatalf("round-trip mismatch:\n got  %+v\n want %+v", got, c)
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
		Limit: 250, Position: "1500", UID: "uid-7",
	}
	got, err := Decode(c.Encode())
	if err != nil {
		t.Fatal(err)
	}
	if got.Position != "1500" || got.UID != "uid-7" {
		t.Fatalf("typed keyset not preserved: %+v", got)
	}
}

// TestSubsumesCatalogCursor models the catalog cursor (sort value + object ref) as a
// unified cursor: the sort value is the Position, the object's UID is the tiebreak.
func TestSubsumesCatalogCursor(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a", Signature: "catsig", Sort: "name", Direction: Ascending,
		Limit: 100, Position: "web-frontend", UID: "uid-abc",
	}
	got, err := Decode(c.Encode())
	if err != nil {
		t.Fatal(err)
	}
	if got.Position != "web-frontend" || got.UID != "uid-abc" {
		t.Fatalf("catalog keyset not preserved: %+v", got)
	}
}

func TestValidateRejectsMismatch(t *testing.T) {
	c := Cursor{
		ClusterID: "cluster-a", Signature: "sig", Sort: "cpu", Direction: Descending,
		Limit: 250, Position: "1", UID: "u1",
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

// TestDecodeRejectsLegacyArrayPosition pins the Position shape: the unified
// cursor carries exactly ONE comparable value per row ("p" is a JSON string).
// A legacy multi-component token ("p" as a JSON array) must fail decode —
// callers map that to cursorInvalid and restart from page 1 rather than
// guessing which component to seek on.
func TestDecodeRejectsLegacyArrayPosition(t *testing.T) {
	raw := `{"c":"cluster-a","q":"sig","s":"name","d":"asc","l":100,"p":["web"],"u":"uid-1"}`
	token := base64.RawURLEncoding.EncodeToString([]byte(raw))
	if _, err := Decode(token); err == nil {
		t.Fatal("expected decode to reject an array-shaped position payload")
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
