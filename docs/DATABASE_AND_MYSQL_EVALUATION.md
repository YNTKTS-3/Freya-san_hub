# Evaluasi Database SQLite & Rencana Migrasi MySQL — Freya-san Hub v5.0

## 1. Kondisi Database Saat Ini (SQLite WAL + `better-sqlite3`)

Runtime utama **Freya-san Hub v5.0** berjalan menggunakan **SQLite (`better-sqlite3`)** dalam mode **WAL (`PRAGMA journal_mode = WAL`)** dan `PRAGMA foreign_keys = ON` di `data/freya-hub.db`.

### Kelebihan Arsitektur Saat Ini
- **Zero external service dependency**: Cocok untuk single-node VPS, container Docker, maupun preview environment tanpa setup server database terpisah.
- **Transaksi Atomik Cepat**: Operasi kritikal (`executeRedeemClaim`, `executeAddLimit`, `claimOwnerPasscodeAtomic`, game scoring, streak restore cap) berjalan sinkron dalam blok `db.transaction(...).immediate()` sehingga bebas race-condition pada single-process Node.js.
- **Skema Terstruktur & Terindeks**: Berisi tabel inti sistem (`settings`, `bot_sessions`, `wa_connection_history`, `wa_provider_configs`), tabel registry & menu (`prefixes`, `commands`, `command_aliases`, `menu_configs`, `menu_categories`, `menu_items`, `menu_fallback_logs`, `custom_commands`), tabel pengguna & keamanan (`users`, `contacts`, `groups`, `group_members`, `abuse_restrictions`, `abuse_events`, `audit_logs`, `logs`, `errors`), tabel ekonomi & game (`redeem_codes`, `redeem_claims`, `game_settings`, `game_sessions`, `game_scores`, `pair_streaks`, `group_streaks`), tabel 48Group (`forty_eight_*`, `jkt48_*`), serta tabel AI, Vault, Multilingual, dan Automation (`ai_providers`, `ai_agents`, `api_keys_vault`, `translations`, `plugins`, `automations`, `scheduled_tasks`).
- **Indeks Performa**: Indeks aktif pada kolom lookup sering pakai (`idx_command_usage_cmd`, `idx_wa_conn_hist_created`, `idx_menu_items_cat`, `idx_custom_cmds_name`, `idx_api_vault_provider`, `idx_translations_key_lang`, `idx_scheduled_tasks_auto`).

### Batasan SQLite untuk Skala Lebih Besar
- **Single-writer lock**: Jika aplikasi dipecah ke banyak worker/instance container (horizontal scaling), SQLite file lokal tidak dapat berbagi write lock lintas host.
- **Kapasitas Log Jangka Panjang**: Tabel append-only (`command_usage`, `logs`, `wa_connection_history`) perlu rotasi atau arsip berkala agar ukuran file `.db` tetap ringkas.

---

## 2. Evaluasi Migrasi ke MySQL 8.0+ (Rekomendasi Strategis)

**Keputusan Saat Ini**: SQLite tetap dipertahankan sebagai engine default v5.0 karena 100% layanan (`server.ts`, `db.ts`, `redeemService.ts`, `gameEngine.ts`, `whatsappEngine.ts`) menggunakan API sinkron `better-sqlite3`. Migrasi ke MySQL hanya disarankan bila Freya-san Hub dijalankan multi-instance (>1 Node worker) atau menampung >100.000 pengguna aktif bersamaan.

### Pemetaan Tipe & Sintaks SQLite → MySQL 8.0

| Konsep SQLite | Padanan MySQL 8.0 | Catatan Implementasi |
| :--- | :--- | :--- |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY` | Gunakan `BIGINT` untuk tabel log & transaksi |
| `TEXT` (ID / key unik) | `VARCHAR(128)` / `VARCHAR(255)` | Wajib untuk kolom `PRIMARY KEY` / `UNIQUE` di MySQL InnoDB |
| `TEXT` (JSON / prompt panjang) | `LONGTEXT` atau `JSON` | Pastikan charset `utf8mb4_unicode_ci` untuk emoji & teks Jepang |
| `datetime('now')` | `CURRENT_TIMESTAMP(3)` | Konsisten dalam UTC |
| `INSERT OR REPLACE INTO` | `INSERT INTO ... ON DUPLICATE KEY UPDATE` | Hindari `REPLACE` agar tidak men-trigger cascade delete FK |
| `db.transaction(...).immediate()` | `START TRANSACTION; SELECT ... FOR UPDATE; COMMIT;` | Kunci baris (`FOR UPDATE`) untuk redeem, limit, claim owner |

### Langkah Migrasi Bertahap (Zero-Data-Loss Plan)
1. **Abstraksi Repository Async**: Buat layer `src/server/repositories/*` yang mengembalikan `Promise<T>` dan membungkus transaksi atomik.
2. **Dual-Driver Adapter**: Pertahankan driver SQLite sebagai mode lokal (`DB_DRIVER=sqlite`) dan tambahkan driver `mysql2/promise` (`DB_DRIVER=mysql`, `DATABASE_URL`).
3. **Skema DDL & Migrator**: Konversi `CREATE TABLE` SQLite ke skrip migrasi MySQL (`utf8mb4`), verifikasi panjang kolom terindeks (maks 768 byte per indeks InnoDB).
4. **ETL Ekspor-Impor + Validasi Checksum**: Ekspor tiap tabel dari `data/freya-hub.db`, muat ke MySQL dalam batch transaksi, lalu verifikasi kesesuaian jumlah baris dan integritas kunci rahasia terenkripsi (`api_keys_vault`, `wa_provider_configs`).
5. **Rencana Rollback**: Simpan salinan read-only `data/freya-hub.db` sebelum cutover; bila latensi atau error query muncul, kembalikan `DB_DRIVER=sqlite` dan restart layanan tanpa kehilangan state awal.
