import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { botText, normalizeBotLang } from '../core/botI18n';
import { db } from './db';

const execFileAsync = promisify(execFile);
const PIPELINE_SCRIPT = path.resolve(process.cwd(), 'scripts', 'media_pipeline.py');
const MAX_MEDIA_INPUT_BYTES = 25 * 1024 * 1024;

export interface LivePhotoBundle {
  stillBuffer: Buffer;
  motionVideoBuffer: Buffer;
  motionPhotoJpgBuffer: Buffer;
  stillDataUrl: string;
  motionVideoDataUrl: string;
  motionPhotoJpgDataUrl: string;
  width: number;
  height: number;
  durationMs: number;
  presentationOffsetMs: number;
  hasAudio: boolean;
  validation: Record<string, unknown>;
}

export interface SoundStickerBundle {
  stickerBuffer: Buffer;
  audioBuffer: Buffer;
  stickerDataUrl: string;
  audioDataUrl: string;
  audioSeconds: number;
  waveform: number[];
  stickerSha256: string;
  audioSha256: string;
  webpValidation: Record<string, unknown>;
  audioValidation: Record<string, unknown>;
}

export interface GeneratedMediaArtifact {
  ok: boolean;
  kind: 'sticker' | 'image' | 'video' | 'audio' | 'text_only' | 'motion_photo' | 'sound_sticker';
  mimetype?: string;
  buffer?: Buffer;
  dataUrl?: string;
  caption: string;
  honestLimitation?: string;
  jobId?: string;
  livePhotoBundle?: LivePhotoBundle;
  soundStickerBundle?: SoundStickerBundle;
}

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines = 6): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= maxCharsPerLine) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w.slice(0, maxCharsPerLine);
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? lines : [' '];
}

