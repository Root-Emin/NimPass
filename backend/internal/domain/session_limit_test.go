package domain

import (
	"errors"
	"math"
	"runtime"
	"testing"
	"time"
)

/*
The bound on how many sessions a Pass may be sold with.

It is stated twice on purpose. `NewSessionCount` is the gate a catalogue Pass
passes through, and `NewPassSessions` is the gate in front of the allocation —
because the value that reaches the allocation has not always been through the
first one.
*/

func TestSessionCountAcceptsTheProductRangeAndNothingAbove(t *testing.T) {
	for _, value := range []int32{1, 2, 499, 500} {
		count, err := NewSessionCount(value)
		if err != nil || int32(count) != value {
			t.Fatalf("sessions=%d was refused: %v", value, err)
		}
	}
	for _, value := range []int32{0, -1, 501, 1_000_000, math.MaxInt32} {
		if _, err := NewSessionCount(value); err == nil {
			t.Fatalf("sessions=%d was accepted", value)
		}
	}
	if MaxSessionsPerPass != 500 {
		t.Fatalf("the documented product limit moved to %d without this test", MaxSessionsPerPass)
	}
}

// 500 sessions build; 501 does not.
func TestPassSessionsStopAtTheLimit(t *testing.T) {
	now := time.Now().UTC()
	id := mustID(t)
	sessions, err := NewPassSessions(id, MaxSessionsPerPass, now, NewID)
	if err != nil || len(sessions) != int(MaxSessionsPerPass) {
		t.Fatalf("a full-size pass did not build: %d %v", len(sessions), err)
	}
	if sessions[0].SequenceNumber != 1 || sessions[len(sessions)-1].SequenceNumber != int32(MaxSessionsPerPass) {
		t.Fatalf("sessions are not numbered 1..N: %d..%d", sessions[0].SequenceNumber, sessions[len(sessions)-1].SequenceNumber)
	}
	if _, err := NewPassSessions(id, MaxSessionsPerPass+1, now, NewID); !errors.Is(err, ErrTooManySessions) {
		t.Fatalf("501 sessions were built: %v", err)
	}
}

// The refusal happens before the allocation, which is the half that matters.
//
// A count of two billion is hundreds of gigabytes of slice capacity. If the
// bound were checked after `make` — or not at all — this test would not report
// a failure, it would take the process down with it. So the assertion is on
// bytes allocated, measured across the call.
func TestAnAbsurdSessionCountAllocatesNothing(t *testing.T) {
	now := time.Now().UTC()
	id := mustID(t)
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	for _, count := range []SessionCount{MaxSessionsPerPass + 1, 1_000_000, 2_000_000_000, math.MaxInt32} {
		if _, err := NewPassSessions(id, count, now, NewID); !errors.Is(err, ErrTooManySessions) {
			t.Fatalf("count=%d was built: %v", count, err)
		}
	}
	runtime.ReadMemStats(&after)
	// Four refusals should cost essentially nothing. A megabyte is far above
	// what error values need and far below one session list of any size worth
	// worrying about.
	if grew := after.TotalAlloc - before.TotalAlloc; grew > 1<<20 {
		t.Fatalf("refusing four oversized counts allocated %d bytes", grew)
	}
}
