# Audit Keamanan & Verifikasi Freya-san Hub v5.0

# Security Summary

Audit kode penuh dilakukan pada seluruh lapisan aplikasi (engine WhatsApp Baileys, webhook Meta Cloud API, API Express `/api/*`, WebSocket `/ws`, Vault API terenkripsi, pembangun Custom Command, backup/restore, serta kontrol akses owner).

- **Penghapusan Kredensial & Nomor Privat Bawaan**: Seluruh fallback nomor telepon pribadi yang sebelumnya tertanam di source code (`src/server/whatsappEngine.ts`, `bot-core.cjs`) maupun fallback kunci enkripsi statis di endpoint backup (`server.ts`) telah dihapus. Konfigurasi nomor owner kini dibaca murni dari environment (`OWNER_NUMBER` / `OWNER_NAME`) atau pengaturan database (`is_secret = 1` dan disamarkan pada response GET).
- **Autentikasi & Perlindungan WebSocket `/ws`**: Endpoint WebSocket kini memblokir pengiriman status atau feed pesan sebelum klien mengirim frame autentikasi `{ type: 'auth', token }` (atau header `Sec-WebSocket-Protocol`) yang lolos verifikasi HMAC session owner.
- **Integritas First-Run Claim & Proteksi Brute-Force**: Proses klaim passcode pertama menggunakan transaksi SQLite atomik (`claimOwnerPasscodeAtomic`), sedangkan endpoint `/api/auth/login` dan `/api/auth/claim` dilindungi *progressive exponential lockout* per IP saat gagal beruntun serta pemeriksaan same-origin untuk mutasi API.
- **Sandbox Eksekusi Custom Command & Proteksi SSRF**: Evaluasi Custom Command berjalan lewat parser template dan aritmatika terbatas tanpa `eval`, `new Function`, maupun akses `child_process`/`fs`; webhook otomatisasi menolak URL non-HTTP(S) serta alamat loopback/private-network (anti-SSRF).
- **Kunci Backup, API Vault & Webhook HMAC**: Kunci Vault eksternal dan token Meta Cloud API dienkripsi `AES-256-GCM` (`api_keys_vault`, `wa_provider_configs`) dengan response API selalu tersamarkan (`maskSecretValue`), webhook Meta memvalidasi tanda tangan `X-Hub-Signature-256` memakai `rawBody`, dan pembuatan/verifikasi/restore backup menolak beroperasi tanpa `BACKUP_ENCRYPTION_KEY` atau passphrase manual yang valid.

---

## PoC Verification

### 1. Kebocoran Status Sensitif pada WebSocket `/ws` Tanpa Autentikasi
- **Masalah Awal**: Handler `wss.on('connection')` di `server.ts` langsung memanggil `ws.send(...)` dengan payload `wa:status` dan mendaftarkan semua socket terbuka dalam `broadcastEvent`, memungkinkan klien tanpa token membaca status nomor WhatsApp dan log chat admin.
- **Perbaikan**: `server.ts` memelihara `authedClients` terpisah, memvalidasi token owner melalui `verifySessionToken`, menutup koneksi yang tidak terautentikasi dalam 10 detik (`4001`/`4003`), dan `OwnerDashboard.tsx` mengirim `{ type: 'auth', token }` pada event `ws.onopen`.
- **Alur Verifikasi**: Hubungkan klien WebSocket tanpa mengirim token → pastikan server tidak mengirim event `wa:status`/`chat:message` dan menutup koneksi; hubungkan klien dengan token login valid → server mengirim `auth:ok` lalu `wa:status`.

### 2. Fallback Kunci Enkripsi Statis pada Endpoint Pembuatan Backup
- **Masalah Awal**: `POST /api/admin/backups/create` menggunakan string fallback statis apabila `BACKUP_ENCRYPTION_KEY` tidak diatur di environment, sehingga enkripsi backup dapat ditebak jika administrator lupa mengonfigurasi key.
- **Perbaikan**: Helper `resolveBackupEncryptionKey` di `server.ts` menolak fallback statis sepenuhnya dan mewajibkan `BACKUP_ENCRYPTION_KEY` (>= 16 karakter) atau `passphrase` eksplisit (>= 12 karakter) pada pembuatan, verifikasi SHA-256 (`POST /api/admin/backups/:id/verify`), dan restore (`POST /api/admin/backups/:id/restore` dengan konfirmasi ganda `RESTORE` + pembuatan snapshot pra-restore).
- **Alur Verifikasi**: Panggil `/api/admin/backups/create` tanpa `BACKUP_ENCRYPTION_KEY` maupun `passphrase` → respons HTTP `400`; panggil ulang dengan passphrase valid → file terenkripsi terbuat dan lolos verifikasi SHA-256 + dekripsi dengan passphrase yang sama.

### 3. Race Condition pada First-Run Claim Owner Passcode
- **Masalah Awal**: `POST /api/auth/claim` melakukan pemeriksaan `isOwnerAuthConfigured()` lalu `INSERT` hash passcode secara terpisah sehingga dua request paralel saat pertama kali setup berpotensi menimpa klaim satu sama lain.
- **Perbaikan**: Ditambahkan transaksi SQLite `.immediate()` `claimOwnerPasscodeAtomic` di `src/server/db.ts` yang memeriksa keberadaan `OWNER_PASSCODE` maupun hash di database secara atomik sebelum menulis satu kali.
- **Alur Verifikasi**: Jalankan dua pemanggilan `claimOwnerPasscodeAtomic` secara berurutan pada kondisi belum terkonfigurasi → pemanggilan pertama mengembalikan `{ ok: true }` dan pemanggilan kedua ditolak dengan `{ ok: false }`.

### 4. Paparan Rahasia pada Settings & API Vault
- **Masalah Awal**: Endpoint `GET /api/admin/settings` hanya menyamarkan key `owner_passcode_hash` dan belum memeriksa seluruh baris dengan `is_secret = 1`.
- **Perbaikan**: `GET /api/admin/settings` kini menyamarkan seluruh kolom di mana `is_secret === 1` menggunakan `maskSecretValue`, sementara `apiVaultService.ts` dan `metaCloudProvider.ts` tidak pernah mengembalikan plaintext API key atau App Secret dalam payload JSON API admin.
- **Alur Verifikasi**: Simpan entri API Vault baru melalui `upsertApiVaultEntry` dan nomor owner lewat `/api/admin/settings` → periksa hasil `listApiVaultEntries()` dan `GET /api/admin/settings` hanya memuat nilai tersamarkan.

### 5. Eksekusi Injeksi pada Custom Command & Guardrail AI Agent
- **Masalah Awal**: Eksekusi skrip kustom dan prompt AI Agent perlu dipastikan tidak dapat memicu evaluasi kode arbitrer atau permintaan sistem sensitif.
- **Perbaikan**: `validateCustomCommandSyntax` di `src/server/customCommandService.ts` memblokir pola `eval`, `Function`, `require`, `import(`, `process.`, dan `child_process`, serta `runAiAgentAction` di `src/server/aiService.ts` memblokir instruksi akses shell/SQL/kredensial dan membatasi aksi berisiko tinggi khusus peran owner.
- **Alur Verifikasi**: Validasi payload custom command dengan `process.exit()` atau `eval('1')` → ditolak dengan daftar error; jalankan `runAiAgentAction` dengan prompt shell command → ditolak sebelum memanggil model AI.
