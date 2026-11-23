import { CommandAuditRow, CommandCategory, CommandDefinition } from './types';

function mk(
  name: string,
  category: CommandCategory,
  opts: Partial<CommandDefinition> = {},
): CommandDefinition {
  const isOwner = category === 'OWNER' || Boolean(opts.isOwnerOnly);
  return {
    name,
    aliases: opts.aliases ?? [],
    category,
    description:
      opts.description ??
      `Perintah ${name} pada modul ${category.toLowerCase()} Freya-san Hub.`,
    example: opts.example ?? `.${name}`,
    permission:
      opts.permission ??
      (isOwner ? 'owner' : category === 'GROUP' ? 'group_admin' : 'public'),
    status: opts.status ?? 'active',
    enabled: opts.enabled ?? true,
    cooldownSec: opts.cooldownSec ?? (isOwner ? 0 : 3),
    dailyLimit: opts.dailyLimit ?? (isOwner ? 0 : 25),
    balanceReward: opts.balanceReward ?? (category === 'GAME' || category === '48GROUP' ? 25 : 5),
    expReward: opts.expReward ?? (category === 'GAME' || category === '48GROUP' ? 15 : 3),
    requiredProvider: opts.requiredProvider ?? null,
    requiredPlugin: opts.requiredPlugin ?? null,
    hasRealHandler: opts.hasRealHandler ?? true,
    isOwnerOnly: isOwner,
    notes: opts.notes,
    sourceCorrection: opts.sourceCorrection,
  };
}

// 9.1 AI (11 commands)
const AI_COMMANDS: CommandDefinition[] = [
  mk('aiimage', 'AI', { description: 'Membuat gambar menggunakan AI image generator.', example: '.aiimage panggung biru modern', requiredProvider: 'gemini' }),
  mk('aiimg', 'AI', { aliases: ['aimg'], description: 'Alias cepat pembuat gambar berbasis AI.', example: '.aiimg sunset tokyo', requiredProvider: 'gemini' }),
  mk('byenexara', 'AI', { description: 'Menutup sesi percakapan aktif dengan AI Nexara.', example: '.byenexara', requiredProvider: 'gemini' }),
  mk('byeopenai', 'AI', { description: 'Menutup sesi percakapan aktif dengan provider OpenAI.', example: '.byeopenai', requiredProvider: 'openai' }),
  mk('editimg', 'AI', { description: 'Mengedit gambar lampiran berdasarkan instruksi teks.', example: '.editimg ubah latar menjadi biru', requiredProvider: 'gemini', status: 'pending_integration', hasRealHandler: false }),
  mk('hitamkan', 'AI', { description: 'Filter penyesuaian tone warna gelap pada gambar.', example: '.hitamkan', requiredPlugin: 'media-processor', status: 'pending_integration', hasRealHandler: false }),
  mk('jadianime', 'AI', { description: 'Mengubah potret menjadi ilustrasi bergaya anime.', example: '.jadianime', requiredProvider: 'gemini', status: 'pending_integration', hasRealHandler: false }),
  mk('nexara', 'AI', { description: 'Berinteraksi dengan AI Nexara (default Gemini server-side).', example: '.nexara jelaskan sejarah JKT48', requiredProvider: 'gemini' }),
  mk('openai', 'AI', { description: 'Berinteraksi dengan provider OpenAI atau fallback terkonfigurasi.', example: '.openai buat ringkasan', requiredProvider: 'openai' }),
  mk('toanime', 'AI', { description: 'Konversi foto menjadi gaya anime.', example: '.toanime', requiredProvider: 'gemini', status: 'pending_integration', hasRealHandler: false }),
  mk('voicejapan', 'AI', { description: 'Sintesis suara berbahasa Jepang dari teks pengguna.', example: '.voicejapan ohayou gozaimasu', requiredProvider: 'tts', status: 'pending_integration', hasRealHandler: false }),
];

// 9.2 DOWNLOAD (18 commands)
const DOWNLOAD_COMMANDS: CommandDefinition[] = [
  'douyin', 'facebook', 'igdl', 'igreel', 'igstory', 'igtv', 'mediafire',
  'otakudesudl', 'pindl', 'spotify', 'threads', 'tiktokmusic', 'tiktoknowm',
  'tiktokslidevideo', 'tiktokwm', 'twitterdl', 'ytmp3', 'ytmp4',
].map((name) =>
  mk(name, 'DOWNLOAD', {
    description: `Pengunduh media resmi dari layanan ${name.replace(/dl$/, '')} (memerlukan plugin downloader aktif).`,
    example: `.${name} https://contoh.tautan/media`,
    requiredPlugin: 'downloader-provider',
    status: 'pending_integration',
    hasRealHandler: false,
  }),
);

