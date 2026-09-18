package application

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"nimpass/backend/internal/domain"
	"nimpass/backend/internal/media"
)

const (
	MediaKindPassCover = "pass_cover"
	MediaJPEG          = "image/jpeg"
)

type MediaObject struct {
	ID              domain.ID
	OwnerIdentityID domain.ID
	Kind            string
	ContentType     string
	ByteSize        int
	CreatedAt       time.Time
}

type MediaStore interface {
	Insert(context.Context, MediaObject) error
	Get(context.Context, domain.ID) (MediaObject, error)
	GetOwned(context.Context, domain.ID, domain.ID) (MediaObject, error)
}

type FileStore interface {
	Write(domain.ID, []byte) error
	Read(domain.ID) ([]byte, error)
}

type Media struct {
	Store MediaStore
	Files FileStore
	Now   func() time.Time
}

func (m Media) UploadCover(ctx context.Context, actor Identity, raw []byte) (MediaObject, error) {
	processed, err := media.ProcessCover(raw)
	if err != nil {
		if errors.Is(err, media.ErrTooLarge) || errors.Is(err, media.ErrNotImage) || errors.Is(err, media.ErrTooManyPixels) {
			return MediaObject{}, fmt.Errorf("%w: %v", ErrValidation, err)
		}
		return MediaObject{}, err
	}
	id, err := domain.NewID()
	if err != nil {
		return MediaObject{}, err
	}
	obj := MediaObject{
		ID:              id,
		OwnerIdentityID: actor.ID,
		Kind:            MediaKindPassCover,
		ContentType:     MediaJPEG,
		ByteSize:        len(processed),
		CreatedAt:       m.Now().UTC(),
	}
	if err := m.Files.Write(id, processed); err != nil {
		return MediaObject{}, err
	}
	if err := m.Store.Insert(ctx, obj); err != nil {
		return MediaObject{}, err
	}
	return obj, nil
}

func (m Media) Open(ctx context.Context, id domain.ID) (MediaObject, []byte, error) {
	obj, err := m.Store.Get(ctx, id)
	if err != nil {
		return MediaObject{}, nil, err
	}
	data, err := m.Files.Read(id)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return MediaObject{}, nil, ErrNotFound
		}
		return MediaObject{}, nil, err
	}
	if len(data) == 0 {
		return MediaObject{}, nil, ErrNotFound
	}
	return obj, data, nil
}

func (m Media) OwnedCover(ctx context.Context, owner, id domain.ID) error {
	obj, err := m.Store.GetOwned(ctx, owner, id)
	if err != nil {
		return err
	}
	if obj.Kind != MediaKindPassCover {
		return ErrValidation
	}
	return nil
}
