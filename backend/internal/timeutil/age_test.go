package timeutil

import (
	"testing"
	"time"
)

func TestFormatAgeZero(t *testing.T) {
	if got := FormatAge(time.Time{}); got != "0s" {
		t.Fatalf("expected 0s, got %s", got)
	}
}

func TestFormatAgeSeconds(t *testing.T) {
	t0 := time.Now().Add(-30 * time.Second)
	if got := FormatAge(t0); got != "30s" {
		t.Fatalf("expected 30s, got %s", got)
	}
}

func TestFormatAgeMinutesHoursAndBeyond(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name     string
		input    time.Time
		expected string
	}{
		{"minutes", now.Add(-(3*time.Minute + 500*time.Millisecond)), "3m"},
		{"hours", now.Add(-(2*time.Hour + 500*time.Millisecond)), "2h"},
		{"daysWithHours", now.Add(-(3*24*time.Hour + 5*time.Hour + 500*time.Millisecond)), "3d5hr"},
		{"days", now.Add(-(10*24*time.Hour + 500*time.Millisecond)), "10d"},
		{"months", now.Add(-(90*24*time.Hour + 500*time.Millisecond)), "3mo"},
		{"yearsWithMonths", now.Add(-(18*30*24*time.Hour + 500*time.Millisecond)), "1yr6mo"},
	}

	for _, tt := range tests {
		if got := FormatAge(tt.input); got != tt.expected {
			t.Fatalf("%s: expected %s, got %s", tt.name, tt.expected, got)
		}
	}
}

func TestFormatAgeFutureReturnsZero(t *testing.T) {
	if got := FormatAge(time.Now().Add(5 * time.Second)); got != "0s" {
		t.Fatalf("expected 0s for future timestamp, got %s", got)
	}
}
