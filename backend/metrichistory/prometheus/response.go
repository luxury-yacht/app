package prometheus

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/luxury-yacht/app/backend/metrichistory"
)

// ErrUnexpectedResult reports a successful response that is not a range-query matrix.
var ErrUnexpectedResult = errors.New("prometheus: response is not a matrix")

// APIError is Prometheus' own error response, e.g. errorType "bad_data" for an invalid query.
type APIError struct {
	Type    string
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("prometheus %s: %s", e.Type, e.Message) }

// Stream is one result series aligned to the response grid; nil values are gaps.
type Stream struct {
	Labels map[string]string
	Values []*float64
}

// errNoBuildInfo means a reply decoded but carried no Prometheus version, e.g. from the wrong Service.
var errNoBuildInfo = errors.New("prometheus: the reply has no build info; is this a Prometheus server?")

// envelope is the status part every Prometheus API response shares.
type envelope struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
}

func (e envelope) apiError() error {
	if e.Status == "error" {
		return &APIError{Type: e.ErrorType, Message: e.Error}
	}
	return nil
}

type apiResponse struct {
	envelope
	Data struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string    `json:"metric"`
			Values [][2]json.RawMessage `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

// DecodeMatrix decodes a query_range response body onto grid. Prometheus' error responses
// become *APIError; an empty result is no data, not an error.
func DecodeMatrix(body []byte, grid metrichistory.Grid) ([]Stream, error) {
	var response apiResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("prometheus: decode response: %w", err)
	}
	if err := response.apiError(); err != nil {
		return nil, err
	}
	if response.Data.ResultType != "matrix" {
		return nil, fmt.Errorf("%w: got %q", ErrUnexpectedResult, response.Data.ResultType)
	}
	streams := make([]Stream, 0, len(response.Data.Result))
	for _, result := range response.Data.Result {
		values, err := alignSamples(result.Values, grid)
		if err != nil {
			return nil, err
		}
		streams = append(streams, Stream{Labels: result.Metric, Values: values})
	}
	return streams, nil
}

// DecodeBuildInfo returns the server version from a status/buildinfo response.
func DecodeBuildInfo(body []byte) (string, error) {
	var response struct {
		envelope
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("prometheus: decode build info: %w", err)
	}
	if err := response.apiError(); err != nil {
		return "", err
	}
	if response.Data.Version == "" {
		return "", errNoBuildInfo
	}
	return response.Data.Version, nil
}

// alignSamples places [unixSeconds, "value"] pairs on the grid. Samples off the grid are
// ignored, and NaN/Inf become gaps because JSON cannot carry them.
func alignSamples(samples [][2]json.RawMessage, grid metrichistory.Grid) ([]*float64, error) {
	values := make([]*float64, grid.Count)
	for _, sample := range samples {
		at, value, err := parseSample(sample)
		if err != nil {
			return nil, err
		}
		index, ok := grid.Index(at)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		values[index] = &value
	}
	return values, nil
}

func parseSample(sample [2]json.RawMessage) (time.Time, float64, error) {
	var seconds float64
	if err := json.Unmarshal(sample[0], &seconds); err != nil {
		return time.Time{}, 0, fmt.Errorf("prometheus: sample timestamp: %w", err)
	}
	var text string
	if err := json.Unmarshal(sample[1], &text); err != nil {
		return time.Time{}, 0, fmt.Errorf("prometheus: sample value: %w", err)
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return time.Time{}, 0, fmt.Errorf("prometheus: sample value %q: %w", text, err)
	}
	return time.UnixMilli(int64(math.Round(seconds * 1000))), value, nil
}
