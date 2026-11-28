'use strict';

/**
 * ============================================================================
 * FREYA-SAN HUB v5.0 - WHATSAPP BOT CORE ENGINE (HYBRID MODULAR COMMONJS)
 * Bot Identity : Freya-san bot by Pak Ujan
 * Owner Contact: Configurable via process.env.OWNER_NUMBER
 * Runtime      : Node.js + @whiskeysockets/baileys (v7+) + FFmpeg CLI
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const pino = require('pino');
const { Boom } = require('@hapi/boom');

// ============================================================================
// 1. KONFIGURASI UTAMA & IDENTITAS PROYEK
// ============================================================================

const CONFIG = {
  projectName: 'Freya-san Hub',
  projectVersion: '5.0',
  botName: 'Freya-san bot by Pak Ujan',
  ownerName: process.env.OWNER_NAME || 'Pak Ujan',
  ownerNumber: String(process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  ownerDisplayNumber: process.env.OWNER_NUMBER ? `+${String(process.env.OWNER_NUMBER).replace(/\D/g, '')}` : '',
  authFolder: path.resolve(process.cwd(), 'data', 'wa-auth-core'),
  prefixes: ['#', '.', '!', '/', '?', '$', '+', '-', '~', '*'],
  pairingStabilizeDelayMs: 3000,
  stickerMaxSeconds: 10,
};

const WIBUSOFT_MENU_CATEGORIES = [
  { id: 'AI', icon: '🤖', desc: 'Tanya AI Nexara & bikin gambar pintar' },
  { id: 'DOWNLOAD', icon: '⬇️', desc: 'Unduh video, musik & media sosial' },
  { id: 'GAME', icon: '🎮', desc: 'Game solo, kuis seru, UNO, Bom & Werewolf' },
  { id: 'GENERAL', icon: '🧭', desc: 'Menu utama, info bot, ping, streak & owner' },
  { id: 'GROUP', icon: '👥', desc: 'Pengaturan grup, welcome, anti-spam & absen' },
  { id: 'INFO', icon: '📊', desc: 'Cek profil, limit, gempa BMKG & leaderboard' },
  { id: 'OWNER', icon: '👑', desc: 'Kontrol khusus Owner, prefix, redeem & server' },
  { id: 'RANDOM', icon: '🎲', desc: 'Pantun, fakta unik & hiburan acak' },
  { id: 'SEARCH', icon: '🔍', desc: 'Cari Wikipedia, cuaca, jadwal shalat & IP' },
  { id: 'STICKER', icon: '✨', desc: 'Bikin stiker WhatsApp, brat & #stikeraudio/#sa' },
  { id: 'TEXTMAKER', icon: '🎨', desc: 'Bikin gambar teks gaya neon, glitch & logo' },
  { id: 'TOOLS', icon: '🛠️', desc: 'Folio, #tolive, mockup chat, QR & utilitas' },
  { id: '48GROUP GAMES', icon: '🌸', desc: 'Arsip member JKT48/AKB48, theater & kuis 48' },
];

// ============================================================================
// 2. LOADER @whiskeysockets/baileys & UTILITAS SANITASI / PARSING
// ============================================================================

async function loadBaileys() {
  try {
    return require('@whiskeysockets/baileys');
  } catch (err) {
    if (err && err.code === 'ERR_REQUIRE_ESM') {
      return await import('@whiskeysockets/baileys');
    }
    throw err;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sanitasi nomor WhatsApp Pairing Code:
 * - Hapus seluruh karakter non-angka (/\D/g)
 * - Konversi otomatis format lokal Indonesia 08xxx -> 628xxx
 * - Validasi panjang 8-15 digit kode negara internasional
 */
function sanitizePairingPhoneNumber(rawInput) {
  let cleanNumber = String(rawInput || '').replace(/\D/g, '');
  if (!cleanNumber) {
    throw new Error('Nomor WhatsApp kosong. Masukin nomor kayak 0812xxxxxxxx atau 62812xxxxxxxx.');
  }
  if (cleanNumber.startsWith('08')) {
    cleanNumber = '62' + cleanNumber.slice(1);
  } else if (cleanNumber.startsWith('0')) {
    throw new Error('Nomor nggak boleh diawali 0 selain awalan lokal Indonesia 08xx.');
  }
  if (cleanNumber.length < 8 || cleanNumber.length > 15) {
    throw new Error('Panjang nomor WhatsApp nggak valid (wajib 8–15 digit termasuk kode negara).');
  }
  return cleanNumber;
}