// 9.3 GAME (38 source commands + additional general games from addendum)
const GAME_SOURCE_LIST: Array<[string, Partial<CommandDefinition>]> = [
  ['akinator', { description: 'Memulai atau melihat status permainan tebak tokoh Akinator.' }],
  ['akinatorstart', { description: 'Memulai sesi baru permainan Akinator.' }],
  ['akinatorstop', { description: 'Menghentikan sesi aktif Akinator.' }],
  ['asahotak', { description: 'Kuis asah otak logika dan pengetahuan umum.' }],
  ['bom', { description: 'Permainan kotak bom virtual; hindari kotak bom untuk mengumpulkan balance virtual.', example: '.bom' }],
  ['buylimit', { description: 'Menukar balance virtual menjadi kuota limit command harian.', example: '.buylimit 5' }],
  ['caklontong', { description: 'Tebak-tebakan humor khas Cak Lontong dengan petunjuk jawaban.' }],
  ['dare', { description: 'Tantangan aman (Truth or Dare versi aman) untuk pemain.' }],
  ['family100', { description: 'Permainan survei Family 100 dengan pencatatan jawaban per sesi.' }],
  ['hint', { description: 'Membuka petunjuk pada sesi permainan aktif (dapat mengurangi poin sesuai aturan).' }],
  ['math', { description: 'Tantangan hitung cepat matematika dengan batas waktu server.' }],
  ['nyerah', { description: 'Menyerah pada sesi permainan aktif di percakapan saat ini.' }],
  ['redeem', { description: 'Menukarkan kode redeem berhadiah balance, EXP, limit, atau premium.', example: '.redeem KODE123' }],
  ['sambungkata', { description: 'Permainan menyambung kata berdasarkan suku kata/huruf terakhir.' }],
  ['siapakahaku', { description: 'Tebak siapa aku berdasarkan petunjuk deskriptif bertahap.' }],
  ['sloth', { description: 'Permainan kombinasi tiga simbol acak dengan hadiah balance virtual (tanpa taruhan uang asli).' }],
  ['suit', { description: 'Batu gunting kertas melawan bot atau pemain lain.', example: '.suit batu' }],
  ['susunkalimat', { description: 'Menyusun kata acak menjadi kalimat bahasa Indonesia yang benar.' }],
  ['susunkata', { description: 'Menyusun huruf acak menjadi kata yang tepat.' }],
  ['susunlirik', { description: 'Menyusun potongan metadata/baris permainan kata tanpa reproduksi lirik penuh berhak cipta.' }],
  ['tebakbendera', { description: 'Menebak negara berdasarkan bendera.' }],
  ['tebakbom', { description: 'Varian permainan tebak kotak aman vs kotak bom.' }],
  ['tebakchara', { description: 'Menebak karakter fiksi/anime dari petunjuk.' }],
  ['tebakemoji', { description: 'Menebak frasa atau judul dari kombinasi emoji.' }],
  ['tebakgambar', { description: 'Menebak teka-teki visual berbasis petunjuk.' }],
  ['tebakkata', { description: 'Permainan tebak kata dengan pelacakan jawaban sesi.' }],
  ['tebaklagu', { description: 'Tebak judul lagu berdasarkan petunjuk metadata (tanpa lirik panjang).' }],
  ['tebaklaguanime', { description: 'Tebak lagu tema anime dari metadata dan petunjuk.' }],
  ['tebaklagukpop', { description: 'Tebak lagu K-Pop dari metadata dan petunjuk.' }],
  ['tekateki', { description: 'Kuis teka-teki klasik dengan skor server-side.' }],
  ['tfbalance', { description: 'Transfer balance virtual antar pengguna secara transaksional.', example: '.tfbalance 628123456789 100' }],
  ['tictactoe', { description: 'Permainan papan 3x3 Tic Tac Toe antar pemain atau lawan bot.', example: '.tictactoe' }],
  ['truth', { description: 'Pertanyaan jujur aman (Truth or Dare versi aman).' }],
  ['ulartangga', { description: 'Permainan papan Ular Tangga berbasis giliran.' }],
  ['undercover', { description: 'Permainan deduksi sosial Undercover berbasis room.' }],
  ['uno', { description: 'Permainan kartu UNO berbasis giliran dalam grup.' }],
  ['werewolf', { description: 'Werewolf Classic berbasis sesi room dengan peran Desa vs Werewolf.' }],
  ['werewolf2', { description: 'Mode lanjutan Werewolf Classic dengan peran tambahan.' }],
];

const GAME_ADDENDUM_EXTRAS: Array<[string, Partial<CommandDefinition>]> = [
  ['mafia', { description: 'Mafia Game klasik dengan fase malam/siang terkelola server.' }],
  ['spyfall', { description: 'Permainan deduksi lokasi Spyfall berbasis room.' }],
  ['impostor', { description: 'Permainan deteksi Impostor berbasis giliran.' }],
  ['tebakangka', { description: 'Menebak angka rahasia antara 1-100 dengan petunjuk lebih tinggi/rendah.' }],
  ['quizbattle', { description: 'Duel adu cepat menjawab pertanyaan antar pemain.' }],
  ['aducepat', { description: 'Adu cepat menjawab kuis pengetahuan dalam sesi grup/pribadi.' }],
];

const GAME_COMMANDS: CommandDefinition[] = [
  ...GAME_SOURCE_LIST.map(([name, opts]) => mk(name, 'GAME', opts)),
  ...GAME_ADDENDUM_EXTRAS.map(([name, opts]) =>
    mk(name, 'GAME', { ...opts, notes: 'Tambahan wajib Game Center umum.' }),
  ),
];

