# Laporan Investigasi Teknis & Implementasi `#tolive` dan `#stickeraudio` (`#sa`) — Freya-san Hub v5.0

## 1. Cara Kerja Teknis Masing-Masing Fitur

### A. `#tolive` — Live / Motion Photo (Pengalaman ala TikTok, Apple Live Photo & Android Motion Photo)
Perbedaan fundamental antar-ekosistem:
- **Apple Live Photo** di iOS menggunakan pasangan dua file terpisah yang dihubungkan melalui `AssetIdentifier` yang sama pada metadata QuickTime/EXIF (file foto **HEIC/JPEG** + video **MOV** berdurasi ~3 detik dengan track `metadata/timed` `com.apple.quicktime.still-image-time`). WhatsApp saat mengirim lewat file dokumen atau galeri konvensional tidak mem-parsing `.heic + .mov` sebagai satu Live Photo interaktif.
- **Android Motion Photo (Google Camera / MotionPhoto v1 & MicroVideo v1)** menyimpan **satu file `.jpg` tunggal** dengan struktur:
  1. JPEG valid (`0xFFD8 ... 0xFFD9`) berisi frame cover resolusi penuh.
  2. Segmen `APP1` (`0xFFE1`) XML/XMP Adobe di dalam header JPEG yang mendeklarasikan `GCamera:MotionPhoto="1"`, `GCamera:MotionPhotoVersion="1"`, `GCamera:MotionPhotoPresentationTimestampUs`, `Container:Directory` (`Primary` + `MotionPhoto` dengan `Item:Length = len(mp4)`), serta `GCamera:MicroVideo="1"` & `GCamera:MicroVideoOffset = len(mp4)`.
  3. Stream video MP4 (H.264 Baseline `yuv420p` + AAC `<= 4.0s`) yang disambungkan (*appended*) persis setelah marker EOI JPEG (`0xFFD9`), sehingga offset `len(file) - MicroVideoOffset` menunjuk tepat ke atom `ftyp` MP4.
- **TikTok Live Photo** dan **Protokol Native WhatsApp (`WAWebProtobufsE2E.proto`)**:
  - Di level jaringan E2E WhatsApp Multi-Device, Live/Motion Photo dikirim sebagai **pasangan dua pesan terhubung** (*paired message*):
    1. Pesan induk `ImageMessage` (frame cover JPEG).
    2. Pesan anak `VideoMessage` dengan field `motionPhotoPresentationOffsetMs` (**tag 29**) dan `MessageContextInfo.messageAssociation` bertipe `AssociationType.MOTION_PHOTO` (**enum 12**) yang menunjuk `parentMessageKey` pesan induk.

### B. `#stickeraudio` / `#sa` — Stiker WhatsApp Animasi Bersuara
- **Format stiker standar WhatsApp**: Kontainer **WebP** (`RIFF....WEBP`) ukuran tepat `512x512 px`, animasi memakai chunk `VP8X` (flag animasi `0x02` + flag EXIF `0x08`), `ANIM`, `ANMF`, serta chunk metadata `EXIF` (dengan header TIFF little-endian `II*\0...` + payload JSON WhatsApp berisi `sticker-pack-id`, `sticker-pack-name`, `sticker-pack-publisher`, `emojis`). Ukuran file wajib `< 500 KB` (stiker animasi) atau `< 100 KB` (statis).
- **Mengapa file WebP biasa tidak bisa menyimpan audio**: Spesifikasi format RIFF WebP secara standar hanya menampung bitmap VP8/VP8L, alpha, ICC, XMP, dan EXIF; tidak ada dekoder audio di dalam gambar WebP itu sendiri.
- **Mekanisme Wibusoft & Protokol Native WhatsApp Sound Sticker (WhatsApp Android Beta `2.26.41.3` / `2.26.47.1+`)**:
  - Berdasarkan skema `WAWebProtobufsE2E.proto`, pesan `StickerMessage` memiliki field ekstensi:
    - `optional string emojis = 25;`
    - `oneof audio { AudioMessage audioMessage = 26; }`
    - serta pembungkus opsional `Message.audioStickerMessage = 134` (`FutureProofMessage`).
  - Saat mengirim Sound Sticker, bot mengunggah dua blob terenkripsi ke server media WhatsApp (`image/webp` animasi dan `audio/ogg; codecs=opus` 48kHz mono + 64-byte PCM `waveform`), lalu membungkus referensi `AudioMessage` tersebut di **field 26** di dalam `StickerMessage`.
  - Karena `@whiskeysockets/baileys@7.0.0-rc14` menghentikan definisi `StickerMessage` pada field `23`, Freya-san Hub v5.0 memasang ekstensi encoder runtime non-invasif pada `WAProto` tanpa memodifikasi `node_modules/`.

---