function parseCommand(rawText, prefixes) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const matchedPrefix = prefixes.find((p) => text.startsWith(p));
  if (!matchedPrefix) return null;

  const withoutPrefix = text.slice(matchedPrefix.length).trim();
  if (!withoutPrefix) return null;

  const parts = withoutPrefix.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { prefix: matchedPrefix, command, args, fullArgs: args.join(' ') };
}

function extractTextFromWAMessage(msg) {
  const content = msg && msg.message ? msg.message : {};
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage && content.extendedTextMessage.text) {
    return content.extendedTextMessage.text;
  }
  if (content.imageMessage && content.imageMessage.caption) {
    return content.imageMessage.caption;
  }
  if (content.videoMessage && content.videoMessage.caption) {
    return content.videoMessage.caption;
  }
  if (content.listResponseMessage && content.listResponseMessage.singleSelectReply) {
    return content.listResponseMessage.singleSelectReply.selectedRowId || '';
  }
  if (
    content.interactiveResponseMessage &&
    content.interactiveResponseMessage.nativeFlowResponseMessage &&
    content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson
  ) {
    try {
      const parsed = JSON.parse(
        content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson
      );
      return parsed && parsed.id ? String(parsed.id) : '';
    } catch (_) {
      return '';
    }
  }
  return '';
}

function removeFileSafe(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`[CLEANUP WARN] Gagal hapus file sementara ${filePath}: ${err.message}`);
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      reject(new Error(`Gagal jalanin ffmpeg: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg keluar dengan kode ${code}: ${stderr.slice(-400)}`));
      }
    });
  });
}

// ============================================================================
// 3. MODUL INTERACTIVE LIST MENU ENGINE ({prefix}menu)
// ============================================================================

function buildInteractiveMenuData(prefix) {
  const title = 'FREYA-SAN HUB v5.0 NAVIGATION';
  const bodyText =
    `Halo! Selamat datang di *${CONFIG.projectName} v${CONFIG.projectVersion}*.\n` +
    `Prefix aktif sekarang: *${prefix}* (mendukung 10 prefix).\n` +
    `Ketuk tombol di bawah buat pilih kategori menu yang kamu mau ya!`;
  const footer = CONFIG.botName;
  const buttonText = 'Pilih Kategori Menu';

  const sections = [
    {
      title: 'Semua Kategori Menu (13)',
      rows: WIBUSOFT_MENU_CATEGORIES.map((cat) => ({
        title: `${cat.icon} ${cat.id}`.slice(0, 24),
        rowId: `${prefix}menu ${cat.id.toLowerCase()}`,
        id: `${prefix}menu ${cat.id.toLowerCase()}`,
        description: cat.desc.slice(0, 72),
      })),
    },
    {
      title: 'Akses Cepat Populer',
      rows: [
        {
          title: '🔊 Stiker Bersuara (#sa)',
          rowId: `${prefix}stikeraudio`,
          id: `${prefix}stikeraudio`,
          description: 'Kombo stiker WebP animasi + voice note tanpa batas durasi',
        },
        {
          title: '👤 Kontak Owner Resmi',
          rowId: `${prefix}owner`,
          id: `${prefix}owner`,
          description: 'Dapetin kartu kontak vCard resmi Pak Ujan',
        },
      ],
    },
  ];

  const plainTextFallbackLines = [
    `*${title}*`,
    bodyText,
    '',
    ...WIBUSOFT_MENU_CATEGORIES.map(
      (cat, idx) => `${idx + 1}. ${cat.icon} *${cat.id}* — ${cat.desc}`
    ),
    '',
    `Akses cepat: *${prefix}stikeraudio* / *${prefix}sa*, *${prefix}owner*, *${prefix}ping*`,
    `_${footer}_`,
  ];

  return {
    title,
    bodyText,
    footer,
    buttonText,
    sections,
    plainTextFallback: plainTextFallbackLines.join('\n'),
  };
}

