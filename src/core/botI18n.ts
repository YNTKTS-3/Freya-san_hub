export type BotLang = 'id' | 'en' | 'ja';

export function normalizeBotLang(lang?: string | null): BotLang {
  const clean = (lang || 'id').trim().toLowerCase();
  if (clean.startsWith('en')) return 'en';
  if (clean.startsWith('ja') || clean.startsWith('jp')) return 'ja';
  return 'id';
}

export function getJakartaDateKey(date = new Date(), timeZone = 'Asia/Jakarta'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function getMonthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

const MESSAGES = {
  id: {
    botFooter: 'Freya-san bot by Pak Ujan',
    limitExhausted: (prefix: string, need: number, have: number) =>
      `Limit kamu habis nih (sisa ${have}, butuh ${need}). Kamu bisa beli limit pakai ${prefix}addlimit <jumlah> atau minta kirimin teman kamu.`,
    limitEmpty: (prefix: string) =>
      `Limit harian kamu udah habis nih. Tambah dulu pakai *${prefix}addlimit <jumlah>* atau tunggu reset / minta kirimin teman ya!`,
    cmdNotFound: (prefix: string, cmd: string) =>
      `Perintah *${prefix}${cmd}* belum ada di daftar ya. Ketik *${prefix}menu* buat lihat menu yang tersedia.`,
    cmdDisabled: (prefix: string, cmd: string) =>
      `Perintah *${prefix}${cmd}* lagi dinonaktifkan sementara sama Owner ya.`,
    maintenance: 'Bot lagi dalam mode maintenance sebentar ya, cuma Owner yang bisa pakai dulu.',
    maintenanceMode: 'Bot lagi dalam mode maintenance sebentar ya, cuma Owner yang bisa pakai dulu.',
    cooldown: (cmd: string, sec: number) =>
      `Santai dulu bentar ya, perintah *${cmd}* bisa dipakai lagi dalam ${sec} detik.`,
    ownerOnly: (cmd?: string) =>
      cmd
        ? `Perintah *${cmd}* ini khusus buat Owner bot aja ya.`
        : 'Command ini khusus buat Owner bot aja ya.',
    groupOnly: 'Command ini cuma bisa dipakai di dalam grup ya.',
    adminOnly: (cmd?: string) =>
      cmd
        ? `Fitur *${cmd}* cuma bisa diatur sama admin grup atau Owner ya.`
        : 'Fitur ini cuma bisa diatur sama admin grup atau Owner.',
    spamWarning: (sec: number) => `Pelan-pelan ya, tunggu sekitar ${sec} detik lagi sebelum kirim command berikutnya.`,
    restrictedUser: (reason?: string) =>
      reason
        ? `Akun kamu lagi dibatasi sementara: ${reason}. Kalau merasa ini keliru, hubungi Owner ya.`
        : 'Akun kamu lagi dibatasi sementara. Hubungi Owner kalau merasa ini keliru ya.',
    helpHeader: (cmd: string) => `Panduan *${cmd}*`,
    ping: (latency: number, status: string) =>
      `Pong! Respon lancar (${latency} ms) · Status koneksi: *${status}*.\n_Freya-san bot by Pak Ujan_`,
  },
  en: {
    botFooter: 'Freya-san bot by Pak Ujan',
    limitExhausted: (prefix: string, need: number, have: number) =>
      `You're out of limits (${have} left, need ${need}). Top up anytime with ${prefix}addlimit <amount> or have a friend send you some.`,
    limitEmpty: (prefix: string) =>
      `You're out of limits right now. Top up anytime using *${prefix}addlimit <amount>* or ask a friend to send you some!`,
    cmdNotFound: (prefix: string, cmd: string) =>
      `Hmm, *${prefix}${cmd}* isn't a recognized command. Send *${prefix}menu* to browse what's available.`,
    cmdDisabled: (prefix: string, cmd: string) =>
      `The command *${prefix}${cmd}* is currently turned off by the Owner.`,
    maintenance: 'The bot is in quick maintenance mode right now—only the Owner can run commands for a moment.',
    maintenanceMode: 'The bot is currently in quick maintenance mode—only the Owner can run commands right now.',
    cooldown: (cmd: string, sec: number) =>
      `Hold on a sec! You can use *${cmd}* again in ${sec}s.`,
    ownerOnly: (cmd?: string) =>
      cmd ? `The *${cmd}* command is reserved for the bot Owner.` : 'This command is reserved for the bot Owner.',
    groupOnly: 'This command only works inside a group chat.',
    adminOnly: (cmd?: string) =>
      cmd
        ? `Only group admins or the Owner can manage *${cmd}*.`
        : 'Only group admins or the Owner can change this setting.',
    spamWarning: (sec: number) => `Easy there! Give it about ${sec}s before sending another command.`,
    restrictedUser: (reason?: string) =>
      reason
        ? `Your account is temporarily restricted: ${reason}. Reach out to the Owner if you think this is a mistake.`
        : 'Your account is temporarily restricted. Reach out to the Owner if you think this is a mistake.',
    helpHeader: (cmd: string) => `Guide for *${cmd}*`,
    ping: (latency: number, status: string) =>
      `Pong! Running smoothly (${latency} ms) · Connection: *${status}*.\n_Freya-san bot by Pak Ujan_`,
  },
  ja: {
    botFooter: 'Freya-san bot by Pak Ujan',
    limitExhausted: (prefix: string, need: number, have: number) =>
      `リミットが足りないよ（残り ${have}、必要 ${need}）。${prefix}addlimit <数> で購入するか、友達に送ってもらってね。`,
    limitEmpty: (prefix: string) =>
      `リミットが切れちゃったみたい。*${prefix}addlimit <数>* で補充するか、友達から送ってもらってね！`,
    cmdNotFound: (prefix: string, cmd: string) =>
      `*${prefix}${cmd}* というコマンドは見つからなかったよ。*${prefix}menu* で一覧を見てみてね。`,
    cmdDisabled: (prefix: string, cmd: string) =>
      `*${prefix}${cmd}* は今オーナーによって一時停止中だよ。`,
    maintenance: '今はメンテナンス中なんだ。オーナー以外は少し待っててね。',
    maintenanceMode: '今はメンテナンス中なんだ。オーナー以外は少し待っててね。',
    cooldown: (cmd: string, sec: number) =>
      `ちょっと待ってね！*${cmd}* はあと${sec}秒で使えます。`,
    ownerOnly: (cmd?: string) =>
      cmd ? `*${cmd}* はオーナー専用のコマンドだよ。` : 'このコマンドはオーナー専用だよ。',
    groupOnly: 'このコマンドはグループチャット専用だよ。',
    adminOnly: (cmd?: string) =>
      cmd
        ? `*${cmd}* を変更できるのはグループ管理者かオーナーだけだよ。`
        : 'この設定を変更できるのはグループ管理者かオーナーだけだよ。',
    spamWarning: (sec: number) => `ちょっと早いよ！あと${sec}秒くらい待ってから送ってね。`,
    restrictedUser: (reason?: string) =>
      reason
        ? `現在アカウントが制限されています: ${reason}。心当たりがない場合はオーナーに連絡してね。`
        : '現在アカウントが制限されています。心当たりがない場合はオーナーに連絡してね。',
    helpHeader: (cmd: string) => `*${cmd}* の使い方`,
    ping: (latency: number, status: string) =>
      `ポン！応答は快調だよ (${latency} ms) · 接続状態: *${status}*\n_Freya-san bot by Pak Ujan_`,
  },
} as const;

export function botText(lang?: string | null) {
  return MESSAGES[normalizeBotLang(lang)];
}
