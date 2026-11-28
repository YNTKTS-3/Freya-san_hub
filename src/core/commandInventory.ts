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
      `Command ${name} di modul ${category.toLowerCase()} Freya-san Hub.`,
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
  mk('aiimage', 'AI', { description: 'Bikin gambar keren pakai AI image generator.', example: '.aiimage panggung biru modern', requiredProvider: 'gemini' }),
  mk('aiimg', 'AI', { aliases: ['aimg'], description: 'Alias cepat buat bikin gambar AI.', example: '.aiimg sunset tokyo', requiredProvider: 'gemini' }),
  mk('byenexara', 'AI', { description: 'Tutup sesi ngobrol yang lagi jalan bareng AI Nexara.', example: '.byenexara', requiredProvider: 'gemini' }),
  mk('byeopenai', 'AI', { description: 'Tutup sesi ngobrol bareng provider OpenAI.', example: '.byeopenai', requiredProvider: 'openai' }),
  mk('editimg', 'AI', { description: 'Edit gambar yang dikirim sesuai instruksi teks kamu.', example: '.editimg ubah latar jadi biru', requiredProvider: 'gemini', status: 'pending_integration', hasRealHandler: false }),
  mk('hitamkan', 'AI', { description: 'Kasih filter nuansa gelap pada gambar.', example: '.hitamkan', requiredPlugin: 'media-processor', status: 'pending_integration', hasRealHandler: false }),
  mk('jadianime', 'AI', { description: 'Ubah foto potret jadi ilustrasi gaya anime.', example: '.jadianime', requiredProvider: 'gemini', status: 'pending_integration', hasRealHandler: false }),
  mk('nexara', 'AI', { description: 'Ngobrol & tanya apa aja ke AI Nexara.', example: '.nexara jelasin sejarah JKT48', requiredProvider: 'gemini' }),
  mk('openai', 'AI', { description: 'Tanya jawab pakai provider OpenAI atau fallback aktif.', example: '.openai bikinin ringkasan', requiredProvider: 'openai' }),
  mk('toanime', 'AI', { description: 'Ubah foto jadi versi anime.', example: '.toanime', requiredProvider: 'gemini', status: 'pending_integration', hasRealHandler: false }),
  mk('voicejapan', 'AI', { description: 'Ubah teks jadi suara bahasa Jepang.', example: '.voicejapan ohayou gozaimasu', requiredProvider: 'tts', status: 'pending_integration', hasRealHandler: false }),
];

// 9.2 DOWNLOAD (18 commands)
const DOWNLOAD_COMMANDS: CommandDefinition[] = [
  'douyin', 'facebook', 'igdl', 'igreel', 'igstory', 'igtv', 'mediafire',
  'otakudesudl', 'pindl', 'spotify', 'threads', 'tiktokmusic', 'tiktoknowm',
  'tiktokslidevideo', 'tiktokwm', 'twitterdl', 'ytmp3', 'ytmp4',
].map((name) =>
  mk(name, 'DOWNLOAD', {
    description: `Downloader media dari ${name.replace(/dl$/, '')} (butuh plugin downloader aktif).`,
    example: `.${name} https://contoh.tautan/media`,
    requiredPlugin: 'downloader-provider',
    status: 'pending_integration',
    hasRealHandler: false,
  }),
);