## 2. Bahasa Pemrograman, Library, dan Tools yang Dipilih
- **Python 3.11** (`scripts/media_pipeline.py`): Manipulasi biner JPEG (`APP1` XMP injection), RIFF/WebP chunk patching (`VP8X` + `EXIF` TIFF+JSON), validasi header `OggS/OpusHead`, dan orkestrasi pipeline konversi + verifikasi.
- **FFmpeg & FFprobe 4.4.2**: Ekstraksi midpoint frame JPEG, transcoding `libx264` (`baseline`, `yuv420p`, `faststart`) + `aac`, filter `zoompan` micro-motion untuk gambar statis agar menjadi motion clip/animasi WebP, kompresi `libwebp` adaptif (`<= 500 KB`), serta encoding audio `libopus` (`48 kHz`, mono, `<= 8s`).
- **Node.js + TypeScript** (`src/server/mediaService.ts`, `src/server/waMediaProtocol.ts`, `src/server/whatsappEngine.ts`): Pembatasan ukuran (maks 25 MB), timeout subprocess (`execFile` array-only tanpa shell), manajemen temporary directory otomatis, pairing 2-langkah `#sa` (5 menit TTL), antrean delivery, dan audit log SQLite `media_jobs`.
- **`@whiskeysockets/baileys` + `protobufjs`**: Encoding protokol `WAProto` (field `12`/`29` untuk Motion Photo, dan ekstensi field `25`/`26`/`134` untuk Sound Sticker).
- **React + Tailwind CSS** (`src/components/OwnerDashboard.tsx`): Media Pipeline Lab pada tab *Connection & Simulator* untuk pengujian langsung, pratinjau `<video>` + `<audio>` + `<img webp>`, serta tabel inspeksi `media_jobs`.

---

## 3. Alasan Memilih Teknologi Tersebut
1. **Tidak terbatas pada JS/Node**: Node.js unggul untuk I/O asinkron, bot engine, dan socket Baileys, tetapi manipulasi biner segmen JPEG APP1/RIFF chunks dan *multi-pass encoding* video/WebP/Opus jauh lebih presisi, cepat, dan aman dilakukan lewat `FFmpeg + Python`.
2. **Keamanan & Isolasi**: Seluruh pemanggilan subprocess menggunakan `execFile` / `subprocess.run(list)` (bukan shell string) untuk mencegah *command injection*, disertai pembersihan direktori temporer pada blok `finally`.
3. **Kepatuhan Protokol Tanpa Fork `node_modules`**: Patch encoder `WAProto` di memori (`installWhatsAppV5ProtoExtensions`) tetap kompatibel dengan pembaruan paket `@whiskeysockets/baileys`.

---

## 4. Alur / Arsitektur Proses Lengkap
1. **WhatsApp Bot Engine (`whatsappEngine.ts`)**: Menerima perintah `#tolive` atau `#stickeraudio`/`#sa` (mendukung input video langsung, atau mekanisme 2 langkah: balas gambar/stiker dengan `#sa` -> balas audio/VN dengan `#sa`).
2. **Media Processing Service (`mediaService.ts`)**: Menvalidasi ukuran input (`<= 25 MB`), membuat direktori temporer terisolasi, memanggil `scripts/media_pipeline.py`, dan mencatat metrik ke tabel `media_jobs`.
3. **Conversion & Validation Layer (`scripts/media_pipeline.py`)**:
   - `#tolive`: Menghasilkan `still.jpg`, `motion.mp4`, dan `motionphoto.jpg` (XMP + appended MP4); memverifikasi keberadaan `MotionPhoto="1"`, offset byte tepat menunjuk `ftyp`, dan stream valid lewat `ffprobe`.
   - `#sa`: Menghasilkan `sticker.webp` (`512x512`, `<= 500 KB`, multi-pass FPS/quality) dengan chunk `EXIF` WhatsApp, dan `audio.ogg` (`48 kHz` Opus + waveform 64 byte); memverifikasi chunk `RIFF/WEBP/VP8X/ANIM/ANMF/EXIF` dan header `OggS/OpusHead`.
4. **Delivery & Wire Protocol Layer (`waMediaProtocol.ts`)**:
   - Ketika WhatsApp terhubung: mengunggah aset terenkripsi (`prepareWAMessageMedia`) dan mengirim pesan berpasangan (`MOTION_PHOTO = 12`) atau `StickerMessage` ber-tag `26` (`relayMessage`), lalu memperbarui status delivery pada `media_jobs`.
   - Ketika WhatsApp offline / melalui Dashboard Simulator: mengembalikan pratinjau penuh (`still`, `motionVideoDataUrl`, `motionPhotoJpgDataUrl`, `stickerDataUrl`, `audioDataUrl`) tanpa mengklaim terkirim ke perangkat WhatsApp fisik.

---

