# PROJECT_TASKS.md — Master Task Registry (Freya-san Hub v5.0)

> **Identitas Proyek**: Freya-san Hub v5.0 (`Freya-san bot by Pak Ujan`)  
> **Standar Bahasa Bot**: Bahasa Indonesia nonbaku yang natural, santai, dan konsisten (`0` formal violations).  
> **Aturan Status**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `NEEDS_VERIFICATION` | `COMPLETED`  
> **Catatan Kejujuran**: Tidak ada tugas yang ditandai `COMPLETED` sebelum kode selesai *dan* diuji nyata. Pengujian perangkat WhatsApp fisik dan Meta Cloud API tanpa kredensial live ditandai `NEEDS_VERIFICATION` atau `BLOCKED` sesuai kondisi aktual.

---

## Ringkasan Status Tugas

| Prioritas | Total | COMPLETED | NEEDS_VERIFICATION | BLOCKED | IN_PROGRESS | NOT_STARTED |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| P0 (Kritis) | 13 | 9 | 3 | 1 | 0 | 0 |
| P1 (Utama) | 11 | 11 | 0 | 0 | 0 | 0 |
| P2 (Penting) | 5 | 5 | 0 | 0 | 0 | 0 |
| P3 (Dok & QA) | 2 | 2 | 0 | 0 | 0 | 0 |
| **Total** | **31** | **27** | **3** | **1** | **0** | **0** |

---

## Daftar Tugas Lengkap (Phase 0 – Phase 8)

### Phase 0: Project Discovery & Governance

- **TASK-001** | **Audit Repository, Arsitektur, Dependency, Database & Baseline**
  - **Prioritas**: P3 | **Dependensi**: - | **Status**: `COMPLETED`
  - **File Terkait**: `package.json`, `bun.lock`, `server.ts`, `src/server/*`, `src/core/*`, `src/components/*`, `README.md`, `.env.example`, `bot-core.cjs`
  - **Deskripsi**: Memeriksa struktur repository, Baileys v7 (`7.0.0-rc14`), SQLite `better-sqlite3`, lockfile (`bun.lock`), menjalankan `bun audit` (0 kerentanan), dan menyusun baseline pengujian.
  - **Kriteria Keberhasilan**: Baseline awal tercatat lengkap sebelum perubahan kode.
  - **Hasil Pengujian**: `npm test` 22/22 pass baseline -> naik ke 26/26 pass final; `npm run lint` exit 0; `bun audit` 0 vulnerabilities.
  - **Catatan Hambatan**: Tidak ada `install.sh` dan `package-lock.json` meski sempat disebut di `README.md` lama (sudah diperbaiki di TASK-028).

- **TASK-002** | **Master Task Registry (`PROJECT_TASKS.md`) & Progress Handoff (`PROJECT_HANDOFF.md`)**
  - **Prioritas**: P0 | **Dependensi**: TASK-001 | **Status**: `COMPLETED`
  - **File Terkait**: `PROJECT_TASKS.md`, `PROJECT_HANDOFF.md`
  - **Deskripsi**: Membuat dan terus memperbarui Master Task Registry serta Progress Handoff hingga akhir Phase 8 dengan pelaporan jujur tanpa fabrikasi.
  - **Kriteria Keberhasilan**: Seluruh instruksi memiliki ID unik dan status mutakhir sesuai bukti uji aktual.
  - **Hasil Pengujian**: Diverifikasi konsisten dengan hasil akhir test suite (`26/26`), TypeScript (`0` error), production build, dan verifikasi browser headless Chromium.
  - **Catatan Hambatan**: -

---

### Phase 1 & 2: WhatsApp Core, Interactive List, Hybrid Menu, Pairing/QR & Providers (P0)

