# Freya-san Hub v5.0

Platform terpadu **WhatsApp Bot Engine (`@whiskeysockets/baileys`)**, **48Group Intelligence, Archive & Game Center**, **General Game Center**, **AI Agent Orchestration (Nexara)**, dan **Redeem Management System** dalam satu arsitektur full-stack (`React + Vite + Express + TypeScript + SQLite`).

---

## Fitur Utama

- **WhatsApp Bot Engine (`@whiskeysockets/baileys`)**: Mendukung **10 prefix aktif bawaan** (`. , ? ! * @ # $ & /`) dengan maupun tanpa spasi, interactive list menu + text fallback, serta **WhatsApp Command Simulator** langsung di Owner Console.
- **48Group Center (Modul Mandiri)**:
  - **Difficulty Explorer (JKT48)**: Klasifikasi era terstruktur dalam 3 tingkat kesulitan tetap:
    - **Level 1 — Mudah–Menengah**: *New Era – Fight Era* (`2022 – 2026`)
    - **Level 2 — Menengah**: *Era One* (`2021 – 2022`)
    - **Level 3 — Sulit**: *Group Release Era – Pre-One Era* (`2011 – 2021`)
  - **Team Explorer (JKT48)**: Navigasi bertingkat **Old** (*Team J, Team KIII, Team T*), **New** (*Team Love, Team Dream, Team Passion*), dan **Other / Unassigned** beserta riwayat transfer & alumni.
  - **Intelligence & Game Center**: Profil member, grup, diskografi, theater archive, kalender event, istilah/budaya, verifikasi sumber resmi, serta kuis 48Group yang dapat difilter per Level/Era maupun Team.
- **Game Center & Activity Engine**: Permainan Private & Group terpisah dengan session lock anti-bertumpuk, papan peringkat, Studio Kertas Folio (`.folio`), dan **Klaim Kode Redeem** publik.
- **Owner Console & Redeem Management**:
  - Autentikasi passcode owner + Bearer token in-memory.
  - **Platform Management → Redeem Management**: 5 submenu (*Redeem Codes, Reward Builder, Claim History, Redeem Analytics, Redeem Settings*), validator handler terpusat, transaksi atomik SQLite, dan riwayat klaim permanen.
  - Command Manager (`586` command teraudit), Prefix Manager, Live Chat Monitor (WebSocket `/ws`), File Manager, Encrypted Backup (`AES-256-GCM`), dan Audit Console.

---

## Prasyarat Sistem

Pastikan perangkat lokal atau server memiliki:

- **Node.js**: versi **20 LTS** atau **22 LTS** (disarankan `>= 20.11`)
- **npm**: versi `>= 10`
- **Git**
- **Build tools C/C++** (untuk kompilasi native `better-sqlite3` jika prebuild tidak tersedia):
  - Windows: *Desktop development with C++* atau `windows-build-tools` (biasanya sudah tersedia prebuilt binary untuk Node 20/22).
  - Ubuntu / Debian: `sudo apt-get update && sudo apt-get install -y build-essential python3`

---

## 1. Menjalankan via VS Code (Local Development)

1. **Clone repository & buka di VS Code**

   ```bash
   git clone <URL_REPO_GITHUB_ANDA>
   cd <NAMA_FOLDER_REPO>
   code .
   ```

2. **Siapkan file environment (`.env`)**

   Salin `.env.example` menjadi `.env` melalui terminal VS Code (`Ctrl + ~` atau `Cmd + J`):

   ```bash
   cp .env.example .env
   ```

   *(Di PowerShell Windows: `Copy-Item .env.example .env`)*

   Buka file `.env` di editor VS Code dan sesuaikan seperlunya:

   ```env
   # Opsional untuk fitur AI Nexara & riset 48Group (Gemini)
   GEMINI_API_KEY="ISI_API_KEY_GEMINI_ANDA"

   # URL publik aplikasi jika di-deploy
   APP_URL="http://localhost:3000"

   # Port server (default 3000)
   PORT=3000

   # Konfigurasi Owner & Keamanan (disarankan diisi sebelum production)
   OWNER_NUMBER="6281234567890"
   OWNER_PASSCODE="passcode_rahasia_minimal_6_karakter"
   SESSION_SECRET="string_acak_panjang_untuk_token_session"
   BACKUP_ENCRYPTION_KEY="kunci_acak_panjang_untuk_backup_aes256"

   # Set "true" jika ingin Baileys langsung mencoba reconnect saat server menyala
   WHATSAPP_AUTO_CONNECT="false"
   ```

   > **Catatan:** Jika `OWNER_PASSCODE` dikosongkan pada pertama kali menjalankan aplikasi, buka tab **Console Owner** di web untuk melakukan *First-Run Claim Passcode* langsung dari UI.

3. **Install dependencies**

   ```bash
   npm install
   ```

4. **Jalankan mode development**

   ```bash
   npm run dev
   ```

   Server Express + Vite middleware akan berjalan di:
   - Web Portal & API: `http://localhost:3000`
   - WebSocket Live Monitor: `ws://localhost:3000/ws`

5. **Menjalankan Test & Type-Check di VS Code**

   ```bash
   npm test
   npm run lint
   ```

---

## 2. Menjalankan di Server Produksi (VPS Linux, PM2, Nginx, Docker, Pterodactyl)

### A. Build & Jalankan Standar (Node.js Production)