async function handleMenuCommand(sock, baileys, jid, quotedMsg, prefix) {
  const menu = buildInteractiveMenuData(prefix);
  const { generateWAMessageFromContent, WAProto } = baileys;

  try {
    if (generateWAMessageFromContent && WAProto && WAProto.Message && WAProto.Message.InteractiveMessage) {
      const interactiveProto = WAProto.Message.create({
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2,
            },
            interactiveMessage: WAProto.Message.InteractiveMessage.create({
              header: WAProto.Message.InteractiveMessage.Header.create({
                title: menu.title,
                hasMediaAttachment: false,
              }),
              body: WAProto.Message.InteractiveMessage.Body.create({
                text: menu.bodyText,
              }),
              footer: WAProto.Message.InteractiveMessage.Footer.create({
                text: menu.footer,
              }),
              nativeFlowMessage: WAProto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: [
                  {
                    name: 'single_select',
                    buttonParamsJson: JSON.stringify({
                      title: menu.buttonText,
                      sections: menu.sections.map((sec) => ({
                        title: sec.title,
                        rows: sec.rows.map((r) => ({
                          header: '',
                          title: r.title,
                          description: r.description,
                          id: r.id,
                        })),
                      })),
                    }),
                  },
                ],
              }),
            }),
          },
        },
      });

      const fullMsg = generateWAMessageFromContent(jid, interactiveProto, {
        userJid: (sock.user && sock.user.id) || jid,
        quoted: quotedMsg,
      });

      await sock.relayMessage(jid, fullMsg.message, {
        messageId: fullMsg.key.id,
        additionalNodes: [
          {
            tag: 'biz',
            attrs: {},
            content: [
              {
                tag: 'interactive',
                attrs: { type: 'native_flow', v: '1' },
                content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
              },
            ],
          },
        ],
      });
      return;
    }

    await sock.sendMessage(
      jid,
      {
        text: menu.bodyText,
        footer: menu.footer,
        title: menu.title,
        buttonText: menu.buttonText,
        sections: menu.sections,
      },
      { quoted: quotedMsg }
    );
  } catch (interactiveErr) {
    console.warn(`[MENU FALLBACK] Interactive List gagal dikirim (${interactiveErr.message}), mengirim plain-text...`);
    await sock.sendMessage(jid, { text: menu.plainTextFallback }, { quoted: quotedMsg });
  }
}

// ============================================================================
// 4. MODUL #stikeraudio / #sa (LINE-STYLE DUAL-OUTPUT SOUND STICKER COMBO)
// ============================================================================

function resolveMediaTargetMessage(msg) {
  const m = msg && msg.message ? msg.message : {};
  const ctx =
    (m.extendedTextMessage && m.extendedTextMessage.contextInfo) ||
    (m.imageMessage && m.imageMessage.contextInfo) ||
    (m.videoMessage && m.videoMessage.contextInfo) ||
    (m.stickerMessage && m.stickerMessage.contextInfo) ||
    null;

  if (ctx && ctx.quotedMessage) {
    return {
      targetMsg: {
        key: {
          remoteJid: msg.key.remoteJid,
          fromMe: false,
          id: ctx.stanzaId || msg.key.id,
          participant: ctx.participant,
        },
        message: ctx.quotedMessage,
      },
      quotedInner: ctx.quotedMessage,
    };
  }

  return { targetMsg: msg, quotedInner: m };
}