- **TASK-003** | **Diagnosis & Perbaikan Baileys Pairing Code (`515 restartRequired`) & QR Code Lifecycle**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `NEEDS_VERIFICATION`
  - **File Terkait**: `src/server/whatsappEngine.ts`, `bot-core.cjs`
  - **Deskripsi**: Memperbaiki bug pada `connection === 'close'` di `whatsappEngine.ts` agar `DisconnectReason.restartRequired` (status `515`) setelah user mengonfirmasi pairing/QR di ponsel otomatis menyambung ulang memakai kredensial baru, mendukung 8 state koneksi lengkap (`disconnected`, `connecting`, `waiting_qr`, `waiting_pairing`, `authenticated`, `connected`, `reconnecting`, `failed`), menjaga single-flight lock, normalisasi nomor Indonesia (`628...` digit saja), dan refresh QR expired tanpa loop request ganda.
  - **Kriteria Keberhasilan**: Simulasi pairing + `515 restartRequired` otomatis reconnect -> `connected`; QR refresh & timeout bersih; tidak ada request pairing ganda.
  - **Hasil Pengujian**: Lulus unit/integration simulation via `setSocketFactoryForTests` di `src/server/auditPhase.test.ts` (semua 26 test file lulus).
  - **Catatan Hambatan**: Koneksi real ke ponsel WhatsApp fisik belum dapat dijalankan dari container sandbox; menunggu uji langsung pada perangkat pemilik (`TASK-031`).

- **TASK-004** | **Arsitektur Multi-Provider Terpisah (`BaileysProvider`, `MetaCloudApiProvider`, `ConnectionProviderManager`)**
  - **Prioritas**: P0 | **Dependensi**: TASK-003 | **Status**: `NEEDS_VERIFICATION`
  - **File Terkait**: `src/server/providers/types.ts`, `src/server/providers/baileysProvider.ts`, `src/server/providers/metaCloudProvider.ts`, `src/server/providers/providerManager.ts`, `server.ts`
  - **Deskripsi**: Memisahkan abstraksi provider WhatsApp menjadi Baileys Provider dan Official Meta Cloud API Provider tanpa mencampur session, credentials, maupun event handler. Menyediakan endpoint webhook resmi `GET/POST /api/webhooks/meta-whatsapp` dengan verifikasi HMAC-SHA256 `X-Hub-Signature-256` & `META_WA_VERIFY_TOKEN`, capability mapping jujur, serta dokumentasi pembatasan single-number antara Baileys dan Cloud API.
  - **Kriteria Keberhasilan**: Switch provider via API/UI tanpa mencampur kredensial; webhook Meta memvalidasi signature & challenge; status Meta tetap jujur (`unconfigured`) bila token belum diisi.
  - **Hasil Pengujian**: Lulus pengujian unit `auditPhase.test.ts` (signature HMAC valid/invalid & provider state isolation) dan verifikasi UI switcher di `WhatsAppConnectionPanel.tsx`.
  - **Catatan Hambatan**: Pengiriman webhook Graph API Meta Cloud live membutuhkan Meta Business App, Phone Number ID, dan Access Token live di environment pengguna.

- **TASK-005** | **Perbaikan WhatsApp Interactive List & Hybrid Menu Engine (DB-Driven + Search + Pagination)**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `NEEDS_VERIFICATION`
  - **File Terkait**: `src/server/menuService.ts`, `src/server/whatsappEngine.ts`, `src/server/db.ts`
  - **Deskripsi**: Menghubungkan `menuService.ts` ke database SQLite live (`commands`, `menu_categories`, `menu_items`, `menu_configs`, `menu_usage_stats`); membangun Hybrid Menu Engine (`hybrid`, `interactive_only`, `text_only`), mencoba `nativeFlowMessage` (`single_select`) lalu fallback ke Baileys `listMessage` sebelum Text Menu bernomor; mendukung `#menu cari <kata>`, pagination >10 baris, navigasi kembali/pindah kategori, filter bahasa menu, dan permission check ketat.
  - **Kriteria Keberhasilan**: Toggle/edit menu & command di DB langsung mengubah menu bot; `listResponseMessage` dan `interactiveResponseMessage` diproses akurat; fallback tercatat di `menu_fallback_logs`.
  - **Hasil Pengujian**: Lulus pengujian di `auditPhase.test.ts` & `v5.test.ts` (live DB sync, `#menu cari`, pagination, mode hybrid/text, fallback log) serta tester UI.
  - **Catatan Hambatan**: Tampilan native Interactive List pada aplikasi WhatsApp di ponsel fisik bergantung kebijakan server WhatsApp akun non-bisnis (memerlukan verifikasi `TASK-031`).

