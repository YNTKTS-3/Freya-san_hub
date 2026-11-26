export type BotLang = 'id' | 'en' | 'ja';
export type BotLanguageStyle = 'santai_nonbaku';

export const FORMAL_INDONESIAN_MARKERS: RegExp[] = [
  /\bAnda\b/,
  /\banda\b/,
  /\bSilakan\b/,
  /\bsilakan\b/,
  /\bHarap\b/,
  /\bharap\b/,
  /\bMohon\b/,
  /\bmohon\b/,
  /\bPerintah tidak ditemukan\b/i,
  /\bPermintaan berhasil diproses\b/i,
  /\bPengguna telah mencapai\b/i,
  /\bmemiliki saldo yang cukup\b/i,
  /\bHarap hubungi administrator\b/i,
  /\bHarap bersabar\b/i,
  /\bterlebih dahulu\b/i,
];

export function findFormalIndonesianViolations(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of FORMAL_INDONESIAN_MARKERS) {
    const match = text.match(pattern);
    if (match) {
      hits.push(match[0]);
    }
  }
  return hits;
}

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
      `Limit kamu udah habis nih (sisa ${have}, butuh ${need}). Tambah limit dulu pakai *${prefix}addlimit <jumlah>* atau minta kirimin teman kamu ya.`,
    limitEmpty: (prefix: string) =>
      `Limit harian kamu udah habis nih. Tambah dulu pakai *${prefix}addlimit <jumlah>* atau tunggu reset / minta kirimin teman ya!`,
    cmdNotFound: (prefix: string, cmd: string) =>
      `Command *${prefix}${cmd}* nggak ketemu nih. Coba cek lewat *${prefix}menu* ya.`,
    cmdDisabled: (prefix: string, cmd: string) =>
      `Command *${prefix}${cmd}* lagi dimatiin sementara sama Owner.`,
    maintenance: 'Bot lagi masuk mode maintenance sebentar ya, jadi sementara cuma Owner yang bisa pakai.',
    maintenanceMode: 'Bot lagi masuk mode maintenance sebentar ya, jadi sementara cuma Owner yang bisa pakai.',
    cooldown: (cmd: string, sec: number) =>
      `Tunggu sebentar ya, command *${cmd}* baru bisa dipakai lagi ${sec} detik lagi.`,
    ownerOnly: (cmd?: string) =>
      cmd
        ? `Command *${cmd}* ini khusus buat Owner bot aja ya.`
        : 'Command ini khusus buat Owner bot aja ya.',
    groupOnly: 'Command ini cuma bisa dipakai di dalam grup ya.',
    adminOnly: (cmd?: string) =>
      cmd
        ? `Fitur *${cmd}* cuma bisa diatur sama admin grup atau Owner ya.`
        : 'Fitur ini cuma bisa diatur sama admin grup atau Owner ya.',
    spamWarning: (sec: number) => `Pelan-pelan ya, tunggu sekitar ${sec} detik lagi sebelum kirim command berikutnya.`,
    restrictedUser: (reason?: string) =>
      reason
        ? `Akun kamu lagi dibatasi sementara: ${reason}. Kalau merasa ini keliru, coba hubungi Owner ya.`
        : 'Akun kamu lagi dibatasi sementara. Coba hubungi Owner kalau merasa ini keliru ya.',
    helpHeader: (cmd: string) => `Panduan *${cmd}*`,
    ping: (latency: number, status: string) =>
      `Pong! Responnya lancar (${latency} ms) · Status koneksi: *${status}*.\n_Freya-san bot by Pak Ujan_`,
    menuListButton: 'Buka Daftar Menu',
    menuBackTitle: '⬅️ Kembali',
    menuBackMainTitle: '⬅️ Kembali ke Menu Utama',
    menuBackMainDesc: 'Balik ke daftar menu utama Freya-san Hub',
    menuNextPageTitle: '➡️ Halaman Berikutnya',
    menuPrevPageTitle: '⬅️ Halaman Sebelumnya',
    menuSessionExpired: (prefix: string) =>
      `Menu ini udah kedaluwarsa atau belum kebuka. Ketik *${prefix}menu* buat buka daftar menu terbaru ya.`,
    menuInvalidChoice: (prefix: string) =>
      `Pilihan menunya nggak ketemu nih. Ketik *${prefix}menu* atau balas angka yang sesuai daftar ya.`,
    menuOptionDenied: 'Kamu nggak punya izin buat buka atau jalanin opsi menu itu ya.',
    menuConfirmYes: '✅ Ya, Lanjut Eksekusi',
    menuConfirmCancel: '❌ Batal',
    menuCancelled: 'Oke, aksinya dibatalin ya.',
    menuWelcomeSubtitle: 'Pilih kategori atau fitur langsung dari daftar di bawah ini ya.',
    menuFallbackHint: 'Balas angka dari daftar (misal *1*) atau ketik command-nya langsung ya.',
    languageUpdated: (langLabel: string) =>
      `Bahasa bot berhasil diganti ke *${langLabel}* (gaya santai nonbaku aktif)!`,
    defaultWelcome: 'Halo {user}! Selamat datang di {group} ya. Yuk kenalan & cek aturan grup!',
    defaultLeft: 'Sampai ketemu lagi {user}, makasih udah ikut seru-seruan di {group}!',
    redeemPromptCode: (prefix: string) =>
      `Masukin kode redeem-nya dulu ya. Contoh: *${prefix}redeem FREYAHUB50*`,
    redeemSuccessDefault: 'Yeay! Kode *{code}* berhasil diklaim buat {user}! Hadiah: {rewards}.',
    redeemExpiredDefault: 'Yah, masa berlaku kode *{code}* udah habis.',
    redeemLimitDefault: 'Kuota klaim kode *{code}* kamu udah habis nih.',
    redeemInvalidDefault: 'Kode redeem *{code}* nggak valid atau lagi nonaktif.',
    balanceNotEnough: (need: number, have: number) =>
      `Balance kamu nggak cukup nih (butuh ${need}, punya kamu ${have}).`,
    ownerContactHeader: 'Kontak Owner Freya-san Hub',
    reportSaved: (name: string) => `Laporan kamu udah masuk ke catatan Owner ya, makasih *${name}*!`,
  },
  en: {
    botFooter: 'Freya-san bot by Pak Ujan',
    limitExhausted: (prefix: string, need: number, have: number) =>
      `You're out of limits (${have} left, need ${need}). Top up anytime with *${prefix}addlimit <amount>* or ask a friend to send you some.`,
    limitEmpty: (prefix: string) =>
      `You're out of limits right now. Top up anytime using *${prefix}addlimit <amount>* or ask a friend to send you some!`,
    cmdNotFound: (prefix: string, cmd: string) =>
      `Hmm, *${prefix}${cmd}* isn't a recognized command. Send *${prefix}menu* to browse what's available.`,
    cmdDisabled: (prefix: string, cmd: string) =>
      `The command *${prefix}${cmd}* is currently turned off by the Owner.`,
    maintenance: 'The bot is in quick maintenance mode right now—only the Owner can run commands for a moment.',
    maintenanceMode: 'The bot is currently in quick maintenance mode—only the Owner can run commands for a moment.',
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
    menuListButton: 'Open Menu List',
    menuBackTitle: '⬅️ Back',
    menuBackMainTitle: '⬅️ Back to Main Menu',
    menuBackMainDesc: 'Return to the Freya-san Hub main menu',
    menuNextPageTitle: '➡️ Next Page',
    menuPrevPageTitle: '⬅️ Previous Page',
    menuSessionExpired: (prefix: string) =>
      `That menu expired. Send *${prefix}menu* to open a fresh interactive menu!`,
    menuInvalidChoice: (prefix: string) =>
      `I couldn't match that choice. Send *${prefix}menu* or reply with one of the listed numbers.`,
    menuOptionDenied: "You don't have permission to open or run that menu option.",
    menuConfirmYes: '✅ Yes, Continue',
    menuConfirmCancel: '❌ Cancel',
    menuCancelled: 'Got it, cancelled!',
    menuWelcomeSubtitle: 'Pick a category or quick tool from the list below.',
    menuFallbackHint: 'Reply with a number from the list (e.g. *1*) or type the command directly.',
    languageUpdated: (langLabel: string) => `Bot language switched to *${langLabel}*!`,
    defaultWelcome: 'Hey {user}! Welcome to {group}. Make sure to check the group rules!',
    defaultLeft: 'See you around {user}! Thanks for hanging out in {group}.',
    redeemPromptCode: (prefix: string) => `Enter your redeem code first, e.g. *${prefix}redeem FREYAHUB50*`,
    redeemSuccessDefault: 'Awesome! Code *{code}* claimed for {user}! Rewards: {rewards}.',
    redeemExpiredDefault: 'Sorry, code *{code}* has expired.',
    redeemLimitDefault: 'You have reached the claim limit for *{code}*.',
    redeemInvalidDefault: 'Code *{code}* is invalid or inactive right now.',
    balanceNotEnough: (need: number, have: number) =>
      `Not enough balance (need ${need}, you have ${have}).`,
    ownerContactHeader: 'Freya-san Hub Owner Contact',
    reportSaved: (name: string) => `Thanks *${name}*! Your report was logged for the Owner.`,
  },
  ja: {
    botFooter: 'Freya-san bot by Pak Ujan',
    limitExhausted: (prefix: string, need: number, have: number) =>
      `リミットが足りないよ（残り ${have}、必要 ${need}）。*${prefix}addlimit <数>* で補充するか、友達に送ってもらってね。`,
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
    menuListButton: 'メニューを開く',
    menuBackTitle: '⬅️ 戻る',
    menuBackMainTitle: '⬅️ メインメニューへ戻る',
    menuBackMainDesc: 'Freya-san Hubのトップメニューに戻るよ',
    menuNextPageTitle: '➡️ 次のページ',
    menuPrevPageTitle: '⬅️ 前のページ',
    menuSessionExpired: (prefix: string) =>
      `メニューの有効期限が切れたみたい。*${prefix}menu* を送って新しく開いてね！`,
    menuInvalidChoice: (prefix: string) =>
      `その選択肢は見つからなかったよ。*${prefix}menu* を送るか、一覧の番号を返信してね。`,
    menuOptionDenied: 'そのメニュー項目を開く権限がないよ。',
    menuConfirmYes: '✅ はい、続行する',
    menuConfirmCancel: '❌ キャンセル',
    menuCancelled: '了解、キャンセルしたよ！',
    menuWelcomeSubtitle: '下のリストからカテゴリや機能を選んでね。',
    menuFallbackHint: '一覧の番号（例: *1*）で返信するか、コマンドをそのまま入力してね。',
    languageUpdated: (langLabel: string) => `ボットの言語を *${langLabel}* に変更したよ！`,
    defaultWelcome: 'やっほー {user}さん！{group}へようこそ！ルールもチェックしてみてね。',
    defaultLeft: 'またね {user}さん！{group}で遊んでくれてありがとう！',
    redeemPromptCode: (prefix: string) => `まずは引き換えコードを入力してね。例: *${prefix}redeem FREYAHUB50*`,
    redeemSuccessDefault: 'やったね！{user}さんのコード *{code}* を引き換えたよ！特典: {rewards}',
    redeemExpiredDefault: 'ごめんね、コード *{code}* は期限切れみたい。',
    redeemLimitDefault: 'コード *{code}* の引き換え上限に達しているよ。',
    redeemInvalidDefault: 'コード *{code}* は無効か、今は使えない状態だよ。',
    balanceNotEnough: (need: number, have: number) =>
      `残高が足りないよ（必要 ${need} / 所持 ${have}）。`,
    ownerContactHeader: 'Freya-san Hub オーナー連絡先',
    reportSaved: (name: string) => `*${name}* さん、報告ありがとう！オーナーのログに記録したよ。`,
  },
} as const;

export function botText(lang?: string | null) {
  return MESSAGES[normalizeBotLang(lang)];
}