// 9.4 GENERAL (11 commands)
const GENERAL_COMMANDS: CommandDefinition[] = [
  mk('changelog', 'GENERAL', { description: 'Menampilkan catatan rilis dan pembaruan terbaru Freya-san Hub.' }),
  mk('everyone', 'GENERAL', { description: 'Menyebut seluruh anggota grup (khusus konteks grup & admin).', permission: 'group_admin' }),
  mk('infobot', 'GENERAL', { description: 'Menampilkan informasi ringkas platform, versi, dan status layanan bot.' }),
  mk('menu', 'GENERAL', { aliases: ['help'], description: 'Membuka Interactive List Menu bertingkat atau fallback menu teks.' }),
  mk('owner', 'GENERAL', { description: 'Menampilkan informasi kontak dukungan resmi tanpa membocorkan nomor privat secara sembarangan.' }),
  mk('ping', 'GENERAL', { description: 'Menguji latensi respons server dan status kesiapan bot.' }),
  mk('resend', 'GENERAL', { description: 'Mengirim ulang pesan atau media terakhir yang diizinkan pada sesi.' }),
  mk('runtime', 'GENERAL', { description: 'Menampilkan lama waktu server dan bot berjalan.' }),
  mk('sender', 'GENERAL', { description: 'Menampilkan identitas pengirim pesan pada percakapan saat ini.' }),
  mk('streak', 'GENERAL', { description: 'Melihat jumlah streak aktivitas harian pengguna.' }),
  mk('version', 'GENERAL', { description: 'Menampilkan versi sistem Freya-san Hub saat ini.' }),
];

// 9.5 GROUP (122 commands)
const GROUP_NAMES: string[] = [
  'absen', 'add', 'addalarm', 'addbadword', 'addlist', 'addpoin', 'addreminder',
  'addwhitelist', 'afk', 'antibadword', 'antibadwordnokick', 'antibot', 'antidelete',
  'antigroupsw', 'antikudeta', 'antilink', 'antilinkchannel', 'antilinknokick',
  'antilinkuniversal', 'antiluar', 'antimentionsw', 'antisticker', 'antiviewonce',
  'antiwame', 'antiwamenokick', 'banmember', 'belumabsen', 'blacklist', 'cekabsen',
  'cekidgroup', 'cekpoint', 'ceksewa', 'cekwarn', 'createschedulecall', 'delalarm',
  'delbadword', 'delblacklist', 'delete', 'deleteabsen', 'deletepoin',
  'deletetotalpesan', 'dellist', 'delreminder', 'delultahku', 'delwarn',
  'delwhitelist', 'demote', 'demotedetector', 'descgc', 'disablealarm', 'done',
  'enablealarm', 'gamemode', 'getlist', 'groupadmin', 'groupinfo', 'groupschedule',
  'groupsetting', 'grouptime', 'hidetag', 'kick', 'kickme', 'leavegc', 'left',
  'levelling', 'linkgc', 'list', 'listalarm', 'listbadword', 'listbanmember',
  'listblacklist', 'listonline', 'listpoint', 'listreminder', 'listtotalpesan',
  'listultah', 'listwarn', 'listwhitelist', 'mulaiabsen', 'mute', 'pinmsg',
  'promote', 'promotedetector', 'proses', 'refreshgroup', 'reqjoin', 'resetalarm',
  'resetbadword', 'resetblacklist', 'resetlist', 'resetpoint', 'resetreminder',
  'resettotalpesan', 'resetultahku', 'resetwarn', 'revokelink', 'setclose',
  'setdescgc', 'setdone', 'setleft', 'setlefttype', 'setnamegc', 'setopen',
  'setppgc', 'setppgcpanjang', 'setproses', 'setwarn', 'setwelcome',
  'setwelcometype', 'streakgrup', 'tagall', 'tfpoint', 'totag', 'totalpesan',
  'ultahku', 'unbanmember', 'unpinmsg', 'updatelist', 'uplist', 'upswgroupv2',
  'vote', 'warn', 'welcome',
];

const GROUP_SPECIAL_DESC: Record<string, Partial<CommandDefinition>> = {
  antiluar: { description: 'Mendeteksi nomor di luar kode negara Indonesia (+62) dengan opsi peringatan/hapus/kick serta pengecualian.' },
  antikudeta: { description: 'Melindungi jabatan owner grup dari demote oleh admin lain bila bot memiliki izin admin.' },
  antigroupsw: { description: 'Mencatat pelanggaran status grup sesuai keterbatasan API WhatsApp dengan sanksi bertahap.' },
  antimentionsw: { description: 'Pengaturan ON/OFF dan pencatatan pelanggaran mention grup pada status.' },
  antibot: { description: 'Mencegah bot tidak terdaftar masuk grup; bot utama & whitelist owner dikecualikan.' },
  done: { description: 'Menandai pekerjaan grup selesai dengan waktu dan penanggung jawab.', permission: 'group_admin' },
  proses: { description: 'Menandai pekerjaan grup sedang diproses dengan penanggung jawab dan notifikasi.', permission: 'group_admin' },
  reqjoin: { description: 'Mengelola permintaan gabung grup (list, approve all/nomor, reject all/nomor).', example: '.reqjoin list', permission: 'group_admin' },
  createschedulecall: { description: 'Membuat pengingat jadwal panggilan grup.', status: 'pending_integration', hasRealHandler: false },
};

