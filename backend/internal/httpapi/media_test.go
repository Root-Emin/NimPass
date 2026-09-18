package httpapi

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"nimpass/backend/internal/config"
	"nimpass/backend/internal/media"
)

func TestPassCoverUploadRejectsHTMLAndServesJPEG(t *testing.T) {
	pool := httpTestPool(t)
	dir := t.TempDir()
	router := NewRouterWithConfig(pool, slog.Default(), config.Config{
		Environment: "test", Network: "TESTNET", PublicOrigin: "http://localhost:5173", MediaDir: dir,
	})
	var cookie *http.Cookie
	csrf := ""
	request := func(req *http.Request) *httptest.ResponseRecorder {
		t.Helper()
		if req.Method != http.MethodGet {
			req.Header.Set("Origin", "http://localhost:5173")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if csrf != "" && req.Method != http.MethodGet {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		return rr
	}
	jsonRequest := func(method, path string, body any) (int, map[string]any, *httptest.ResponseRecorder) {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		rr := request(req)
		var response map[string]any
		if rr.Body.Len() > 0 && rr.Header().Get("Content-Type") == "application/json" {
			if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
		}
		return rr.Code, response, rr
	}

	wallet, pub, key := httpKey(t)
	status, c, _ := jsonRequest("POST", "/api/v1/auth/challenges", map[string]any{"wallet": wallet})
	if status != 201 {
		t.Fatalf("challenge %d %v", status, c)
	}
	message := c["message"].(string)
	sig := hex.EncodeToString(ed25519.Sign(key, []byte(message)))
	status, login, rr := jsonRequest("POST", "/api/v1/auth/sessions", map[string]any{"challengeId": c["id"], "wallet": wallet, "publicKey": pub, "signature": sig})
	if status != 201 {
		t.Fatalf("login %d %v", status, login)
	}
	cookie = rr.Result().Cookies()[0]
	csrf = login["csrfToken"].(string)

	html := multipartBody(t, "exploit.php.jpg", []byte("<script>alert(1)</script>"))
	req := httptest.NewRequest("POST", "/api/v1/media", html.body)
	req.Header.Set("Content-Type", html.contentType)
	denied := request(req)
	if denied.Code != 400 {
		t.Fatalf("html upload %d %s", denied.Code, denied.Body.String())
	}

	traversal := httptest.NewRequest("GET", "/api/v1/media/../etc/passwd", nil)
	if got := request(traversal); got.Code != 400 && got.Code != 404 {
		t.Fatalf("traversal %d %s", got.Code, got.Body.String())
	}

	cover := multipartBody(t, "photo.png", tinyJPEG(t))
	req = httptest.NewRequest("POST", "/api/v1/media", cover.body)
	req.Header.Set("Content-Type", cover.contentType)
	uploaded := request(req)
	if uploaded.Code != 201 {
		t.Fatalf("jpeg upload %d %s", uploaded.Code, uploaded.Body.String())
	}
	var mediaObj map[string]any
	if err := json.Unmarshal(uploaded.Body.Bytes(), &mediaObj); err != nil {
		t.Fatal(err)
	}
	if mediaObj["kind"] != "pass_cover" || mediaObj["contentType"] != "image/jpeg" {
		t.Fatalf("media DTO %v", mediaObj)
	}
	mediaID := mediaObj["id"].(string)

	served := request(httptest.NewRequest("GET", "/api/v1/media/"+mediaID, nil))
	if served.Code != 200 {
		t.Fatalf("serve %d %s", served.Code, served.Body.String())
	}
	if served.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("content type %q", served.Header().Get("Content-Type"))
	}
	if served.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	if served.Header().Get("Cache-Control") != "public, max-age=604800, immutable" {
		t.Fatalf("cache %q", served.Header().Get("Cache-Control"))
	}
	if sniff := served.Body.Bytes(); len(sniff) < 3 || sniff[0] != 0xff || sniff[1] != 0xd8 || sniff[2] != 0xff {
		t.Fatal("served bytes were not JPEG")
	}
	if bytes.Contains(served.Body.Bytes(), []byte("<script>")) {
		t.Fatal("served cover contained script bytes")
	}

	status, providerCreate, _ := jsonRequest("POST", "/api/v1/providers", map[string]any{"name": "Studio"})
	if status != 201 {
		t.Fatalf("provider %d %v", status, providerCreate)
	}
	_, providers, _ := jsonRequest("GET", "/api/v1/providers", nil)
	providerID := providers["items"].([]any)[0].(map[string]any)["id"].(string)
	status, service, _ := jsonRequest("POST", "/api/v1/providers/"+providerID+"/services", map[string]any{"name": "Yoga", "description": "Classes"})
	if status != 201 {
		t.Fatalf("service %d %v", status, service)
	}
	status, pass, _ := jsonRequest("POST", "/api/v1/providers/"+providerID+"/services/"+service["id"].(string)+"/passes", map[string]any{
		"title": "Ten sessions", "sessions": 10, "priceLuna": 12340000, "coverMediaId": mediaID,
	})
	if status != 201 {
		t.Fatalf("pass %d %v", status, pass)
	}
	if pass["coverMediaId"] != mediaID || pass["coverUrl"] != "/api/v1/media/"+mediaID {
		t.Fatalf("cover fields %v", pass)
	}

	foreign := request(httptest.NewRequest("GET", "/api/v1/media/"+mediaID, nil))
	if foreign.Code != 200 {
		t.Fatalf("public GET after attach %d", foreign.Code)
	}

	oversized := bytes.Repeat([]byte{0xff, 0xd8, 0xff, 0xd9}, media.MaxUploadBytes/4+32)
	big := multipartBody(t, "huge.jpg", oversized)
	req = httptest.NewRequest("POST", "/api/v1/media", big.body)
	req.Header.Set("Content-Type", big.contentType)
	if got := request(req); got.Code != 400 {
		t.Fatalf("oversized upload %d %s", got.Code, got.Body.String())
	}
}

type multipartPayload struct {
	body        *bytes.Buffer
	contentType string
}

func multipartBody(t *testing.T, name string, data []byte) multipartPayload {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return multipartPayload{body: &buf, contentType: writer.FormDataContentType()}
}

func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 6, 6))
	for y := 0; y < 6; y++ {
		for x := 0; x < 6; x++ {
			img.Set(x, y, color.NRGBA{R: 30, G: 90, B: 40, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
