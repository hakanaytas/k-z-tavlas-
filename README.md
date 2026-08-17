# Kız Tavlası 🎲❤️

Sıcak, sade, gün ışığı alan bir ahşap masa temasında; klasik tavladan tamamen
bağımsız kurallara sahip, iki kişilik, gerçek zamanlı çevrimiçi bir zar oyunu.
Framework yok — düz HTML/CSS/JavaScript + Firebase. GitHub Pages'te doğrudan
yayınlanabilir, PWA olarak telefona eklenebilir.

## Dosya yapısı

```
kiz-tavlasi/
├── index.html          # Tüm ekranlar (giriş, menü, oda, tahta, sohbet, bitiş...)
├── style.css            # Glassmorphism + sıcak gökyüzü/ahşap tema, animasyonlar
├── app.js                # Oyun mantığı, Firebase entegrasyonu, render
├── firebase.js           # Firebase başlatma (Auth + Firestore)
├── manifest.json          # PWA manifesti
├── service-worker.js      # Çevrimdışı önbellekleme
├── firestore.rules        # Firestore güvenlik kuralları
├── sounds/                 # Kısa, üretilmiş ses efektleri (.wav)
├── icons/                   # Uygulama ikonları (192/512, maskable dahil)
└── README.md
```

## Kurulum — Firebase tarafı

Proje zaten `firebase.js` içine gömülü bir Firebase yapılandırmasıyla geliyor
(`kzavlasii` projesi). Kendi Firebase projenizle kullanmak isterseniz:

1. [Firebase Console](https://console.firebase.google.com) → yeni proje.
2. **Build → Authentication → Sign-in method** → **Anonymous** sağlayıcısını
   etkinleştirin.
3. **Build → Firestore Database** → veritabanı oluşturun (üretim modunda
   başlayabilirsiniz, çünkü kurallar aşağıda ayrıca tanımlanıyor).
4. **Firestore → Rules** sekmesine gidip bu depodaki `firestore.rules`
   dosyasının içeriğini yapıştırıp yayınlayın.
5. Proje ayarlarından **Web app** ekleyip aldığınız `firebaseConfig`
   nesnesini `firebase.js` dosyasındaki `firebaseConfig` ile değiştirin.

Firestore'da elle koleksiyon oluşturmanıza gerek yok; `users` ve `rooms`
koleksiyonları uygulama ilk yazma işlemini yaptığında otomatik oluşur.

## Yayınlama — GitHub Pages

1. Bu klasörün tamamını bir GitHub deposuna yükleyin (kök dizine, alt klasöre
   değil — `index.html` depo kökünde olmalı ya da Pages ayarında doğru klasör
   seçilmeli).
2. Depo **Settings → Pages** → **Source**: `Deploy from a branch` → dal olarak
   `main`, klasör olarak `/ (root)` seçin.
3. Birkaç dakika içinde `https://kullanici-adiniz.github.io/depo-adi/`
   adresinde yayında olur.
4. Firebase Console → Authentication → **Settings → Authorized domains**
   kısmına GitHub Pages alan adınızı (`kullanici-adiniz.github.io`) eklemeyi
   unutmayın, yoksa anonim giriş engellenir.

Statik dosyalar olduğu için Netlify, Vercel veya Firebase Hosting üzerinden
yayınlamak da aynı şekilde çalışır (`firebase deploy` için `firebase.json`
eklemeniz yeterli).

## Oyun kuralları — "Kız Tavlası"

Bu oyun **klasik tavla değildir**; yalnızca zar atma ve taş taşıma fikrinden
ilham alan özgün bir kuraldır:

1. **Başlangıç dizilimi** — Her oyuncunun kendi tarafında 3 kule bulunur, her
   kulede 5 taş vardır (toplam 15 taş).
2. **Başlangıç zarı** — Oyun başlamadan önce iki oyuncu da birer zar atar.
   Büyük gelen oyuna başlar; berabere kalırsa tekrar atılır.
3. **1. Bölüm — İniş** — Sırası gelen oyuncu iki zar atar (zar eş gelirse —
   çift — 4 hamle hakkı kazanılır, aksi halde 2 hamle hakkı). Her hamle
   hakkında oyuncu kendi kulelerinden birine dokunur; o kuleden bir taş
   animasyonla aşağı iner ve oyuncunun "Hazır" alanına geçer.
4. **2. Bölüm — Çıkış** — Bir oyuncunun tüm kuleleri boşaldığında, o andan
   itibaren attığı zarlardaki her hamle hakkı "Hazır" alanındaki bir taşı
   "Çıkış" alanına gönderir.
5. **Kazanma** — 15 taşını da ilk çıkışa gönderen oyuncu oyunu kazanır;
   kupa animasyonu, konfeti ve kazanma sesi eşliğinde kutlanır.

Bütün hamleler Firestore üzerinden anlık senkronize edilir; rakibin hangi
kuleye dokunduğu, hangi zarı attığı ve taşın ne zaman indiği karşı tarafta da
canlı olarak görünür — sayfa hiç yenilenmez.

## Öne çıkan özellikler

- **Oda sistemi** — Kod üreterek oda kur, kodla katıl, "Hazırım" ile başlat.
- **Gerçek zamanlı senkronizasyon** — Firestore `onSnapshot` ile anlık tahta,
  zar ve hamle güncellemesi.
- **Sohbet** — Emoji destekli, hazır mesajlı, gerçek zamanlı sohbet paneli.
- **Ses ve animasyon** — Zar atma, taş inişi, mesaj bildirimi, kazanma
  müziği; hepsi küçük, üretilmiş `.wav` dosyaları olarak gömülü ve
  Ayarlar'dan kapatılabilir.
- **İstatistikler** — Toplam oyun, galibiyet, kazanma yüzdesi Firestore'da
  `users/{uid}` altında tutulur.
- **PWA** — Ana ekrana eklenebilir, `service-worker.js` ile çevrimdışı açılış
  desteklenir (oyun için elbette internet gerekir, ama uygulama kabuğu
  çevrimdışı da açılır).
- **Bağlantı takibi** — Her oyuncu düzenli "nabız" (heartbeat) yazar; rakip
  ~22 saniyeden uzun süre sessiz kalırsa "bağlantı koptu" uyarısı gösterilir,
  Firestore SDK'nın kendi otomatik yeniden bağlanma mekanizması sayesinde
  bağlantı geri geldiğinde oyun kaldığı yerden devam eder.

## Sınırlamalar ve genişletme fikirleri

- Bu sürüm **istemci taraflı (client-authoritative)** çalışır: hamle
  doğrulaması tarayıcıda yapılıp doğrudan Firestore'a yazılır. Rekabetçi /
  hileye tamamen kapalı bir sürüm için hamle mantığının bir **Cloud
  Function**'a taşınması ve Firestore yazma izninin yalnızca o fonksiyona
  verilmesi önerilir (`firestore.rules` içinde bu konuda not bırakıldı).
  Firestore Rules ile beraber, tam güvenli anti-cheat başlıca genişletme
  fikri olarak dosyada belgelenmiştir.
- Ses efektleri, dışarıdan telifli bir ses kütüphanesi gerektirmemesi için
  bu proje içinde küçük Python betikleriyle **üretilmiştir**; dilerseniz
  `sounds/` klasöründeki `.wav` dosyalarını kendi ses tasarımınızla
  değiştirebilirsiniz.
- Uygulama ikonu `icons/icon-source.svg` kaynağından türetilmiştir; farklı
  bir görsel kimlik isterseniz aynı dosyayı düzenleyip yeniden
  boyutlandırabilirsiniz.
