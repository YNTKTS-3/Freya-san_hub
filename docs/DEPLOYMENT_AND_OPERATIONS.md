# Panduan Deployment & Operasional 24/7 — Freya-san Hub v5.0

Panduan ini disusun sesuai struktur aktual repositori (`server.ts`, `package.json`, `data/`).

---

## 1. Environment Variables Wajib Produksi

Atur di `.env` (server lokal/VPS) atau Secrets manager (jangan pernah commit `.env` ke Git):

- `PORT=3000`
- `NODE_ENV=production`
- `SESSION_SECRET` — minimal 32 karakter acak untuk penandatanganan token session admin & WebSocket.
- `OWNER_PASSCODE` — passcode login Owner Console (bila kosong saat run pertama, wajib segera diklaim lewat UI Owner Console).
- `API_VAULT_SECRET` — minimal 32 karakter acak untuk enkripsi `AES-256-GCM` kunci API di Central API Manager & kredensial Meta Cloud API.
- `BACKUP_ENCRYPTION_KEY` — minimal 16 karakter acak untuk enkripsi & verifikasi/restore backup `.enc.json`.
- `OWNER_NUMBER` & `OWNER_NAME` — nomor WhatsApp owner (`628...`) dan nama tampilan untuk command `#owner`.
- `GEMINI_API_KEY` — API key Gemini server-side (opsional; bisa juga disimpan terenkripsi lewat Central API Manager).
- `META_WA_*` — opsional jika memilih provider **Meta WhatsApp Business Cloud API** (`META_WA_ACCESS_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_VERIFY_TOKEN`, `META_WA_APP_SECRET`).

---

## 2. Build & Menjalankan 24/7 (PM2 di VPS Linux)

```bash
npm install
npm run build
NODE_ENV=production PORT=3000 pm2 start "npm start" --name freya-san-hub
pm2 save
pm2 startup
```

### Reverse Proxy Nginx + HTTPS + WebSocket `/ws`
Pastikan header `Upgrade`, `Connection`, `Host`, dan `X-Forwarded-Host` diteruskan agar koneksi WebSocket terautentikasi (`/ws`) dan pengecekan same-origin mutation API bekerja mulus di balik domain HTTPS.

```nginx
server {
    listen 443 ssl http2;
    server_name hub.domainanda.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Docker Container (Persistent Volume `./data`)

```bash
docker build -t freya-san-hub .
docker run -d \
  --name freya-san-hub \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  --restart unless-stopped \
  freya-san-hub
```

---

## 3. Operasional Media Pipeline (`#tolive` & `#sa`)

Pastikan binary `ffmpeg` (dengan encoder `libvpx-vp9` / `libopus` / `libx264`) dan `python3` terpasang di host container/VPS agar konversi Motion Photo (`JPEG+XMP+MP4`) dan Sound Sticker (`WebP+Opus`) berjalan penuh.

---

## 4. Prosedur Backup, Verifikasi & Restore

1. Pastikan `BACKUP_ENCRYPTION_KEY` terpasang (atau masukkan passphrase minimal 12 karakter saat operasi manual).
2. Buat snapshot terenkripsi melalui **Owner Console → Backup & Settings → Buat Backup Baru**.
3. Uji integritas file menggunakan tombol **Verify SHA-256** untuk memastikan checksum & dekripsi AES-256-GCM berhasil.
4. Bila diperlukan restore, gunakan tombol **Restore** dan isi konfirmasi ganda `RESTORE`; sistem otomatis membuat snapshot cadangan *pre-restore* di `data/backups/` sebelum memperbarui database.

---

## 5. Checklist Troubleshooting Koneksi WhatsApp

- **Baileys Error 515 (`restartRequired`) saat Pairing Code / QR**: Engine otomatis menjaga status `pendingPairingCompletion` saat reconnect instan dan tidak menolak koneksi ulang, lalu menyelesaikan transisi ke `connected`.
- **Pairing gagal berulang atau sesi korup**: Gunakan **Reset Koneksi** terlebih dahulu; bila kredensial auth rusak permanen, gunakan **Reset Sesi Penuh** dan tautkan ulang perangkat.
- **Meta Cloud API**: Pastikan URL webhook HTTPS publik mengarah ke `/api/webhooks/meta-whatsapp`, `Verify Token` cocok untuk permintaan `GET`, dan `App Secret` aktif untuk verifikasi `X-Hub-Signature-256` pada `POST`.
