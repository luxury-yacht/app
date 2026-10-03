package panelmetrics

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

var podKey = Key{ClusterID: "dev:dev-cluster", PanelID: "obj:dev:dev-cluster:/v1/pod:podinfo:api"}

func open() bool { return true }

func num(value float64) *float64 { return &value }

func podSample(t int64, cpu float64) Sample {
	return Sample{
		T:      t,
		CPU:    Values{Usage: num(cpu), Request: num(100), Limit: num(500)},
		Memory: Values{Usage: num(64 << 20), Limit: num(256 << 20)},
	}
}

func times(series Series) []int64 {
	out := make([]int64, 0, len(series.Samples))
	for _, sample := range series.Samples {
		out = append(out, sample.T)
	}
	return out
}

func TestBufferKeepsOneSamplePerCollection(t *testing.T) {
	buffer := NewBuffer(10)
	require.NoError(t, buffer.Append(podKey, podSample(1_000, 10), open))
	// The same collection seen again (another render, a second window) and an older one.
	require.NoError(t, buffer.Append(podKey, podSample(1_000, 99), open))
	require.NoError(t, buffer.Append(podKey, podSample(500, 99), open))
	require.NoError(t, buffer.Append(podKey, podSample(6_000, 20), open))

	series := buffer.Since(podKey, 0)
	require.Equal(t, []int64{1_000, 6_000}, times(series))
	require.Equal(t, 10.0, *series.Samples[0].CPU.Usage)
}

func TestBufferKeepsAFixedNumberOfSamplesPerPanel(t *testing.T) {
	buffer := NewBuffer(3)
	for t0 := int64(1); t0 <= 5; t0++ {
		require.NoError(t, buffer.Append(podKey, podSample(t0*1_000, float64(t0)), open))
	}

	series := buffer.Since(podKey, 0)
	require.Equal(t, []int64{3_000, 4_000, 5_000}, times(series))
	// The oldest kept sample: a reader drops anything older it still holds.
	require.Equal(t, int64(3_000), series.FirstT)
}

func TestBufferStoresReservationsOnlyWhenTheyChange(t *testing.T) {
	buffer := NewBuffer(10)
	for t0 := int64(1); t0 <= 4; t0++ {
		require.NoError(t, buffer.Append(podKey, podSample(t0*1_000, 10), open))
	}
	raised := podSample(5_000, 10)
	raised.CPU.Limit = num(1_000)
	require.NoError(t, buffer.Append(podKey, raised, open))

	// Memory per sample is the usage pair; requests and limits are kept as change points.
	require.Len(t, buffer.series[podKey].changes, 2)

	series := buffer.Since(podKey, 0)
	require.Equal(t, 500.0, *series.Samples[3].CPU.Limit)
	require.Equal(t, 100.0, *series.Samples[3].CPU.Request)
	require.Equal(t, 1_000.0, *series.Samples[4].CPU.Limit)
	require.Equal(t, float64(256<<20), *series.Samples[4].Memory.Limit)
}

func TestBufferDropsChangePointsThatPredateTheKeptSamples(t *testing.T) {
	buffer := NewBuffer(2)
	for t0 := int64(1); t0 <= 5; t0++ {
		sample := podSample(t0*1_000, 10)
		sample.CPU.Limit = num(float64(t0 * 100))
		require.NoError(t, buffer.Append(podKey, sample, open))
	}

	require.Len(t, buffer.series[podKey].changes, 2)
	series := buffer.Since(podKey, 0)
	require.Equal(t, 400.0, *series.Samples[0].CPU.Limit)
	require.Equal(t, 500.0, *series.Samples[1].CPU.Limit)
}

func TestBufferReturnsOnlySamplesNewerThanTheReadersLast(t *testing.T) {
	buffer := NewBuffer(10)
	for t0 := int64(1); t0 <= 3; t0++ {
		require.NoError(t, buffer.Append(podKey, podSample(t0*1_000, 10), open))
	}

	require.Equal(t, []int64{3_000}, times(buffer.Since(podKey, 2_000)))
	require.Empty(t, buffer.Since(podKey, 3_000).Samples)
	require.Empty(t, buffer.Since(Key{ClusterID: "other", PanelID: "x"}, 0).Samples)
}

func TestBufferKeepsUnreportedValuesAbsentRatherThanZero(t *testing.T) {
	buffer := NewBuffer(10)
	sample := Sample{T: 1_000, CPU: Values{Request: num(100)}, Memory: Values{Usage: num(0)}}
	require.NoError(t, buffer.Append(podKey, sample, open))

	got := buffer.Since(podKey, 0).Samples[0]
	require.Nil(t, got.CPU.Usage)
	require.Nil(t, got.CPU.Limit)
	require.Equal(t, 100.0, *got.CPU.Request)
	require.Equal(t, 0.0, *got.Memory.Usage)
}

func TestBufferRecordsOnlyForOpenPanels(t *testing.T) {
	buffer := NewBuffer(10)
	require.NoError(t, buffer.Append(podKey, podSample(1_000, 10), func() bool { return false }))
	require.Empty(t, buffer.Since(podKey, 0).Samples)

	require.NoError(t, buffer.Append(podKey, podSample(1_000, 10), open))
	buffer.Remove(podKey)
	require.Empty(t, buffer.Since(podKey, 0).Samples)
}

func TestBufferRejectsSamplesThatCannotBeMetrics(t *testing.T) {
	buffer := NewBuffer(10)
	require.Error(t, buffer.Append(podKey, Sample{T: 0}, open))
	require.Error(t, buffer.Append(podKey, Sample{T: 1, CPU: Values{Usage: num(-1)}}, open))
	require.Error(t, buffer.Append(podKey, Sample{T: 1, Memory: Values{Limit: num(math.Inf(1))}}, open))
	require.Error(t, buffer.Append(Key{PanelID: "x"}, podSample(1, 1), open))
	require.Empty(t, buffer.Since(podKey, 0).Samples)
}
