package media

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
)

const (
	// 2 MiB is the accepted upload and the largest re-encoded cover we keep.
	MaxUploadBytes = 2 << 20
	maxEdge        = 1600
	maxPixels      = 4096 * 4096
	jpegQuality    = 82
)

var (
	ErrTooLarge      = errors.New("file too large")
	ErrNotImage      = errors.New("not an allowed image")
	ErrTooManyPixels = errors.New("image dimensions too large")
)

func sniff(raw []byte) string {
	if len(raw) >= 3 && raw[0] == 0xff && raw[1] == 0xd8 && raw[2] == 0xff {
		return "jpeg"
	}
	if len(raw) >= 8 && bytes.Equal(raw[:8], []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}) {
		return "png"
	}
	return ""
}

// ProcessCover turns a client upload into a JPEG we are willing to serve.
//
// The filename, declared Content-Type and original bytes are untrusted
// (docs/09-SECURITY.md §83). Magic bytes, decoder config, pixel limits and a
// full re-encode are what decide whether anything is stored.
func ProcessCover(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return nil, ErrNotImage
	}
	if len(raw) > MaxUploadBytes {
		return nil, ErrTooLarge
	}
	kind := sniff(raw)
	if kind == "" {
		return nil, ErrNotImage
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") || format != kind {
		return nil, ErrNotImage
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
		return nil, ErrTooManyPixels
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxPixels {
		return nil, ErrTooManyPixels
	}
	img, decoded, err := image.Decode(bytes.NewReader(raw))
	if err != nil || decoded != format {
		return nil, ErrNotImage
	}
	img = downscale(img, maxEdge)
	bounds := img.Bounds()
	opaque := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(opaque, opaque.Bounds(), image.White, image.Point{}, draw.Src)
	draw.Draw(opaque, opaque.Bounds(), img, bounds.Min, draw.Over)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, opaque, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, err
	}
	if out.Len() > MaxUploadBytes {
		out.Reset()
		if err := jpeg.Encode(&out, opaque, &jpeg.Options{Quality: 60}); err != nil {
			return nil, err
		}
	}
	if out.Len() == 0 || out.Len() > MaxUploadBytes {
		return nil, ErrTooLarge
	}
	return out.Bytes(), nil
}

func downscale(src image.Image, edge int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= edge && h <= edge {
		return src
	}
	nw, nh := edge, edge
	if w >= h {
		nh = h * edge / w
	} else {
		nw = w * edge / h
	}
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewNRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy := b.Min.Y + y*h/nh
		for x := 0; x < nw; x++ {
			sx := b.Min.X + x*w/nw
			dst.SetNRGBA(x, y, nrgbaAt(src, sx, sy))
		}
	}
	return dst
}

func nrgbaAt(src image.Image, x, y int) color.NRGBA {
	r, g, b, a := src.At(x, y).RGBA()
	return color.NRGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: uint8(a >> 8)}
}