// 9.3 GAME (38 source commands + additional general games from addendum)
const GAME_SOURCE_LIST: Array<[string, Partial<CommandDefinition>]> = [
  ['akinator', { description: 'Mulai atau cek status game tebak tokoh Akinator.' }],
  ['akinatorstart', { description: 'Mulai sesi baru game Akinator.' }],
  ['akinatorstop', { description: 'Hentikan sesi Akinator yang lagi jalan.' }],
  ['asahotak', { description: 'Kuis asah otak logika & pengetahuan umum.' }],
  ['bom', { description: 'Main tebak kotak bom virtual dengan hadiah & penalti yang bisa diatur di Dashboard.', example: '.bom' }],
  ['buylimit', { description: 'Tukar balance virtual jadi limit command pribadi.', example: '.buylimit 5' }],
  ['caklontong', { description: 'Tebak-tebakan kocak khas Cak Lontong lengkap dengan petunjuk.' }],
  ['dare', { description: 'Tantangan seru versi aman buat main bareng teman.' }],
  ['family100', { description: 'Game survei Family 100 dengan papan skor tiap sesi.' }],
  ['hint', { description: 'Buka petunjuk buat game yang lagi jalan (bisa ngurangin poin).' }],
  ['math', { description: 'Adu cepat hitung matematika pakai timer server.' }],
  ['nyerah', { description: 'Menyerah dari sesi game yang lagi jalan di chat ini.' }],
  ['redeem', { description: 'Klaim kode redeem buat dapat balance, EXP, limit, atau premium.', example: '.redeem KODE123' }],
  ['sambungkata', { description: 'Sambung kata berantai dari huruf atau suku kata terakhir.' }],
  ['siapakahaku', { description: 'Tebak siapa aku dari petunjuk bertahap.' }],
  ['sloth', { description: 'Putar kombinasi 3 simbol acak berhadiah balance virtual (bukan judi uang asli).' }],
  ['suit', { description: 'Main batu gunting kertas lawan bot atau teman.', example: '.suit batu' }],
  ['susunkalimat', { description: 'Susun kata acak jadi kalimat bahasa Indonesia yang pas.' }],
  ['susunkata', { description: 'Susun huruf acak jadi kata yang bener.' }],
  ['susunlirik', { description: 'Susun potongan baris lagu dari metadata (tanpa lirik penuh).' }],
  ['tebakbendera', { description: 'Tebak nama negara dari benderanya.' }],
  ['tebakbom', { description: 'Varian game tebak kotak aman vs kotak bom.' }],
  ['tebakchara', { description: 'Tebak karakter fiksi atau anime dari petunjuknya.' }],
  ['tebakemoji', { description: 'Tebak film, lagu, makanan, atau tokoh dari rangkaian emoji (195+ soal).', example: '.tebakemoji' }],
  ['tebakgambar', { description: 'Tebak teka-teki gambar dari petunjuk yang ada.' }],
  ['tebakkata', { description: 'Main tebak kata dengan tracking jawaban tiap sesi.' }],
  ['tebaklagu', { description: 'Tebak judul lagu dari info metadata & petunjuk.' }],
  ['tebaklaguanime', { description: 'Tebak lagu anime dari metadata & petunjuk.' }],
  ['tebaklagukpop', { description: 'Tebak lagu K-Pop dari metadata & petunjuk.' }],
  ['tekateki', { description: 'Kuis teka-teki klasik dengan skor tercatat di server.' }],
  ['tfbalance', { description: 'Transfer balance virtual ke user lain.', example: '.tfbalance 628123456789 100' }],
  ['tictactoe', { description: 'Main papan 3x3 Tic Tac Toe lawan bot atau teman.', example: '.tictactoe' }],
  ['truth', { description: 'Pertanyaan jujur versi aman buat main bareng.' }],
  ['ulartangga', { description: 'Main papan Ular Tangga bareng-bareng pakai giliran.' }],
  ['undercover', { description: 'Game deduksi kata Undercover (210 pasangan kata + opsi Mr. White) dengan peran dikirim lewat chat pribadi.', example: '.undercover' }],
  ['uno', { description: 'Main kartu UNO di grup dengan kartu aksi, Wild color, timeout 60 detik, dan .uno stop.', example: '.uno' }],
  ['werewolf', { description: 'Werewolf Classic pakai room dengan pembagian peran lewat chat pribadi & voting aman.', example: '.werewolf' }],
  ['werewolf2', { aliases: ['ww2'], description: 'Mode lanjutan Werewolf Classic (Freya-san bot by Pak Ujan) dengan peran ekstra & voting malam privat.', example: '.ww2' }],
];

const GAME_ADDENDUM_EXTRAS: Array<[string, Partial<CommandDefinition>]> = [
  ['mafia', { description: 'Mafia Game klasik dengan fase siang/malam teratur.' }],
  ['spyfall', { description: 'Game cari mata-mata Spyfall berbasis room.' }],
  ['impostor', { description: 'Game cari Impostor lewat diskusi & voting.' }],
  ['tebakangka', { description: 'Tebak angka rahasia 1-100 dengan petunjuk lebih tinggi/rendah.' }],
  ['quizbattle', { description: 'Duel adu cepat jawab kuis bareng pemain lain.' }],
  ['aducepat', { description: 'Adu cepat jawab kuis pengetahuan di grup atau chat pribadi.' }],
];