- **TASK-006** | **Menu Management Backend APIs & Analytics**
  - **Prioritas**: P1 | **Dependensi**: TASK-005 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/menuService.ts`, `server.ts`, `src/server/db.ts`
  - **Deskripsi**: API CRUD kategori menu, item menu, urutan (`sort_order`), label, deskripsi, mapping command, visibilitas, permission, bahasa, toggle aktif/nonaktif, mode menu (`hybrid` | `interactive_only` | `text_only`), preview menu interaktif & teks, serta analitik pemakaian menu.
  - **Kriteria Keberhasilan**: Perubahan dari dashboard langsung terefleksi di respons `#menu` bot.
  - **Hasil Pengujian**: Teruji via `auditPhase.test.ts` dan endpoint API `/api/admin/menu/*` saat verifikasi UI Owner Console.
  - **Catatan Hambatan**: -

---

### Phase 3: Security Hardening (P0)

- **TASK-007** | **Autentikasi WebSocket `/ws` & Pemisahan Event Publik vs Privat**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `COMPLETED`
  - **File Terkait**: `server.ts`, `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: Mengharuskan autentikasi token owner pada `/ws` melalui frame `{ type: 'auth', token }` (atau protokol header tanpa query string token), serta memblokir broadcast `qrDataUrl`, `pairingCode`, dan `chat:message` ke socket yang belum terautentikasi.
  - **Kriteria Keberhasilan**: Koneksi `/ws` tanpa autentikasi tidak menerima data privat/QR/pairing code dan ditutup otomatis.
  - **Hasil Pengujian**: Terverifikasi pada `server.ts` & koneksi WebSocket authenticated di `OwnerDashboard.tsx` selama inspeksi browser (`0` error WS).
  - **Catatan Hambatan**: -

- **TASK-008** | **Owner Claim Atomik, Brute-Force Lockout & Rotasi Passcode**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `COMPLETED`
  - **File Terkait**: `server.ts`, `src/server/db.ts`
  - **Deskripsi**: Mengamankan `/api/auth/claim` dengan transaksi `IMMEDIATE` atomik (`claimOwnerPasscodeAtomic`), menambahkan progressive exponential lockout pada `/api/auth/login` dan `/api/auth/claim`, serta endpoint `POST /api/admin/auth/change-passcode`.
  - **Kriteria Keberhasilan**: Claim paralel hanya meloloskan klaim pertama; percobaan salah berulang memicu lockout; login & rotasi passcode bekerja aman.
  - **Hasil Pengujian**: Lulus unit test `auditPhase.test.ts` & flow login Owner Console di Chromium.
  - **Catatan Hambatan**: -

- **TASK-009** | **Hapus Legacy Static Backup Key + Implementasi Backup Verify & Restore Aman**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `COMPLETED`
  - **File Terkait**: `server.ts`
  - **Deskripsi**: Menghapus fallback key statis lama (`[KEY_STATIS_LAMA]`), mewajibkan `BACKUP_ENCRYPTION_KEY` atau passphrase manual eksplisit, serta menambahkan `POST /api/admin/backups/:id/verify` (SHA-256 + GCM) dan `POST /api/admin/backups/:id/restore` (konfirmasi ganda `RESTORE` + auto-snapshot pra-restore).
  - **Kriteria Keberhasilan**: Zero static backup key di source code; create tanpa key ditolak; verify & restore tervalidasi.
  - **Hasil Pengujian**: Teruji via `auditPhase.test.ts` dan `grep` repo (`0` temuan key statis).
  - **Catatan Hambatan**: -

- **TASK-010** | **Hapus Hardcoded Personal Phone Numbers di Source, Tests, DB & Docs**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/whatsappEngine.ts`, `src/server/db.ts`, `bot-core.cjs`, `src/core/core.test.ts`, `src/server/v5.test.ts`, `.env.example`, `README.md`, `data/freya-hub.db`
  - **Deskripsi**: Menghapus seluruh literal nomor telepon pribadi (`[NOMOR_PRIBADI_DIHAPUS]`) dari codebase, test, database lokal, dan dokumentasi; membaca `OWNER_NUMBER` / `OWNER_NAME` murni dari environment atau pengaturan DB Owner Settings.
  - **Kriteria Keberhasilan**: `grep` seluruh source/docs menghasilkan `0` temuan nomor pribadi tersebut; `#owner` dan test bekerja dinamis.
  - **Hasil Pengujian**: `grep` codebase & docs = `0` hits; SQLite `owner_number_configured` bersih (`''`); `npm test` 26/26 pass.
  - **Catatan Hambatan**: -

