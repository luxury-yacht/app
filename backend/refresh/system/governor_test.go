package system

import (
	"reflect"
	"testing"
)

func TestGovernorPolicyAssign(t *testing.T) {
	cases := []struct {
		name          string
		keepWarm      int
		mru           []string
		visible       string
		underPressure bool
		want          map[string]ResourceTier
	}{
		{
			name: "single visible cluster is foreground",
			mru:  []string{"a"}, visible: "a", keepWarm: 2,
			want: map[string]ResourceTier{"a": TierForeground},
		},
		{
			name: "warm budget keeps the next N background, rest cold",
			mru:  []string{"a", "b", "c", "d"}, visible: "a", keepWarm: 2,
			want: map[string]ResourceTier{"a": TierForeground, "b": TierBackground, "c": TierBackground, "d": TierCold},
		},
		{
			name: "visible anywhere in MRU is still foreground; warm counts non-visible",
			mru:  []string{"b", "a", "c"}, visible: "a", keepWarm: 1,
			want: map[string]ResourceTier{"b": TierBackground, "a": TierForeground, "c": TierCold},
		},
		{
			name: "memory pressure collapses warm to zero (only visible stays warm)",
			mru:  []string{"a", "b", "c"}, visible: "a", keepWarm: 5, underPressure: true,
			want: map[string]ResourceTier{"a": TierForeground, "b": TierCold, "c": TierCold},
		},
		{
			name: "keepWarm zero demotes every non-visible cluster",
			mru:  []string{"a", "b", "c"}, visible: "a", keepWarm: 0,
			want: map[string]ResourceTier{"a": TierForeground, "b": TierCold, "c": TierCold},
		},
		{
			name: "no visible cluster (e.g. app blurred): all subject to the warm budget",
			mru:  []string{"a", "b", "c"}, visible: "", keepWarm: 1,
			want: map[string]ResourceTier{"a": TierBackground, "b": TierCold, "c": TierCold},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := GovernorPolicy{KeepWarm: c.keepWarm}.Assign(c.mru, c.visible, c.underPressure)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("Assign(%v, %q, pressure=%v) =\n  %v\nwant\n  %v", c.mru, c.visible, c.underPressure, got, c.want)
			}
		})
	}
}

func TestPlanGovernorTransitions(t *testing.T) {
	// indexByCluster lets assertions ignore the (nondeterministic) map-iteration
	// order PlanGovernorTransitions inherits from its `desired` input.
	indexByCluster := func(ts []GovernorTransition) map[string]GovernorTransition {
		out := make(map[string]GovernorTransition, len(ts))
		for _, t := range ts {
			out[t.ClusterID] = t
		}
		return out
	}

	cases := []struct {
		name        string
		lastApplied map[string]ResourceTier
		desired     map[string]ResourceTier
		want        map[string]GovernorTransition
	}{
		{
			name:        "cold start: foreground built+active, background built+idle, cold torn down",
			lastApplied: nil,
			desired:     map[string]ResourceTier{"a": TierForeground, "b": TierBackground, "c": TierCold},
			want: map[string]GovernorTransition{
				"a": {ClusterID: "a", Tier: TierForeground, EnsureRunning: true, MetricsActive: true},
				"b": {ClusterID: "b", Tier: TierBackground, EnsureRunning: true, MetricsActive: false},
				"c": {ClusterID: "c", Tier: TierCold, Teardown: true},
			},
		},
		{
			name:        "no-op when tier is unchanged",
			lastApplied: map[string]ResourceTier{"a": TierForeground, "b": TierBackground},
			desired:     map[string]ResourceTier{"a": TierForeground, "b": TierBackground},
			want:        map[string]GovernorTransition{},
		},
		{
			name:        "promote background->foreground pins metrics active without rebuild churn flag",
			lastApplied: map[string]ResourceTier{"a": TierBackground},
			desired:     map[string]ResourceTier{"a": TierForeground},
			want: map[string]GovernorTransition{
				"a": {ClusterID: "a", Tier: TierForeground, EnsureRunning: true, MetricsActive: true},
			},
		},
		{
			name:        "demote foreground->background pauses metrics but keeps it running",
			lastApplied: map[string]ResourceTier{"a": TierForeground},
			desired:     map[string]ResourceTier{"a": TierBackground},
			want: map[string]GovernorTransition{
				"a": {ClusterID: "a", Tier: TierBackground, EnsureRunning: true, MetricsActive: false},
			},
		},
		{
			name:        "demote background->cold tears down",
			lastApplied: map[string]ResourceTier{"a": TierBackground},
			desired:     map[string]ResourceTier{"a": TierCold},
			want: map[string]GovernorTransition{
				"a": {ClusterID: "a", Tier: TierCold, Teardown: true},
			},
		},
		{
			name:        "re-warm cold->foreground rebuilds and activates",
			lastApplied: map[string]ResourceTier{"a": TierCold},
			desired:     map[string]ResourceTier{"a": TierForeground},
			want: map[string]GovernorTransition{
				"a": {ClusterID: "a", Tier: TierForeground, EnsureRunning: true, MetricsActive: true},
			},
		},
		{
			name:        "cluster dropped from desired (closed) produces no transition",
			lastApplied: map[string]ResourceTier{"a": TierForeground, "b": TierBackground},
			desired:     map[string]ResourceTier{"a": TierForeground},
			want:        map[string]GovernorTransition{},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := indexByCluster(PlanGovernorTransitions(c.lastApplied, c.desired))
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("PlanGovernorTransitions(%v, %v) =\n  %v\nwant\n  %v", c.lastApplied, c.desired, got, c.want)
			}
		})
	}
}

func TestResourceTierString(t *testing.T) {
	for tier, want := range map[ResourceTier]string{TierForeground: "foreground", TierBackground: "background", TierCold: "cold"} {
		if tier.String() != want {
			t.Fatalf("%d.String() = %q, want %q", tier, tier.String(), want)
		}
	}
}
