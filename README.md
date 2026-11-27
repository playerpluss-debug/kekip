# Gecikmeli Cevap

- Oyun: `/late-answer.html`. 3–8 KEKIP hesabı, oda kodu veya açık oda. Oda sahibi 5/7/10 soru, 7/10/15 saniye ve görünürlük seçer.
- Soru bankası: `late-answer-questions.json`. Soru, kategori ve kabul edilen cevaplar sunucuda kalır. Beklenen cevap yalnızca jüriye gönderilir. Bir oda kodu altında sorular tekrar kullanılmaz. Tekrar oyunda kalan benzersiz sorular yetmezse aynı grup yeni oda koduyla devam eder.
- Jüri cevap süresi içinde tek oy verir. Tüm oylar gelirse sunucu hemen ilerler. Süre dolduğunda geçerli oylar değerlendirilir. Geçerli oylar eşitse doğru, hiç oy yoksa yanlış. Jüride kararla aynı oyu veren oyuncu 0,5 puan, doğru cevap veren yarışmacı 1 puan alır. Finalde en yüksek puanı paylaşan uygun oyuncular birlikte kazanır.
- Yarışmacının bağlantısı kesilirse sayaç 60 saniyelik dönüş süresinde durur. Süre dolarsa yarım tur geri alınır. Ayrılan oyuncu sonuçta işaretlenir ve tamamlama ödüllerini alamaz. Diğer oyuncuların tamamladığı turlar korunur.
- Sonuçlar `kekip_game_results` tablosunda `late_answer` olarak saklanır. Tamamlanan maç 20 XP ve mevcut günlük tavan içinde 10 KC verir. Kazanan 10 ek XP alır. Tamamlayan hesaplara mevcut kart drop kuralları uygulanır. Oda, oylar ve bağlantı rezervasyonları tek sunucu örneğinin belleğindedir.

## Render ve PostgreSQL

Varsayılan yapılandırma herkese açık STUN kullanır. Çapraz ağlarda sesin kurulacağı garanti değildir. TURN için sunucu ortamında `TURN_URL` (`turn:` veya `turns:`), `TURN_USERNAME` ve `TURN_CREDENTIAL` birlikte girilir. WebRTC tarayıcısına yalnızca doğrulanmış oda üyelerine bağlantı ayarları aktarılır. Ayrı, sınırlı TURN hesabı kullan ve sağlayıcında kota tanımla. Ses sunucuya kaydedilmez veya arşivlenmez.

`migrations/late-answer-up.sql` hesap şeması ilk hazırlanırken idempotent çalışır. Eski sürüme dönerken yeni uygulama örneğini durdurduktan sonra `migrations/late-answer-down.sql` çalıştırılabilir. Geri alma, Gecikmeli Cevap davetlerini siler ve ilgili çevrimiçi durumları ana sayfaya çevirir. Maç kayıtları, XP ve KC geçmişi korunur.

## Doğrulama

Otomatik test: `node --test tests/late-answer.test.js`.

Manuel kabul listesi:

1. Üç hesapla bir oda başlat. İki farklı cihaz ve tarayıcı kullan. Sesli cevap, jüri oyu, son cevap, final, yeniden bağlanma ve kart bildirimi kontrol edilir.
2. Mikrofon iznini reddet, dinleyici olarak devam et. İzni açıp mikrofonu tekrar dene. Boş veya meşgul cihaz, yerel susturma, ses seviyesi ve konuşma göstergesini dene.
3. Farklı ağlarda TURN olmadan bağlantı durumunu gözle. TURN ortam değişkenlerini tanımlayıp yeniden dağıt. Gerekirse tarayıcı WebRTC tanılamalarında röle yolunu doğrula.
4. Mobil Safari ve Chrome’da ses oynatma düğmesi, klavye odağı, 44 px kontroller, arka plandan dönüş ve süre duyurularını kontrol et.
5. En az beş Gece ve beş Gölge kombinini, saç, göz, aksesuar ve Mitik set çeşitliliğiyle sahnede karşılaştır. Sekme gizliyken ve hareket azaltma ayarında animasyonun durduğunu kontrol et. Sekiz oyuncuyla düşük güçlü bir cihazda ses ve çizim performansını gözle.
6. Davet, oda sohbeti, rozet, görev, profil, liderlik ve KC/XP sonuçlarını doğrula. Amiral Battı ve Futbol Kariyer’de oda, ödül ve sohbet akışlarına regresyon testi yap.

Mesh bağlantıda 8 oyuncuda cihaz başına en fazla 7 eş bağlantı vardır. Mobil ağ koşulları, TURN kapasitesi ve jüri katılımı oyunun deneyimini etkiler.