- **TASK-011** | **Production `SESSION_SECRET` Enforcement, Settings Secret Masking, CSRF/CORS & Log Sanitization**
  - **Prioritas**: P0 | **Dependensi**: TASK-002 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/db.ts`, `server.ts`
  - **Deskripsi**: Mewajibkan `SESSION_SECRET` (>=16 karakter) saat `NODE_ENV=production`, menyamarkan seluruh row `is_secret = 1` pada `GET /api/admin/settings`, menambahkan pengecekan Same-Origin/CSRF + allowlist CORS untuk route mutasi admin, serta sanitasi log untuk token/QR/pairing code/private key.
  - **Kriteria Keberhasilan**: Seluruh secret termasking; log bebas token/QR/key.
  - **Hasil Pengujian**: Terverifikasi di `auditPhase.test.ts` dan snapshot `OwnerDashboard` Settings.
  - **Catatan Hambatan**: -

- **TASK-012** | **Security Audit Report & PoC Verification (`walkthrough.md`)**
  - **Prioritas**: P0 | **Dependensi**: TASK-007, TASK-008, TASK-009, TASK-010, TASK-011 | **Status**: `COMPLETED`
  - **File Terkait**: `walkthrough.md`
  - **Deskripsi**: Mendokumentasikan `# Security Summary` diikuti `## PoC Verification` dengan jejak skenario eksploit dan pemblokiran untuk setiap temuan keamanan.
  - **Kriteria Keberhasilan**: Seluruh kerentanan terdokumentasi akurat dengan PoC terverifikasi.
  - **Hasil Pengujian**: `walkthrough.md` telah ditinjau ulang dan sesuai dengan implementasi kode final.
  - **Catatan Hambatan**: -

---

### Phase 4: Database, Command Engine, Plugin/API Vault & Multilingual (P1)

- **TASK-013** | **Audit Database SQLite, Indexing, Backup/Recovery & Evaluasi Migrasi MySQL**
  - **Prioritas**: P1 | **Dependensi**: TASK-001 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/db.ts`, `docs/DATABASE_AND_MYSQL_EVALUATION.md`
  - **Deskripsi**: Mengaudit schema SQLite, menambah migrasi idempoten (`ensureColumn`) untuk kompatibilitas DB pre-existing, menambah index baru (`idx_api_vault_provider`, dll.), memverifikasi WAL mode, serta menyusun evaluasi menyeluruh migrasi MySQL + mapping schema + rollback plan.
  - **Kriteria Keberhasilan**: Index & kolom migrasi aktif di SQLite live; `docs/DATABASE_AND_MYSQL_EVALUATION.md` lengkap.
  - **Hasil Pengujian**: Migrasi SQLite live `data/freya-hub.db` berhasil, `npm test` 26/26 pass.
  - **Catatan Hambatan**: -

- **TASK-014** | **Command Engine Upgrade: Prefix Toggle, Custom Command (Visual Builder + Script Editor + Sandbox + Test)**
  - **Prioritas**: P1 | **Dependensi**: TASK-005 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/customCommandService.ts`, `src/server/whatsappEngine.ts`, `server.ts`, `src/server/db.ts`
  - **Deskripsi**: CRUD Custom Command dengan dukungan Visual Builder & Script Editor berbasis evaluator aman (tanpa `eval`/`Function`/`child_process`), validasi sintaks, preview, permission (`public`/`premium`/`group_admin`/`owner`), test-run, aktivasi toggle, serta pengelolaan toggle prefix dari dashboard.
  - **Kriteria Keberhasilan**: Custom command dapat dibuat, divalidasi, dites, dan langsung berjalan di bot/simulator.
  - **Hasil Pengujian**: Lulus unit/integration test `auditPhase.test.ts` termasuk penolakan payload injeksi `eval`/`process`.
  - **Catatan Hambatan**: -

