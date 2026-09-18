package domain

import (
	"testing"
	"time"
)

/*
A Pass expiration must be in the future when it is set.

The rule already lived in `ExpirationPolicy.Resolve`, which both `NewPass` and
`Pass.Publish` call, so create and update have always enforced it. What was
missing was a test saying so — and in particular one saying *where* the
boundary is and that it is an instant rather than a wall clock.
*/

func newPassAt(t *testing.T, expires *time.Time, now time.Time) error {
	t.Helper()
	_, err := NewPass(mustID(t), mustID(t), mustID(t), "10 Sessions", "", 10, 25_000_000, NewExpirationPolicy(expires), "", now)
	return err
}

func TestPassExpirationBoundaryIsStrictlyInTheFuture(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		name     string
		expires  time.Time
		accepted bool
	}{
		{"a day ago", now.Add(-24 * time.Hour), false},
		{"a second ago", now.Add(-time.Second), false},
		// The boundary itself. `Resolve` requires After(now), so an expiration
		// equal to the instant it is set at is already over.
		{"exactly now", now, false},
		{"a nanosecond later", now.Add(time.Nanosecond), true},
		{"a second later", now.Add(time.Second), true},
		{"a year later", now.Add(365 * 24 * time.Hour), true},
	} {
		err := newPassAt(t, &c.expires, now)
		if c.accepted && err != nil {
			t.Fatalf("%s was refused: %v", c.name, err)
		}
		if !c.accepted && err == nil {
			t.Fatalf("%s was accepted", c.name)
		}
	}
	// No expiration at all stays legal: an open-ended Pass is the default.
	if err := newPassAt(t, nil, now); err != nil {
		t.Fatalf("an open-ended pass was refused: %v", err)
	}
}

// The comparison is between instants, not between the numbers on two clocks.
//
// A provider in Kiritimati (+14:00) and one in Niue (-11:00) can write the same
// civil date and mean moments 25 hours apart. Comparing wall clocks would
// accept a date already past for one of them and refuse a future one for the
// other, so both directions are asserted.
func TestPassExpirationComparesInstantsNotWallClocks(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	ahead := time.FixedZone("Kiritimati", 14*60*60)
	behind := time.FixedZone("Niue", -11*60*60)

	// 2026-09-19T01:00+14:00 is 2026-09-18T11:00Z — an hour *before* now, even
	// though its date and time both read later than the UTC clock.
	pastInAFarAheadZone := time.Date(2026, 9, 19, 1, 0, 0, 0, ahead)
	if !pastInAFarAheadZone.Before(now) {
		t.Fatal("fixture does not describe a past instant")
	}
	if err := newPassAt(t, &pastInAFarAheadZone, now); err == nil {
		t.Fatal("a past instant written in a far-ahead zone was accepted")
	}

	// 2026-09-18T02:00-11:00 is 2026-09-18T13:00Z — an hour *after* now, even
	// though its clock reads earlier.
	futureInAFarBehindZone := time.Date(2026, 9, 18, 2, 0, 0, 0, behind)
	if !futureInAFarBehindZone.After(now) {
		t.Fatal("fixture does not describe a future instant")
	}
	if err := newPassAt(t, &futureInAFarBehindZone, now); err != nil {
		t.Fatalf("a future instant written in a far-behind zone was refused: %v", err)
	}

	// And the stored value is normalised to UTC, so nothing downstream has to
	// carry the provider's zone to read it back.
	pass, err := NewPass(mustID(t), mustID(t), mustID(t), "10 Sessions", "", 10, 25_000_000, NewExpirationPolicy(&futureInAFarBehindZone), "", now)
	if err != nil {
		t.Fatal(err)
	}
	if pass.Expiration.ExpiresAt == nil || !pass.Expiration.ExpiresAt.Equal(futureInAFarBehindZone) {
		t.Fatalf("expiration did not survive the round trip: %v", pass.Expiration.ExpiresAt)
	}
}