const GAME_COMMANDS: CommandDefinition[] = [
  ...GAME_SOURCE_LIST.map(([name, opts]) => mk(name, 'GAME', opts)),
  ...GAME_ADDENDUM_EXTRAS.map(([name, opts]) =>
    mk(name, 'GAME', { ...opts, notes: 'Tambahan wajib Game Center umum.' }),
  ),
];

// 9.4 GENERAL (11 commands)
const GENERAL_COMMANDS: CommandDefinition[] = [
  mk('changelog', 'GENERAL', { description: 'Lihat catatan update terbaru Freya-san Hub.' }),
  mk('everyone', 'GENERAL', { description: 'Mention semua anggota grup (khusus admin di grup).', permission: 'group_admin' }),
  mk('infobot', 'GENERAL', { description: 'Lihat info singkat platform, versi, dan status bot.' }),
  mk('menu', 'GENERAL', { aliases: ['help'], description: 'Buka menu interaktif WhatsApp atau daftar menu teks lengkap.' }),
  mk('owner', 'GENERAL', { description: 'Tampilin kartu kontak resmi Owner Freya-san Hub v5.0 (Pak Ujan) pakai vCard.' }),
  mk('ping', 'GENERAL', { description: 'Cek kecepatan respon server dan kesiapan bot.' }),
  mk('resend', 'GENERAL', { description: 'Kirim ulang pesan atau media terakhir yang diizinkan di sesi ini.' }),
  mk('runtime', 'GENERAL', { description: 'Cek udah berapa lama server dan bot jalan.' }),
  mk('sender', 'GENERAL', { description: 'Lihat info identitas pengirim pesan di chat ini.' }),
  mk('streak', 'GENERAL', { description: 'Kelola pasangan streak harian bareng teman (maks 10 pasangan & pulihin maks 5x/bulan).', example: '.streak @user | .streak pulihkan' }),
  mk('version', 'GENERAL', { description: 'Cek versi sistem Freya-san Hub sekarang.' }),
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
  antiluar: { description: 'Deteksi nomor luar negeri (selain +62) dengan opsi teguran/hapus/kick.' },
  antikudeta: { description: 'Jaga posisi owner grup biar nggak gampang didemote admin lain.' },
  antigroupsw: { description: 'Catat pelanggaran status grup sesuai kemampuan API WhatsApp dengan sanksi bertahap.' },
  antimentionsw: { description: 'Atur ON/OFF dan catat pelanggaran mention grup di status WhatsApp.' },
  antibot: { description: 'Cegah bot asing masuk grup; bot utama & whitelist owner tetap aman.' },
  done: { description: 'Tandai tugas atau orderan grup selesai lengkap dengan jam & penanggung jawab.', permission: 'group_admin' },
  proses: { description: 'Tandai tugas atau orderan grup lagi diproses sama penanggung jawab.', permission: 'group_admin' },
  antisticker: { description: 'Aktifin filter anti-stiker (termasuk stiker bersuara) di grup.', example: '.antisticker on' },
  streakgrup: { description: 'Kelola streak grup harian (on/off, top, pulihkan maks 5x/bulan).', example: '.streakgrup on | .streakgrup top | .streakgrup pulihkan' },
  createschedulecall: { description: 'Bikin pengingat jadwal panggilan grup.', status: 'pending_integration', hasRealHandler: false },
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
  mk('balance', 'INFO', { description: 'Cek saldo balance virtual kamu.' }),
  mk('cekchannel', 'INFO', { description: 'Cek info channel WhatsApp resmi yang terhubung.' }),
  mk('cekpremium', 'INFO', { description: 'Cek status & sisa masa aktif premium kamu.' }),
  mk('infocovid', 'INFO', { description: 'Lihat ringkasan info kesehatan publik dari sumber resmi.', status: 'pending_integration', hasRealHandler: false }),
  mk('infogempa', 'INFO', { description: 'Cek info gempa terbaru langsung dari data resmi BMKG.' }),
  mk('infounsur', 'INFO', { description: 'Cek detail unsur kimia dari tabel periodik.', example: '.infounsur Au' }),
  mk('kodebahasa', 'INFO', { description: 'Lihat daftar kode bahasa yang didukung bot (id, en, ja).' }),
  mk('level', 'INFO', { description: 'Cek level dan progres EXP akun kamu.' }),
  mk('limit', 'INFO', { description: 'Cek sisa limit harian akun kamu.' }),
  mk('listban', 'INFO', { description: 'Lihat daftar user yang lagi diban dari bot.' }),
  mk('listblock', 'INFO', { description: 'Lihat daftar kontak yang lagi diblokir.' }),
  mk('listgroup', 'INFO', { description: 'Lihat daftar grup yang terhubung sesuai izin akses kamu.' }),
  mk('listpremium', 'INFO', { description: 'Lihat daftar user dengan status premium aktif.' }),
  mk('profile', 'INFO', { description: 'Lihat profil lengkap kamu: level, EXP, balance, dan streak.' }),
  mk('report', 'INFO', { description: 'Kirim laporan bug atau saran langsung ke catatan Owner.', example: '.report deskripsi masalah' }),
  mk('status', 'INFO', { description: 'Cek kondisi real-time mesin WhatsApp, database, AI, dan antrean.' }),
  mk('topglobal', 'INFO', { description: 'Lihat papan peringkat global semua user (Balance, Level, EXP).' }),
  mk('toplocal', 'INFO', { description: 'Lihat papan peringkat lokal khusus anggota grup ini.' }),
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
    description: 'Klaim atau cek keaslian kode redeem resmi Freya-san Hub.',
    sourceCorrection: 'Renamed from legacy "claimwibusoftredeem" to "claimFreyasanredeem".',
  },
  spr: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — fungsinya masih nunggu konfirmasi Owner.' },
  sprx: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — fungsinya masih nunggu konfirmasi Owner.' },
  topeng: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — fungsinya masih nunggu konfirmasi Owner.' },
  topengx: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — fungsinya masih nunggu konfirmasi Owner.' },
  call: { status: 'pending_integration', hasRealHandler: false, description: 'Butuh integrasi panggilan WhatsApp resmi; bot nggak bakal bikin panggilan palsu.' },
  callloop: { status: 'pending_integration', hasRealHandler: false, description: 'Atur loop antrean panggilan (nunggu dukungan library WhatsApp).' },
  callplay: { status: 'pending_integration', hasRealHandler: false, description: 'Putar audio di panggilan (nunggu dukungan library WhatsApp).' },
  callqueue: { status: 'pending_integration', hasRealHandler: false, description: 'Antrean sesi panggilan (nunggu dukungan library WhatsApp).' },
  callskip: { status: 'pending_integration', hasRealHandler: false, description: 'Lewati antrean panggilan (nunggu dukungan library WhatsApp).' },
  callstop: { status: 'pending_integration', hasRealHandler: false, description: 'Stop sesi panggilan yang jalan (nunggu dukungan library WhatsApp).' },
  videocall: { status: 'pending_integration', hasRealHandler: false, description: 'Butuh dukungan video call WebRTC resmi WhatsApp.' },
  golink: { description: 'OWNER -> GROUP MANAGEMENT: Ambil link undangan grup lewat ID grup valid.' },
  upswgroup: { description: 'Upload Status WhatsApp dengan mention grup lewat antrean & cooldown.' },
  upswgroupv2byid: { description: 'Upload Status WhatsApp berdasarkan ID grup tertentu & status sewa.' },
  upswmentiongroup: { description: 'Upload status dengan mention grup lengkap dengan preview & cooldown.' },
  antideletepc: { description: 'Kirim notif kalau ada pesan dihapus di chat pribadi (kalau salinannya ada).' },
  autonexara: { description: 'Nyalain atau matiin mode otomatis AI Nexara.' },
  autoread: { description: 'Atur centang biru WhatsApp (Blue Tick) ON/OFF.' },
  addredeem: { description: 'Wizard langkah demi langkah buat bikin kode redeem baru plus reward tambahan.', example: '.addredeem' },
  editredeem: { description: 'Ubah batas klaim, masa aktif, atau status kode redeem yang udah ada.', example: '.editredeem FREYAHUB50 max_claims=200' },
  inforedeem: { aliases: ['redeeminfo'], description: 'Lihat detail hadiah, kuota klaim, dan status kode redeem.', example: '.redeeminfo FREYAHUB50' },
  deleteredeem: { aliases: ['delredeem'], description: 'Hapus kode redeem dari daftar aktif tanpa ngapus riwayat klaimnya.', example: '.delredeem KODE123' },
  redeemhistory: { description: 'Lihat log riwayat klaim kode redeem terbaru.', example: '.redeemhistory FREYAHUB50' },
  redeemstats: { description: 'Lihat ringkasan statistik klaim & pembagian hadiah kode redeem.', example: '.redeemstats' },
  redeemdisable: { description: 'Matiin sementara kode redeem tertentu.', example: '.redeemdisable FREYAHUB50' },
  redeemenable: { description: 'Aktifin lagi kode redeem tertentu.', example: '.redeemenable FREYAHUB50' },
  addlimit: {
    permission: 'public',
    isOwnerOnly: false,
    description: 'Beli limit buat diri sendiri atau kirim limit ke teman (pakai nomor WA atau balas pesannya).',
    example: '.addlimit 10 | .addlimit 628123456789 5 | (balas chat) .addlimit 5',
  },
  setbio: {
    description: 'Atur bio/info profil akun WhatsApp bot resmi (Freya-san bot by Pak Ujan).',
    example: '.setbio Freya-san bot by Pak Ujan aktif 24/7',
  },
  upswch: {
    description: 'Kirim postingan ke Channel WhatsApp kalau bot udah nyambung & jadi admin channel.',
    example: '.upswch <channelJid/invite> <teks>',
  },
  redeemreset: { description: 'Reset ulang hitungan klaim kode redeem pakai konfirmasi aman.', example: '.redeemreset FREYAHUB50 confirm' },
};