- **TASK-015** | **Central API Manager (`api_keys_vault`) & Plugin Management Lengkap**
  - **Prioritas**: P1 | **Dependensi**: TASK-011 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/apiVaultService.ts`, `src/server/db.ts`, `server.ts`
  - **Deskripsi**: Central API Manager dengan enkripsi `AES-256-GCM` untuk API key (tidak pernah mengembalikan plaintext key ke UI/log), pengelolaan provider, scope, kuota harian, rate limit, usage & error tracking; serta manajemen Plugin.
  - **Kriteria Keberhasilan**: Key tersimpan terenkripsi, tampil termasking (`****xxxx`), dan dapat dikelola via API & UI.
  - **Hasil Pengujian**: Lulus test vault `auditPhase.test.ts` & rendering `ApiManagerPanel.tsx` di Chromium.
  - **Catatan Hambatan**: -

- **TASK-016** | **Multilingual System: Pemisahan `menu_language` vs `ai_language`, Per-User/Group, & Translation Review**
  - **Prioritas**: P1 | **Dependensi**: TASK-005 | **Status**: `COMPLETED`
  - **File Terkait**: `src/core/botI18n.ts`, `src/server/translationService.ts`, `src/server/whatsappEngine.ts`, `src/server/aiService.ts`, `server.ts`, `src/server/db.ts`
  - **Deskripsi**: Memisahkan `menu_language` dan `ai_language` secara independen pada level Global Owner, Grup, dan Pengguna; menambah tabel `translations` serta UI Translation Review agar terjemahan tetap natural/santun dan tidak kaku.
  - **Kriteria Keberhasilan**: Mengganti `menu_language` tidak mengubah `ai_language` dan sebaliknya; review terjemahan berjalan dari dashboard.
  - **Hasil Pengujian**: Teruji via `auditPhase.test.ts` dan kontrol bahasa terpisah di `OwnerDashboard.tsx`.
  - **Catatan Hambatan**: -

- **TASK-017** | **Audit AI Agent & Automation Workflow (Trigger, Condition, Action, Schedule, Retry, Guardrail)**
  - **Prioritas**: P1 | **Dependensi**: TASK-015, TASK-016 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/aiService.ts`, `src/server/automationService.ts`, `server.ts`, `src/server/db.ts`
  - **Deskripsi**: Guardrail AI Agent berdasarkan permission pengguna & pola terlarang (`AI_AGENT_FORBIDDEN_PATTERNS`), serta Automation Workflow dengan trigger, condition, action, anti-SSRF webhook, retry/attempt logging, dan `automation_logs`.
  - **Kriteria Keberhasilan**: AI Agent menolak aksi di luar izin/berbahaya; workflow automation berjalan dengan retry & log tercatat.
  - **Hasil Pengujian**: Lulus test guardrail AI & automation di `auditPhase.test.ts`.
  - **Catatan Hambatan**: -

- **TASK-018** | **File Manager Hardening & Terminal Access Control**
  - **Prioritas**: P1 | **Dependensi**: TASK-008 | **Status**: `COMPLETED`
  - **File Terkait**: `server.ts`, `src/server/db.ts`
  - **Deskripsi**: Validasi upload/download File Manager (allowlist ekstensi, batas ukuran, proteksi path traversal) serta Terminal Dashboard khusus command diagnostik terizinkan milik Owner tanpa arbitrary shell execution.
  - **Kriteria Keberhasilan**: Upload ilegal/oversize & path traversal ditolak; shell bebas ditolak.
  - **Hasil Pengujian**: Terverifikasi pada route handler `server.ts` & linting/build clean.
  - **Catatan Hambatan**: -

---

### Phase 5 & 6: Dashboard, 13 Modul Bot, 48Group & Streak Verification (P1/P2)

