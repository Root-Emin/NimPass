package httpapi

import (
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/media"
)

func (h *handler) uploadMedia(w http.ResponseWriter, r *http.Request) {
	if !h.allow(r, "media-upload:"+string(sessionFrom(r).Identity.ID), 20, 10*time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many uploads")
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/form-data" {
		apiFailure(w, r, http.StatusUnsupportedMediaType, "CONTENT_TYPE", "Multipart form required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+256<<10)
	if err := r.ParseMultipartForm(media.MaxUploadBytes); err != nil {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Upload too large or invalid")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "file is required")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, media.MaxUploadBytes+1))
	if err != nil {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Upload unreadable")
		return
	}
	if int64(len(raw)) > media.MaxUploadBytes {
		apiFailure(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Upload too large")
		return
	}
	obj, err := h.media.UploadCover(r.Context(), sessionFrom(r).Identity, raw)
	if err != nil {
		catalogError(w, r, err)
		return
	}
	respond(w, 201, mediaDTO(obj))
}

func (h *handler) getMedia(w http.ResponseWriter, r *http.Request) {
	if !h.allow(r, "media-get:"+h.clientIP(r), 240, time.Minute) {
		apiFailure(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests")
		return
	}
	id, ok := parsedID(w, r, chi.URLParam(r, "mediaID"))
	if !ok {
		return
	}
	_, data, err := h.media.Open(r.Context(), id)
	if err != nil {
		mappedError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", application.MediaJPEG)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", `inline; filename="cover.jpg"`)
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func mediaDTO(obj application.MediaObject) any {
	return map[string]any{
		"id":          obj.ID,
		"kind":        obj.Kind,
		"contentType": obj.ContentType,
		"byteSize":    obj.ByteSize,
		"createdAt":   obj.CreatedAt,
	}
}
