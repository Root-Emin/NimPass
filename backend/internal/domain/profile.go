package domain

import (
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Category belongs to a service; Passes inherit the current category from it.
// Empty means unclassified, never an inferred classification of legacy records.
type Category string

func Categories() []Category {
	return []Category{"fitness", "tutoring", "languages", "coaching", "wellness", "music", "beauty", "consulting", "mentoring"}
}

func ParseCategory(value string) (Category, error) {
	if value == "" {
		return "", nil
	}
	for _, c := range Categories() {
		if value == string(c) {
			return c, nil
		}
	}
	return "", errors.New("unknown category")
}

var slugShape = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
var slugSeparators = regexp.MustCompile(`[^a-z0-9]+`)

func NormalizeSlug(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) < 3 || len(value) > 80 || !slugShape.MatchString(value) {
		return "", errors.New("slug requires 3 to 80 lowercase ASCII letters, digits and single hyphens")
	}
	// UUIDs belong to the legacy ID route, never to the public slug namespace.
	if _, err := ParseID(value); err == nil {
		return "", errors.New("slug cannot be a UUID")
	}
	switch value {
	case "api", "auth", "admin", "www", "app", "public", "providers", "packages", "passes", "discover", "health", "new", "settings", "support", "login", "logout":
		return "", errors.New("reserved slug")
	}
	return value, nil
}

// GeneratedSlug is the collision-proof public slug for a provider: their name
// plus their own id, which nothing else can hold.
//
// It is the last candidate `SlugCandidates` offers rather than the only one,
// because it is unique at the cost of being unreadable — and a provider URL
// exists to be sent to a customer.
func GeneratedSlug(name string, id ID) string {
	base := slugBase(name)
	if base == "" {
		base = "provider"
	}
	return base + "-" + strings.ReplaceAll(string(id), "-", "")
}

// How many readable candidates are tried before falling back to the id form.
// Nine is enough that "the ninth Alex" is a curiosity rather than a case worth
// designing for, and small enough that a contended name cannot turn provider
// creation into a long series of failing inserts.
const readableSlugCandidates = 9

// SlugCandidates lists the public slugs a new provider may take, best first.
//
//	Emin Kutlu  ->  emin-kutlu, emin-kutlu-2 … emin-kutlu-9, emin-kutlu-<id>
//
// The caller walks the list and keeps the first the database accepts, so
// uniqueness is decided by `providers_slug_unique` and never by a read-then-
// write race here. The last entry carries the provider's own id and therefore
// always succeeds, which is what makes the walk terminate.
//
// A name that cannot produce a valid slug on its own — two characters, or
// nothing but punctuation or non-ASCII script — skips straight to that last
// entry rather than being padded into something the provider never wrote.
func SlugCandidates(name string, id ID) []string {
	base := slugBase(name)
	fallback := GeneratedSlug(name, id)
	// An empty base means the name produced nothing a URL can carry — two
	// characters, punctuation, or a script with no ASCII in it. The readable
	// candidates would then all be the literal word "provider", and handing the
	// first such account `/providers/provider` is worse than the id form.
	if base == "" {
		return []string{fallback}
	}
	if _, err := NormalizeSlug(base); err != nil {
		return []string{fallback}
	}
	out := make([]string, 0, readableSlugCandidates+1)
	out = append(out, base)
	for n := 2; n <= readableSlugCandidates; n++ {
		out = append(out, base+"-"+strconv.Itoa(n))
	}
	return append(out, fallback)
}

// slugBase reduces a display name to the readable part of a slug, or "" when
// the name has nothing a URL can carry.
func slugBase(name string) string {
	base := strings.Trim(slugSeparators.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(base) > 40 {
		base = strings.TrimRight(base[:40], "-")
	}
	return base
}

// Nil fields preserve existing values on edit; an empty string clears a field.
// Slugs are assigned at creation and immutable, keeping shared URLs stable.
type ProfileInput struct {
	Slug     *string `json:"slug"`
	Headline *string `json:"headline"`
	Bio      *string `json:"bio"`
	// A picture the provider chose from Nimiq's identicon set, numbered within
	// their own wallet. 0 is the wallet's own identicon.
	AvatarVariant *int16  `json:"avatarVariant"`
	AvatarURL     *string `json:"avatarUrl"`
	Location      *string `json:"location"`
}

// How many identicons of one wallet the gallery may offer, 0 included.
const AvatarVariants = 256

func (p *Provider) ApplyProfile(input ProfileInput) error {
	if input.Slug != nil {
		slug, err := NormalizeSlug(*input.Slug)
		if err != nil {
			return err
		}
		if p.Slug != "" && p.Slug != slug {
			return errors.New("slug is immutable")
		}
		p.Slug = slug
	}
	for _, f := range []struct {
		input *string
		dst   *string
		max   int
	}{
		{input.Headline, &p.Headline, 160}, {input.Bio, &p.Bio, 2000},
		{input.Location, &p.Location, 160}, {input.AvatarURL, &p.AvatarURL, 2048},
	} {
		if f.input == nil {
			continue
		}
		value := strings.TrimSpace(*f.input)
		if len(value) > f.max || strings.ContainsRune(value, '\x00') {
			return errors.New("invalid profile field")
		}
		*f.dst = value
	}
	if input.AvatarVariant != nil {
		if *input.AvatarVariant < 0 || int(*input.AvatarVariant) >= AvatarVariants {
			return errors.New("avatarVariant is outside the identicon gallery")
		}
		p.AvatarVariant = *input.AvatarVariant
	}
	if p.AvatarURL != "" {
		u, err := url.Parse(p.AvatarURL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
			return errors.New("avatarUrl requires an HTTPS URL without credentials or fragment")
		}
	}
	return nil
}