- **TASK-019** | **Connection Dashboard (`WhatsAppConnectionPanel.tsx`) & Provider Switcher**
  - **Prioritas**: P1 | **Dependensi**: TASK-003, TASK-004 | **Status**: `COMPLETED`
  - **File Terkait**: `src/components/WhatsAppConnectionPanel.tsx`, `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: Provider Selector (Baileys vs Meta Cloud API), 8 state badge, metode QR & Pairing Code dengan validasi nomor, refresh QR, request pairing baru, Reset Baileys, info keterbatasan perangkat/socket, serta panel konfigurasi Meta Cloud API.
  - **Kriteria Keberhasilan**: Seluruh state & tombol terhubung ke backend API, responsif desktop/mobile, support Light/Dark mode.
  - **Hasil Pengujian**: Diverifikasi langsung di headless Chromium (`playwright-cli`), `0` console errors.
  - **Catatan Hambatan**: -

- **TASK-020** | **Menu Management Dashboard Panel**
  - **Prioritas**: P1 | **Dependensi**: TASK-006 | **Status**: `COMPLETED`
  - **File Terkait**: `src/components/MenuManagementPanel.tsx`, `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: UI CRUD Kategori & Item Menu, Mode Menu (`hybrid`/`interactive_only`/`text_only`), preview interaktif & teks, serta analitik pemakaian menu.
  - **Kriteria Keberhasilan**: Semua perubahan tersimpan di DB dan terlihat saat preview.
  - **Hasil Pengujian**: Diverifikasi langsung di Chromium (`Menu Management` tab), `0` console/API errors.
  - **Catatan Hambatan**: -

- **TASK-021** | **Custom Command Builder (Visual Builder + Script Editor) UI**
  - **Prioritas**: P1 | **Dependensi**: TASK-014 | **Status**: `COMPLETED`
  - **File Terkait**: `src/components/CustomCommandBuilderPanel.tsx`, `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: Antarmuka Visual Builder + Script Editor untuk membuat, memvalidasi, mem-preview, mengetes langsung (`Test Run`), mengatur permission, dan toggle aktif/nonaktif Custom Command.
  - **Kriteria Keberhasilan**: Pembuatan & uji custom command berjalan end-to-end.
  - **Hasil Pengujian**: Diverifikasi langsung di Chromium (`Custom Commands` tab), `0` console/API errors.
  - **Catatan Hambatan**: -

- **TASK-022** | **Central API Manager & Plugin Dashboard UI**
  - **Prioritas**: P1 | **Dependensi**: TASK-015 | **Status**: `COMPLETED`
  - **File Terkait**: `src/components/ApiManagerPanel.tsx`, `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: Halaman Central API Manager (enkripsi key, provider, scope, kuota, rate limit) dan manajemen Plugin di Owner Dashboard.
  - **Kriteria Keberhasilan**: Form & daftar vault terenkripsi tampil dan berfungsi tanpa memaparkan key penuh.
  - **Hasil Pengujian**: Diverifikasi langsung di Chromium (`Central API Manager` tab), `0` console errors.
  - **Catatan Hambatan**: -

