package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

type MediaRepository struct{ Pool *pgxpool.Pool }

func (r MediaRepository) Insert(ctx context.Context, obj application.MediaObject) error {
	if r.Pool == nil {
		return application.ErrNotFound
	}
	_, err := r.Pool.Exec(ctx, `INSERT INTO media_objects(id,owner_identity_id,kind,content_type,byte_size,created_at) VALUES($1,$2,$3,$4,$5,$6)`, obj.ID, obj.OwnerIdentityID, obj.Kind, obj.ContentType, obj.ByteSize, obj.CreatedAt)
	return err
}

func (r MediaRepository) Get(ctx context.Context, id domain.ID) (application.MediaObject, error) {
	return r.scan(r.Pool, ctx, `SELECT id,owner_identity_id,kind,content_type,byte_size,created_at FROM media_objects WHERE id=$1`, id)
}

func (r MediaRepository) GetOwned(ctx context.Context, owner, id domain.ID) (application.MediaObject, error) {
	return r.scan(r.Pool, ctx, `SELECT id,owner_identity_id,kind,content_type,byte_size,created_at FROM media_objects WHERE id=$1 AND owner_identity_id=$2`, id, owner)
}

func (r MediaRepository) scan(pool *pgxpool.Pool, ctx context.Context, query string, args ...any) (application.MediaObject, error) {
	var obj application.MediaObject
	if pool == nil {
		return obj, application.ErrNotFound
	}
	err := pool.QueryRow(ctx, query, args...).Scan(&obj.ID, &obj.OwnerIdentityID, &obj.Kind, &obj.ContentType, &obj.ByteSize, &obj.CreatedAt)
	return obj, notFound(err)
}
