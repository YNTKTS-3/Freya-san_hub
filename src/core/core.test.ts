import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFIXES, parseCommandInput } from './prefixParser';
import { ALL_COMMANDS, findCommandByNameOrAlias, generateInventoryAudit } from './commandInventory';
import { parseFolioText } from './folioParser';
import {
  calculateQuizScore,
  canStartSessionInChat,
  filterVerifiedQuizQuestions,
  isIndonesianPhoneNumber,
  maskPhoneNumberForGroup,
  rollSloth,
  validateChatScopeIsolation,
} from './gameRules';

test('All 10 default prefixes work with and without space', () => {
  assert.equal(DEFAULT_PREFIXES.length, 10);
  for (const prefix of DEFAULT_PREFIXES) {
    const noSpace = parseCommandInput(`${prefix}menu halo dunia`, DEFAULT_PREFIXES);
    assert.equal(noSpace.isCommand, true, `Failed no-space for prefix ${prefix}`);
    assert.equal(noSpace.prefix, prefix);
    assert.equal(noSpace.hadSpaceAfterPrefix, false);
    assert.equal(noSpace.commandName, 'menu');
    assert.equal(noSpace.rawArgs, 'halo dunia');

    const withSpace = parseCommandInput(`${prefix} menu Halo Dunia`, DEFAULT_PREFIXES);
    assert.equal(withSpace.isCommand, true, `Failed with-space for prefix ${prefix}`);
    assert.equal(withSpace.prefix, prefix);
    assert.equal(withSpace.hadSpaceAfterPrefix, true);
    assert.equal(withSpace.commandName, 'menu');
    assert.equal(withSpace.rawArgs, 'Halo Dunia');
  }
});

test('Parser ignores mid-sentence punctuation and preserves argument casing', () => {
  const normalSentence = parseCommandInput('Halo Freya! Apa kabar? Ini email@contoh.com.', DEFAULT_PREFIXES);
  assert.equal(normalSentence.isCommand, false);

  const folioCmd = parseCommandInput('.folio {tengah}JUDUL SKRIPSI', DEFAULT_PREFIXES);
  assert.equal(folioCmd.isCommand, true);
  assert.equal(folioCmd.commandName, 'folio');
  assert.equal(folioCmd.rawArgs, '{tengah}JUDUL SKRIPSI');
});