Jangan jalankan Vite dev middleware di server produksi. Build frontend terlebih dahulu, lalu jalankan server dengan `NODE_ENV=production`:

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 npm start
```

Saat `NODE_ENV=production`, `server.ts` otomatis melayani file statis hasil build dari folder `dist/` sekaligus API `/api/*` dan WebSocket `/ws` pada satu port (`3000` atau nilai `PORT`).

---

### B. Deployment 24/7 Menggunakan PM2 (Ubuntu / Debian VPS)

1. Install PM2 secara global:

   ```bash
   sudo npm install -g pm2
   ```

2. Pastikan `.env` sudah terisi dan build sudah dijalankan:

   ```bash
   npm install
   npm run build
   ```

3. Jalankan aplikasi dengan PM2:

   ```bash
   NODE_ENV=production PORT=3000 pm2 start "npx tsx server.ts" --name freya-san-hub
   pm2 save
   pm2 startup
   ```

4. Cek log & status:

   ```bash
   pm2 status
   pm2 logs freya-san-hub
   ```

---

### C. Konfigurasi Reverse Proxy Nginx (Domain + HTTPS + WebSocket)

Jika memakai Nginx di depan aplikasi (`port 3000`), pastikan header `Upgrade` dan `Connection` diteruskan agar fitur WebSocket `/ws` (*Live Chat Monitor* & status WhatsApp real-time) berjalan normal:

```nginx
server {
    listen 80;
    server_name hub.domainanda.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Wajib untuk WebSocket (/ws)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Setelah itu aktifkan SSL dengan Certbot (`sudo certbot --nginx -d hub.domainanda.com`) dan perbarui `APP_URL="https://hub.domainanda.com"` di `.env`.

---

### D. Menjalankan via Docker / Container

Contoh `Dockerfile` jika ingin menjalankan di container / VPS / Cloud Run / Railway / Fly.io:

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
```

Jalankan container sambil me-mount folder `./data` agar database SQLite dan sesi login WhatsApp tetap tersimpan saat container di-restart:

```bash
docker build -t freya-san-hub .
docker run -d \
  --name freya-san-hub \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  freya-san-hub
```

---

### E. Menjalankan di Panel Pterodactyl / Hosting Node.js

1. Upload seluruh source code (kecuali `node_modules/` dan `data/`).
2. Atur **Node.js Version** ke **20** atau **22**.
3. Isi variabel environment di panel (atau unggah file `.env`).
4. Pada command install / build jalankan:
   ```bash
   npm install && npm run build
   ```
5. Atur **Startup Command**:
   ```bash
   NODE_ENV=production npx tsx server.ts
   ```
   Sesuaikan variabel `PORT` dengan port alokasi dari panel hosting Anda.

---

## 3. Cara Menautkan Bot WhatsApp & Menggunakan Fitur Utama

1. Buka aplikasi di browser, klik menu **Console Owner** di pojok kanan atas, lalu login (atau buat passcode pertama jika belum diset).
2. Masuk ke menu **Connection & Simulator**:
   - Klik **Hubungkan / Tampilkan QR** untuk memunculkan kode QR Baileys.
   - Buka WhatsApp di ponsel → **Perangkat Tertaut (Linked Devices)** → **Tautkan Perangkat**, lalu pindai QR.
   - Jika hanya ingin menguji perintah tanpa menautkan nomor WhatsApp, gunakan panel **WhatsApp Command & Interactive Menu Tester** di sebelah kanan.
3. Contoh perintah WhatsApp cepat yang bisa diuji:
   - `.menu` — Menampilkan menu kategori command.
   - `.jkt48 level` / `.jkt48 level 1` — Membuka **Difficulty Explorer JKT48** (Level 1–3).
   - `.jkt48 team` / `.jkt48 team old` — Membuka **Team Explorer JKT48** (*Old / New / Other*).
   - `.kuis48 level 3` / `.kuis48 team team_j` — Memulai kuis 48Group terfilter Era/Team.
   - `.addredeem` *(khusus Owner)* — Membuka wizard interaktif 6 langkah pembuatan kode redeem dengan Reward Registry tervalidasi.
   - `.redeem FREYAHUB50` — Mengklaim kode redeem langsung ke saldo, EXP, limit harian, badge, atau streak pengguna.

---

## 4. Daftar Skrip NPM

| Perintah | Fungsi |
| :--- | :--- |
| `npm run dev` | Menjalankan server Express + Vite development mode pada port `3000` |
| `npm run build` | Mem-build bundle frontend produksi ke direktori `dist/` |
| `npm start` | Menjalankan `tsx server.ts` (gunakan `NODE_ENV=production` di server produksi) |
| `npm test` | Menjalankan seluruh unit test & service test (`src/core/*.test.ts` & `src/server/*.test.ts`) |
| `npm run lint` | Memeriksa tipe TypeScript secara penuh (`tsc --noEmit`) |

---

## 5. Penyimpanan Data & Keamanan

Semua data runtime disimpan secara lokal di direktori `data/` (sudah diabaikan oleh `.gitignore`):

- `data/freya-hub.db` — Database SQLite (WAL mode) untuk command, game session, 48Group archive, user, redeem, dan log audit.
- `data/wa-auth/` — Kredensial sesi login WhatsApp Baileys.
- `data/files/` — File yang dibuat melalui Owner File Manager.
- `data/backups/` — Arsip backup terenkripsi `AES-256-GCM`.

> **Penting:** Jangan pernah meng-commit file `.env` maupun folder `data/` ke repositori GitHub publik agar passcode owner, API key, dan sesi WhatsApp tetap aman.