const GROUP_COMMANDS: CommandDefinition[] = GROUP_NAMES.map((name) =>
  mk(name, 'GROUP', {
    permission: ['absen', 'afk', 'cekabsen', 'belumabsen', 'cekpoint', 'list', 'getlist', 'ultahku', 'listultah', 'totalpesan', 'listtotalpesan', 'vote'].includes(name)
      ? 'public'
      : 'group_admin',
    ...(GROUP_SPECIAL_DESC[name] ?? {}),
  }),
);

// 9.6 INFO (18 commands)
const INFO_COMMANDS: CommandDefinition[] = [
  mk('balance', 'INFO', { description: 'Melihat saldo balance virtual akun Anda.' }),
  mk('cekchannel', 'INFO', { description: 'Memeriksa informasi saluran WhatsApp resmi yang terhubung.' }),
  mk('cekpremium', 'INFO', { description: 'Memeriksa status dan masa aktif langganan premium.' }),
  mk('infocovid', 'INFO', { description: 'Menampilkan ringkasan informasi kesehatan publik dari sumber resmi.', status: 'pending_integration', hasRealHandler: false }),
  mk('infogempa', 'INFO', { description: 'Mengambil info gempa terbaru dari sumber BMKG resmi.' }),
  mk('infounsur', 'INFO', { description: 'Informasi unsur kimia dari tabel periodik terverifikasi.', example: '.infounsur Au' }),
  mk('kodebahasa', 'INFO', { description: 'Daftar kode bahasa yang didukung sistem terjemahan & bot (id, en, ja).' }),
  mk('level', 'INFO', { description: 'Menampilkan level dan progres EXP pengguna.' }),
  mk('limit', 'INFO', { description: 'Menampilkan sisa limit penggunaan command harian.' }),
  mk('listban', 'INFO', { description: 'Menampilkan daftar pengguna yang sedang diblokir dari bot.' }),
  mk('listblock', 'INFO', { description: 'Menampilkan daftar kontak yang diblokir.' }),
  mk('listgroup', 'INFO', { description: 'Menampilkan daftar grup yang terhubung dengan izin akses sesuai role.' }),
  mk('listpremium', 'INFO', { description: 'Menampilkan daftar anggota dengan status premium aktif.' }),
  mk('profile', 'INFO', { description: 'Menampilkan profil lengkap pengguna: level, EXP, balance, dan streak.' }),
  mk('report', 'INFO', { description: 'Mengirim laporan bug atau masukan ke log administrator.', example: '.report deskripsi masalah' }),
  mk('status', 'INFO', { description: 'Menampilkan kesehatan real-time WhatsApp engine, database, AI, dan antrean.' }),
  mk('topglobal', 'INFO', { description: 'Papan peringkat global berdasarkan EXP dan skor game.' }),
  mk('toplocal', 'INFO', { description: 'Papan peringkat lokal dalam grup atau kategori aktif.' }),
];

// 9.7 OWNER (152 source + 5 prefix manager commands = 157)
const OWNER_NAMES: string[] = [
  'accadmininvitechannel', 'addbalance', 'addlevel', 'addlimit', 'addpremium',
  'addpremiumgroup', 'addredeem', 'addrespon', 'addsewa', 'addsewathisgroup', 'addxp',
  'anticall', 'anticallnoblock', 'antideletepc', 'autoleavegcnosewa', 'autonexara',
  'autoread', 'autotype', 'ban', 'bccancel', 'bcconfirm', 'bcgchidetag', 'bcgroup',
  'bchidetag', 'bcmember', 'bcpc', 'bcpremium', 'bcsewa', 'bcstat',
  'blacklistglobal', 'block', 'blockpc', 'broadcast', 'buttonmode', 'buttontojson',
  'call', 'callloop', 'callplay', 'callqueue', 'callskip', 'callstop', 'cekaccount',
  'cekgroupcron', 'cekgroupsewa', 'ceklimitakun', 'cekopenaikey', 'ceksewabyid',
  'chatgroup', 'claimFreyasanredeem', 'cleangroupcron', 'cleangroupsewa', 'clearchat',
  'copythumbnail', 'createbutton', 'createfullbutton', 'createlist', 'createredeem',
  'createtemplate', 'createthumbnail', 'delbalance', 'delblacklistglobal',
  'deleteredeem', 'delfreeautores', 'delfreecommand', 'dellevel', 'dellimit',
  'delpremium', 'delpremiumgroup', 'delrespon', 'delsewa', 'delxp', 'editredeem', 'freeautores',
  'freecommand', 'globalgamemode', 'golink', 'grabcontact', 'greeting',
  'grouponlypremium', 'inforedeem', 'inviteme', 'join', 'leaveall', 'leavegcbyid',
  'leavenosewa', 'levellingpc', 'listblacklistglobal', 'listcommand',
  'listfreeautores', 'listfreecommand', 'listgroupnosewa', 'listpremiumgroup',
  'listredeem', 'listrespon', 'listsewa', 'listsewapermanent', 'mutebc', 'mutebyid',
  'mycontacts', 'onlygroup', 'onlyindo', 'onlyprem', 'pconlyprem', 'premiumgroup',
  'promoteme', 'public', 'publicbyid', 'queue', 'rawmessage', 'react',
  'reactchannel', 'redeemdisable', 'redeemenable', 'redeemhistory', 'redeemreset', 'redeemstats',
  'refreshgroupbyid', 'refreshpremiumlist', 'resetanonymous',
  'resetbalance', 'resetblacklistglobal', 'resetfreeautores', 'resetfreecommand',
  'resetlevel', 'resetlimit', 'resetlimitreceivedgroup', 'resetpremium',
  'resetresponse', 'resetxp', 'searchmessage', 'self', 'selfbyid', 'setbio',
  'setcommand', 'setdefaultweltype', 'setlimitgroup', 'setlimitreceivedgroup',
  'setname', 'setopenaikey', 'setpp', 'setpppanjang', 'setscript', 'setwrsuit',
  'setwrttt', 'spr', 'sprx', 'testbutton', 'topeng', 'topengx', 'unban',
  'unblock', 'unreact', 'unreactchannel', 'upchannel', 'upres', 'upsw', 'upswch',
  'upswgroup', 'upswgroupv2byid', 'upswmentiongroup', 'upswmentiongroupsilent',
  'upswpremium', 'videocall',
];