async function handleStickerAudioCommand(sock, baileys, msg, jid, prefix) {
  const { downloadMediaMessage } = baileys;
  const { targetMsg, quotedInner } = resolveMediaTargetMessage(msg);

  const hasVisualMedia = Boolean(
    quotedInner.videoMessage ||
      quotedInner.imageMessage ||
      quotedInner.stickerMessage ||
      (quotedInner.viewOnceMessage &&
        quotedInner.viewOnceMessage.message &&
        (quotedInner.viewOnceMessage.message.videoMessage ||
          quotedInner.viewOnceMessage.message.imageMessage))
  );

  if (!hasVisualMedia) {
    await sock.sendMessage(
      jid,
      {
        text:
          `Cara pakai *${prefix}stikeraudio* atau *${prefix}sa*:\n` +
          `Balas (reply) video/gambar/stiker bersuara atau kirim video pakai caption *${prefix}sa*.\n` +
          `Bot bakal kirim Stiker WebP animasi (maks 10 detik) lalu disusul langsung Voice Note Opus tanpa batas durasi!`,
      },
      { quoted: msg }
    );
    return;
  }

  const jobToken = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `freya-sa-in-${jobToken}.bin`);
  const stickerPath = path.join(tmpDir, `freya-sa-stk-${jobToken}.webp`);
  const audioPath = path.join(tmpDir, `freya-sa-aud-${jobToken}.ogg`);

  try {
    const mediaBuffer = await downloadMediaMessage(
      targetMsg,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock.updateMediaMessage,
      }
    );

    if (!Buffer.isBuffer(mediaBuffer) || mediaBuffer.length === 0) {
      throw new Error('Media nggak bisa diunduh dari server WhatsApp.');
    }

    fs.writeFileSync(inputPath, mediaBuffer);

    // Output 1: Stiker Animasi WebP (512x512, maks 10 detik)
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vcodec', 'libwebp',
      '-filter:v',
      'fps=fps=15,scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
      '-loop', '0',
      '-ss', '00:00:00',
      '-t', '00:00:10',
      '-preset', 'default',
      '-an',
      '-vsync', '0',
      stickerPath,
    ]);

    // Output 2: Audio Voice Note Opus OGG (TANPA batas durasi -t!)
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-vbr', 'on',
      audioPath,
    ]);

    // Eksekusi Pengiriman Beruntun ala LINE
    await sock.sendMessage(jid, { sticker: { url: stickerPath } }, { quoted: msg });
    await sock.sendMessage(
      jid,
      { audio: { url: audioPath }, mimetype: 'audio/mp4', ptt: true },
      { quoted: msg }
    );
  } catch (err) {
    await sock.sendMessage(
      jid,
      {
        text: `Yah, gagal bikin kombo stiker bersuara (${err.message}). Pastiin media punya stream video/gambar + audio yang valid ya!`,
      },
      { quoted: msg }
    );
  } finally {
    removeFileSafe(inputPath);
    removeFileSafe(stickerPath);
    removeFileSafe(audioPath);
  }
}

// ============================================================================
// 5. MODUL #owner (OWNER CONTACT CARD vCARD 3.0 ENGINE)
// ============================================================================