- **TASK-023** | **Penyelarasan Navigasi Dashboard + Settings (Owner Number/Passcode, Backup Verify/Restore, Bahasa & Translation Review)**
  - **Prioritas**: P2 | **Dependensi**: TASK-008, TASK-009, TASK-016, TASK-019, TASK-020, TASK-021, TASK-022 | **Status**: `COMPLETED`
  - **File Terkait**: `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: Menyatukan 14 area utama dashboard termasuk 48Group Management, Redeem, Economy/Limit, Abuse Prevention, Game Activity, Backup Verify/Restore, Identitas/Passcode Owner, Bahasa Terpisah & Translation Review.
  - **Kriteria Keberhasilan**: Seluruh modul dapat diakses, bebas error console, responsif di desktop & mobile Light/Dark Mode.
  - **Hasil Pengujian**: Diverifikasi di Chromium (Desktop Light, Desktop Dark, Mobile `390x844`), `0` console errors.
  - **Catatan Hambatan**: -

- **TASK-024** | **Audit & Verifikasi 13 Modul Bot Utama + Status Jujur**
  - **Prioritas**: P2 | **Dependensi**: TASK-015, TASK-017 | **Status**: `COMPLETED`
  - **File Terkait**: `src/core/moduleAudit.ts`, `src/server/whatsappEngine.ts`, `server.ts`, `src/components/OwnerDashboard.tsx`
  - **Deskripsi**: Menginventarisasi dan mengaudit 13 modul utama beserta command, permission, DB, integrasi API, error handling, dan menandai modul belum terhubung eksternal secara jujur (`pending_integration`).
  - **Kriteria Keberhasilan**: Seluruh 13 modul teraudit nyata pada backend & dashboard tanpa klaim palsu.
  - **Hasil Pengujian**: Lulus pemeriksaan `moduleAudit.ts` & rendering tab `Multilingual & 13 Modules` di Chromium.
  - **Catatan Hambatan**: Modul yang membutuhkan API pihak ketiga (mis. Smart Home / Music / Downloader) jujur ditandai butuh API provider di Vault.

- **TASK-025** | **Verifikasi Integrasi 48Group di Dalam Kategori GAME & Pelestarian Game Lama**
  - **Prioritas**: P2 | **Dependensi**: TASK-005 | **Status**: `COMPLETED`
  - **File Terkait**: `src/core/commandInventory.ts`, `src/server/menuService.ts`, `src/components/FortyEightCenter.tsx`, `src/components/FortyEightCalendarWidget.tsx`
  - **Deskripsi**: Memastikan command 48Group tetap berada di dalam kategori `GAME` tanpa menghapus game lama, serta widget kalender jadwal konser & ulang tahun member 48Group terpasang di `FortyEightCenter`.
  - **Kriteria Keberhasilan**: Audit inventory membuktikan seluruh command 48Group ada di `GAME`, game lama aktif, dan kalender 48Group tampil di UI.
  - **Hasil Pengujian**: Teruji via `v5.test.ts` + `core.test.ts` + screenshot Round 1 `48Group Center` (menampilkan kalender November 2026 & daftar H- event member/theater).
  - **Catatan Hambatan**: -

- **TASK-026** | **Verifikasi & Ketahanan Aturan `#streak` & `#streakgrup`**
  - **Prioritas**: P2 | **Dependensi**: TASK-013 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/streakService.ts`, `src/server/whatsappEngine.ts`
  - **Deskripsi**: Memastikan `#streak` mewajibkan persetujuan minimal 1 pengguna dan `#streakgrup` memenuhi syarat minimal 3 orang berbeda atau minimal 5 pesan termasuk interaksi bot, bebas duplikasi & pulih setelah restart.
  - **Kriteria Keberhasilan**: Unit & integration test streak pass tanpa regresi.
  - **Hasil Pengujian**: Lulus di `v5.test.ts` (`26/26` test pass).
  - **Catatan Hambatan**: -

- **TASK-027** | **Audit Menyeluruh Bahasa Indonesia Nonbaku di Bot & Dashboard**
  - **Prioritas**: P2 | **Dependensi**: TASK-016, TASK-023 | **Status**: `COMPLETED`
  - **File Terkait**: `src/core/botI18n.ts`, `src/server/whatsappEngine.ts`, `src/server/menuService.ts`, `src/server/providers/*`
  - **Deskripsi**: Memeriksa seluruh balasan command, pesan error, menu, notifikasi grup, pesan owner/admin, dan UI agar konsisten menggunakan bahasa Indonesia nonbaku yang natural.
  - **Kriteria Keberhasilan**: Pemeriksaan otomatis `findFormalIndonesianViolations` lolos `0` pelanggaran.
  - **Hasil Pengujian**: Lulus di `core.test.ts` & `v5.test.ts` (`0` violations).
  - **Catatan Hambatan**: -

---

### Phase 7 & 8: Deployment, Dokumentasi, Pengujian & Verifikasi Browser (P1–P3)

