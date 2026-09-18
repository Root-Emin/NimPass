package media

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nimpass/backend/internal/domain"
)

func TestDiskWritesUUIDNamedJPEG(t *testing.T) {
	dir := t.TempDir()
	store := Disk{Dir: dir}
	id, err := domain.NewID()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Write(id, []byte("jpeg-bytes")); err != nil {
		t.Fatal(err)
	}
	got, err := store.Read(id)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "jpeg-bytes" {
		t.Fatalf("got %q", got)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != string(id)+".jpg" {
		t.Fatalf("unsafe name stored: %v", entries)
	}
}

func TestDiskRejectsPathTraversalIDs(t *testing.T) {
	dir := t.TempDir()
	store := Disk{Dir: dir}
	for _, id := range []domain.ID{"../etc/passwd", domain.ID(strings.Repeat("a", 36)), "not-a-uuid"} {
		if err := store.Write(id, []byte("x")); err == nil {
			t.Fatalf("accepted %q", id)
		}
		if _, err := store.Read(id); err == nil {
			t.Fatalf("read accepted %q", id)
		}
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 0 {
		t.Fatalf("traversal wrote files: %v %v", entries, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "..")); err != nil {
		t.Fatal(err)
	}
}
