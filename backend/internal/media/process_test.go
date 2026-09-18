package media

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestProcessCoverAcceptsJPEGAndPNG(t *testing.T) {
	jpegBytes := encodeJPEG(t, 8, 8)
	pngBytes := encodePNG(t, 8, 8)
	for _, raw := range [][]byte{jpegBytes, pngBytes} {
		out, err := ProcessCover(raw)
		if err != nil {
			t.Fatal(err)
		}
		if sniff(out) != "jpeg" {
			t.Fatalf("re-encoded cover was not JPEG")
		}
		if _, err := jpeg.Decode(bytes.NewReader(out)); err != nil {
			t.Fatalf("re-encoded JPEG does not decode: %v", err)
		}
	}
}

func TestProcessCoverRejectsNonImages(t *testing.T) {
	cases := [][]byte{
		nil,
		[]byte("<!DOCTYPE html><script>alert(1)</script>"),
		[]byte("<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'></svg>"),
		[]byte("GIF89a" + "\x01\x00\x01\x00"),
		[]byte("%PDF-1.4"),
		append([]byte("MZ"), bytes.Repeat([]byte("A"), 32)...),
		[]byte{0xff, 0xd8}, // truncated JPEG magic
	}
	for _, raw := range cases {
		if _, err := ProcessCover(raw); err != ErrNotImage {
			t.Fatalf("accepted %#v: %v", truncate(raw), err)
		}
	}
}

func TestProcessCoverRejectsOversizedUpload(t *testing.T) {
	raw := bytes.Repeat([]byte{0xff, 0xd8, 0xff}, MaxUploadBytes/3+10)
	if _, err := ProcessCover(raw); err != ErrTooLarge {
		t.Fatalf("got %v", err)
	}
}

func TestProcessCoverRejectsPixelBombHeader(t *testing.T) {
	raw := pngIHDR(10000, 10000)
	if _, err := ProcessCover(raw); err != ErrTooManyPixels {
		t.Fatalf("got %v want ErrTooManyPixels", err)
	}
}

func TestProcessCoverStripsTrailingHTML(t *testing.T) {
	raw := append(encodeJPEG(t, 4, 4), []byte("<script>alert(1)</script>")...)
	out, err := ProcessCover(raw)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out, []byte("<script>")) {
		t.Fatal("re-encoded cover retained trailing HTML")
	}
}

func encodeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: 200, G: 40, B: 40, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func encodePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: 40, G: 80, B: 200, A: 128})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func pngIHDR(width, height uint32) []byte {
	sig := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], width)
	binary.BigEndian.PutUint32(ihdr[4:8], height)
	ihdr[8] = 8
	ihdr[9] = 2
	chunkType := []byte("IHDR")
	crc := crc32.ChecksumIEEE(append(append([]byte{}, chunkType...), ihdr...))
	out := append(sig, 0, 0, 0, 13)
	out = append(out, chunkType...)
	out = append(out, ihdr...)
	var crcBuf [4]byte
	binary.BigEndian.PutUint32(crcBuf[:], crc)
	return append(out, crcBuf[:]...)
}

func truncate(raw []byte) []byte {
	if len(raw) > 24 {
		return raw[:24]
	}
	return raw
}