- **TASK-028** | **Perbaikan `.env.example`, `README.md` & `docs/DEPLOYMENT_AND_OPERATIONS.md`**
  - **Prioritas**: P3 | **Dependensi**: TASK-010, TASK-011, TASK-013 | **Status**: `COMPLETED`
  - **File Terkait**: `.env.example`, `README.md`, `docs/DEPLOYMENT_AND_OPERATIONS.md`
  - **Deskripsi**: Menghapus referensi file yang tidak ada (`install.sh`, `npm ci`), menyelaraskan instruksi instalasi dengan `package.json`/`bun.lock`, serta mendokumentasikan `META_WA_*`, `SESSION_SECRET`, `BACKUP_ENCRYPTION_KEY`, dan operasional VPS/PM2/Nginx/Docker/backup tanpa nomor pribadi pemilik.
  - **Kriteria Keberhasilan**: Seluruh perintah di dokumentasi valid dan siap dijalankan pada repo ini.
  - **Hasil Pengujian**: File `.env.example`, `README.md`, dan `docs/DEPLOYMENT_AND_OPERATIONS.md` telah diaudit dan bersih.
  - **Catatan Hambatan**: -

- **TASK-029** | **Suite Unit Test, Integration Test, Regression Test & Security PoC Test**
  - **Prioritas**: P0 | **Dependensi**: TASK-003..TASK-027 | **Status**: `COMPLETED`
  - **File Terkait**: `src/server/v5.test.ts`, `src/server/auditPhase.test.ts`, `src/core/core.test.ts`
  - **Deskripsi**: Menambahkan dan memverifikasi seluruh test untuk `515 restartRequired`, 8 connection states, Meta Cloud API webhook HMAC, Hybrid Menu live DB + `#menu cari` + pagination, atomik `/api/auth/claim`, lockout, Backup verify/restore, Custom Command safe sandbox, API Vault masking, dan pemisahan `menu_language` vs `ai_language`.
  - **Kriteria Keberhasilan**: `npm test` lulus 100% tanpa skip.
  - **Hasil Pengujian**: `npm test` -> **26/26 PASS** (`0` fail, `0` skipped).
  - **Catatan Hambatan**: -

- **TASK-030** | **Build, Type-Check, Security Grep & Verifikasi Browser (`playwright-cli`)**
  - **Prioritas**: P0 | **Dependensi**: TASK-028, TASK-029 | **Status**: `COMPLETED`
  - **File Terkait**: Seluruh project
  - **Deskripsi**: Menjalankan `npm test`, build produksi, `tsc --noEmit`, `restart_dev_server`, dan inspeksi aplikasi live di headless Chromium (Public Landing, 48Group Center + Calendar Widget, Owner Console Login & Dashboard 14+ panel, Dark/Light mode, Mobile `390x844`).
  - **Kriteria Keberhasilan**: Build & lint bersih, seluruh journey UI berjalan tanpa console/API error.
  - **Hasil Pengujian**: Build berhasil, `tsc --noEmit` 0 error, `grep` rahasia 0 hits, dan Chromium Round 1 & 2 selesai dengan 0 console errors.
  - **Catatan Hambatan**: -

- **TASK-031** | **Verifikasi Perangkat WhatsApp Fisik (QR, Pairing Code `515`, & Interactive List Live Client)**
  - **Prioritas**: P0 | **Dependensi**: TASK-003, TASK-005, TASK-030 | **Status**: `BLOCKED`
  - **File Terkait**: `src/server/whatsappEngine.ts`, `src/server/menuService.ts`
  - **Deskripsi**: Menguji pairing code, QR code, serta rendering Interactive List (`single_select` / `listMessage` / text fallback) secara langsung terhadap akun WhatsApp di ponsel fisik serta live Meta Cloud API webhook jika diaktifkan.
  - **Kriteria Keberhasilan**: Akun WhatsApp terhubung nyata dan menu interaktif terverifikasi tampil di perangkat.
  - **Hasil Pengujian**: Tidak tersedia perangkat WhatsApp fisik, kartu SIM aktif, maupun kredensial Meta Cloud API bisnis live di container sandbox.
  - **Catatan Hambatan**: Memerlukan perangkat WhatsApp nyata milik Owner di luar container sandbox; tetap berstatus `BLOCKED` hingga diuji pengguna pada hardware nyata.