async function renderSvgToBuffer(svg: string, targetFormat: 'png' | 'webp'): Promise<{ buffer: Buffer; mimetype: string; dataUrl: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-media-'));
  const svgPath = path.join(tmpDir, 'art.svg');
  const outPath = path.join(tmpDir, `out.${targetFormat}`);
  try {
    fs.writeFileSync(svgPath, svg, 'utf8');
    const args =
      targetFormat === 'webp'
        ? [svgPath, '-resize', '512x512', '-define', 'webp:lossless=false', '-quality', '85', outPath]
        : [svgPath, outPath];
    await execFileAsync('convert', args, { timeout: 10000 });
    const buffer = fs.readFileSync(outPath);
    const mimetype = targetFormat === 'webp' ? 'image/webp' : 'image/png';
    return {
      buffer,
      mimetype,
      dataUrl: `data:${mimetype};base64,${buffer.toString('base64')}`,
    };
  } catch {
    // Clean SVG fallback if ImageMagick encounters unusual glyph rendering
    const buf = Buffer.from(svg, 'utf8');
    return {
      buffer: buf,
      mimetype: 'image/svg+xml',
      dataUrl: `data:image/svg+xml;base64,${buf.toString('base64')}`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function generateBratSticker(params: {
  variant: 'brat2' | 'bratbahlil' | 'bratspongebob';
  text: string;
  lang?: string;
}): Promise<GeneratedMediaArtifact> {
  const lang = normalizeBotLang(params.lang);
  const raw = params.text.trim();
  if (!raw) {
    return {
      ok: false,
      kind: 'text_only',
      caption:
        lang === 'en'
          ? `Add some text first (max 100 characters), e.g. .${params.variant} feeling good ✨`
          : `Tulis teksnya dulu ya (maks 100 karakter), misalnya: .${params.variant} santai aja ✨`,
    };
  }

  // Spread graphemes/codepoints safely for emoji-inclusive 100-char limit
  const chars = Array.from(raw);
  if (chars.length > 100) {
    return {
      ok: false,
      kind: 'text_only',
      caption:
        lang === 'en'
          ? `Too long (${chars.length}/100 characters). Keep it to 100 characters or less!`
          : `Teksnya kepanjangan nih (${chars.length}/100 karakter). Maksimal 100 karakter termasuk emoji ya.`,
    };
  }

  const lines = wrapLines(raw, 14, 6);
  const fontSize = lines.length <= 2 ? 56 : lines.length <= 4 ? 42 : 34;
  const lineHeight = fontSize * 1.25;
  const startY = 256 - ((lines.length - 1) * lineHeight) / 2;

  let bg = '#8ACE00';
  let fg = '#0F172A';
  let badge = 'BRAT2 STICKER';
  let decor = '';

  if (params.variant === 'bratbahlil') {
    bg = '#F8FAFC';
    fg = '#0F172A';
    badge = 'EDISI PAPAN MEME [SIMULASI]';
    decor = `<rect x="28" y="28" width="456" height="456" rx="34" fill="#FFFFFF" stroke="#1E3A8A" stroke-width="10"/>
             <rect x="28" y="28" width="456" height="64" rx="24" fill="#1D4ED8"/>
             <text x="256" y="70" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="#FFFFFF">${escapeXml(badge)}</text>`;
  } else if (params.variant === 'bratspongebob') {
    bg = '#FDE047';
    fg = '#422006';
    badge = 'SPONGEBOB CARD MEME';
    decor = `<rect x="20" y="20" width="472" height="472" rx="36" fill="#FEF08A" stroke="#CA8A04" stroke-width="10"/>
             <circle cx="80" cy="86" r="24" fill="#EAB308" opacity="0.45"/>
             <circle cx="430" cy="410" r="30" fill="#EAB308" opacity="0.45"/>
             <circle cx="410" cy="100" r="18" fill="#EAB308" opacity="0.45"/>
             <text x="256" y="72" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="20" font-weight="bold" fill="#854D0E">${escapeXml(badge)}</text>`;
  } else {
    decor = `<rect x="16" y="16" width="480" height="480" rx="38" fill="${bg}"/>`;
  }

  const textNodes = lines
    .map(
      (line, i) =>
        `<text x="256" y="${Math.round(startY + i * lineHeight)}" text-anchor="middle" font-family="DejaVu Sans, Noto Color Emoji, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${fg}">${escapeXml(line)}</text>`,
    )
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${bg}"/>
    ${decor}
    ${textNodes}
    <text x="256" y="486" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="14" fill="${fg}" opacity="0.6">${escapeXml(botText(lang).botFooter)}</text>
  </svg>`;

  const rendered = await renderSvgToBuffer(svg, 'webp');
  return {
    ok: true,
    kind: 'sticker',
    mimetype: rendered.mimetype,
    buffer: rendered.buffer,
    dataUrl: rendered.dataUrl,
    caption: `Stiker ${params.variant} berhasil dibuat (${chars.length}/100 karakter).`,
  };
}

export async function generateMockupImage(params: {
  type:
    | 'fakeml'
    | 'tiktokqc'
    | 'iqcpink'
    | 'iqcdark'
    | 'iqcimage'
    | 'fakestoryig'
    | 'fakechios'
    | 'fakecall'
    | 'fakegc'
    | 'faketweet'
    | 'fakedana'
    | 'fakebca'
    | 'fakeovo';
  rawArgs: string;
  senderName: string;
  attachedImageBase64?: string;
  lang?: string;
}): Promise<GeneratedMediaArtifact> {
  const lang = normalizeBotLang(params.lang);
  const args = params.rawArgs.trim();

  // Parse -s right / -s left flag for iqcpink/iqcdark
  let bubbleSide: 'left' | 'right' = 'left';
  let cleanText = args;
  const sideMatch = args.match(/(?:^|\s)-s\s+(right|left)(?=\s|$)/i);
  if (sideMatch) {
    bubbleSide = sideMatch[1].toLowerCase() === 'right' ? 'right' : 'left';
    cleanText = args.replace(sideMatch[0], ' ').trim();
  }

  const parts = cleanText.split('|').map((p) => p.trim()).filter(Boolean);
  const primary = parts[0] || params.senderName || 'Freya-san User';
  const secondary = parts[1] || 'Contoh teks simulasi Freya-san Hub v5.0';
  const tertiary = parts[2] || 'Terverifikasi [SIMULASI]';

  let width = 800;
  let height = 460;
  let bodySvg = '';

  const simBanner = `<rect x="540" y="18" width="236" height="34" rx="8" fill="#DC2626"/>
    <text x="658" y="40" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="bold" fill="#FFFFFF">[SIMULASI / EDUTAINMENT]</text>`;

  if (params.type === 'iqcpink' || params.type === 'iqcdark' || params.type === 'iqcimage') {
    const isDark = params.type === 'iqcdark' || params.type === 'iqcimage';
    const bg = isDark ? '#0F172A' : '#FDF2F8';
    const cardBg = isDark ? '#1E293B' : '#FCE7F3';
    const bubbleBg = isDark ? '#334155' : '#F472B6';
    const textColor = '#FFFFFF';
    const labelColor = isDark ? '#94A3B8' : '#9D174D';
    const textBody = cleanText || 'Halo, ini tampilan iPhone Quoted Chat!';
    const lines = wrapLines(textBody, 34, 4);
    const bubbleX = bubbleSide === 'right' ? 210 : 50;
    const bubbleW = 540;
    const imgBlock = params.attachedImageBase64
      ? `<image href="${params.attachedImageBase64}" x="${bubbleX + 20}" y="130" width="220" height="120" preserveAspectRatio="xMidYMid slice"/>`
      : '';
    const textOffsetY = params.attachedImageBase64 ? 280 : 185;

    bodySvg = `<rect width="800" height="460" fill="${bg}"/>
      <rect x="28" y="28" width="744" height="404" rx="28" fill="${cardBg}"/>
      <text x="56" y="72" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="bold" fill="${labelColor}">iQC ${params.type.toUpperCase()} · Posisi: ${bubbleSide.toUpperCase()}</text>
      <rect x="${bubbleX}" y="108" width="${bubbleW}" height="${params.attachedImageBase64 ? 270 : 210}" rx="26" fill="${bubbleBg}"/>
      ${imgBlock}
      ${lines
        .map(
          (l, i) =>
            `<text x="${bubbleX + 28}" y="${textOffsetY + i * 34}" font-family="DejaVu Sans, sans-serif" font-size="25" font-weight="bold" fill="${textColor}">${escapeXml(l)}</text>`,
        )
        .join('')}
      <text x="56" y="408" font-family="DejaVu Sans, sans-serif" font-size="14" fill="${labelColor}">@ ${escapeXml(params.senderName)} · [SIMULASI]</text>`;
  } else if (params.type === 'fakedana' || params.type === 'fakebca' || params.type === 'fakeovo') {
    const brandMap = {
      fakedana: { name: 'DANA [SIMULASI]', bg: '#0284C7', accent: '#E0F2FE' },
      fakebca: { name: 'BCA Mobile [SIMULASI]', bg: '#1E3A8A', accent: '#DBEAFE' },
      fakeovo: { name: 'OVO [SIMULASI]', bg: '#6D28D9', accent: '#EDE9FE' },
    }[params.type];
    const amountNum = Number(String(secondary).replace(/\D/g, '')) || 50000;
    const formatted = `Rp ${amountNum.toLocaleString('id-ID')}`;
    bodySvg = `<rect width="800" height="460" fill="#F1F5F9"/>
      <rect x="40" y="30" width="720" height="400" rx="24" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="2"/>
      <rect x="40" y="30" width="720" height="90" rx="24" fill="${brandMap.bg}"/>
      <text x="72" y="84" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="bold" fill="#FFFFFF">${brandMap.name}</text>
      <text x="72" y="175" font-family="DejaVu Sans, sans-serif" font-size="18" fill="#64748B">Penerima Simulasi</text>
      <text x="72" y="210" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="bold" fill="#0F172A">${escapeXml(primary)}</text>
      <text x="72" y="268" font-family="DejaVu Sans, sans-serif" font-size="18" fill="#64748B">Nominal Simulasi</text>
      <text x="72" y="315" font-family="DejaVu Sans, sans-serif" font-size="40" font-weight="bold" fill="${brandMap.bg}">${escapeXml(formatted)}</text>
      <rect x="72" y="350" width="656" height="46" rx="10" fill="${brandMap.accent}"/>
      <text x="90" y="379" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="bold" fill="#0F172A">WATERMARK: DOKUMEN SIMULASI NON-TRANSAKSI</text>
      ${simBanner}`;
  } else if (params.type === 'fakeml') {
    bodySvg = `<rect width="800" height="460" fill="#0B1120"/>
      <rect x="32" y="32" width="736" height="396" rx="22" fill="#172554" stroke="#F59E0B" stroke-width="4"/>
      <text x="64" y="92" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="#FBBF24">PROFIL GAME MOBA [SIMULASI]</text>
      <text x="64" y="165" font-family="DejaVu Sans, sans-serif" font-size="40" font-weight="bold" fill="#FFFFFF">${escapeXml(primary)}</text>
      <text x="64" y="220" font-family="DejaVu Sans, sans-serif" font-size="24" fill="#93C5FD">Tier: ${escapeXml(secondary)}</text>
      <text x="64" y="265" font-family="DejaVu Sans, sans-serif" font-size="20" fill="#CBD5E1">Win Rate: ${escapeXml(parts[2] || '64.5%')} · Role: ${escapeXml(parts[3] || 'Mid / Gold')}</text>
      <text x="64" y="390" font-family="DejaVu Sans, sans-serif" font-size="15" fill="#94A3B8">Freya-san Hub Visual Card · Bukan data akun resmi game</text>
      ${simBanner}`;
  } else if (params.type === 'tiktokqc') {
    const lines = wrapLines(secondary, 36, 4);
    bodySvg = `<rect width="800" height="460" fill="#09090B"/>
      <rect x="60" y="70" width="680" height="320" rx="28" fill="#18181B" stroke="#F43F5E" stroke-width="3"/>
      <text x="96" y="128" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="bold" fill="#FB7185">${escapeXml(primary)}</text>
      ${lines.map((l, i) => `<text x="96" y="${184 + i * 36}" font-family="DejaVu Sans, sans-serif" font-size="26" fill="#FAFAFA">${escapeXml(l)}</text>`).join('')}
      <text x="96" y="358" font-family="DejaVu Sans, sans-serif" font-size="16" fill="#A1A1AA">Komentar Mockup Gaya TikTok [SIMULASI]</text>
      ${simBanner}`;
  } else if (params.type === 'fakestoryig') {
    const lines = wrapLines(secondary, 26, 5);
    bodySvg = `<rect width="800" height="460" fill="#831843"/>
      <rect x="190" y="20" width="420" height="420" rx="28" fill="#BE185D" stroke="#FBCFE8" stroke-width="3"/>
      <text x="224" y="74" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="#FFFFFF">@${escapeXml(primary.replace(/^@/, ''))}</text>
      ${lines.map((l, i) => `<text x="400" y="${190 + i * 36}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="#FFFFFF">${escapeXml(l)}</text>`).join('')}
      <text x="224" y="410" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#FBCFE8">IG Story Mockup [SIMULASI]</text>
      ${simBanner}`;
  } else if (params.type === 'fakechios') {
    const lines = wrapLines(secondary, 36, 4);
    bodySvg = `<rect width="800" height="460" fill="#E2E8F0"/>
      <rect x="64" y="54" width="672" height="352" rx="30" fill="#FFFFFF" stroke="#94A3B8" stroke-width="2"/>
      <text x="104" y="112" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="#0F172A">Saluran / Info iOS Card · ${escapeXml(primary)}</text>
      <line x1="104" y1="134" x2="696" y2="134" stroke="#E2E8F0" stroke-width="2"/>
      ${lines.map((l, i) => `<text x="104" y="${188 + i * 36}" font-family="DejaVu Sans, sans-serif" font-size="25" fill="#1E293B">${escapeXml(l)}</text>`).join('')}
      <text x="104" y="372" font-family="DejaVu Sans, sans-serif" font-size="15" fill="#64748B">Freya-san Hub · Kartu Informasi [SIMULASI]</text>
      ${simBanner}`;
  } else if (params.type === 'fakecall') {
    const isVideo = /video/i.test(secondary);
    bodySvg = `<rect width="800" height="460" fill="#0F172A"/>
      <circle cx="400" cy="170" r="64" fill="#1D4ED8"/>
      <text x="400" y="182" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="40" font-weight="bold" fill="#FFFFFF">${escapeXml(primary.slice(0, 2).toUpperCase())}</text>
      <text x="400" y="275" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="#FFFFFF">${escapeXml(primary)}</text>
      <text x="400" y="318" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="20" fill="#93C5FD">${isVideo ? 'Panggilan Video Masuk [SIMULASI]' : 'Panggilan Suara Masuk [SIMULASI]'}</text>
      <circle cx="310" cy="390" r="28" fill="#DC2626"/>
      <circle cx="490" cy="390" r="28" fill="#16A34A"/>
      ${simBanner}`;
  } else if (params.type === 'fakegc') {
    bodySvg = `<rect width="800" height="460" fill="#ECFDF5"/>
      <rect x="64" y="48" width="672" height="364" rx="24" fill="#FFFFFF" stroke="#10B981" stroke-width="3"/>
      <text x="104" y="114" font-family="DejaVu Sans, sans-serif" font-size="20" font-weight="bold" fill="#047857">UNDANGAN GRUP [SIMULASI]</text>
      <text x="104" y="176" font-family="DejaVu Sans, sans-serif" font-size="36" font-weight="bold" fill="#0F172A">${escapeXml(primary)}</text>
      <text x="104" y="232" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#475569">${escapeXml(secondary)}</text>
      <rect x="104" y="300" width="220" height="48" rx="12" fill="#059669"/>
      <text x="214" y="331" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="bold" fill="#FFFFFF">Gabung [Simulasi]</text>
      ${simBanner}`;
  } else {
    // faketweet
    const lines = wrapLines(secondary, 38, 4);
    bodySvg = `<rect width="800" height="460" fill="#FFFFFF"/>
      <rect x="44" y="44" width="712" height="372" rx="22" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2"/>
      <text x="84" y="106" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="#0F172A">${escapeXml(primary)}</text>
      <text x="84" y="136" font-family="DejaVu Sans, sans-serif" font-size="18" fill="#64748B">@${escapeXml(primary.toLowerCase().replace(/[^a-z0-9]/g, '') || 'freyasan')} · ${escapeXml(tertiary)}</text>
      ${lines.map((l, i) => `<text x="84" y="${194 + i * 36}" font-family="DejaVu Sans, sans-serif" font-size="25" fill="#0F172A">${escapeXml(l)}</text>`).join('')}
      <text x="84" y="378" font-family="DejaVu Sans, sans-serif" font-size="16" fill="#64748B">Mockup Postingan Sosial [SIMULASI]</text>
      ${simBanner}`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bodySvg}</svg>`;
  const rendered = await renderSvgToBuffer(svg, 'png');
  return {
    ok: true,
    kind: 'image',
    mimetype: rendered.mimetype,
    buffer: rendered.buffer,
    dataUrl: rendered.dataUrl,
    caption: `Mockup *${params.type}* berhasil dibuat [SIMULASI — hanya untuk hiburan/edukasi].`,
  };
}

export async function generateSpotifyCard(rawArgs: string, langRaw?: string): Promise<GeneratedMediaArtifact> {
  const lang = normalizeBotLang(langRaw);
  const input = rawArgs.trim();
  const spotifyUrlMatch = input.match(/https?:\/\/open\.spotify\.com\/(track|album|playlist)\/[A-Za-z0-9]+/i);

  if (!spotifyUrlMatch) {
    return {
      ok: false,
      kind: 'text_only',
      caption:
        lang === 'en'
          ? 'No live Spotify playback session is connected on this server. Send a valid Spotify track URL (https://open.spotify.com/track/...) to build a card from official public metadata!'
          : lang === 'ja'
          ? 'サーバーにSpotify再生セッションは連携されていないよ。公開メタデータからカードを作るには有効なSpotify URL (https://open.spotify.com/track/...) を貼ってね。'
          : 'Saat ini server nggak tersambung ke akun pemutaran Spotify live kamu. Kirim tautan lagu Spotify yang valid (misal https://open.spotify.com/track/...) biar aku buatkan kartunya dari metadata publik resmi ya!',
    };
  }

  const url = spotifyUrlMatch[0];
  let title = 'Spotify Track';
  let provider = 'Spotify Public Metadata';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = (await res.json()) as { title?: string; provider_name?: string };
      if (json.title) title = json.title;
      if (json.provider_name) provider = json.provider_name;
    }
  } catch {
    return {
      ok: false,
      kind: 'text_only',
      caption: 'Gagal mengambil metadata publik dari Spotify oEmbed saat ini (koneksi timeout atau tautan tidak ditemukan).',
    };
  }

  const titleLines = wrapLines(title, 28, 3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360">
    <rect width="800" height="360" fill="#121212"/>
    <rect x="28" y="28" width="744" height="304" rx="24" fill="#181818" stroke="#1DB954" stroke-width="3"/>
    <circle cx="96" cy="96" r="32" fill="#1DB954"/>
    <text x="96" y="106" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="bold" fill="#000000">♫</text>
    <text x="150" y="92" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="bold" fill="#1DB954">${escapeXml(provider.toUpperCase())}</text>
    <text x="150" y="118" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#B3B3B3">${escapeXml(url)}</text>
    ${titleLines.map((l, i) => `<text x="64" y="${190 + i * 40}" font-family="DejaVu Sans, sans-serif" font-size="32" font-weight="bold" fill="#FFFFFF">${escapeXml(l)}</text>`).join('')}
    <text x="64" y="308" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#94A3B8">${escapeXml(botText(lang).botFooter)}</text>
  </svg>`;

  const rendered = await renderSvgToBuffer(svg, 'png');
  return {
    ok: true,
    kind: 'image',
    mimetype: rendered.mimetype,
    buffer: rendered.buffer,
    dataUrl: rendered.dataUrl,
    caption: `🎵 *${title}*\nSumber metadata: Spotify oEmbed\n${url}`,
  };
}

export async function convertStickerToImage(stickerBuffer?: Buffer): Promise<GeneratedMediaArtifact> {
  if (!stickerBuffer || stickerBuffer.length === 0) {
    return {
      ok: false,
      kind: 'text_only',
      caption: 'Balas pesan stiker yang mau diubah ke gambar pakai command ini ya!',
    };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-toimg-'));
  const inPath = path.join(tmpDir, 'in.webp');
  const outPath = path.join(tmpDir, 'out.png');
  try {
    fs.writeFileSync(inPath, stickerBuffer);
    await execFileAsync('convert', [`${inPath}[0]`, outPath], { timeout: 10000 });
    const pngBuf = fs.readFileSync(outPath);
    return {
      ok: true,
      kind: 'image',
      mimetype: 'image/png',
      buffer: pngBuf,
      dataUrl: `data:image/png;base64,${pngBuf.toString('base64')}`,
      caption: 'Stiker berhasil dikonversi jadi gambar PNG!',
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'text_only',
      caption: `Gagal mengonversi stiker ke PNG: ${err instanceof Error ? err.message : 'format tidak didukung'}`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function recordMediaJob(params: {
  id?: string;
  command: 'tolive' | 'stickeraudio';
  userPhone?: string;
  inputKind: string;
  outputFormat: string;
  bytesOut: number;
  durationMs: number;
  validationOk: boolean;
  deliveryMode: string;
  deliveryStatus: string;
  detail?: Record<string, unknown>;
  errorMessage?: string | null;
}): string {
  const jobId = params.id || `mjob-${crypto.randomBytes(5).toString('hex')}`;
  try {
    db.prepare(`
      INSERT INTO media_jobs (id, command, user_phone, input_kind, output_format, bytes_out, duration_ms, validation_ok, delivery_mode, delivery_status, detail_json, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      params.command,
      params.userPhone || null,
      params.inputKind,
      params.outputFormat,
      params.bytesOut,
      params.durationMs,
      params.validationOk ? 1 : 0,
      params.deliveryMode,
      params.deliveryStatus,
      JSON.stringify(params.detail ?? {}),
      params.errorMessage ?? null,
    );
  } catch {
    // Ignore if called in a pure isolated test without DB migrated
  }
  return jobId;
}

export function updateMediaJobDelivery(jobId: string, deliveryMode: string, deliveryStatus: string, detailPatch?: Record<string, unknown>): void {
  try {
    const existing = db.prepare('SELECT detail_json FROM media_jobs WHERE id = ?').get(jobId) as { detail_json: string } | undefined;
    let merged = detailPatch ?? {};
    if (existing?.detail_json) {
      try {
        merged = { ...JSON.parse(existing.detail_json), ...(detailPatch ?? {}) };
      } catch {
        merged = detailPatch ?? {};
      }
    }
    db.prepare('UPDATE media_jobs SET delivery_mode = ?, delivery_status = ?, detail_json = ? WHERE id = ?').run(
      deliveryMode,
      deliveryStatus,
      JSON.stringify(merged),
      jobId,
    );
  } catch {
    // ignore
  }
}

export function listRecentMediaJobs(limit = 30) {
  try {
    return db
      .prepare('SELECT * FROM media_jobs ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(100, limit)));
  } catch {
    return [];
  }
}

export async function generateMediaPipelineSample(kind: 'image' | 'video' | 'audio'): Promise<Buffer> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-sample-'));
  try {
    if (kind === 'image') {
      const out = path.join(tmpDir, 'sample.png');
      await execFileAsync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x640:rate=1', '-frames:v', '1', out],
        { timeout: 10000 },
      );
      return fs.readFileSync(out);
    }
    if (kind === 'audio') {
      const out = path.join(tmpDir, 'sample.ogg');
      await execFileAsync(
        'ffmpeg',
        ['-y', '-f', 'lavfi', '-i', 'sine=frequency=523.25:duration=2.5', '-c:a', 'libopus', '-ar', '48000', '-ac', '1', out],
        { timeout: 10000 },
      );
      return fs.readFileSync(out);
    }
    const out = path.join(tmpDir, 'sample.mp4');
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=512x512:rate=24:duration=2.5',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.5',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart',
        out,
      ],
      { timeout: 15000 },
    );
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function convertMediaToLivePhotoBundle(params: {
  mediaBuffer?: Buffer;
  mediaKind?: 'image' | 'video' | 'sticker' | 'audio' | 'none';
  userPhone?: string;
  lang?: string;
}): Promise<GeneratedMediaArtifact> {
  const lang = normalizeBotLang(params.lang);
  const compatNote =
    lang === 'en'
      ? 'Compatible format: Android MotionPhoto (JPEG+XMP+MP4) & WhatsApp paired Motion Photo protocol (AssociationType.MOTION_PHOTO=12).'
      : lang === 'ja'
      ? '対応形式: Android MotionPhoto (JPEG+XMP+MP4) および WhatsApp Motion Photo プロトコル (AssociationType=12)。'
      : 'Format kompatibel: container MotionPhoto Android (JPEG+XMP+MP4) serta protokol paired Motion Photo WhatsApp (AssociationType.MOTION_PHOTO=12) untuk iOS & Android.';

  if (!params.mediaBuffer || params.mediaBuffer.length === 0 || !params.mediaKind || params.mediaKind === 'none' || params.mediaKind === 'audio') {
    return {
      ok: false,
      kind: 'text_only',
      honestLimitation: compatNote,
      caption:
        lang === 'en'
          ? `Reply to an image or short video with .tolive to convert it into a Motion Photo / Live Photo.\n\n${compatNote}`
          : `Balas gambar atau video pendek pakai command #tolive ya! Bot akan ekstrak frame cover + video geraknya jadi Live/Motion Photo.\n\n${compatNote}`,
    };
  }

  if (params.mediaBuffer.length > MAX_MEDIA_INPUT_BYTES) {
    return {
      ok: false,
      kind: 'text_only',
      caption: 'Ukuran file terlalu besar untuk diproses #tolive (maksimal 25 MB).',
    };
  }

  const startMs = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-tolive-'));
  const outDir = path.join(tmpDir, 'out');
  const isVideo = params.mediaKind === 'video';
  const ext = isVideo ? 'mp4' : params.mediaKind === 'sticker' ? 'webp' : 'bin';
  const inPath = path.join(tmpDir, `input.${ext}`);

  try {
    fs.writeFileSync(inPath, params.mediaBuffer);
    const { stdout } = await execFileAsync(
      'python3',
      [
        PIPELINE_SCRIPT,
        'tolive',
        '--input', inPath,
        '--outdir', outDir,
        '--kind', isVideo ? 'video' : 'image',
        '--max-duration', '4.0',
      ],
      { timeout: 28000, maxBuffer: 2 * 1024 * 1024 },
    );

    const parsed = JSON.parse(stdout.trim());
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Pipeline validation failed');
    }

    const stillBuffer = fs.readFileSync(parsed.stillPath);
    const motionVideoBuffer = fs.readFileSync(parsed.motionMp4Path);
    const motionPhotoJpgBuffer = fs.readFileSync(parsed.motionPhotoJpgPath);

    const jobId = recordMediaJob({
      command: 'tolive',
      userPhone: params.userPhone,
      inputKind: parsed.inputKind || params.mediaKind,
      outputFormat: 'motion_photo_jpg+paired_mp4',
      bytesOut: motionPhotoJpgBuffer.length,
      durationMs: Date.now() - startMs,
      validationOk: true,
      deliveryMode: 'pending_dispatch',
      deliveryStatus: 'validated',
      detail: {
        width: parsed.width,
        height: parsed.height,
        clipDurationMs: parsed.durationMs,
        presentationOffsetMs: parsed.presentationOffsetMs,
        hasAudio: parsed.hasAudio,
        validation: parsed.validation,
      },
    });

    return {
      ok: true,
      kind: 'motion_photo',
      mimetype: 'image/jpeg',
      buffer: motionPhotoJpgBuffer,
      dataUrl: `data:image/jpeg;base64,${motionPhotoJpgBuffer.toString('base64')}`,
      jobId,
      honestLimitation: compatNote,
      livePhotoBundle: {
        stillBuffer,
        motionVideoBuffer,
        motionPhotoJpgBuffer,
        stillDataUrl: `data:image/jpeg;base64,${stillBuffer.toString('base64')}`,
        motionVideoDataUrl: `data:video/mp4;base64,${motionVideoBuffer.toString('base64')}`,
        motionPhotoJpgDataUrl: `data:image/jpeg;base64,${motionPhotoJpgBuffer.toString('base64')}`,
        width: Number(parsed.width || 0),
        height: Number(parsed.height || 0),
        durationMs: Number(parsed.durationMs || 3000),
        presentationOffsetMs: Number(parsed.presentationOffsetMs || 0),
        hasAudio: Boolean(parsed.hasAudio),
        validation: parsed.validation || {},
      },
      caption:
        `Live/Motion Photo berhasil dibuat (${parsed.width}x${parsed.height}, ${(parsed.durationMs / 1000).toFixed(1)}s, ` +
        `XMP Offset ${parsed.validation?.microVideoOffset ?? motionVideoBuffer.length} B).\n` +
        `Audio: ${parsed.hasAudio ? 'dipertahankan (AAC)' : 'tanpa audio'}.\n${compatNote}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Kesalahan pipeline media #tolive';
    recordMediaJob({
      command: 'tolive',
      userPhone: params.userPhone,
      inputKind: params.mediaKind || 'unknown',
      outputFormat: 'failed',
      bytesOut: 0,
      durationMs: Date.now() - startMs,
      validationOk: false,
      deliveryMode: 'none',
      deliveryStatus: 'failed',
      errorMessage: errMsg,
    });
    return {
      ok: false,
      kind: 'text_only',
      honestLimitation: compatNote,
      caption: `Proses #tolive gagal: ${errMsg}`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export const convertMediaToLiveMotionMp4 = convertMediaToLivePhotoBundle;

export async function convertStickerAudioBundle(params: {
  visualBuffer?: Buffer;
  visualKind?: 'image' | 'video' | 'sticker' | 'audio' | 'none';
  audioBuffer?: Buffer;
  userPhone?: string;
  packName?: string;
  packPublisher?: string;
  lang?: string;
}): Promise<GeneratedMediaArtifact> {
  const lang = normalizeBotLang(params.lang);
  const compatNote =
    lang === 'en'
      ? 'Protocol note: Uses StickerMessage.audioMessage (WAWebProtobufsE2E field 26) with Animated WebP + OGG/Opus. Playback icon requires WhatsApp Beta 2.26.41.3+/2.26.47.1+ on recipient devices.'
      : 'Catatan protokol: Mengemas Animated WebP (512x512 + EXIF) & OGG/Opus ke field WAProto StickerMessage.audioMessage (tag 26). Ikon putar suara hanya aktif di WhatsApp klien terbaru (Android Beta 2.26.41.3+/2.26.47.1+); klien lama menampilkan stiker animasi tanpa suara.';

  if (!params.visualBuffer || params.visualBuffer.length === 0 || !params.visualKind || params.visualKind === 'none' || params.visualKind === 'audio') {
    return {
      ok: false,
      kind: 'text_only',
      honestLimitation: compatNote,
      caption:
        'Cara pakai #sa / #stickeraudio:\n' +
        '1. Balas video bersuara langsung dengan #sa, ATAU\n' +
        '2. Balas stiker/gambar dengan #sa dulu, lalu balas audio/VN dengan #sa untuk memasangkannya.',
    };
  }

  if (params.visualBuffer.length > MAX_MEDIA_INPUT_BYTES || (params.audioBuffer && params.audioBuffer.length > MAX_MEDIA_INPUT_BYTES)) {
    return {
      ok: false,
      kind: 'text_only',
      caption: 'Ukuran file terlalu besar untuk diproses #sa (maksimal 25 MB).',
    };
  }

  const startMs = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-sa-'));
  const outDir = path.join(tmpDir, 'out');
  const vExt = params.visualKind === 'video' ? 'mp4' : params.visualKind === 'sticker' ? 'webp' : 'png';
  const vPath = path.join(tmpDir, `visual.${vExt}`);
  const aPath = params.audioBuffer && params.audioBuffer.length > 0 ? path.join(tmpDir, 'audio.bin') : '';

  try {
    fs.writeFileSync(vPath, params.visualBuffer);
    if (aPath && params.audioBuffer) {
      fs.writeFileSync(aPath, params.audioBuffer);
    }

    const pyArgs = [
      PIPELINE_SCRIPT,
      'stickeraudio',
      '--visual', vPath,
      '--outdir', outDir,
      '--pack-name', params.packName || 'Freya-san Hub v5.0',
      '--pack-publisher', params.packPublisher || botText(lang).botFooter,
      '--max-duration', '8.0',
    ];
    if (aPath) {
      pyArgs.push('--audio', aPath);
    }

    const { stdout } = await execFileAsync('python3', pyArgs, {
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim());
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Sound sticker pipeline validation failed');
    }

    const stickerBuffer = fs.readFileSync(parsed.stickerPath);
    const audioBuffer = fs.readFileSync(parsed.audioPath);

    const jobId = recordMediaJob({
      command: 'stickeraudio',
      userPhone: params.userPhone,
      inputKind: aPath ? `${params.visualKind}+audio` : String(params.visualKind),
      outputFormat: 'animated_webp+opus_ogg',
      bytesOut: stickerBuffer.length + audioBuffer.length,
      durationMs: Date.now() - startMs,
      validationOk: true,
      deliveryMode: 'pending_dispatch',
      deliveryStatus: 'validated',
      detail: {
        stickerBytes: stickerBuffer.length,
        audioBytes: audioBuffer.length,
        audioSeconds: parsed.audioSeconds,
        webpValidation: parsed.webpValidation,
        audioValidation: parsed.audioValidation,
      },
    });

    return {
      ok: true,
      kind: 'sound_sticker',
      mimetype: 'image/webp',
      buffer: stickerBuffer,
      dataUrl: `data:image/webp;base64,${stickerBuffer.toString('base64')}`,
      jobId,
      honestLimitation: compatNote,
      soundStickerBundle: {
        stickerBuffer,
        audioBuffer,
        stickerDataUrl: `data:image/webp;base64,${stickerBuffer.toString('base64')}`,
        audioDataUrl: `data:audio/ogg;base64,${audioBuffer.toString('base64')}`,
        audioSeconds: Number(parsed.audioSeconds || 1),
        waveform: Array.isArray(parsed.waveform) ? parsed.waveform : [],
        stickerSha256: String(parsed.stickerSha256 || ''),
        audioSha256: String(parsed.audioSha256 || ''),
        webpValidation: parsed.webpValidation || {},
        audioValidation: parsed.audioValidation || {},
      },
      caption:
        `Sound Sticker (#sa) siap! Animated WebP ${Math.round(stickerBuffer.length / 1024)} KB (` +
        `${parsed.webpValidation?.anmfFrames ?? 1} frame, 512x512, EXIF pack aktif) + ` +
        `Opus ${parsed.audioSeconds}s (${Math.round(audioBuffer.length / 1024)} KB).\n\n${compatNote}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Kesalahan pipeline #sa';
    recordMediaJob({
      command: 'stickeraudio',
      userPhone: params.userPhone,
      inputKind: aPath ? `${params.visualKind}+audio` : String(params.visualKind),
      outputFormat: 'failed',
      bytesOut: 0,
      durationMs: Date.now() - startMs,
      validationOk: false,
      deliveryMode: 'none',
      deliveryStatus: 'failed',
      errorMessage: errMsg,
    });
    return {
      ok: false,
      kind: 'text_only',
      honestLimitation: compatNote,
      caption: `Proses #sa gagal: ${errMsg}`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function handleStickerAudioCapability(params: {
  quotedMediaKind?: 'image' | 'video' | 'sticker' | 'audio' | 'none';
  lang?: string;
}): GeneratedMediaArtifact {
  const lang = normalizeBotLang(params.lang);
  return {
    ok: false,
    kind: 'text_only',
    caption:
      lang === 'en'
        ? 'Reply to a video with sound using .sa, or reply to a sticker/image first then reply to an audio note with .sa!'
        : 'Balas video bersuara pakai #sa, atau balas stiker/gambar dulu pakai #sa lalu balas pesan audio/VN untuk menggabungkannya!',
  };
}