// Also 7.3 Owner Prefix Manager commands: prefix, listprefix, addprefix, delprefix, resetprefix
const OWNER_PREFIX_COMMANDS = ['prefix', 'listprefix', 'addprefix', 'delprefix', 'resetprefix'];

const OWNER_SPECIAL: Record<string, Partial<CommandDefinition>> = {
  claimFreyasanredeem: {
    aliases: ['claimwibusoftredeem'],
    description: 'Mengklaim atau memverifikasi kode redeem resmi Freya-san Hub.',
    sourceCorrection: 'Renamed from legacy "claimwibusoftredeem" to "claimFreyasanredeem".',
  },
  spr: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi asli belum diverifikasi owner.' },
  sprx: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi asli belum diverifikasi owner.' },
  topeng: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi asli belum diverifikasi owner.' },
  topengx: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi asli belum diverifikasi owner.' },
  call: { status: 'pending_integration', hasRealHandler: false, description: 'Memerlukan integrasi panggilan WhatsApp yang didukung library; tidak melakukan simulasi panggilan palsu.' },
  callloop: { status: 'pending_integration', hasRealHandler: false, description: 'Kontrol antrean loop panggilan (pending verifikasi library WhatsApp).' },
  callplay: { status: 'pending_integration', hasRealHandler: false, description: 'Kontrol putar audio panggilan (pending verifikasi library WhatsApp).' },
  callqueue: { status: 'pending_integration', hasRealHandler: false, description: 'Antrean sesi panggilan (pending verifikasi library WhatsApp).' },
  callskip: { status: 'pending_integration', hasRealHandler: false, description: 'Lewati item antrean panggilan (pending verifikasi library WhatsApp).' },
  callstop: { status: 'pending_integration', hasRealHandler: false, description: 'Hentikan sesi panggilan aktif (pending verifikasi library WhatsApp).' },
  videocall: { status: 'pending_integration', hasRealHandler: false, description: 'Memerlukan dukungan WebRTC/panggilan video resmi WhatsApp.' },
  golink: { description: 'OWNER -> GROUP MANAGEMENT: Mengambil tautan undangan grup berdasarkan ID grup tervalidasi.' },
  upswgroup: { description: 'Mengunggah WhatsApp Status dengan mention grup melalui antrean dan cooldown.' },
  upswgroupv2byid: { description: 'Mengunggah status WhatsApp berdasarkan ID grup spesifik dan status sewa.' },
  upswmentiongroup: { description: 'Mengunggah status dengan mention grup (dengan preview, queue, dan cooldown).' },
  antideletepc: { description: 'Mengirim notifikasi pesan terhapus di private chat bila salinan tersedia secara sah.' },
  autonexara: { description: 'Mengaktifkan/menonaktifkan mode otomatis AI Nexara dengan fallback multi-provider.' },
  autoread: { description: 'Sinkronisasi Blue Tick Control WhatsApp ON/OFF dari dashboard dan bot.' },
  addredeem: { description: 'Wizard interaktif bertahap untuk membuat kode redeem dengan Balance, EXP, Level, dan reward tambahan dari Reward Registry.', example: '.addredeem' },
  editredeem: { description: 'Mengubah batas klaim, masa berlaku, atau status kode redeem yang sudah ada.', example: '.editredeem FREYAHUB50 max_claims=200' },
  inforedeem: { aliases: ['redeeminfo'], description: 'Menampilkan detail konfigurasi reward, kuota klaim, dan status kode redeem.', example: '.redeeminfo FREYAHUB50' },
  deleteredeem: { aliases: ['delredeem'], description: 'Menghapus kode redeem dari daftar aktif tanpa menghilangkan riwayat klaim.', example: '.delredeem KODE123' },
  redeemhistory: { description: 'Melihat log riwayat klaim kode redeem terbaru (berhasil, gagal, ditolak, kedaluwarsa).', example: '.redeemhistory FREYAHUB50' },
  redeemstats: { description: 'Menampilkan statistik ringkas klaim kode redeem dan distribusi hadiah.', example: '.redeemstats' },
  redeemdisable: { description: 'Menonaktifkan sementara kode redeem tertentu.', example: '.redeemdisable FREYAHUB50' },
  redeemenable: { description: 'Mengaktifkan kembali kode redeem tertentu.', example: '.redeemenable FREYAHUB50' },
  redeemreset: { description: 'Mereset counter klaim kode redeem dengan konfirmasi eksplisit.', example: '.redeemreset FREYAHUB50 confirm' },
};

