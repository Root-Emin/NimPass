package media

import (
	"os"
	"path/filepath"

	"nimpass/backend/internal/domain"
)

// Disk stores re-encoded covers under operator-controlled names.
//
// The original filename never reaches the filesystem (docs/09-SECURITY.md §83).
// Paths are derived from a parsed UUID, so a client cannot traverse out of Dir.
type Disk struct {
	Dir string
}

func (d Disk) path(id domain.ID) (string, error) {
	parsed, err := domain.ParseID(string(id))
	if err != nil {
		return "", err
	}
	if d.Dir == "" {
		return "", os.ErrInvalid
	}
	return filepath.Join(d.Dir, string(parsed)+".jpg"), nil
}

func (d Disk) Write(id domain.ID, data []byte) error {
	if err := os.MkdirAll(d.Dir, 0o700); err != nil {
		return err
	}
	p, err := d.path(id)
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (d Disk) Read(id domain.ID) ([]byte, error) {
	p, err := d.path(id)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(p)
}
