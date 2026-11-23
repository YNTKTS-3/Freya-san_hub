# Freya-san Hub v5.0 — Panduan Instalasi, Operasional, API & Pemulihan

## 1. Arsitektur & Teknologi
- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (Light / Dark / System mode, Bahasa Indonesia / English / 日本語).
- **Backend & Real-time**: Express.js + `ws` WebSocket Server pada port `3000`.
- **Database**: SQLite WAL (`data/freya-hub.db`) dengan foreign keys, indeks, dan transaksi atomik.
- **WhatsApp Engine**: `@whiskeysockets/baileys` terisolasi di `src/server/whatsappEngine.ts` (QR Code, reconnect otomatis, message queue, Blue Tick Control ON/OFF).
- **AI Provider**: Server-side `@google/genai` (`gemini-4-hydrogen`) dengan Google Search Grounding untuk riset sumber resmi 48Group.

## 2. Konfigurasi Environment (`.env` / Secrets)
Salin `.env.example` menjadi `.env` atau isi melalui panel **Settings > Secrets**:
- `GEMINI_API_KEY`: Kunci API Gemini server-side untuk modul AI Nexara & riset sumber resmi 48Group.
- `OWNER_NUMBER`: Nomor WhatsApp owner (disimpan privat di server; tidak pernah ditampilkan di halaman publik).
- `OWNER_PASSCODE`: Passcode login Owner Console (jika dikosongkan, sistem menyediakan form klaim passcode pertama kali yang di-hash dengan `scrypt`).
- `SESSION_SECRET`: Kunci penandatanganan token sesi owner (fallback otomatis ke `crypto.randomBytes(32)` di memori).
- `BACKUP_ENCRYPTION_KEY`: Kunci enkripsi AES-256-GCM untuk arsip backup database.
- `WHATSAPP_AUTO_CONNECT`: Set `"true"` untuk menyambungkan WhatsApp Engine otomatis saat boot.

## 3. Menjalankan Aplikasi
- **Development**: `npm run dev` (menjalankan `tsx server.ts` pada port `3000`).
- **Build Produksi**: `npm run build`
- **Start Produksi**: `NODE_ENV=production npm start`
- **Pengujian Otomatis**: `npm test` (menjalankan `tsx --test src/core/*.test.ts`).
- **Type Check**: `npm run lint` (`tsc --noEmit`).

## 4. Ringkasan Endpoint API Utama
- `GET /api/health` — Pemeriksaan kesehatan Backend, SQLite, WhatsApp Engine, AI Provider, dan CPU/RAM.
- `GET /api/public/overview` & `GET /api/public/commands` — Data publik & penjelajah command (mengecualikan command owner).
- `GET /api/48group/intelligence` — Data terverifikasi grup, generasi, member, diskografi, theater, event, dan istilah 48Group.
- `GET /api/games/catalog`, `POST /api/games/start`, `POST /api/games/action` — Mesin permainan terpadu (Game Center Umum & 48Group Game Center) dengan isolasi Private vs Group.
- `GET /api/auth/status`, `POST /api/auth/claim`, `POST /api/auth/login` — Autentikasi Owner Console.
- `/api/admin/*` — Seluruh endpoint manajemen (memerlukan header `Authorization: Bearer <token>`).

## 5. Keterbatasan Teknis Platform yang Dilaporkan Secara Jujur
1. **Status WhatsApp (`antigroupsw` / `antimentionsw`) & Panggilan (`call*` / `videocall`)**: Library WhatsApp Web berbasis protokol web memiliki batasan akses teknis terhadap event panggilan suara/video penuh serta keterbatasan tertentu pada pembacaan status pihak ketiga. Fitur tersebut dicatat secara jujur dengan status `pending_integration` / batas API, dan tidak disimulasikan seolah-olah aktif penuh.
2. **Downloader & Sticker Media Eksternal**: Command kategori `DOWNLOAD` dan sebagian `STICKER` terdaftar penuh di database registry dengan status `pending_integration` hingga adapter/layanan eksternal dikonfigurasi oleh owner.
3. **Command `spr`, `sprx`, `topeng`, `topengx`, `fakechios`, `deep`, `fast`, `slow`**: Dipertahankan 100% di registry dengan status `pending_specification` tanpa mengarang perilaku.