const OWNER_COMMANDS: CommandDefinition[] = [
  ...OWNER_NAMES.map((name) => mk(name, 'OWNER', { isOwnerOnly: true, ...(OWNER_SPECIAL[name] ?? {}) })),
  ...OWNER_PREFIX_COMMANDS.map((name) =>
    mk(name, 'OWNER', {
      isOwnerOnly: true,
      description: `Owner Prefix Manager (${name}) untuk mengelola 10 prefix default & prefix tambahan.`,
      notes: 'Bagian 7.3 Owner Prefix Manager.',
    }),
  ),
];

// 9.8 RANDOM (21 commands)
const RANDOM_COMMANDS: CommandDefinition[] = [
  'alay', 'apakah', 'cekkhodam', 'faktaunik', 'husbu', 'jadian', 'kapankah',
  'katabijak', 'loli', 'neko', 'pantun', 'ppcouple', 'puisi', 'quotesanime',
  'randomanime', 'randommeme', 'randomnumber', 'randomtag', 'rate', 'siapakah',
  'waifu',
].map((name) =>
  mk(name, 'RANDOM', {
    description: `Generator konten acak ${name} dengan filter keamanan dan respons terstruktur.`,
  }),
);

// 9.9 SEARCH (19 commands)
const SEARCH_COMMANDS: CommandDefinition[] = [
  'alkitab', 'alquranaudio', 'artinama', 'brainly', 'cekidff', 'cekidml', 'cuaca',
  'googleimage', 'igstalk', 'ipchecker', 'jadwalshalat', 'lirik', 'otakudesu',
  'otakudesuinfo', 'otakudesuongoing', 'pinterest', 'play', 'wikipedia', 'ytsearch',
].map((name) =>
  mk(name, 'SEARCH', {
    description: `Pencarian informasi publik untuk modul ${name}.`,
    status: ['wikipedia', 'ipchecker', 'artinama', 'cuaca', 'jadwalshalat'].includes(name)
      ? 'active'
      : 'pending_integration',
    hasRealHandler: ['wikipedia', 'ipchecker', 'artinama', 'cuaca', 'jadwalshalat'].includes(name),
  }),
);

// 9.10 STICKER (23 commands)
const STICKER_COMMANDS: CommandDefinition[] = [
  'attp', 'brat', 'brat2', 'bratvideo', 'createstickerpack', 'delsetwm',
  'emojisticker', 'quickchat', 'semoji', 'semojimix', 'setwm', 'smeme', 'snobg',
  'sticker', 'stickercircle', 'stickerly', 'stickerwm', 'takesticker', 'telestick',
  'toimg', 'trigger', 'ttp', 'ziptelestick',
].map((name) =>
  mk(name, 'STICKER', {
    description: `Pengolah stiker WhatsApp (${name}) dengan dukungan metadata watermark.`,
    requiredPlugin: 'sticker-processor',
    status: ['setwm', 'delsetwm'].includes(name) ? 'active' : 'pending_integration',
    hasRealHandler: ['setwm', 'delsetwm'].includes(name),
  }),
);

// 9.11 TEXTMAKER (38 canonical commands)
const TEXTMAKER_CORRECTIONS: Record<string, string> = {
  avengers: 'Normalized spelling from source "avangers" to "avengers".',
  blackpink: 'Normalized spelling from source "blankpink" to "blackpink".',
};

const TEXTMAKER_COMMANDS: CommandDefinition[] = [
  'avengers', 'batman', 'bear', 'bisnissign', 'blackpink', 'bokeh', 'cartoon',
  'cloud', 'colorneon', 'deadpool', 'digitalglitch', 'dropwater', 'fflogo',
  'firework', 'glitch', 'glow', 'graffiti', 'greenneon', 'halloween', 'holo',
  'lightglow', 'magma', 'marvel', 'narutologo', 'neon', 'neonlight', 'pencil',
  'phlogo', 'pubglogo', 'sand', 'sky', 'spacetext', 'thor', 'thunder',
  'watercolor', 'wetglass', 'window', 'wolf',
].map((name) =>
  mk(name, 'TEXTMAKER', {
    description: `Pembuat teks bergaya visual "${name}" berbasis SVG/Canvas renderer.`,
    example: `.${name} Freya-san Hub`,
    sourceCorrection: TEXTMAKER_CORRECTIONS[name],
  }),
);

