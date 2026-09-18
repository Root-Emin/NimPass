package domain

import "fmt"

// Accent is a pass's chosen visual identity. The six values are the same
// earth tones the frontend already uses for derived marks — never a free-form
// colour, never the product accent by default.
type Accent string

const (
	AccentPine  Accent = "PINE"
	AccentSlate Accent = "SLATE"
	AccentClay  Accent = "CLAY"
	AccentOlive Accent = "OLIVE"
	AccentPlum  Accent = "PLUM"
	AccentAmber Accent = "AMBER"
)

// ParseAccent accepts a stored or requested token. Empty is valid: older
// passes have no choice recorded, and the frontend derives a tone from the
// service name rather than forcing pine on every page.
func ParseAccent(value string) (Accent, error) {
	switch Accent(value) {
	case "", AccentPine, AccentSlate, AccentClay, AccentOlive, AccentPlum, AccentAmber:
		return Accent(value), nil
	default:
		return "", fmt.Errorf("unknown pass accent %q", value)
	}
}