## 5. Contoh Input dan Output Nyata
- **`#tolive` (Input: gambar PNG 640x640 atau video MP4 2.5s + audio 440Hz)**:
  - Output:
    1. `still.jpg` (512x512 / dimensi terjaga)
    2. `motion.mp4` (H.264 Baseline `yuv420p` + AAC, `<= 4.0s`)
    3. `motionphoto.jpg` (JPEG + XMP `GCamera:MotionPhoto="1"`, `MicroVideoOffset = len(motion.mp4)`)
    4. Payload WAProto: `ImageMessage` + `VideoMessage` (`motionPhotoPresentationOffsetMs`, `AssociationType.MOTION_PHOTO = 12`).
- **`#sa` (Input: video bersuara 2.5s atau pasangan PNG + OGG/Opus)**:
  - Output:
    1. `sticker.webp` (`512x512`, animasi WebP `< 500 KB`, memiliki `VP8X`, `ANIM`, `ANMF`, dan `EXIF` metadata pack Freya-san Hub)
    2. `audio.ogg` (`audio/ogg; codecs=opus`, mono `48 kHz`, ditambah `waveform` 64 nilai `0..100`)
    3. Payload WAProto: `StickerMessage` dengan field `25` (`emojis`) dan field `26` (`AudioMessage`).

---

## 6. Batasan Teknis & Masalah Kompatibilitas
1. **Versi Aplikasi Penerima (`#sa`)**: Fitur native Sound Sticker baru mulai diperkenalkan pada **WhatsApp Android Beta `2.26.41.3` / `2.26.47.1+`**. Penerima yang memakai WhatsApp versi stabil lama akan melihat stiker animasi WebP normal tanpa tombol putar suara (karena klien lama mengabaikan tag protobuf `26`), atau jika dibungkus dalam `audioStickerMessage` tag `134` tanpa dukungan klien, akan muncul pesan pembungkus *update required*.
2. **Dukungan Live Photo di WhatsApp Web/Desktop & Beberapa Klien**: WhatsApp iOS/Android versi lama menampilkan pasangan `ImageMessage + VideoMessage` sebagai gambar + video terpisah bila fitur paired `AssociationType.MOTION_PHOTO` belum diaktifkan di akun tersebut; sedangkan file `motionphoto.jpg` (unduhan dari Dashboard / Google Photos Android) langsung dikenali Galeri Android / Google Photos sebagai Motion Photo.
3. **Keterbatasan Lingkungan Server Kontainer**: Selama socket `@whiskeysockets/baileys` berstatus `disconnected`, pengujian over-the-air ke nomor HP fisik belum dijalankan; seluruh konversi media, validasi container, database logging, UI Media Lab, dan *encoding-decoding* biner Protobuf WhatsApp sudah diuji nyata di server ini.

---

## 7. Hasil Pengujian Nyata yang Sudah Dijalankan
Semua pengujian otomatis dijalankan melalui `npx tsx --test src/core/core.test.ts src/server/v5.test.ts` serta verifikasi UI browser melalui Chromium Playwright pada Dashboard Owner (`Connection & Simulator -> Media Pipeline Lab`):
- Konversi nyata `#tolive` dari sampel PNG (zoompan 3.0s) dan sampel MP4 bersuara -> lolos validasi XMP offset, `ftyp` boundary check, dan `ffprobe`.
- Konversi nyata `#sa` dari sampel MP4 bersuara dan pasangan 2-tahap PNG + OGG -> lolos validasi ukuran `< 500 KB`, chunk `VP8X/ANIM/ANMF/EXIF`, dan header `OggS/OpusHead`.
- **Uji Wire Protobuf Roundtrip** (`protobufjs`): Buffer keluaran `buildMotionPhotoProtoPair` dan `buildSoundStickerProtoPayload` didekode kembali menggunakan definisi resmi `WAWebProtobufsE2E.proto`, membuktikan tag `26` (`AudioMessage`), tag `134` (`FutureProofMessage`), tag `29` (`motionPhotoPresentationOffsetMS`), dan `AssociationType = 12` terbaca presisi.

---

## 8. Status Akhir Implementasi
- **Selesai & Aktif di Backend, Bot Dispatcher, API, dan Dashboard Media Lab**:
  - `scripts/media_pipeline.py`
  - `src/server/mediaService.ts`
  - `src/server/waMediaProtocol.ts`
  - `src/server/whatsappEngine.ts`
  - `src/server/db.ts` (`media_jobs`)
  - `server.ts` (`/api/admin/media/*`)
  - `src/components/OwnerDashboard.tsx` (Media Pipeline Lab & Simulator Preview)
- **Pengujian Lapangan Perangkat Fisik (Menunggu Pairing QR Owner)**: Siap dijalankan segera setelah akun WhatsApp bot ditautkan melalui tab *Connection Manager*.