// 9.12 TOOLS (71 commands)
const TOOLS_NAMES: string[] = [
  'bass', 'blown', 'blur', 'bratbahlil', 'bratspongebob', 'cekplatform', 'confess',
  'dbase64', 'dec', 'deep', 'dhex', 'earrape', 'ebase64', 'ehex', 'enc',
  'fakebca', 'fakecall', 'fakechios', 'fakedana', 'fakegc', 'fakeml', 'fakeovo',
  'fakereply', 'fakestoryig', 'faketweet', 'fast', 'fat', 'folio', 'font',
  'halah', 'hartatahta', 'hdsw', 'hdvideo', 'heleh', 'hilih', 'holoh', 'huluh',
  'imagetopdf', 'iqc', 'iqcdark', 'iqcimage', 'iqcpink', 'kinetictext', 'kirim',
  'menfess', 'nightcore', 'nulis', 'ocr', 'poll', 'ptvtovideo', 'qrcode',
  'qrcodereader', 'readmore', 'readviewonce', 'removebackground', 'reverse',
  'robot', 'screenshot', 'shortlink', 'slow', 'smooth', 'spotifycard', 'swhd',
  'tiktokqc', 'tolive', 'tomp3', 'toquickvideo', 'tourl', 'toviewonce', 'tovn',
  'translate', 'tts', 'tts2', 'tupai', 'upscale', 'wait',
];

const TOOLS_SPECIAL: Record<string, Partial<CommandDefinition>> = {
  folio: {
    description: 'Mengubah teks dengan tag {judul}, {tengah}, {kiri}, {kanan}, {baris1/2/3}, {tebal}, {miring} menjadi dokumen kertas folio rapi.',
    example: '.folio {judul}SURAT RESMI\\n{baris2}\\nIsi paragraf.',
  },
  fakechios: {
    status: 'pending_specification',
    hasRealHandler: false,
    description: 'Pending specification — fungsi belum diuji owner; dibatasi label simulasi.',
  },
  deep: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi menunggu verifikasi implementasi audio/media.' },
  fast: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi menunggu verifikasi implementasi audio/media.' },
  slow: { status: 'pending_specification', hasRealHandler: false, description: 'Pending specification — fungsi menunggu verifikasi implementasi audio/media.' },
  kirim: { description: 'Mengirim pesan terstruktur ke nomor tujuan atau ke owner dengan kontrol konfirmasi & audit log.' },
  readviewonce: {
    description: 'Terbatas: menghormati privasi pesan sekali lihat; tidak melewati proteksi privasi WhatsApp.',
    notes: 'Security boundary enforced (Section 18).',
  },
  fakebca: { description: 'Simulasi visual edukatif berlabel SIMULASI; dilarang untuk bukti transaksi nyata.' },
  fakedana: { description: 'Simulasi visual edukatif berlabel SIMULASI; dilarang untuk bukti transaksi nyata.' },
  fakeovo: { description: 'Simulasi visual edukatif berlabel SIMULASI; dilarang untuk bukti transaksi nyata.' },
  fakeml: { description: 'Simulasi kartu profil berlabel SIMULASI.' },
  ebase64: { description: 'Encode teks ke Base64.' },
  dbase64: { description: 'Decode teks dari Base64.' },
  ehex: { description: 'Encode teks ke Hexadecimal.' },
  dhex: { description: 'Decode teks dari Hexadecimal.' },
  readmore: { description: 'Membuat pesan teks dengan pemisah "Baca Selengkapnya" WhatsApp.' },
  halah: { description: 'Mengubah huruf vokal teks menjadi huruf a.' },
  heleh: { description: 'Mengubah huruf vokal teks menjadi huruf e.' },
  hilih: { description: 'Mengubah huruf vokal teks menjadi huruf i.' },
  holoh: { description: 'Mengubah huruf vokal teks menjadi huruf o.' },
  huluh: { description: 'Mengubah huruf vokal teks menjadi huruf u.' },
  reverse: { description: 'Membalik urutan karakter teks.' },
  qrcode: { description: 'Membuat gambar QR Code dari teks atau tautan.' },
  cekplatform: { description: 'Menampilkan tipe perangkat/platform pengirim pesan.' },
  translate: { description: 'Menerjemahkan teks antar bahasa (ID / EN / JA).' },
};

const ACTIVE_TOOLS_SET = new Set([
  'folio', 'kirim', 'ebase64', 'dbase64', 'ehex', 'dhex', 'readmore',
  'halah', 'heleh', 'hilih', 'holoh', 'huluh', 'reverse', 'qrcode',
  'cekplatform', 'translate', 'font', 'poll', 'confess', 'menfess',
  'fakebca', 'fakedana', 'fakeovo', 'fakeml', 'fakereply', 'faketweet',
  'fakestoryig', 'fakegc', 'fakecall', 'readviewonce',
]);