async function handleOwnerCommand(sock, jid, quotedMsg) {
  if (!CONFIG.ownerNumber) {
    await sock.sendMessage(
      jid,
      {
        text: 'Kontak Owner belum diatur di server nih. Atur OWNER_NUMBER di file .env atau menu Pengaturan Owner di dashboard ya!',
      },
      { quoted: quotedMsg }
    );
    return;
  }

  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${CONFIG.ownerName}`,
    `ORG:${CONFIG.projectName} v${CONFIG.projectVersion}`,
    `TEL;type=CELL;type=VOICE;waid=${CONFIG.ownerNumber}:${CONFIG.ownerDisplayNumber || `+${CONFIG.ownerNumber}`}`,
    'END:VCARD',
  ].join('\n');

  await sock.sendMessage(
    jid,
    {
      contacts: {
        displayName: CONFIG.ownerName,
        contacts: [{ vcard }],
      },
    },
    { quoted: quotedMsg }
  );

  await sock.sendMessage(
    jid,
    {
      text: `Ini kontak resmi owner Freya-san Hub v5.0 (${CONFIG.ownerName}). Chat aja langsung kalau ada keperluan atau laporan keluhan bot!`,
    },
    { quoted: quotedMsg }
  );
}

// ============================================================================
// 6. COMMAND ROUTER & KONEKSI ENGINE BAILEYS (PAIRING CODE + AUTO-RECONNECT)
// ============================================================================

async function routeIncomingMessage(sock, baileys, msg) {
  if (!msg || !msg.message || (msg.key && msg.key.fromMe)) return;

  const jid = msg.key && msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;

  const rawText = extractTextFromWAMessage(msg);
  const parsed = parseCommand(rawText, CONFIG.prefixes);
  if (!parsed) return;

  const { prefix, command } = parsed;

  if (command === 'menu' || command === 'help') {
    await handleMenuCommand(sock, baileys, jid, msg, prefix);
    return;
  }

  if (command === 'stikeraudio' || command === 'stickeraudio' || command === 'sa') {
    await handleStickerAudioCommand(sock, baileys, msg, jid, prefix);
    return;
  }

  if (command === 'owner') {
    await handleOwnerCommand(sock, jid, msg);
    return;
  }

  if (command === 'ping') {
    await sock.sendMessage(
      jid,
      { text: `Pong! *${CONFIG.botName}* aktif dan siap jalan nih.` },
      { quoted: msg }
    );
  }
}

async function startWhatsAppBot(options = {}) {
  const baileys = await loadBaileys();
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { Browsers, DisconnectReason, useMultiFileAuthState } = baileys;

  const usePairingCode =
    typeof options.usePairingCode === 'boolean'
      ? options.usePairingCode
      : Boolean(process.env.WA_PAIRING_NUMBER);
  const rawPhoneInput = options.phoneNumber || process.env.WA_PAIRING_NUMBER || '';

  if (!fs.existsSync(CONFIG.authFolder)) {
    fs.mkdirSync(CONFIG.authFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authFolder);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    // Wajib pakai Browser UA resmi Baileys agar tidak ditolak ("Gagal menautkan perangkat")
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: !usePairingCode,
    markOnlineOnConnect: false,
  });

  // Simpan kredensial secara real-time saat ada pembaruan sesi
  sock.ev.on('creds.update', saveCreds);

  // Pairing Code Timing & State Control:
  // Pastikan belum terdaftar (!sock.authState.creds.registered) lalu tunggu 3000 ms sebelum requestPairingCode
  if (usePairingCode && !sock.authState.creds.registered) {
    const cleanNumber = sanitizePairingPhoneNumber(rawPhoneInput);
    setTimeout(async () => {
      try {
        if (sock.authState.creds.registered) return;
        const pairingCode = await sock.requestPairingCode(cleanNumber);
        console.log(`[PAIRING CODE] Nomor: +${cleanNumber} | Kode: ${pairingCode}`);
        console.log('Masukin kode di WhatsApp HP -> Setelan -> Perangkat Tertaut -> Tautkan dengan nomor telepon.');
      } catch (pairErr) {
        console.error(`[PAIRING ERROR] Gagal minta pairing code: ${pairErr.message}`);
      }
    }, CONFIG.pairingStabilizeDelayMs);
  }

  // Auto-reconnect listener (tidak reconnect jika loggedOut)
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log(`[CONNECTED] ${CONFIG.botName} (${CONFIG.projectName} v${CONFIG.projectVersion}) terhubung!`);
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect && lastDisconnect.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : lastDisconnect &&
              lastDisconnect.error &&
              lastDisconnect.error.output &&
              lastDisconnect.error.output.statusCode;

      const isRestartRequired = statusCode === DisconnectReason.restartRequired;
      const shouldReconnect = isRestartRequired || statusCode !== DisconnectReason.loggedOut;
      console.warn(`[DISCONNECTED] Kode: ${statusCode || 'unknown'} | Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => {
          startWhatsAppBot({ usePairingCode: false }).catch((err) => {
            console.error(`[RECONNECT FATAL] ${err.message}`);
          });
        }, isRestartRequired ? 200 : 3000);
      } else {
        console.error('[LOGGED OUT] Sesi WhatsApp keluar. Hapus folder auth atau login ulang.');
      }
    }
  });

  // Listener pesan masuk
  sock.ev.on('messages.upsert', async (event) => {
    if (event.type !== 'notify') return;
    for (const msg of event.messages || []) {
      try {
        await routeIncomingMessage(sock, baileys, msg);
      } catch (err) {
        console.error(`[MESSAGE HANDLER ERROR] ${err.message}`);
      }
    }
  });

  return sock;
}

module.exports = {
  CONFIG,
  WIBUSOFT_MENU_CATEGORIES,
  sanitizePairingPhoneNumber,
  parseCommand,
  buildInteractiveMenuData,
  handleMenuCommand,
  handleStickerAudioCommand,
  handleOwnerCommand,
  routeIncomingMessage,
  startWhatsAppBot,
};

if (require.main === module) {
  startWhatsAppBot().catch((err) => {
    console.error(`[BOOT ERROR] ${err.message}`);
    process.exit(1);
  });
}