test('Inventory audit preserves all categories, spelling corrections, and pending specs', () => {
  const audit = generateInventoryAudit();
  assert.equal(audit.length, 13);

  const claimCmd = findCommandByNameOrAlias('claimFreyasanredeem');
  assert.ok(claimCmd);
  assert.ok(claimCmd.aliases.includes('claimwibusoftredeem'));

  const avengers = findCommandByNameOrAlias('avengers');
  assert.ok(avengers);
  const blackpink = findCommandByNameOrAlias('blackpink');
  assert.ok(blackpink);

  for (const pendingName of ['spr', 'sprx', 'topeng', 'topengx']) {
    const cmd = findCommandByNameOrAlias(pendingName);
    assert.ok(cmd, `Missing ${pendingName}`);
    assert.equal(cmd.status, 'pending_specification');
  }
  const fakeChIos = findCommandByNameOrAlias('fakechios');
  assert.ok(fakeChIos);
  assert.equal(fakeChIos.status, 'active');

  // Ensure no duplicate canonical command names in ALL_COMMANDS
  const names = ALL_COMMANDS.map((c) => c.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('Folio parser handles alignment, blank lines, bold, italic, and title tags', () => {
  const doc = parseFolioText(
    '{tengah}JUDUL SKRIPSI\n{baris2}\nIsi paragraf pertama.\n{kanan}Jakarta, 13 Juni 2029\n{baris1}\n{kanan}{tebal}Nama User',
  );
  assert.equal(doc.lines.length, 4);
  assert.equal(doc.lines[0].align, 'center');
  assert.equal(doc.lines[0].text, 'JUDUL SKRIPSI');
  assert.equal(doc.lines[1].blankLinesBefore, 2);
  assert.equal(doc.lines[2].align, 'right');
  assert.equal(doc.lines[3].bold, true);
  assert.equal(doc.lines[3].blankLinesBefore, 1);
});

test('Game rules enforce single-session lock, scope isolation, verified-only 48Group questions, and scoring', () => {
  const lockCheck = canStartSessionInChat(
    [{ chatId: '1203630001@g.us', status: 'active' }],
    '1203630001@g.us',
  );
  assert.equal(lockCheck.allowed, false);

  const otherGroupCheck = canStartSessionInChat(
    [{ chatId: '1203630001@g.us', status: 'active' }],
    '1203630002@g.us',
  );
  assert.equal(otherGroupCheck.allowed, true);

  assert.equal(
    validateChatScopeIsolation('private', '628123@s.whatsapp.net', 'group', '1203@g.us'),
    false,
  );
  assert.equal(
    validateChatScopeIsolation('group', '1203@g.us', 'group', '1203@g.us'),
    true,
  );

  const filtered = filterVerifiedQuizQuestions([
    { id: 'q1', validationStatus: 'official_verified' },
    { id: 'q2', validationStatus: 'pending_review' },
    { id: 'q3', validationStatus: 'rumor' },
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'q1');

  assert.equal(calculateQuizScore({ difficulty: 'normal', isCorrect: false, hintsUsed: 0, elapsedSec: 5, maxTimeSec: 60 }), 0);
  const scoreNoHint = calculateQuizScore({ difficulty: 'normal', isCorrect: true, hintsUsed: 0, elapsedSec: 10, maxTimeSec: 60 });
  const scoreWithHint = calculateQuizScore({ difficulty: 'normal', isCorrect: true, hintsUsed: 1, elapsedSec: 10, maxTimeSec: 60 });
  assert.ok(scoreNoHint > scoreWithHint);

  assert.equal(isIndonesianPhoneNumber('+62 812-3456-7890'), true);
  assert.equal(isIndonesianPhoneNumber('085129878352'), true);
  assert.equal(isIndonesianPhoneNumber('+1 415 555 0101'), false);

  assert.equal(maskPhoneNumberForGroup('6281234567890'), '6281-****-890');

  const jackpot = rollSloth(() => 0.99);
  assert.equal(jackpot.isWin, true);
  assert.equal(jackpot.tier, 'jackpot');
});

import {
  JKT48_DIFFICULTY_LEVELS,
  JKT48_TEAM_GROUPS,
  JKT48_TEAMS,
  classifyDifficultyByYear,
  getTeamsByGroup,
} from './jkt48Classification';
import {
  REWARD_REGISTRY,
  getActiveRewardRegistry,
  renderRedeemMessage,
  validateRedeemConfiguration,
} from './redeemEngine';

test('JKT48 Difficulty Levels maintain strict Level 1 -> Level 2 -> Level 3 ordering and Team Groups', () => {
  assert.equal(JKT48_DIFFICULTY_LEVELS.length, 3);
  assert.equal(JKT48_DIFFICULTY_LEVELS[0].id, 'level_1');
  assert.equal(JKT48_DIFFICULTY_LEVELS[0].eraCategory, 'New Era – Fight Era');
  assert.equal(JKT48_DIFFICULTY_LEVELS[0].periodRange, '2022 – 2026');

  assert.equal(JKT48_DIFFICULTY_LEVELS[1].id, 'level_2');
  assert.equal(JKT48_DIFFICULTY_LEVELS[1].eraCategory, 'Era One');
  assert.equal(JKT48_DIFFICULTY_LEVELS[1].periodRange, '2021 – 2022');

  assert.equal(JKT48_DIFFICULTY_LEVELS[2].id, 'level_3');
  assert.equal(JKT48_DIFFICULTY_LEVELS[2].eraCategory, 'Group Release Era – Pre-One Era');
  assert.equal(JKT48_DIFFICULTY_LEVELS[2].periodRange, '2011 – 2021');

  assert.equal(classifyDifficultyByYear(2024), 'level_1');
  assert.equal(classifyDifficultyByYear(2021), 'level_2');
  assert.equal(classifyDifficultyByYear(2013), 'level_3');

  assert.deepEqual(JKT48_TEAM_GROUPS.map((g) => g.id), ['old', 'new', 'other']);
  assert.deepEqual(getTeamsByGroup('old').map((t) => t.name), ['Team J', 'Team KIII', 'Team T']);
  assert.deepEqual(getTeamsByGroup('new').map((t) => t.name), ['Team Love', 'Team Dream', 'Team Passion']);
  assert.deepEqual(getTeamsByGroup('other').map((t) => t.id), ['team_unassigned']);
  assert.equal(JKT48_TEAMS.length, 7);
});

test('Redeem Reward Registry excludes unimplemented handlers and validates configurations', () => {
  const active = getActiveRewardRegistry();
  assert.ok(active.length >= 4);
  assert.equal(active.some((r) => r.id === 'physical_merch_voucher'), false);
  assert.equal(REWARD_REGISTRY.some((r) => r.id === 'physical_merch_voucher' && !r.hasRealHandler), true);

  const rejectedUnimplemented = validateRedeemConfiguration({
    code: 'TESTCODE1',
    rewardBalance: 100,
    additionalRewards: [{ rewardId: 'physical_merch_voucher', params: {} }],
  });
  assert.equal(rejectedUnimplemented.ok, false);

  const rejectedZero = validateRedeemConfiguration({
    code: 'EMPTY1',
    rewardBalance: 0,
    rewardExp: 0,
    rewardLevel: 0,
    additionalRewards: [],
  });
  assert.equal(rejectedZero.ok, false);

  const valid = validateRedeemConfiguration({
    code: 'VALID2026',
    rewardBalance: 200,
    rewardExp: 100,
    rewardLevel: 1,
    maxClaims: 50,
    perUserLimit: 1,
    additionalRewards: [
      { rewardId: 'daily_limit_bonus', params: { amount: 15 } },
      { rewardId: 'badge_reward', params: { badgeName: 'Theater Fan', domain: '48group' } },
    ],
  });
  assert.equal(valid.ok, true);

  const msg = renderRedeemMessage('Halo {user}, kode {code} +{balance}', '', {
    user: 'Raka',
    code: 'FREYA',
    balance: 100,
  });
  assert.equal(msg, 'Halo Raka, kode FREYA +100');

  // Verify new owner redeem commands & aliases exist
  assert.ok(findCommandByNameOrAlias('addredeem'));
  assert.ok(findCommandByNameOrAlias('redeeminfo'));
  assert.ok(findCommandByNameOrAlias('delredeem'));
  assert.ok(findCommandByNameOrAlias('redeemhistory'));
  assert.ok(findCommandByNameOrAlias('redeemstats'));
  assert.ok(findCommandByNameOrAlias('redeemreset'));
});

import {
  buildMonthGridCells,
  buildMonthItemsMap,
  getNextBirthdayDate,
  getUpcomingHighlights,
  parseIsoDateParts,
} from './fortyEightCalendar';

test('48Group calendar highlights upcoming concert dates and recurring member birthdays accurately', () => {
  assert.deepEqual(parseIsoDateParts('2006-02-13'), { year: 2006, month: 2, day: 13 });
  assert.equal(parseIsoDateParts('Jadwal Mingguan Resmi'), null);

  const ref = { year: 2026, month: 11, day: 23 };
  const christyNext = getNextBirthdayDate({ year: 2005, month: 12, day: 5 }, ref);
  assert.deepEqual(christyNext.date, { year: 2026, month: 12, day: 5 });
  assert.equal(christyNext.daysUntil, 12);
  assert.equal(christyNext.turningAge, 21);

  const freyaNext = getNextBirthdayDate({ year: 2006, month: 2, day: 13 }, ref);
  assert.deepEqual(freyaNext.date, { year: 2027, month: 2, day: 13 });
  assert.equal(freyaNext.daysUntil, 82);

  const sampleEvents = [
    {
      id: 'evt-jkt48-anniv-2026',
      group_id: 'jkt48',
      title: 'JKT48 15th Anniversary Milestone',
      event_type: 'Konser / Anniversary',
      event_date: '2026-12-17',
      venue: 'Jakarta',
      summary: 'Anniversary',
      source_url: 'https://jkt48.com/',
    },
    {
      id: 'evt-weekly',
      group_id: 'jkt48',
      title: 'Theater Reguler',
      event_type: 'Theater',
      event_date: 'Jadwal Mingguan Resmi',
      venue: 'fX Sudirman',
      summary: 'Reguler',
      source_url: 'https://jkt48.com/',
    },
  ];
  const sampleMembers = [
    {
      id: 'jkt48-christy',
      name: 'Angelina Christy',
      nickname: 'Christy',
      group_id: 'jkt48',
      generation: 'Generasi 7',
      status: 'Member Aktif',
      birth_date: '2005-12-05',
      source_url: 'https://jkt48.com/',
    },
  ];

  const upcoming = getUpcomingHighlights({
    events: sampleEvents,
    members: sampleMembers,
    referenceDate: ref,
    filter: 'all',
    limit: 5,
  });
  assert.equal(upcoming.length, 2);
  assert.equal(upcoming[0].kind, 'birthday');
  assert.equal(upcoming[0].isoDate, '2026-12-05');
  assert.equal(upcoming[1].kind, 'concert');
  assert.equal(upcoming[1].isoDate, '2026-12-17');

  const decMap = buildMonthItemsMap({
    year: 2026,
    month: 12,
    events: sampleEvents,
    members: sampleMembers,
    referenceDate: ref,
    filter: 'all',
  });
  assert.equal(decMap.get('2026-12-05')?.[0]?.kind, 'birthday');
  assert.equal(decMap.get('2026-12-17')?.[0]?.kind, 'concert');

  const grid = buildMonthGridCells(2026, 12);
  assert.equal(grid.length % 7, 0);
  assert.ok(grid.some((c) => c.isoDate === '2026-12-17' && c.inCurrentMonth));
});

import { botText, findFormalIndonesianViolations, getJakartaDateKey, normalizeBotLang, shiftDateKey } from './botI18n';
import { TEBAK_EMOJI_SEED, UNDERCOVER_WORD_PAIRS_SEED } from './gameContentSeed';
import { FOLIO_GUIDE_ID } from './folioParser';

test('v5 core: natural botI18n, Jakarta date keys, seed counts (210 Undercover & 195 Tebak Emoji), and command aliases', () => {
  assert.equal(normalizeBotLang('ID'), 'id');
  assert.equal(normalizeBotLang('en-US'), 'en');
  assert.equal(normalizeBotLang('jp'), 'ja');
  assert.equal(botText('id').botFooter, 'Freya-san bot by Pak Ujan');
  assert.equal(botText('en').botFooter, 'Freya-san bot by Pak Ujan');
  assert.equal(botText('ja').botFooter, 'Freya-san bot by Pak Ujan');

  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.match(getJakartaDateKey(new Date('2026-11-25T10:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);

  assert.equal(UNDERCOVER_WORD_PAIRS_SEED.length, 210);
  assert.equal(TEBAK_EMOJI_SEED.length, 195);

  for (const name of [
    'streak',
    'streakgrup',
    'brat2',
    'bratbahlil',
    'bratspongebob',
    'bratspgbb',
    'fakeml',
    'tiktokqc',
    'iqcpink',
    'iqcdark',
    'iqcimage',
    'fakestoryig',
    'fakechios',
    'fakecall',
    'fakegc',
    'faketweet',
    'fakedana',
    'fakebca',
    'fakeovo',
    'spotifycard',
    'upswch',
    'tolive',
    'stickeraudio',
    'sa',
    'setbio',
    'undercover',
    'werewolf',
    'werewolf2',
    'ww2',
    'uno',
    'bom',
    'tebakemoji',
    'toplocal',
    'topglobal',
    'addlimit',
  ]) {
    const cmd = findCommandByNameOrAlias(name);
    assert.ok(cmd, `Expected command/alias ${name} in registry`);
    assert.equal(cmd.status, 'active', `Expected ${name} to be active`);
  }
});

test('v5.0.3 standard: zero formal Indonesian markers in botI18n, commands, folio guide, and reward registry', () => {
  const idCopy = botText('id');
  for (const [key, val] of Object.entries(idCopy)) {
    const sample =
      typeof val === 'function'
        ? (val as (...args: any[]) => string)('.', 'cmd', 5, 'reason')
        : String(val);
    assert.deepEqual(
      findFormalIndonesianViolations(sample),
      [],
      `Formal Indonesian found in botText('id').${key}: ${sample}`,
    );
  }

  for (const cmd of ALL_COMMANDS) {
    assert.deepEqual(
      findFormalIndonesianViolations(cmd.description),
      [],
      `Formal Indonesian found in command description for ${cmd.name}: ${cmd.description}`,
    );
  }

  assert.deepEqual(findFormalIndonesianViolations(FOLIO_GUIDE_ID), []);

  for (const r of REWARD_REGISTRY) {
    assert.deepEqual(
      findFormalIndonesianViolations(`${r.name} ${r.description}`),
      [],
      `Formal Indonesian found in REWARD_REGISTRY.${r.id}`,
    );
  }
});