const TOOLS_COMMANDS: CommandDefinition[] = TOOLS_NAMES.map((name) => {
  const override = TOOLS_SPECIAL[name] ?? {};
  const isPendingSpec = override.status === 'pending_specification';
  const hasReal = override.hasRealHandler ?? ACTIVE_TOOLS_SET.has(name);
  return mk(name, 'TOOLS', {
    status: isPendingSpec ? 'pending_specification' : hasReal ? 'active' : 'pending_integration',
    hasRealHandler: hasReal,
    ...override,
  });
});

// 48GROUP CENTER Dedicated Commands (Integrated with 48Group Intelligence & Game Center)
const FORTY_EIGHT_COMMANDS: CommandDefinition[] = [
  mk('48group', '48GROUP', { description: 'Menu utama 48Group Center (Intelligence Archive & Game Center).' }),
  mk('jkt48', '48GROUP', { description: 'Menampilkan profil JKT48, jadwal theater, dan member terverifikasi.' }),
  mk('akb48', '48GROUP', { description: 'Menampilkan profil AKB48 dan arsip resmi sister group.' }),
  mk('member48', '48GROUP', { description: 'Mencari profil member 48Group terverifikasi beserta sumber resmi.', example: '.member48 Freya' }),
  mk('theater48', '48GROUP', { description: 'Menampilkan daftar setlist dan arsip pertunjukan theater.' }),
  mk('istilah48', '48GROUP', { description: 'Kamus istilah 48Group (Jiko, Oshimen, Senbatsu, Kenkyuusei, dll.).', example: '.istilah48 oshimen' }),
  mk('memberquiz', '48GROUP', { description: 'Kuis profil member 48Group menggunakan data terverifikasi.' }),
  mk('groupquiz', '48GROUP', { description: 'Kuis pengetahuan grup dan sister group 48Group.' }),
  mk('songquiz', '48GROUP', { description: 'Kuis diskografi, single, center, dan tahun rilis 48Group.' }),
  mk('genchallenge', '48GROUP', { description: 'Tantangan sejarah dan urutan generasi 48Group.' }),
  mk('theaterchallenge', '48GROUP', { description: 'Kuis setlist dan lagu pertunjukan theater 48Group.' }),
  mk('timeline48', '48GROUP', { description: 'Permainan menyusun urutan peristiwa sejarah 48Group.' }),
  mk('guessmember48', '48GROUP', { description: 'Tebak member 48Group dengan petunjuk bertahap.' }),
  mk('daily48', '48GROUP', { description: 'Tantangan harian 48Group tanpa pengulangan soal berdekatan.' }),
  mk('werewolf48', '48GROUP', { description: 'Werewolf 48Group bertema Theater & Center dengan sesi terkelola server.' }),
  mk('mafia48', '48GROUP', { description: 'Mafia 48Group multipemain dalam room terpisah.' }),
];

export const ALL_COMMANDS: CommandDefinition[] = [
  ...AI_COMMANDS,
  ...DOWNLOAD_COMMANDS,
  ...GAME_COMMANDS,
  ...GENERAL_COMMANDS,
  ...GROUP_COMMANDS,
  ...INFO_COMMANDS,
  ...OWNER_COMMANDS,
  ...RANDOM_COMMANDS,
  ...SEARCH_COMMANDS,
  ...STICKER_COMMANDS,
  ...TEXTMAKER_COMMANDS,
  ...TOOLS_COMMANDS,
  ...FORTY_EIGHT_COMMANDS,
];

// Exact counts from Section 9 of the Master Prompt
export const SOURCE_CATEGORY_COUNTS: Record<CommandCategory, number> = {
  AI: 11,
  DOWNLOAD: 18,
  GAME: 38,
  GENERAL: 11,
  GROUP: 123,
  INFO: 18,
  OWNER: 163,
  RANDOM: 21,
  SEARCH: 19,
  STICKER: 23,
  TEXTMAKER: 38,
  TOOLS: 76,
  '48GROUP': 16,
};

export function generateInventoryAudit(): CommandAuditRow[] {
  const categories: CommandCategory[] = [
    'AI', 'DOWNLOAD', 'GAME', 'GENERAL', 'GROUP', 'INFO',
    'OWNER', 'RANDOM', 'SEARCH', 'STICKER', 'TEXTMAKER', 'TOOLS', '48GROUP',
  ];

  return categories.map((category) => {
    const items = ALL_COMMANDS.filter((c) => c.category === category);
    const realHandlers = items.filter((c) => c.hasRealHandler).length;
    const pending = items.filter(
      (c) => c.status === 'pending_specification' || c.status === 'pending_integration',
    ).length;

    return {
      category,
      sourceCount: items.length,
      registryCount: items.length,
      realHandlerCount: realHandlers,
      pendingCount: pending,
      status: items.length > 0 ? 'Audited' : 'Empty',
    };
  });
}

export function findCommandByNameOrAlias(
  query: string,
  commands: CommandDefinition[] = ALL_COMMANDS,
): CommandDefinition | undefined {
  const normalized = query.trim().toLowerCase();
  return commands.find(
    (c) =>
      c.name.toLowerCase() === normalized ||
      c.aliases.some((a) => a.toLowerCase() === normalized),
  );
}