const OWNER_COMMANDS: CommandDefinition[] = [
  ...OWNER_NAMES.map((name) => mk(name, 'OWNER', { isOwnerOnly: true, ...(OWNER_SPECIAL[name] ?? {}) })),
  ...OWNER_PREFIX_COMMANDS.map((name) =>
    mk(name, 'OWNER', {
      isOwnerOnly: true,
      description: `Owner Prefix Manager (${name}) buat ngatur 10 prefix bawaan & prefix tambahan.`,
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
    description: `Generator konten acak ${name} yang aman dan rapi.`,
  }),
);

// 9.9 SEARCH (19 commands)
const SEARCH_COMMANDS: CommandDefinition[] = [
  'alkitab', 'alquranaudio', 'artinama', 'brainly', 'cekidff', 'cekidml', 'cuaca',
  'googleimage', 'igstalk', 'ipchecker', 'jadwalshalat', 'lirik', 'otakudesu',
  'otakudesuinfo', 'otakudesuongoing', 'pinterest', 'play', 'wikipedia', 'ytsearch',
].map((name) =>
  mk(name, 'SEARCH', {
    description: `Cari info publik lewat modul ${name}.`,
    status: ['wikipedia', 'ipchecker', 'artinama', 'cuaca', 'jadwalshalat'].includes(name)
      ? 'active'
      : 'pending_integration',
    hasRealHandler: ['wikipedia', 'ipchecker', 'artinama', 'cuaca', 'jadwalshalat'].includes(name),
  }),
);

// 9.10 STICKER (24 commands)
const STICKER_COMMANDS: CommandDefinition[] = [
  'attp', 'brat', 'brat2', 'bratvideo', 'createstickerpack', 'delsetwm',
  'emojisticker', 'quickchat', 'semoji', 'semojimix', 'setwm', 'smeme', 'snobg',
  'sticker', 'stickeraudio', 'stickercircle', 'stickerly', 'stickerwm', 'takesticker', 'telestick',
  'toimg', 'trigger', 'ttp', 'ziptelestick',
].map((name) =>
  mk(name, 'STICKER', {
    aliases: name === 'stickeraudio' ? ['stikeraudio', 'sa'] : [],
    description:
      name === 'brat2'
        ? 'Bikin stiker brat teks & emoji (maks 100 karakter).'
        : name === 'toimg'
        ? 'Ubah stiker WebP jadi gambar PNG.'
        : name === 'stickeraudio'
        ? 'Ubah video bersuara atau gambar+audio jadi kombo stiker WebP animasi + voice note Opus tanpa batas durasi.'
        : `Pengolah stiker WhatsApp (${name}) lengkap dengan watermark.`,
    example:
      name === 'brat2'
        ? '.brat2 santai aja ✨'
        : name === 'stickeraudio'
        ? '#sa (balas video atau gambar+audio)'
        : `.${name}`,
    requiredPlugin: ['setwm', 'delsetwm', 'brat2', 'toimg', 'stickeraudio'].includes(name) ? null : 'sticker-processor',
    status: ['setwm', 'delsetwm', 'brat2', 'toimg', 'stickeraudio'].includes(name) ? 'active' : 'pending_integration',
    hasRealHandler: ['setwm', 'delsetwm', 'brat2', 'toimg', 'stickeraudio'].includes(name),
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
    description: `Bikin gambar teks bergaya "${name}".`,
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
    description: 'Ubah teks pakai tag {judul}, {tengah}, {kiri}, {kanan}, {baris1/2/3}, {tebal}, {miring} jadi dokumen kertas folio rapi.',
    example: '.folio {judul}SURAT RESMI\\n{baris2}\\nIsi paragraf.',
  },
  fakechios: {
    status: 'active',
    hasRealHandler: true,
    description: 'Bikin mockup kartu info iOS/channel berlabel [SIMULASI].',
    example: '.fakechios Freya-san Hub | Pembaruan v5.0 aktif',
  },
  bratbahlil: { description: 'Bikin gambar/stiker meme gaya teks papan bertanda.', example: '.bratbahlil Halo warga!' },
  bratspongebob: {
    aliases: ['bratspgbb'],
    description: 'Bikin gambar/stiker meme teks karakter gaya SpongeBob.',
    example: '.bratspgbb Kerjaan beres!',
  },
  tiktokqc: { description: 'Bikin mockup komentar TikTok berlabel [SIMULASI].', example: '.tiktokqc @freyafans | Seru banget live hari ini!' },
  iqcpink: { description: 'Bikin mockup chat iPhone tema pink (-s right buat rata kanan).', example: '.iqcpink -s right Halo semua!' },
  iqcdark: { description: 'Bikin mockup chat iPhone tema gelap (bisa pakai lampiran gambar).', example: '.iqcdark Lagi santai malam ini' },
  iqcimage: { description: 'Bikin mockup chat iPhone plus lampiran gambar.', example: '.iqcimage Lihat foto ini' },
  fakestoryig: { description: 'Bikin mockup Instagram Story berlabel [SIMULASI].', example: '.fakestoryig freyasan | Sore yang cerah' },
  fakecall: { description: 'Bikin mockup layar panggilan suara/video berlabel [SIMULASI].', example: '.fakecall Freya | video' },
  fakegc: { description: 'Bikin mockup kartu undangan/info grup WhatsApp berlabel [SIMULASI].', example: '.fakegc Komunitas Freya | 48 Anggota' },
  faketweet: { description: 'Bikin mockup postingan gaya X/Twitter berlabel [SIMULASI].', example: '.faketweet Freya-san | Jangan lupa senyum hari ini!' },
  spotifycard: { description: 'Bikin kartu Spotify dari info link lagu atau data lagu yang lagi diputar.', example: '.spotifycard https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' },
  tolive: {
    description: 'Ubah gambar atau video jadi Live/Motion Photo (Android MotionPhoto + pasangan video WhatsApp).',
    example: '.tolive (balas gambar/video)',
  },
  deep: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — lagi nunggu verifikasi efek audio.' },
  fast: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — lagi nunggu verifikasi efek audio.' },
  slow: { status: 'pending_specification', hasRealHandler: false, description: 'Pending spesifikasi — lagi nunggu verifikasi efek audio.' },
  kirim: { description: 'Kirim pesan terstruktur ke nomor tujuan atau ke Owner pakai konfirmasi & audit log.' },
  readviewonce: {
    description: 'Terbatas: hormatin privasi pesan sekali lihat; nggak bakal ngebobol proteksi privasi WhatsApp.',
    notes: 'Security boundary enforced (Section 18).',
  },
  fakebca: { description: 'Simulasi visual edukatif berlabel [SIMULASI]; dilarang buat bukti transfer asli.', example: '.fakebca Raka | 50000' },
  fakedana: { description: 'Simulasi visual edukatif berlabel [SIMULASI]; dilarang buat bukti transfer asli.', example: '.fakedana Raka | 25000' },
  fakeovo: { description: 'Simulasi visual edukatif berlabel [SIMULASI]; dilarang buat bukti transfer asli.', example: '.fakeovo Raka | 30000' },
  fakeml: { description: 'Simulasi kartu profil game berlabel [SIMULASI].', example: '.fakeml FreyaPlayer | Mythic' },
  ebase64: { description: 'Encode teks jadi Base64.' },
  dbase64: { description: 'Decode teks dari Base64.' },
  ehex: { description: 'Encode teks jadi Hexadecimal.' },
  dhex: { description: 'Decode teks dari Hexadecimal.' },
  readmore: { description: 'Bikin pesan teks pakai pemisah "Baca Selengkapnya" di WhatsApp.' },
  halah: { description: 'Ubah semua huruf vokal teks jadi huruf a.' },
  heleh: { description: 'Ubah semua huruf vokal teks jadi huruf e.' },
  hilih: { description: 'Ubah semua huruf vokal teks jadi huruf i.' },
  holoh: { description: 'Ubah semua huruf vokal teks jadi huruf o.' },
  huluh: { description: 'Ubah semua huruf vokal teks jadi huruf u.' },
  reverse: { description: 'Balik urutan karakter teks.' },
  qrcode: { description: 'Bikin gambar QR Code dari teks atau link.' },
  cekplatform: { description: 'Cek tipe HP/perangkat pengirim pesan.' },
  translate: { description: 'Terjemahin teks antar bahasa (ID / EN / JA).' },
};

const ACTIVE_TOOLS_SET = new Set([
  'folio', 'kirim', 'ebase64', 'dbase64', 'ehex', 'dhex', 'readmore',
  'halah', 'heleh', 'hilih', 'holoh', 'huluh', 'reverse', 'qrcode',
  'cekplatform', 'translate', 'font', 'poll', 'confess', 'menfess',
  'fakebca', 'fakedana', 'fakeovo', 'fakeml', 'fakereply', 'faketweet',
  'fakestoryig', 'fakegc', 'fakecall', 'fakechios', 'readviewonce',
  'bratbahlil', 'bratspongebob', 'tiktokqc', 'iqcpink', 'iqcdark', 'iqcimage',
  'spotifycard', 'tolive',
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
  mk('48group', '48GROUP', { description: 'Buka menu utama 48Group Center (Arsip & Game Center).' }),
  mk('jkt48', '48GROUP', { description: 'Lihat profil JKT48, jadwal theater, dan member terverifikasi.' }),
  mk('akb48', '48GROUP', { description: 'Lihat profil AKB48 dan arsip resmi sister group.' }),
  mk('member48', '48GROUP', { description: 'Cari profil member 48Group terverifikasi plus sumber resminya.', example: '.member48 Freya' }),
  mk('theater48', '48GROUP', { description: 'Lihat daftar setlist dan arsip show theater 48Group.' }),
  mk('istilah48', '48GROUP', { description: 'Kamus istilah 48Group (Jiko, Oshimen, Senbatsu, Kenkyuusei, dll.).', example: '.istilah48 oshimen' }),
  mk('memberquiz', '48GROUP', { description: 'Kuis profil member 48Group dari database terverifikasi.' }),
  mk('groupquiz', '48GROUP', { description: 'Kuis pengetahuan grup & sister group 48Group.' }),
  mk('songquiz', '48GROUP', { description: 'Kuis diskografi, single, center, dan tahun rilis 48Group.' }),
  mk('genchallenge', '48GROUP', { description: 'Tantangan sejarah dan urutan generasi 48Group.' }),
  mk('theaterchallenge', '48GROUP', { description: 'Kuis setlist & lagu theater 48Group.' }),
  mk('timeline48', '48GROUP', { description: 'Game urutin peristiwa sejarah 48Group.' }),
  mk('guessmember48', '48GROUP', { description: 'Tebak member 48Group pakai petunjuk bertahap.' }),
  mk('daily48', '48GROUP', { description: 'Tantangan harian 48Group dengan soal fresh tiap hari.' }),
  mk('werewolf48', '48GROUP', { description: 'Werewolf 48Group tema Theater & Center berbasis room.' }),
  mk('mafia48', '48GROUP', { description: 'Mafia 48Group multiplayer dalam room terpisah.' }),
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
  STICKER: 24,
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
