package prometheus

import (
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/metrichistory"
)

func TestDecodeMatrixAlignsSamplesToTheGridAndKeepsGaps(t *testing.T) {
	entry := loadManifest(t)["pod_cpu_by_container"]
	grid := fixtureGrid(t, entry)
	streams, err := DecodeMatrix(loadFixture(t, "pod_cpu_by_container"), grid)
	if err != nil {
		t.Fatal(err)
	}
	if len(streams) != 1 || streams[0].Labels["container"] != "podinfo" {
		t.Fatalf("streams = %+v", streams)
	}
	values := streams[0].Values
	if len(values) != grid.Count {
		t.Fatalf("got %d values for a %d-point grid", len(values), grid.Count)
	}
	// The pod's first sample arrived after the range start: a leading gap, not a zero.
	if values[0] != nil {
		t.Errorf("values[0] = %v, want a gap", *values[0])
	}
	if values[1] == nil || *values[1] != 0.0005678338376631298 {
		t.Errorf("values[1] = %v, want the first fixture sample", values[1])
	}
	if last := values[grid.Count-1]; last == nil || *last != 0.0025297544221962814 {
		t.Errorf("last value = %v, want the final fixture sample", last)
	}
}

func TestDecodeMatrixTreatsAnEmptyResultAsNoDataNotAnError(t *testing.T) {
	grid := fixtureGrid(t, loadManifest(t)["pod_filesystem_absent"])
	streams, err := DecodeMatrix(loadFixture(t, "pod_filesystem_absent"), grid)
	if err != nil {
		t.Fatalf("empty result returned %v", err)
	}
	if len(streams) != 0 {
		t.Errorf("streams = %+v, want none", streams)
	}
}

func TestDecodeMatrixReturnsPrometheusErrorsAsAPIError(t *testing.T) {
	_, err := DecodeMatrix(loadFixture(t, "error_bad_data"), metrichistory.Grid{StartMs: 0, StepMs: 30000, Count: 2})
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v, want *APIError", err)
	}
	if apiErr.Type != "bad_data" {
		t.Errorf("error type = %q, want bad_data", apiErr.Type)
	}
}

func TestDecodeMatrixRejectsNonMatrixResults(t *testing.T) {
	body := []byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`)
	if _, err := DecodeMatrix(body, metrichistory.Grid{StepMs: 30000, Count: 1}); !errors.Is(err, ErrUnexpectedResult) {
		t.Errorf("err = %v, want ErrUnexpectedResult", err)
	}
}

func TestDecodeMatrixRejectsUndecodableBodies(t *testing.T) {
	if _, err := DecodeMatrix([]byte(`<html>502 Bad Gateway</html>`), metrichistory.Grid{StepMs: 30000, Count: 1}); err == nil {
		t.Error("an HTML proxy error decoded without error")
	}
}

func TestDecodeMatrixDropsNonFiniteSamples(t *testing.T) {
	// A 0/0 throttling ratio evaluates to NaN; JSON cannot carry NaN or Inf to the frontend.
	body := []byte(`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[100,"NaN"],[130,"+Inf"],[160,"0.5"]]}]}}`)
	streams, err := DecodeMatrix(body, metrichistory.Grid{StartMs: 100_000, StepMs: 30_000, Count: 3})
	if err != nil {
		t.Fatal(err)
	}
	values := streams[0].Values
	if values[0] != nil || values[1] != nil {
		t.Errorf("non-finite samples kept: %v %v", values[0], values[1])
	}
	if values[2] == nil || *values[2] != 0.5 {
		t.Errorf("finite sample lost: %v", values[2])
	}
}

func TestDecodeMatrixIgnoresSamplesOutsideTheGrid(t *testing.T) {
	body := []byte(`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[70,"1"],[100,"2"],[190,"3"]]}]}}`)
	streams, err := DecodeMatrix(body, metrichistory.Grid{StartMs: 100_000, StepMs: 30_000, Count: 3})
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, 3)
	for _, value := range streams[0].Values {
		if value == nil {
			got = append(got, "nil")
			continue
		}
		got = append(got, strconv.FormatFloat(*value, 'f', -1, 64))
	}
	if want := "2 nil nil"; strings.Join(got, " ") != want {
		t.Errorf("values = %s, want %s", strings.Join(got, " "), want)
	}
}

func TestDecodeBuildInfoReportsTheVersionOnlyForAPrometheusReply(t *testing.T) {
	version, err := DecodeBuildInfo(loadFixture(t, "buildinfo"))
	if err != nil || version != "3.15.0" {
		t.Fatalf("DecodeBuildInfo(buildinfo) = %q, %v; want 3.15.0", version, err)
	}
	var apiErr *APIError
	if _, err := DecodeBuildInfo(loadFixture(t, "error_bad_data")); !errors.As(err, &apiErr) {
		t.Errorf("error reply: err = %v, want *APIError", err)
	}
	// A test against the wrong Service must fail, not report a connection.
	for _, body := range []string{`<html>Grafana</html>`, `{"status":"success","data":{}}`} {
		if version, err := DecodeBuildInfo([]byte(body)); err == nil {
			t.Errorf("DecodeBuildInfo(%s) = %q, want an error", body, version)
		}
	}
}
