# Nimpass — Claude Code Instructions

Nimpass geliştirmesinde bu repository içindeki dokümantasyon source of truth'tur.

## Mandatory documentation

Herhangi bir implementation, refactor veya mimari değişiklik yapmadan önce
görevle ilgili dokümanları oku.

Büyük feature'lar veya mimari değişikliklerde aşağıdaki dokümanların tamamını oku:

- `docs/01-PRODUCT.md`
- `docs/02-USER-FLOWS.md`
- `docs/03-DESIGN-SYSTEM.md`
- `docs/04-NIMIQ-MINI-APPS.md`
- `docs/05-NIMIQ-PAY-INTEGRATION.md`
- `docs/06-COMPETITION.md`
- `docs/07-SCORING-STRATEGY.md`
- `docs/08-ARCHITECTURE.md`
- `docs/09-SECURITY.md`
- `docs/10-SUBMISSION-CHECKLIST.md`
- `docs/DECISIONS.md`
- `docs/README.md`

## Source of truth

Dokümantasyonda açıkça tanımlanmış bir davranışı tahmin ederek değiştirme.

Kod ile dokümantasyon çelişiyorsa bunu sessizce çözmeye çalışma.
Önce çelişkiyi belirt.

`docs/DECISIONS.md` içindeki kabul edilmiş kararları açık bir talimat olmadan değiştirme.

## Product

Nimpass web-first bir Nimiq Mini App'tir.

Ürünün:
- product davranışları için `01-PRODUCT.md`,
- kullanıcı akışları için `02-USER-FLOWS.md`,
- UI/UX için `03-DESIGN-SYSTEM.md`,
- Nimiq Mini Apps için `04-NIMIQ-MINI-APPS.md`,
- Nimiq Pay için `05-NIMIQ-PAY-INTEGRATION.md`
esas alınmalıdır.

## Design

UI implementasyonlarında `docs/03-DESIGN-SYSTEM.md` bağlayıcıdır.

Luma ürünün temel tasarım referansıdır ancak branding veya asset'leri
kopyalanmamalıdır.

## Architecture

Frontend ve backend sınırları için:

`docs/08-ARCHITECTURE.md`

dosyasını takip et.

Mevcut mimariyi incelemeden yeni abstraction, dependency veya pattern ekleme.

## Security

Authentication, authorization, wallet, payment, QR, redemption,
API veya kullanıcı girdisi içeren görevlerde mutlaka:

`docs/09-SECURITY.md`

dosyasını oku.

Client tarafından bildirilen kritik state'lere körü körüne güvenme.

## Development workflow

Bir göreve başlamadan önce:

1. İlgili dokümanları oku.
2. Mevcut implementasyonu incele.
3. Mevcut pattern'leri bul.
4. Sonra değişiklik yap.

Görev tamamlanmadan önce:

- ilgili testleri çalıştır,
- typecheck/lint varsa çalıştır,
- hata durumlarını kontrol et,
- dokümantasyonla implementasyonun uyuştuğunu doğrula.

Test etmediğin bir şeyi test edilmiş gibi raporlama.

## Important

Dokümanlar optional context değildir.

Nimpass implementation contract'ının parçasıdır.