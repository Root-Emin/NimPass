# Mission 05 — Backend completion ve release denetimi

Tarih: 15 Eylül 2026. Kapsam: `backend/**`. Frontend, kök README ve `docs/**` değiştirilmedi. Başlangıçta mevcut olan pass accent / migration 7 ve signing-scheme değişiklikleri korundu; bu rapor çalışma ağacının o günkü durumunu değerlendirir. Canlı Nimiq cihazı veya gerçek Testnet ödeme kanıtı sağlanmadı.

**Later note (ADR-004):** the sellable catalog item is a Pass. Live HTTP paths are `/public/passes` and `/catalog/passes`, not `/public/packages`. The routes below describe Mission 05 as shipped on 15 September 2026.

## 1. Mission 01–04.1 regresyon denetimi

Auth → session/CSRF → provider/payout → service/pass/publish → discovery → purchase intent → transaction matching → finality/reconciliation → compensation veya tek purchased pass → customer authorization → provider lookup → atomic confirm → history zinciri incelendi ve PostgreSQL testleriyle doğrulandı. Fake payment completion eklenmedi. Receipt, Pass ve redemption otoritesi PostgreSQL transaction/constraint katmanında kaldı.

## 2. Provider slug

`docs/08-ARCHITECTURE.md` provider modeli ve public routing için slug öngörüyor. `slug`, internal UUID'den ayrıldı. Custom slug trim/lowercase normalizasyonu, ASCII biçimi, 3–80 sınırı, reserved isimler ve UUID reddi uygulanıyor. Unique constraint eşzamanlı çakışmaları engelliyor. Omitted slug ve eski kayıtlar için isim öneki + UUID suffix kullanılıyor. Slug oluşturulduktan sonra değişmez; isim güncellemesi paylaşılan URL'yi bozmaz. DB trigger da bu kuralı korur. UUID ile private authorization devam eder; slug yetki sağlamaz.

## 3. Category

`docs/03-DESIGN-SYSTEM.md` içindeki dokuz kategori kullanıldı: fitness, tutoring, languages, coaching, wellness, music, beauty, consulting, mentoring. Kategori serviste saklanır; paket servisinin güncel kategorisini devralır. `service_categories` FK bütünlüğü sağlar. Boş kategori unclassified anlamındadır; eski kayıtlara tahminle kategori atanmaz. Kategori otoritesi backend'dir.

## 4. Rich provider profile

Mevcut `name` display name olarak korundu. `headline`, `bio`, `avatarUrl`, `location` kalıcı alanları eklendi. Edit DTO, domain ve public DTO ayrıdır. Omitted/null optional alanlar korunur; boş string temizler. Metin sınırları UTF-8 byte cinsindendir. Public DTO yalnızca id, name, slug, headline, bio, avatarUrl, location içerir; payout, identity, audit veya session bilgisi içermez.

Avatar dış HTTPS URL referansıdır; backend bu URL'yi fetch etmez. Credential/fragment içeren URL ve unsafe scheme reddedilir. Mevcut minimum gereksinim için cover veya upload altyapısı gerekli görülmedi. **INFRASTRUCTURE DECISION REQUIRED:** ileride dosya yükleme/managed media istenirse storage/CDN, izinler ve retention ayrıca kararlaştırılmalıdır; mevcut URL contract'ı bunu taklit etmez.

## 5. Pass list

`GET /api/v1/passes` authenticated müşterinin yalnızca kendi Pass'lerini döndürür. `limit` 1–100, default 20; optional status ve opaque cursor vardır. `(created_at, id)` descending sıralama, eşzamanlı kayıtlarda offset kaynaklı kopyaları önler. `nextCursor: null` son sayfadır. Expiration status filtrelemeden önce server-side hesaplanır. Private ownership filtresi cursor'dan bağımsızdır.

## 6. Public discovery değişiklikleri

- `GET /api/v1/public/categories`: canonical kategori slug listesi.
- `GET /api/v1/public/packages?category=<value>`: servise bağlı server-side exact filter; omitted/empty bütün kategoriler. Bilinmeyen/tekrarlanan değer 400.
- `GET /api/v1/public/providers/by-slug/{slug}`: public slug lookup.
- Mevcut `GET /api/v1/public/providers/{providerID}` korunur.
- Public offers içinde zengin provider alanları ve `service.category` bulunur. Liste hâlâ en fazla 100 published/unexpired offer döndürür.

## 7. Migration'lar

- `000008_product_completion.up.sql`: profile/slug backfill, unique/check/immutable trigger; kategori/FK/index; distributed rate-limit buckets; retry counter; auth audit events; pass paging index.
- `000009_release_boundaries.up.sql`: database network/environment binding; verified payment network ve timestamp constraints.

Önceden var olan migration 1–7 yeniden yazılmadı. Migration runner artık uygulanmış en yüksek versiyonun gerisine eklenmeye çalışılan migration'ı reddeder. Checksum ve advisory lock davranışı korunur.

## 8. Sign fixture tooling

`go run ./cmd/verify-sign-fixture -fixture /private/path/auth-login.json -scheme auto` tek komutta raw, Hub envelope ve derived-wallet eşleşmesini ayrı raporlar. File/stdin desteği shell history/process argv içine imza koyma ihtiyacını kaldırır. 32 KiB limit, unknown-field rejection ve gizli veri basmayan çıktı test edildi. Hiçbir private key kabul edilmez. Legacy flags korunur. Raw/Hub ve yanlış-wallet örnekleri yerel üretilmiş Ed25519 anahtarlarıyla test edildi; bunlar cihaz kanıtı değildir.

## 9. Signing live blocker

**Açık:** gerçek Nimiq Pay `sign()` fixture'ı yok. Aktif verifier veya default `raw` scheme canlı kanıt olmadan değiştirilmedi. Sunucuda tek konfigüre scheme çalışır, otomatik fallback yoktur. [Resmî Mini Apps API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider) `sign` girdi/çıktısını belirtir; host'un raw/envelope davranışını bu sözleşme tek başına kanıtlamaz. [Hub envelope belgesi](https://www.nimiq.dev/hub/guide/transactions) ayrı bir API içindir ve Mini App cihaz testi yerine geçmez.

## 10. Network configuration

Config, auth challenge ve transaction network doğrulamaları denetlendi. Eksik redemption network/environment kontrolleri create/current/detail/authorize/lookup/confirm akışlarına eklendi. Pass oluşturma ağ bilgisi purchase snapshot'ından okunur; reconciliation aktif config ile farklı snapshot ağını kabul etmez. İlk server boot DB'yi tek network/environment'a bağlar. Farklı ağ/ortam veya uyumsuz mevcut kayıtlar fail-closed startup üretir. Aynı DB'nin Testnet/Mainnet arasında yeniden adlandırılması desteklenmez.

## 11. RPC hardening

5 saniye HTTP timeout, 8 saniye inspection deadline, context cancellation, 2 MiB body limiti ve JSON-RPC ID/result doğrulaması korunur. Redirect takip edilmez. Aynı anda result+error taşıyan envelope reddedilir. RPC/connection/timeout/malformed/reorg hataları paid/failed sonucu üretmez; belirsizlik reconciliation'a bırakılır. Trusted node network ve main-chain/macro finality kontrolleri korunur. Adapter kendi içinde sınırsız retry yapmaz.

## 12. Reconciliation worker

10 saniye tick, en fazla 20 due purchase, 4 paralel inspection. Retry counter DB'de saklanır: UNCERTAIN/NOT_FOUND için 60 → 120 → 240 → 480 saniye capped backoff. Matching mempool/finality gözlemleri 30 saniye polling aralığına döner. Process restart durumu sıfırlamaz. Manual reconcile rate-limit altında daha erken kontrol edebilir. Belirsiz ödeme otomatik terk edilmez; tekrar ödeme istenmez. Confirm/compensation receipt claim transaction'ı ve tek-Pass invariant korunur.

## 13. Multi-instance

Auth/session/challenge replay/idempotency/consumption zaten DB otoritesindeydi; process-local rate-limit bağımlılığı kaldırıldı. İki instance aynı due purchase için redundant RPC okuması yapabilir; row locks, candidate guard ve unique receipt/Pass nedeniyle çift ekonomik etki oluşturmaz. Lease/queue eklenmedi; bu kapasite optimizasyonu P2'dir.

## 14. Rate limiting

Mevcut auth, payout, purchase, reconciliation ve redemption limitleri atomic PostgreSQL counters kullanır. 40 concurrent denemede limit 10 ise tam 10 kabul edildi; yeni limiter instance sayaçları sıfırlamadı. DB hatası/cancellation fail-closed. Expired buckets worker tarafından bounded batch ile temizlenir. Cleanup, kilit beklerken aynı anda yenilenen bucket expiry değerini yeniden kontrol eder; aktif sayacın silinerek limitin aşılması PostgreSQL concurrency regresyon testiyle engellendi. Unit-test harici runtime'da in-memory limiter kullanılmaz.

## 15. Trusted proxy

Forwarded IP yalnızca doğrudan peer explicit trusted CIDR içindeyse kullanılır. Sağdan sola ilk untrusted adres seçilir. Spoofed sol önek, untrusted peer ve malformed XFF regresyonları test edildi. CIDR listesi gerçek deployment ingress adresleriyle operator tarafından doldurulmalı; geniş internet trust tanımı yapılmamalı.

## 16. CORS release config

Tek exact `PUBLIC_ORIGIN`, credential support, Content-Type / X-CSRF-Token / Idempotency-Key allowlist. Wildcard credential yok. Production HTTPS zorunlu. Frontend/API aynı site altında olmalı; credentialed CORS, SameSite=Lax'ın cross-site engelini kaldırmaz.

## 17. Cookie/session

Production cookie: `__Host-nimpass_session`, Secure, HttpOnly, SameSite=Lax, Path=/, Domain yok; 24 saat Max-Age ve server-side expiry. Local HTTP insecure modu yalnızca açık non-production ayarla mümkün. Production insecure cookie konfigürasyonu reddedilir. Token/CSRF digest storage, session revoke/expiry kontrolleri korunur. Session lookup sırasında altyapı hatası 500 INTERNAL_ERROR döner ve cookie korunur; 401 yalnızca eksik/geçersiz/süresi dolmuş/iptal edilmiş oturum içindir. Aynı cookie ile outage sonrası recovery regresyon testi geçti.

## 18. CSRF

Bütün private mutation rotaları ortak session+CSRF middleware altında. Public auth POST'ları exact Origin/Referer kontrolü altında. Provider edit/publish, purchase create/submit/reconcile/cancel, challenge/authorization ve provider lookup/confirm bu sınırı atlamaz. Eksik/yanlış CSRF, foreign Origin ve revoked/expired session testleri geçer. Strict JSON unknown-field/trailing-data davranışı korundu; `application/jsonp` gibi sahte Content-Type değerleri artık reddedilir.

## 19. Fresh-install / upgrade

Yerel, yeni PostgreSQL 15 cluster'ında migration 1–9 sıfırdan uygulandı. Entegrasyon paketleri kendi random schema'larını oluşturup temizledi. Ek test, yalnızca izole test schema'sında 1–7'yi uygulayıp gerçek provider/service/package kayıtlarını oluşturdu; 8–9 upgrade sonrasında offer ve isimler korundu, slug backfill oluştu, kategori unclassified kaldı. Checksum bozulması readiness ve migrate tarafından reddedildi. Concurrent migrator regresyonu geçti.

## 20. Database invariants

Denetlenen DB garantileri: verified transaction hash uniqueness; purchase başına unique verified receipt ve Pass; Pass/purchase/provider/service/owner composite FK; tek aktif redemption challenge; challenge başına tek redemption; positive original sessions/price; nonnegative used/remaining ve toplam tutarlılığı; completed balance; customer/idempotency unique key; compensation receipt FK. Eklenen garantiler: slug unique/shape/immutability, category FK, verified network/timestamp ve deployment context checks. DB constraint testleri gerçek PostgreSQL üzerinde geçti.

## 21. Concurrency / race

Auth challenge replay, payment confirm/receipt/Pass provisioning, duplicate transaction, concurrent compensation, challenge creation, authorization, final-session confirm ve reference rotation testleri geçti. Yeni concurrent lookup-during-rotation testi, lookup'ın tüketmediğini ve eski reference'ın rotation sonrasında geçersiz olduğunu doğrular. `-race` altında aynı 110 test/alt test geçti; skip yok.

## 22. Object authorization

Customer başka customer's purchase/Pass'ine erişemez; Pass list/history yalnızca authenticated owner'a aittir. Provider service/package/edit/lookup/confirm/history query'leri owner ile sınırlandırılır. Slug veya UUID bilgisi yetki sağlamaz. Yeni profile edit ve Pass paging testleri yabancı actor davranışını kapsar. Current-challenge expiry update'i de customer ownership ile sınırlandırıldı.

## 23. Logging / secret audit

Normal HTTP logları method, route template, status, duration ve sanitize edilmiş request ID içerir; raw path/query/body/cookie/signature/reference içermez. DB connection parse/connect hatalarındaki credential içerebilen raw driver metinleri ve raw worker/readiness errors kaldırıldı. RPC response error text'i kullanıcıya/loga aktarılmaz. Auth başarılı login ve proof failure audit event'leri eklendi; payout audit, purchase verification/compensation ve redemption consumption audit'i korunur. Confirm attempts ve replay rejection kaydedilir. Fixture CLI capture'ı basmaz. Live harness yalnızca explicit Testnet operator aracıdır; API challenge/reference çıktısı hassastır, CI/production loguna yönlendirilmemelidir.

## 24. Config/env

APP_ENV, DATABASE_URL, NIMIQ_NETWORK, PUBLIC_ORIGIN; server için NIMIQ_RPC_URL. HTTP_ADDR, SESSION_COOKIE_MODE, NIMIQ_SIGNING_SCHEME, TRUSTED_PROXY_CIDRS ve MIGRATIONS_DIR README/.env.example içinde açıklanır. Production DB TLS artık explicit require/verify-ca/verify-full ister; default/prefer gibi downgrade edebilen modlar reddedilir. URL userinfo taşıyan PUBLIC_ORIGIN reddedilir. Eksik/uyumsuz config fail-fast. Yeni dependency eklenmedi.

## 25. Health/readiness

`/health/live` process liveness. `/health/ready` DB ve release migration checksum/version seti; bozuk/eksik schema 503. Her migration sürümü tam bir kez eşlenir; eksik sürümün yinelenen bir dosyayla gizlenmesi reddedilir ve regresyon testiyle doğrulandı. RPC transient outage public browsing readiness'ini düşürmez. MIGRATIONS_DIR server ile birlikte erişilebilir olmalıdır. Gerçek binary smoke testi readiness ve public category rotasını doğruladı; bu test yerel RPC stub kullandı.

## 26. Startup / graceful shutdown

Config → DB → migration check → DB context binding → RPC network inspection → gerçek listener bind → worker/HTTP sırası açık. Port bind başarısızken başarı logu/çalışan worker bırakılmaz. SIGTERM worker'ı iptal eder, HTTP için 10 saniye grace sağlar, gerekirse connections force-close edilir, worker bitince DB pool kapanır. Gerçek binary SIGTERM sonrası exit 0 verdi. Aynı DB ile yanlış network startup'ı exit 1 verdi. Worker cancellation/in-flight bekleme unit testi geçti.

## 27. OpenAPI drift

Yeni route/schema/field/query contract'ları `openapi.yaml` içinde. Pass detail'deki stale Mission 03 redemption cümlesi kaldırıldı. Public/private DTO farkı, snapshot alanları, cursor/status filter, category ve profile normalization davranışı açıklandı. Ortak middleware/infrastructure error schema'sı bütün operasyonlarda default response ile temsil edilir. HTTP contract testleri değişen rotaları doğrular; OpenAPI lint geçer. Bilinen açık runtime/OpenAPI uyuşmazlığı tespit edilmedi; her olası response'un otomatik schema-fuzz doğrulaması yapılmış değildir.

## 28. Error contract

Yeni bir hayalî error code eklenmedi; validation/conflict/ownership/runtime hataları mevcut normalize sözleşmeyle döner. Signing/network ve category/slug negatif testleri gerçek return sitelerini kullanır. Geçerli, parametresiz `/public/categories` çağrısı için erişilemeyen 4xx uydurulmadı: Redocly'nin tek uyarısı bu rotada 4xx bulunmamasıdır. Ortak middleware ve panic davranışı mevcut schema ile belgeli.

## 29. Yeni/değişen API rotaları

Yeni: `/public/categories`, `/public/providers/by-slug/{slug}`, `/passes` (hepsi GET, `/api/v1` altında). Değişen: GET `/public/packages` kategori query'si; provider create/edit/detail/public response alanları; service create/edit/detail/public service category; GET `/passes/{passID}` snapshot alanları. Eski private ID rotaları ve Mission 04 redemption URL'leri korunur.

## 30. Yeni/değişen DTO alanları

Provider/private/public: slug, headline, bio, avatarUrl, location. Service/public service: category. Pass/list/detail: serviceName, providerName, priceLuna, completedAt; bunlar mevcut kalıcı snapshot/state alanlarıdır. PassPage: items + nullable nextCursor. Public package kategorisi `service.category` içinde; package seviyesinde ikinci authoritative category alanı yoktur.

## 31. FRONTEND RE-SYNC REQUIRED

Frontend owner aşağıdakileri canonical OpenAPI'den yeniden eşlemelidir:

1. Provider model/form/public card: slug, headline, bio, avatarUrl, location; `name` display name olarak devam eder.
2. Public navigation: slug için `/public/providers/by-slug/{slug}`; internal UUID authorization rotalarını koru.
3. Service form/model: backend category setini `/public/categories` üzerinden al; kategori filtresini `/public/packages?category=...` ile server'a gönder.
4. My Passes: purchase→passId fan-out yerine `/passes`, status/limit/cursor; snapshot ad/price alanlarını doğrudan kullan.
5. Boş kategori/profil, immutable slug conflict, empty pages ve nextCursor:null durumlarını göster.

Frontend dosyalarında değişiklik yapılmadı. Yeni alanlar eski istemciler için çoğunlukla additive'dir; yeni deneyimler için bu re-sync gerekir.

## 32. DOCUMENTATION DRIFT

- `docs/DECISIONS.md`, `docs/README.md`, `docs/10-SUBMISSION-CHECKLIST.md` boş; kabul edilmiş decision kaydı veya tamamlanmış submission checklist varmış gibi varsayılmadı.
- Architecture public route örnekleri `/providers/{slug}` kullanıyor; çalışan canonical API public/private namespace'i ayırır ve compatibility için ID lookup'ı korur.
- Category kontrollü değerleri, immutable slug politikası, rich profile URL contract'ı, Pass pagination, DB rate limiting ve deployment binding kararları docs içinde henüz detaylı kaydedilmemiştir. Bu kararların `DECISIONS.md`'ye alınması önerilir; ownership nedeniyle burada uygulanmadı.
- Fixed UTC package expiration ve compensation case mevcut uygulamanın sınırlarıdır; relative-duration expiration ve otomatik refund/reissue workflow yoktur.
- Kök dokümantasyon canonical OpenAPI + bu backend runbook ile re-sync edilmelidir. `docs/**` değiştirilmedi.

## 33. Test sonuçları

Yeni yerel PostgreSQL cluster'ı, disposable `nimpass_test` DB, package başına izole schema. `go test -count=1 -json ./...`: **110 pass, 0 fail, 0 skip** (alt testler dahil). Suite auth, domain, config, RPC, migration, HTTP ve gerçek PostgreSQL lifecycle/concurrency testlerini içerir. İki CLI paketinin test dosyası olmaması integration skip değildir. Real binary smoke: startup/readiness/public route/SIGTERM ve network mismatch başarılı.

## 34. Quality gates

| Gate | Sonuç |
| --- | --- |
| `go test -count=1 ./...` (JSON output ile ayrıca sayıldı) | PASS, 110 test/alt test, skip yok |
| `go test -count=1 -race ./...` | PASS, 110 test/alt test, skip/race yok |
| `go vet ./...` | PASS |
| `golangci-lint run ./...` | PASS, 0 issues |
| `npx --yes @redocly/cli lint openapi.yaml` | PASS, 0 error; public categories için 1 açıklanmış 4xx uyarısı |
| `gofmt -l .` | Boş çıktı |
| `git diff --check` | PASS |
| `go build ./cmd/server` + process smoke | PASS; yerel RPC stub, canlı Nimiq kanıtı değil |

## 35. Kalan P0 release blockers

Gerçek cihaz `AUTH_LOGIN` sign fixture'ı ve seçilen scheme'in payout/redemption üzerinde doğrulanması; gerçek Testnet transaction → RPC inclusion → macro finality → tek Pass → son-session redemption lifecycle kanıtı. Bunlar olmadan production/mainnet veya tam release-ready kararı verilmez. Yerel testlerle doğrulanmış kapsamda bilinen açık P0 backend kod hatası yoktur.

## 36. Kalan P1 konuları

Deployment üzerinde gerçek ingress CIDR, HTTPS/CA, same-site cookie/CORS ve WebView auth testleri operator tarafından tamamlanmalı. Compensation case'in refund/reissue çözümü otomatik değildir; gerçek vaka için provider/operator remediation sorumluluğu ve iletişim akışı belirlenmeli. Frontend re-sync ayrı owner tarafından yapılmalıdır. Bu görev gerçek dış deployment, cihaz veya finansal işlem gerçekleştirmedi.

## 37. Kalan P2 borcu

Public catalogue/purchases/histories hâlâ 100 kayıtla sınırlı, cursor pagination yalnızca Pass list'te. Replicalar duplicate RPC okuması yapabilir; gerekirse lease/queue optimizasyonu. Auth/audit geçmişi retention/archival politikası ve daha geniş operasyonel metrikler ileride ele alınmalı. Slug yeniden adlandırma/alias yönlendirmesi ve managed image upload bilinçli olarak bu contract'ta yoktur.

## 38. Live Testnet öncesi kesin adımlar

1. Backend artifact ile migration 1–9'u birlikte paketle; gerekli env/TLS/origin/proxy değerlerini ayarla.
2. Ayrı Testnet DB üzerinde migrator çalıştır, server başlat, liveness/readiness kontrol et.
3. Gerçek cihaz AUTH_LOGIN fixture'ını al; `verify-sign-fixture -fixture ... -scheme auto` çalıştır.
4. Kanıtlanan tek scheme'i konfigüre et; fresh challenge ile login ve gerçek cookie/CSRF doğrula.
5. Payout doğrulama → service/category → publish → customer intent → tek Testnet ödeme → RPC/finality → Pass.
6. AUTHORIZE_REDEMPTION → provider lookup → explicit confirm → history → final session.
7. Replay/cancellation/uncertainty/refresh senaryolarını doğrula; belirsizlikte yeniden ödeme yapma.
8. Sanitized kanıtları release kaydına ekle ve verdict'i yeniden değerlendir.

Detaylı operator komutları ve 13 adımlı cihaz prosedürü [backend README](README.md#live-testnet-release-validation--operator-sequence) içindedir.

### Mini-apps pre-ship checklist — bu backend görevine uygulanabilen bölüm

PASS: wallet private key/seed toplama yok; backend-authoritative verification; callback üzerinden payment success yok; provider ownership ve replay koruması; RPC hata/iptal yönetimi; explicit CORS; Testnet/Mainnet ayrımı. **6 pass.**

FAIL: gerçek cihaz signing interoperability; gerçek Testnet payment/redemption lifecycle. **2 fail — canlı kanıt gerekli.**

SKIP: frontend SDK initialization/approval UX; responsive görsel QA; touch-target kontrolü; EVM/token/chain alanları; Nimiq görsel asset incelemesi. **5 grup skip — frontend read-only veya bu NIM backend kapsamına uygulanmıyor; bunlar integration-test skip değildir.**

## İkinci doğrulama — 15 Eylül 2026

Kullanıcının son kontrol talebiyle üç ek hata giderildi: session DB hatasının 401 gibi sunulması, eşzamanlı rate-limit renewal/cleanup yarışı ve yinelenen migration sürümünün eksik sürümü gizleyebilmesi. Her biri için regresyon testi eklendi; session hata davranışı README ve canonical OpenAPI açıklamasına işlendi.

İlk tam suite denemesinde yerel PostgreSQL çalışmadığı için integration testleri bağlantı hatası verdi. Disposable cluster başlatıldıktan sonra tam normal ve race suite yeniden çalıştırıldı: her birinde **110 pass, 0 fail, 0 skip**. `go vet`, `golangci-lint` (0 issues), gofmt ve diff kontrolü geçti; son OpenAPI lint 0 error ve yukarıda açıklanan 1 warning verdi. Güncel sonuçlar bu yeniden çalıştırmaya aittir. Canlı Nimiq ve deployment kanıtı hâlâ sağlanmış değildir; önceki process smoke yerel RPC stub ile yapılmıştır.

## Verdict

**BACKEND RELEASE CANDIDATE — LIVE NIMIQ VALIDATION PENDING**
