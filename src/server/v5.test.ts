import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyUserBalanceAndExp, db, runMigrations, seedDatabase } from './db';
import { validatePairingPhoneNumber, whatsappEngine } from './whatsappEngine';
import {
  clearRateLimitBucketsForTests,
  recordAbuseEvent,
  setAbuseRestrictionAction,
} from './abuseService';
import {
  ensureUserRecord,
  executeAddLimit,
  formatLeaderboardMessage,
  getBomConfig,
  getLimitConfig,
  getUserRankPosition,
  isUserPremiumValid,
  setUserPremiumStatus,
  updateBomConfig,
} from './economyService';
import {
  invitePairStreak,
  recordGroupStreakBotInteraction,
  recordPairStreakMutualInteraction,
  respondPairStreakInvite,
  restoreGroupStreak,
  restorePairStreak,
  setGroupStreakEnabled,
} from './streakService';
import {
  buildUnoCardMetadata,
  canPlayUnoCard,
  checkUnoSessionTimeout,
  resolveStickerToUnoCard,
  resetGameQueueDelayRangeForTests,
  setGameQueueDelayRangeForTests,
} from './multiplayerGames';
import { startGameSession, submitGameAction } from './gameEngine';
import { generateBratSticker, generateMockupImage } from './mediaService';
import {
  buildBaileysListPayload,
  buildMenuPayload,
  formatMenuFallbackText,
  issueMenuSession,
  listMenuFallbackLogs,
  recordMenuFallbackLog,
  resolveMenuSelection,
} from './menuService';
import { findFormalIndonesianViolations } from '../core/botI18n';

runMigrations();
seedDatabase();

const TEST_GROUP_1 = '999000111@g.us';
const TEST_GROUP_2 = '999000222@g.us';
const TEST_PHONES = [
  '628990001001',
  '628990001002',
  '628990001003',
  '628990001004',
  '628990001005',
  '628990001006',
  '628990001007',
  '628990001008',
  '628990001009',
  '628990001010',
  '628990001011',
  '628990001012',
];

const originalBomCfg = getBomConfig();

function cleanupTestEntities() {
  const placeholders = TEST_PHONES.map(() => '?').join(',');
  db.prepare(`DELETE FROM users WHERE phone IN (${placeholders})`).run(...TEST_PHONES);
  db.prepare(`DELETE FROM abuse_restrictions WHERE user_phone IN (${placeholders})`).run(...TEST_PHONES);
  db.prepare(`DELETE FROM abuse_events WHERE user_phone IN (${placeholders})`).run(...TEST_PHONES);
  db.prepare(`DELETE FROM limit_transactions WHERE actor_phone IN (${placeholders}) OR target_phone IN (${placeholders})`).run(
    ...TEST_PHONES,
    ...TEST_PHONES,
  );
  db.prepare(`DELETE FROM pair_streaks WHERE user_a IN (${placeholders}) OR user_b IN (${placeholders})`).run(
    ...TEST_PHONES,
    ...TEST_PHONES,
  );
  db.prepare(`DELETE FROM pair_streak_restores WHERE restored_by IN (${placeholders})`).run(...TEST_PHONES);
  db.prepare(`DELETE FROM group_members WHERE group_id IN (?, ?)`).run(TEST_GROUP_1, TEST_GROUP_2);
  db.prepare(`DELETE FROM group_streaks WHERE group_id IN (?, ?)`).run(TEST_GROUP_1, TEST_GROUP_2);
  db.prepare(`DELETE FROM group_streak_daily_logs WHERE group_id IN (?, ?)`).run(TEST_GROUP_1, TEST_GROUP_2);
  db.prepare(`DELETE FROM group_streak_restores WHERE group_id IN (?, ?)`).run(TEST_GROUP_1, TEST_GROUP_2);
  db.prepare(`DELETE FROM groups WHERE id IN (?, ?)`).run(TEST_GROUP_1, TEST_GROUP_2);
  const privateChats = TEST_PHONES.map((p) => `${p}@s.whatsapp.net`);
  const chatIds = [TEST_GROUP_1, TEST_GROUP_2, ...privateChats];
  const chatPlaceholders = chatIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM game_sessions WHERE chat_id IN (${chatPlaceholders})`).run(...chatIds);
  db.prepare(`DELETE FROM game_scores WHERE user_phone IN (${placeholders})`).run(...TEST_PHONES);
  db.prepare(`DELETE FROM whatsapp_menu_sessions WHERE user_phone IN (${placeholders})`).run(...TEST_PHONES);
  db.prepare(`DELETE FROM menu_fallback_logs WHERE chat_id IN (?, ?, ?, ?)`).run(
    TEST_GROUP_1,
    TEST_GROUP_2,
    `${TEST_PHONES[0]}@s.whatsapp.net`,
    `${TEST_PHONES[10]}@s.whatsapp.net`,
  );
}

beforeEach(() => {
  cleanupTestEntities();
  clearRateLimitBucketsForTests();
  setGameQueueDelayRangeForTests(0, 0);
  for (const p of TEST_PHONES) {
    ensureUserRecord(p, `User ${p.slice(-3)}`);
  }
});

after(() => {
  cleanupTestEntities();
  clearRateLimitBucketsForTests();
  resetGameQueueDelayRangeForTests();
  updateBomConfig(originalBomCfg);
  db.prepare(`UPDATE settings SET value = 'id', updated_at = datetime('now') WHERE key = 'default_language'`).run();
});

test('1 & 2. Limit system: initial limit is 50, premium preserves remaining limit & #addlimit works in 3 modes', () => {
  const userA = ensureUserRecord(TEST_PHONES[0], 'Tester A');
  const userB = ensureUserRecord(TEST_PHONES[1], 'Tester B');
  assert.equal(userA.daily_limit, 50);

  db.prepare('UPDATE users SET daily_limit = 35 WHERE phone = ?').run(userA.phone);
  applyUserBalanceAndExp(userA.phone, 'Tester A', 1000, 0, 'Test fund');

  // Grant premium then remove premium -> remaining 35 is preserved!
  setUserPremiumStatus(userA.phone, true, new Date(Date.now() + 86400_000).toISOString());
  assert.equal(isUserPremiumValid(ensureUserRecord(userA.phone)), true);
  setUserPremiumStatus(userA.phone, false, null);
  assert.equal(ensureUserRecord(userA.phone).daily_limit, 35);

  // Mode 1: #addlimit self-topup using balance
  const price = getLimitConfig().pricePerUnit;
  const selfBuy = executeAddLimit({
    actorPhone: userA.phone,
    mode: 'self',
    amount: 5,
    idempotencyKey: 'tx-self-1',
  });
  assert.equal(selfBuy.ok, true);
  assert.equal(ensureUserRecord(userA.phone).daily_limit, 40);
  // Balance starts at 100 + 1000 = 1100; spent 5 * price
  assert.equal(ensureUserRecord(userA.phone).balance, 1100 - 5 * price);

  // Mode 2 & 3: Owner grant by phone idempotently
  const ownerAdd = executeAddLimit({
    actorPhone: TEST_PHONES[2],
    mode: 'phone',
    targetPhoneRaw: userB.phone,
    amount: 12,
    idempotencyKey: 'tx-owner-1',
    skipBalanceChargeForOwner: true,
  });
  assert.equal(ownerAdd.ok, true);
  assert.equal(ensureUserRecord(userB.phone).daily_limit, 62);

  // Idempotent replay with same idempotencyKey does NOT double-credit!
  executeAddLimit({
    actorPhone: TEST_PHONES[2],
    mode: 'phone',
    targetPhoneRaw: userB.phone,
    amount: 12,
    idempotencyKey: 'tx-owner-1',
    skipBalanceChargeForOwner: true,
  });
  assert.equal(ensureUserRecord(userB.phone).daily_limit, 62);
});

test('3 & 4. Pair Streak & Group Streak rules, bot rejection, consent & 5x/month restore cap', () => {
  const botReject = invitePairStreak({
    initiatorPhone: TEST_PHONES[0],
    partnerPhone: 'minbot',
  });
  assert.equal(botReject.ok, false);
  assert.equal(botReject.ignoredBot, true);

  const p0 = TEST_PHONES[0];
  for (let i = 1; i <= 10; i++) {
    const inv = invitePairStreak({
      initiatorPhone: p0,
      partnerPhone: TEST_PHONES[i],
      todayKey: '2026-11-20',
    });
    assert.equal(inv.ok, true, `Invite ${i} failed`);
    const selfAcc = respondPairStreakInvite({
      responderPhone: p0,
      accept: true,
      initiatorHintPhone: TEST_PHONES[i],
      todayKey: '2026-11-20',
    });
    assert.equal(selfAcc.ok, false);
    const partnerAcc = respondPairStreakInvite({
      responderPhone: TEST_PHONES[i],
      accept: true,
      initiatorHintPhone: p0,
      todayKey: '2026-11-20',
    });
    assert.equal(partnerAcc.ok, true);
  }
  const over10 = invitePairStreak({ initiatorPhone: p0, partnerPhone: TEST_PHONES[11], todayKey: '2026-11-20' });
  assert.equal(over10.ok, false);

  // Mutual interaction: BOTH users ping each other on 2026-11-21 to increment streak to 2
  recordPairStreakMutualInteraction({
    senderPhone: p0,
    targetPhones: [TEST_PHONES[1]],
    todayKey: '2026-11-21',
  });
  recordPairStreakMutualInteraction({
    senderPhone: TEST_PHONES[1],
    targetPhones: [p0],
    todayKey: '2026-11-21',
  });
  const streakRow = db
    .prepare(`SELECT * FROM pair_streaks WHERE pair_key = ?`)
    .get(`${p0}::${TEST_PHONES[1]}`) as any;
  assert.equal(streakRow.current_streak, 2);

  // Same-day restore max 5 times/month after 1 missed day
  for (let r = 1; r <= 5; r++) {
    db.prepare(`UPDATE pair_streaks SET last_active_date = '2026-11-21' WHERE id = ?`).run(streakRow.id);
    const resRestore = restorePairStreak({
      userPhone: p0,
      partnerPhoneHint: TEST_PHONES[1],
      todayKey: '2026-11-23',
    });
    assert.equal(resRestore.ok, true, `Restore #${r} should succeed`);
  }
  db.prepare(`UPDATE pair_streaks SET last_active_date = '2026-11-21' WHERE id = ?`).run(streakRow.id);
  const blocked6 = restorePairStreak({
    userPhone: p0,
    partnerPhoneHint: TEST_PHONES[1],
    todayKey: '2026-11-23',
  });
  assert.equal(blocked6.ok, false);

  // Group streak: 3 unique users OR 5 bot interactions
  setGroupStreakEnabled(TEST_GROUP_1, true);
  for (let c = 1; c <= 4; c++) {
    const r = recordGroupStreakBotInteraction({ groupId: TEST_GROUP_1, userPhone: TEST_PHONES[0], todayKey: '2026-11-20' });
    assert.equal(r.activatedToday, false);
  }
  const hit5 = recordGroupStreakBotInteraction({ groupId: TEST_GROUP_1, userPhone: TEST_PHONES[0], todayKey: '2026-11-20' });
  assert.equal(hit5.activatedToday, true);

  setGroupStreakEnabled(TEST_GROUP_2, true);
  recordGroupStreakBotInteraction({ groupId: TEST_GROUP_2, userPhone: TEST_PHONES[0], todayKey: '2026-11-20' });
  recordGroupStreakBotInteraction({ groupId: TEST_GROUP_2, userPhone: TEST_PHONES[1], todayKey: '2026-11-20' });
  const hit3Users = recordGroupStreakBotInteraction({ groupId: TEST_GROUP_2, userPhone: TEST_PHONES[2], todayKey: '2026-11-20' });
  assert.equal(hit3Users.activatedToday, true);

  db.prepare(`UPDATE group_streaks SET last_active_date = '2026-11-18' WHERE group_id = ?`).run(TEST_GROUP_2);
  const grpRestore = restoreGroupStreak({ groupId: TEST_GROUP_2, actorPhone: TEST_PHONES[0], todayKey: '2026-11-20' });
  assert.equal(grpRestore.ok, true);
});

test('5. Leaderboard sorting, 1-based ranking, and strict group isolation', () => {
  db.prepare(`UPDATE users SET display_name = 'Alpha', balance = 500, level = 2, exp = 100 WHERE phone = ?`).run(TEST_PHONES[0]);
  db.prepare(`UPDATE users SET display_name = 'Beta', balance = 900, level = 3, exp = 50 WHERE phone = ?`).run(TEST_PHONES[1]);
  db.prepare(`UPDATE users SET display_name = 'Gamma', balance = 999999, level = 10, exp = 500 WHERE phone = ?`).run(TEST_PHONES[2]);

  db.prepare(`INSERT INTO groups (id, name, member_count) VALUES (?, 'Group One', 2) ON CONFLICT(id) DO NOTHING`).run(TEST_GROUP_1);
  db.prepare(`INSERT INTO groups (id, name, member_count) VALUES (?, 'Group Two', 1) ON CONFLICT(id) DO NOTHING`).run(TEST_GROUP_2);
  db.prepare(`INSERT OR REPLACE INTO group_members (group_id, user_phone) VALUES (?, ?), (?, ?)`).run(
    TEST_GROUP_1,
    TEST_PHONES[0],
    TEST_GROUP_1,
    TEST_PHONES[1],
  );
  db.prepare(`INSERT OR REPLACE INTO group_members (group_id, user_phone) VALUES (?, ?)`).run(TEST_GROUP_2, TEST_PHONES[2]);

  const localText = formatLeaderboardMessage({ scope: 'local', groupId: TEST_GROUP_1, requesterPhone: TEST_PHONES[0], lang: 'id' });
  assert.match(localText, /^[\s\S]*1\./m);
  assert.ok(!localText.includes('Gamma'), 'Group Two user must NEVER leak into Group One toplocal');
  assert.equal(getUserRankPosition('local', TEST_PHONES[1], TEST_GROUP_1), 1);

  const globalText = formatLeaderboardMessage({ scope: 'global', requesterPhone: TEST_PHONES[2], lang: 'id' });
  assert.ok(globalText.includes('Gamma'));
  assert.equal(getUserRankPosition('global', TEST_PHONES[2]), 1);
});

test('6 & 7. 5-wrong-answer cap on Q&A games + configurable Bom game with negative balance & cashout', () => {
  const quizStart = startGameSession({
    gameId: 'tebakemoji',
    chatScope: 'group',
    chatId: TEST_GROUP_1,
    groupName: 'Grup Quiz',
    hostPhone: TEST_PHONES[0],
    hostName: 'Tester',
  });
  assert.equal(quizStart.ok, true);
  assert.ok(quizStart.sessionId);

  for (let i = 1; i <= 4; i++) {
    const wrong = submitGameAction({
      sessionId: quizStart.sessionId!,
      chatScope: 'group',
      chatId: TEST_GROUP_1,
      playerPhone: TEST_PHONES[0],
      playerName: 'Tester',
      input: `salah-${i}`,
    });
    assert.equal(wrong.sessionStatus, 'active');
  }
  const fifthWrong = submitGameAction({
    sessionId: quizStart.sessionId!,
    chatScope: 'group',
    chatId: TEST_GROUP_1,
    playerPhone: TEST_PHONES[0],
    playerName: 'Tester',
    input: 'salah-5',
  });
  assert.equal(fifthWrong.sessionStatus, 'completed');
  assert.match(fifthWrong.announcement || '', /Batas salah habis|salah tercapai|Jawaban yang benar/i);

  // Set player balance to 10 so bomb penalty (-80) after partial reward (+15) cleanly produces negative balance (-55)
  db.prepare('UPDATE users SET balance = 10 WHERE phone = ?').run(TEST_PHONES[1]);
  updateBomConfig({ gridSize: 8, bombCount: 2, rewardPerStep: 30, clearBonus: 150, bombPenalty: 80, partialRewardPct: 50 });
  const bomStart = startGameSession({
    gameId: 'bom',
    chatScope: 'group',
    chatId: TEST_GROUP_1,
    groupName: 'Grup Bom',
    hostPhone: TEST_PHONES[1],
    hostName: 'Bomber',
  });
  assert.equal(bomStart.ok, true);
  const rawRow = db.prepare(`SELECT state_json FROM game_sessions WHERE id = ?`).get(bomStart.sessionId) as { state_json: string };
  const parsed = JSON.parse(rawRow.state_json);
  const safeCell = parsed.board.findIndex((_: any, i: number) => !parsed.bombIndexes.includes(i));
  const bombCell = parsed.bombIndexes[0];

  const openSafe = submitGameAction({
    sessionId: bomStart.sessionId!,
    chatScope: 'group',
    chatId: TEST_GROUP_1,
    playerPhone: TEST_PHONES[1],
    playerName: 'Bomber',
    input: String(safeCell + 1),
  });
  assert.equal(openSafe.sessionStatus, 'active');

  const hitBomb = submitGameAction({
    sessionId: bomStart.sessionId!,
    chatScope: 'group',
    chatId: TEST_GROUP_1,
    playerPhone: TEST_PHONES[1],
    playerName: 'Bomber',
    input: String(bombCell + 1),
  });
  assert.equal(hitBomb.sessionStatus, 'completed');
  const bomberAfter = ensureUserRecord(TEST_PHONES[1]);
  assert.equal(bomberAfter.balance, -55);
});

test('8. Undercover staggered private roles & Werewolf2 exact footer "Freya-san bot by Pak Ujan"', async () => {
  const wwStart = await whatsappEngine.processIncomingMessage({
    chatId: TEST_GROUP_1,
    chatScope: 'group',
    groupName: 'Grup WW2',
    senderPhone: TEST_PHONES[0],
    senderName: 'Host',
    text: '#ww2',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.match(wwStart.replyText, /Freya-san bot by Pak Ujan/);

  for (let i = 1; i <= 3; i++) {
    await whatsappEngine.processIncomingMessage({
      chatId: TEST_GROUP_1,
      chatScope: 'group',
      groupName: 'Grup WW2',
      senderPhone: TEST_PHONES[i],
      senderName: `P${i}`,
      text: 'gabung',
      isGroupAdmin: false,
      source: 'simulator',
    });
  }
  clearRateLimitBucketsForTests();
  const wwBegin = await whatsappEngine.processIncomingMessage({
    chatId: TEST_GROUP_1,
    chatScope: 'group',
    groupName: 'Grup WW2',
    senderPhone: TEST_PHONES[0],
    senderName: 'Host',
    text: 'mulai',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.equal(wwBegin.privateDeliveries?.length, 4);
  assert.match(wwBegin.replyText, /Freya-san bot by Pak Ujan/);
  db.prepare(`UPDATE game_sessions SET status = 'cancelled' WHERE chat_id = ?`).run(TEST_GROUP_1);

  clearRateLimitBucketsForTests();
  const ucLobby = await whatsappEngine.processIncomingMessage({
    chatId: TEST_GROUP_1,
    chatScope: 'group',
    groupName: 'Grup Undercover',
    senderPhone: TEST_PHONES[0],
    senderName: 'Host',
    text: '#undercover mrwhite on',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.match(ucLobby.replyText, /Mr\. White: ON/);
  for (let i = 1; i <= 2; i++) {
    await whatsappEngine.processIncomingMessage({
      chatId: TEST_GROUP_1,
      chatScope: 'group',
      groupName: 'Grup Undercover',
      senderPhone: TEST_PHONES[i],
      senderName: `U${i}`,
      text: 'gabung',
      isGroupAdmin: false,
      source: 'simulator',
    });
  }
  clearRateLimitBucketsForTests();
  const ucStart = await whatsappEngine.processIncomingMessage({
    chatId: TEST_GROUP_1,
    chatScope: 'group',
    groupName: 'Grup Undercover',
    senderPhone: TEST_PHONES[0],
    senderName: 'Host',
    text: 'mulai',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.equal(ucStart.privateDeliveries?.length, 3);
  assert.ok(!ucStart.replyText.includes('Civilian:') && !ucStart.replyText.includes('Undercover:'));
});

test('9. UNO cards, sticker mapping, stop authorization, and 60s timeout stop without auto-skipping', () => {
  const meta = buildUnoCardMetadata('R-7');
  assert.equal(meta.stickerId, 'uno-sticker-merah-7');
  const parsed = resolveStickerToUnoCard(meta.stickerId);
  assert.equal(parsed?.code, 'R-7');
  assert.equal(canPlayUnoCard('R-7', 'R-2', 'merah'), true);
  assert.equal(canPlayUnoCard('WILD+4', 'B-9', 'biru'), true);

  const unoStart = startGameSession({
    gameId: 'uno',
    chatScope: 'group',
    chatId: TEST_GROUP_2,
    groupName: 'Grup UNO',
    hostPhone: TEST_PHONES[0],
    hostName: 'Host',
  });
  assert.equal(unoStart.ok, true);
  submitGameAction({ sessionId: unoStart.sessionId!, chatScope: 'group', chatId: TEST_GROUP_2, playerPhone: TEST_PHONES[1], playerName: 'P2', input: 'gabung', actionType: 'join' });
  submitGameAction({ sessionId: unoStart.sessionId!, chatScope: 'group', chatId: TEST_GROUP_2, playerPhone: TEST_PHONES[0], playerName: 'Host', input: 'mulai', actionType: 'start_lobby' });

  const unoStateRow = db.prepare(`SELECT state_json FROM game_sessions WHERE id = ?`).get(unoStart.sessionId) as { state_json: string };
  const expiredState = { ...JSON.parse(unoStateRow.state_json), turnDeadlineMs: Date.now() - 5000 };
  db.prepare(`UPDATE game_sessions SET state_json = ? WHERE id = ?`).run(JSON.stringify(expiredState), unoStart.sessionId);
  const timeoutRes = checkUnoSessionTimeout(unoStart.sessionId!);
  assert.equal(timeoutRes.timedOut, true);
  const sessAfter = db.prepare(`SELECT status FROM game_sessions WHERE id = ?`).get(unoStart.sessionId) as { status: string };
  assert.equal(sessAfter.status, 'expired');
});

test('10. Brat stickers, 13 [SIMULASI] mockups, honest capability checks & anti-abuse enforcement', async () => {
  const bratRes = await generateBratSticker({ variant: 'brat2', text: 'Halo Freya ✨' });
  assert.equal(bratRes.ok, true);
  assert.match(bratRes.mimetype || '', /webp|svg/);

  const tooLongBrat = await generateBratSticker({ variant: 'brat2', text: 'a'.repeat(105) });
  assert.equal(tooLongBrat.ok, false);

  const mockupRes = await generateMockupImage({ type: 'fakechios', rawArgs: 'Channel Test | Hai semua | 120', senderName: 'Tester' });
  assert.equal(mockupRes.ok, true);
  assert.ok(mockupRes.buffer && mockupRes.buffer.length > 100);

  const saNoAudio = await whatsappEngine.processIncomingMessage({
    chatId: `${TEST_PHONES[6]}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: TEST_PHONES[6],
    senderName: 'Tester',
    text: '#stickeraudio',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.match(saNoAudio.replyText, /sticker|\.webp|WhatsApp/i);

  const upswchOffline = await whatsappEngine.processIncomingMessage({
    chatId: `${TEST_PHONES[7]}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: TEST_PHONES[7],
    senderName: 'Tester',
    text: '#upswch 123456@newsletter Halo channel',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.match(upswchOffline.replyText, /Baileys|terhubung|belum aktif|Owner/i);

  setAbuseRestrictionAction({
    userPhone: TEST_PHONES[5],
    action: 'temp_restrict',
    reason: 'Spam burst uji coba',
    durationMinutes: 15,
    actor: 'test',
  });
  recordAbuseEvent({
    userPhone: TEST_PHONES[5],
    submodule: 'anti_spam',
    severity: 'rule_violation',
    actionTaken: 'temp_restrict',
    detail: 'Unit test spam event',
  });
  const blockedRes = await whatsappEngine.processIncomingMessage({
    chatId: `${TEST_PHONES[5]}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: TEST_PHONES[5],
    senderName: 'Restricted',
    text: '.menu',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.match(blockedRes.replyText, /dibatasi|restricted|制限/i);
});

test('11. Real #tolive (MotionPhoto JPEG+XMP+MP4) & #sa (Animated WebP+EXIF + Opus) pipelines & WAProto wire decode', async () => {
  const { execFileSync } = await import('node:child_process');
  const crypto = await import('node:crypto');
  const protobuf = await import('protobufjs');
  const {
    convertMediaToLivePhotoBundle,
    convertStickerAudioBundle,
    generateMediaPipelineSample,
  } = await import('./mediaService');
  const {
    buildMotionPhotoProtoPair,
    buildSoundStickerProtoPayload,
  } = await import('./waMediaProtocol');

  // 1) Real #tolive from synthetic PNG image (micro-motion zoompan)
  const sampleImg = await generateMediaPipelineSample('image');
  const liveFromImg = await convertMediaToLivePhotoBundle({
    mediaBuffer: sampleImg,
    mediaKind: 'image',
    userPhone: TEST_PHONES[8],
    lang: 'id',
  });
  assert.equal(liveFromImg.ok, true, liveFromImg.caption);
  assert.ok(liveFromImg.livePhotoBundle);
  const imgBundle = liveFromImg.livePhotoBundle!;
  assert.equal((imgBundle.validation as any).ok, true);
  assert.equal((imgBundle.validation as any).motionPhotoTag, '1');
  assert.equal((imgBundle.validation as any).embeddedVideoCodec, 'h264');
  const offset = Number((imgBundle.validation as any).microVideoOffset);
  assert.equal(offset, imgBundle.motionVideoBuffer.length);
  const extractedMp4 = imgBundle.motionPhotoJpgBuffer.subarray(imgBundle.motionPhotoJpgBuffer.length - offset);
  assert.equal(extractedMp4.subarray(4, 8).toString('ascii'), 'ftyp');

  // 2) Real #tolive from synthetic video+audio MP4 -> preserves AAC audio and builds valid MotionPhoto
  const sampleVid = await generateMediaPipelineSample('video');
  const liveFromVid = await convertMediaToLivePhotoBundle({
    mediaBuffer: sampleVid,
    mediaKind: 'video',
    userPhone: TEST_PHONES[8],
    lang: 'id',
  });
  assert.equal(liveFromVid.ok, true, liveFromVid.caption);
  assert.equal(liveFromVid.livePhotoBundle?.hasAudio, true);
  assert.equal((liveFromVid.livePhotoBundle?.validation as any).ok, true);

  // Quick ffprobe sanity on extracted motion MP4 via temp file (avoids stdin EPIPE on faststart MP4)
  const fsMod = await import('node:fs');
  const osMod = await import('node:os');
  const pathMod = await import('node:path');
  const probeTmp = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'freya-probe-'));
  let probeOut = '';
  try {
    const tmpMp4 = pathMod.join(probeTmp, 'motion.mp4');
    fsMod.writeFileSync(tmpMp4, liveFromVid.livePhotoBundle!.motionVideoBuffer);
    probeOut = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', tmpMp4],
      { encoding: 'utf8' },
    );
  } finally {
    fsMod.rmSync(probeTmp, { recursive: true, force: true });
  }
  assert.match(probeOut, /h264/);
  assert.match(probeOut, /aac/);

  // 3) Real #sa from synthetic video -> 512x512 Animated WebP (<500KB, VP8X+ANIM+ANMF+EXIF) + OGG/Opus
  const saFromVid = await convertStickerAudioBundle({
    visualBuffer: sampleVid,
    visualKind: 'video',
    userPhone: TEST_PHONES[8],
    lang: 'id',
  });
  assert.equal(saFromVid.ok, true, saFromVid.caption);
  assert.ok(saFromVid.soundStickerBundle);
  const sb = saFromVid.soundStickerBundle!;
  assert.ok(sb.stickerBuffer.length <= 500 * 1024);
  assert.equal((sb.webpValidation as any).ok, true);
  assert.ok(((sb.webpValidation as any).chunks as string[]).includes('VP8X'));
  assert.ok(((sb.webpValidation as any).chunks as string[]).includes('ANIM'));
  assert.ok(((sb.webpValidation as any).chunks as string[]).includes('EXIF'));
  assert.equal((sb.webpValidation as any).hasWhatsAppExif, true);
  assert.ok(Number((sb.webpValidation as any).anmfFrames) > 1);
  assert.equal((sb.audioValidation as any).ok, true);
  assert.equal((sb.audioValidation as any).codec, 'opus');
  assert.equal((sb.audioValidation as any).sampleRate, 48000);
  assert.equal(sb.waveform.length, 64);

  // 4) Two-step #sa flow in whatsappEngine: step 1 image -> step 2 audio -> produces sound_sticker
  const sampleAudio = await generateMediaPipelineSample('audio');
  const saStep1 = await whatsappEngine.processIncomingMessage({
    chatId: `${TEST_PHONES[9]}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: TEST_PHONES[9],
    senderName: 'StickerAudioTester',
    text: '#sa',
    quotedMediaKind: 'image',
    quotedMediaBuffer: sampleImg,
    hasMedia: true,
    hasReply: true,
    source: 'simulator',
  });
  assert.equal(saStep1.status, 'pending');
  assert.match(saStep1.replyText, /5 menit|audio/i);

  clearRateLimitBucketsForTests();
  const saStep2 = await whatsappEngine.processIncomingMessage({
    chatId: `${TEST_PHONES[9]}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: TEST_PHONES[9],
    senderName: 'StickerAudioTester',
    text: '#sa',
    quotedMediaKind: 'audio',
    quotedMediaBuffer: sampleAudio,
    hasMedia: true,
    hasReply: true,
    source: 'simulator',
  });
  assert.equal(saStep2.status, 'ok', saStep2.replyText);
  assert.equal(saStep2.mediaPreview?.kind, 'sound_sticker');
  assert.ok(saStep2.mediaPreview?.dataUrl?.startsWith('data:image/webp;base64,'));
  assert.ok(saStep2.mediaPreview?.audioDataUrl?.startsWith('data:audio/ogg;base64,'));

  // 5) Wire-level Protobuf roundtrip check against upstream WAWebProtobufsE2E.proto field tags
  const wireProto = `
    syntax = "proto2";
    package wa_test;
    message MessageKey {
      optional string remoteJid = 1;
      optional bool fromMe = 2;
      optional string id = 3;
      optional string participant = 4;
    }
    message MessageAssociation {
      enum AssociationType {
        UNKNOWN = 0;
        MOTION_PHOTO = 12;
      }
      optional AssociationType associationType = 1;
      optional MessageKey parentMessageKey = 2;
      optional int32 messageIndex = 4;
    }
    message MessageContextInfo {
      optional bytes messageSecret = 3;
      optional MessageAssociation messageAssociation = 10;
    }
    message ImageMessage {
      optional string url = 1;
      optional string mimetype = 2;
      optional string caption = 3;
      optional bytes fileSha256 = 4;
      optional uint64 fileLength = 5;
      optional uint32 height = 6;
      optional uint32 width = 7;
      optional bytes mediaKey = 8;
      optional bytes fileEncSha256 = 9;
      optional string directPath = 11;
    }
    message VideoMessage {
      optional string url = 1;
      optional string mimetype = 2;
      optional bytes fileSha256 = 3;
      optional uint64 fileLength = 4;
      optional uint32 seconds = 5;
      optional bytes mediaKey = 6;
      optional bool gifPlayback = 8;
      optional uint32 height = 9;
      optional uint32 width = 10;
      optional bytes fileEncSha256 = 11;
      optional string directPath = 13;
      optional uint64 motionPhotoPresentationOffsetMS = 29;
    }
    message AudioMessage {
      optional string url = 1;
      optional string mimetype = 2;
      optional bytes fileSha256 = 3;
      optional uint64 fileLength = 4;
      optional uint32 seconds = 5;
      optional bool ptt = 6;
      optional bytes mediaKey = 7;
      optional bytes fileEncSha256 = 8;
      optional string directPath = 9;
      optional bytes waveform = 19;
    }
    message StickerMessage {
      optional string url = 1;
      optional bytes fileSha256 = 2;
      optional bytes fileEncSha256 = 3;
      optional bytes mediaKey = 4;
      optional string mimetype = 5;
      optional uint32 height = 6;
      optional uint32 width = 7;
      optional string directPath = 8;
      optional uint64 fileLength = 9;
      optional bool isAnimated = 13;
      optional string emojis = 25;
      optional AudioMessage audioMessage = 26;
    }
    message FutureProofMessage {
      optional Message message = 1;
    }
    message Message {
      optional ImageMessage imageMessage = 3;
      optional AudioMessage audioMessage = 8;
      optional VideoMessage videoMessage = 9;
      optional StickerMessage stickerMessage = 26;
      optional MessageContextInfo messageContextInfo = 35;
      optional FutureProofMessage audioStickerMessage = 134;
    }
  `;
  const pb: any = (protobuf as any).default ?? protobuf;
  const root = pb.parse(wireProto).root;
  const MsgType = root.lookupType('wa_test.Message');

  const sha = crypto.randomBytes(32);
  const mk = crypto.randomBytes(32);
  const pair = buildMotionPhotoProtoPair({
    jid: '628990001008@s.whatsapp.net',
    stillMeta: {
      url: 'https://mmg.whatsapp.net/still',
      directPath: '/still',
      mediaKey: mk,
      fileSha256: sha,
      fileEncSha256: sha,
      fileLength: imgBundle.stillBuffer.length,
      width: imgBundle.width,
      height: imgBundle.height,
    },
    videoMeta: {
      url: 'https://mmg.whatsapp.net/vid',
      directPath: '/vid',
      mediaKey: mk,
      fileSha256: sha,
      fileEncSha256: sha,
      fileLength: imgBundle.motionVideoBuffer.length,
      width: imgBundle.width,
      height: imgBundle.height,
      seconds: 3,
      presentationOffsetMs: imgBundle.presentationOffsetMs,
    },
  });
  const decodedChild = MsgType.decode(pair.childEncodedBytes) as any;
  assert.equal(Number(decodedChild.videoMessage.motionPhotoPresentationOffsetMS), imgBundle.presentationOffsetMs);
  assert.equal(decodedChild.messageContextInfo.messageAssociation.associationType, 12);
  assert.equal(decodedChild.messageContextInfo.messageAssociation.parentMessageKey.id, pair.parentMsg.key.id);

  const saProto = buildSoundStickerProtoPayload({
    stickerMeta: {
      url: 'https://mmg.whatsapp.net/stk',
      directPath: '/stk',
      mediaKey: mk,
      fileSha256: sha,
      fileEncSha256: sha,
      fileLength: sb.stickerBuffer.length,
      isAnimated: true,
      emojis: '🔊',
    },
    audioMeta: {
      url: 'https://mmg.whatsapp.net/aud',
      directPath: '/aud',
      mediaKey: mk,
      fileSha256: sha,
      fileEncSha256: sha,
      fileLength: sb.audioBuffer.length,
      seconds: sb.audioSeconds,
      waveform: sb.waveform,
    },
    wrapFutureProofEnvelope: true,
  });
  const decodedSa = MsgType.decode(saProto.encodedBytes) as any;
  assert.equal(decodedSa.stickerMessage.emojis, '🔊');
  assert.equal(decodedSa.stickerMessage.audioMessage.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(decodedSa.stickerMessage.audioMessage.seconds, sb.audioSeconds);
  assert.equal(decodedSa.audioStickerMessage.message.stickerMessage.audioMessage.seconds, sb.audioSeconds);

  // Verify media_jobs persistence in SQLite
  const jobRows = db.prepare(`SELECT command, validation_ok FROM media_jobs WHERE user_phone IN (?, ?)`).all(TEST_PHONES[8], TEST_PHONES[9]) as any[];
  assert.ok(jobRows.length >= 4);
  assert.ok(jobRows.every((r) => r.validation_ok === 1));
  db.prepare(`DELETE FROM media_jobs WHERE user_phone IN (?, ?)`).run(TEST_PHONES[8], TEST_PHONES[9]);
});

test('12. v5.0.3 Interactive List menus, fallback navigation, strict permissions, game precedence & language switch', async () => {
  const ownerPhone = whatsappEngine.getOwnerPhoneNormalized();
  const userPhone = TEST_PHONES[10];
  const userChatId = `${userPhone}@s.whatsapp.net`;

  // 1) Verify every interactive menu key builds cleanly with casual nonbaku Indonesian + footer + Kembali
  const keysToAudit = [
    'main',
    'games',
    '48group',
    '48group_level',
    '48group_team',
    '48group_team:old',
    '48group_quiz',
    'group_settings',
    'bot_settings',
    'owner',
    'premium_redeem',
    'economy',
    'help_info',
    'features',
    'confirm:resetprefix',
    'category:OWNER:1',
    'category:OWNER:2',
  ];

  for (const key of keysToAudit) {
    const { headerText, menu } = buildMenuPayload(key, {
      prefix: '.',
      lang: 'id',
      isOwner: true,
      isGroupAdmin: true,
      chatScope: 'group',
      groupName: 'Grup Uji Menu',
      botStatus: 'online',
      senderName: 'Owner',
    });
    assert.equal(menu.footer, 'Freya-san bot by Pak Ujan', `Wrong footer on menu ${key}`);
    assert.ok(menu.sections.length >= 1, `Expected sections on menu ${key}`);
    const totalRows = menu.sections.reduce((acc, s) => acc + s.rows.length, 0);
    assert.ok(totalRows >= 2, `Expected rows on menu ${key}`);
    if (key !== 'main') {
      const flat = menu.sections.flatMap((s) => s.rows);
      assert.ok(
        flat.some((r) => /kembali/i.test(r.title) || r.id === 'menu:main'),
        `Submenu ${key} must provide Kembali navigation`,
      );
    }
    const fallbackBody = formatMenuFallbackText(menu, headerText, 'id');
    assert.deepEqual(
      findFormalIndonesianViolations(fallbackBody),
      [],
      `Formal Indonesian violation in menu ${key}`,
    );
    const baileysPayload = buildBaileysListPayload(menu, headerText);
    assert.equal(baileysPayload.footer, 'Freya-san bot by Pak Ujan');
  }

  // 2) Open .menu as normal user -> reply "1" opens games submenu via numeric fallback
  const mainRes = await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '.menu',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.equal(mainRes.status, 'ok');
  assert.ok(mainRes.interactiveMenu);
  assert.equal(mainRes.interactiveMenu!.menuKey, 'main');

  clearRateLimitBucketsForTests();
  const num1Res = await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '1',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.equal(num1Res.status, 'ok');
  assert.equal(num1Res.interactiveMenu?.menuKey, 'games');
  assert.deepEqual(findFormalIndonesianViolations(num1Res.replyText), []);

  // 3) Explicit native selectedRowId tap opens 48group submenu
  clearRateLimitBucketsForTests();
  await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '.menu',
    isGroupAdmin: false,
    source: 'simulator',
  });
  clearRateLimitBucketsForTests();
  const tap48Res = await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: 'Menu 48GROUP',
    selectedRowId: 'menu:48group',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.equal(tap48Res.status, 'ok');
  assert.equal(tap48Res.interactiveMenu?.menuKey, '48group');

  // 4) Strict server-side permission checks: non-owner cannot open owner menu or execute owner row
  clearRateLimitBucketsForTests();
  const ownerDeniedCmd = await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '.menu owner',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.equal(ownerDeniedCmd.status, 'denied');
  assert.deepEqual(findFormalIndonesianViolations(ownerDeniedCmd.replyText), []);

  const ownerMenuForBypass = buildMenuPayload('owner', {
    prefix: '.',
    lang: 'id',
    isOwner: true,
    isGroupAdmin: true,
    chatScope: 'private',
  });
  issueMenuSession({
    chatId: userChatId,
    userPhone,
    chatScope: 'private',
    menu: ownerMenuForBypass.menu,
  });
  const forgedRowTap = resolveMenuSelection({
    chatId: userChatId,
    userPhone,
    chatScope: 'private',
    selectedRowId: 'cmd:listprefix',
    rawText: '',
    isOwner: false,
    isGroupAdmin: false,
    prefix: '.',
    lang: 'id',
  });
  assert.equal(forgedRowTap.kind, 'denied');

  // Non-admin in group denied group_settings row
  const groupAdminMenu = buildMenuPayload('group_settings', {
    prefix: '.',
    lang: 'id',
    isOwner: false,
    isGroupAdmin: true,
    chatScope: 'group',
  });
  issueMenuSession({
    chatId: TEST_GROUP_1,
    userPhone,
    chatScope: 'group',
    menu: groupAdminMenu.menu,
  });
  const nonAdminTap = resolveMenuSelection({
    chatId: TEST_GROUP_1,
    userPhone,
    chatScope: 'group',
    selectedRowId: 'cmd:welcome_on',
    rawText: '',
    isOwner: false,
    isGroupAdmin: false,
    prefix: '.',
    lang: 'id',
  });
  assert.equal(nonAdminTap.kind, 'denied');

  // 5) Expired session check
  db.prepare(`UPDATE whatsapp_menu_sessions SET expires_at = datetime('now', '-5 minutes') WHERE user_phone = ?`).run(userPhone);
  const expiredTap = resolveMenuSelection({
    chatId: userChatId,
    userPhone,
    chatScope: 'private',
    selectedRowId: 'menu:games',
    rawText: '',
    isOwner: false,
    isGroupAdmin: false,
    prefix: '.',
    lang: 'id',
  });
  assert.equal(expiredTap.kind, 'expired');

  // 6) Active game priority: when .bom is running, sending "1" plays Bom instead of menu selection
  clearRateLimitBucketsForTests();
  await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '.menu',
    isGroupAdmin: false,
    source: 'simulator',
  });
  clearRateLimitBucketsForTests();
  const bomStart = await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '.bom',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.equal(bomStart.status, 'ok');
  clearRateLimitBucketsForTests();
  const bomMove = await whatsappEngine.processIncomingMessage({
    chatId: userChatId,
    chatScope: 'private',
    senderPhone: userPhone,
    senderName: 'Menu Tester',
    text: '1',
    isGroupAdmin: false,
    source: 'simulator',
  });
  assert.equal(bomMove.interactiveMenu, undefined);
  assert.match(bomMove.replyText, /Kotak|Bom|Aman|Meledak/i);

  // 7) Fallback logs persistence
  recordMenuFallbackLog({
    chatId: userChatId,
    menuKey: 'main',
    mode: 'text_fallback',
    reason: 'unit_test_fallback',
    clientInfo: 'baileys-test',
  });
  const logs = listMenuFallbackLogs(10);
  assert.ok(logs.some((l) => l.chat_id === userChatId && l.reason === 'unit_test_fallback'));

  // 8) Owner language switch (.setcommand lang en -> .menu -> .setcommand lang id)
  clearRateLimitBucketsForTests();
  const setEn = await whatsappEngine.processIncomingMessage({
    chatId: `${ownerPhone}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: ownerPhone,
    senderName: 'Owner',
    text: '.setcommand lang en',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.equal(setEn.status, 'ok');
  assert.match(setEn.replyText, /English/i);

  clearRateLimitBucketsForTests();
  const enMenu = await whatsappEngine.processIncomingMessage({
    chatId: `${ownerPhone}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: ownerPhone,
    senderName: 'Owner',
    text: '.menu',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.equal(enMenu.interactiveMenu?.buttonText, 'Open Menu List');

  clearRateLimitBucketsForTests();
  const setId = await whatsappEngine.processIncomingMessage({
    chatId: `${ownerPhone}@s.whatsapp.net`,
    chatScope: 'private',
    senderPhone: ownerPhone,
    senderName: 'Owner',
    text: '.setcommand lang id',
    isGroupAdmin: true,
    source: 'simulator',
  });
  assert.equal(setId.status, 'ok');
  assert.match(setId.replyText, /Indonesia/i);
  db.prepare(`DELETE FROM whatsapp_menu_sessions WHERE user_phone = ?`).run(ownerPhone);
});

test('13. Baileys Pairing Code, QR Code, Reset Koneksi, Reset Sesi Penuh, Locking & History', async () => {
  // 1) Validasi nomor telepon pairing code
  assert.equal(validatePairingPhoneNumber('').ok, false);
  assert.equal(validatePairingPhoneNumber('abc123456').ok, false);
  assert.equal(validatePairingPhoneNumber('081234567890').ok, false);
  assert.equal(validatePairingPhoneNumber('62123').ok, false);
  assert.equal(validatePairingPhoneNumber('621234567890123456').ok, false);
  const validPhone = validatePairingPhoneNumber('+62 812-3456-7890');
  assert.equal(validPhone.ok, true);
  assert.equal(validPhone.normalized, '6281234567890');

  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-wa-auth-test-'));
  const historyBefore = (db.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM wa_connection_history`).get() as { max_id: number }).max_id;

  interface MockSocketControl {
    ev: EventEmitter;
    endCalls: number;
    pairingRequestedWith: string[];
  }
  const sockets: MockSocketControl[] = [];
  let slowAuthRelease: (() => void) | null = null;
  let useSlowFactoryOnce = false;
  let nextCredsRegistered = false;

  whatsappEngine.setAuthDirForTests(tmpAuthDir);
  whatsappEngine.setSocketFactoryForTests(async ({ authDir }) => {
    if (useSlowFactoryOnce) {
      useSlowFactoryOnce = false;
      await new Promise<void>((resolve) => {
        slowAuthRelease = resolve;
      });
    }
    const ev = new EventEmitter();
    const ctrl: MockSocketControl = {
      ev,
      endCalls: 0,
      pairingRequestedWith: [],
    };
    sockets.push(ctrl);

    const sock: any = {
      ev,
      user: { id: '6281234567890:1@s.whatsapp.net' },
      end: () => {
        ctrl.endCalls += 1;
      },
      requestPairingCode: async (digits: string) => {
        ctrl.pairingRequestedWith.push(digits);
        return 'ABCD1234';
      },
      sendMessage: async () => ({ key: { id: 'mock-msg-id' } }),
      readMessages: async () => undefined,
      groupMetadata: async () => ({ subject: 'Mock Group', participants: [] }),
    };

    const state: any = {
      creds: { registered: nextCredsRegistered },
      keys: {},
    };
    const saveCreds = async () => {
      fs.writeFileSync(
        path.join(authDir, 'creds.json'),
        JSON.stringify({ registered: state.creds.registered, noiseKey: 'secret-test-noise' }),
        'utf8',
      );
    };
    return { sock, state, saveCreds };
  });

  try {
    // Pastikan state bersih di awal uji
    await whatsappEngine.disconnect('test');

    // 2) Koneksi QR Code -> qr_ready -> connected -> cegah sesi ganda
    const qrConnectPromise = whatsappEngine.connect({ method: 'qr', actor: 'test-owner' });
    // Tunggu sampai socket mock pertama terbuat
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sockets.length, 1);
    sockets[0].ev.emit('connection.update', { qr: 'mock-qr-payload-test' });
    const qrRes = await qrConnectPromise;
    assert.equal(qrRes.ok, true);
    assert.equal(whatsappEngine.getStatus().status, 'qr_ready');
    assert.ok(whatsappEngine.getStatus().qrDataUrl?.startsWith('data:image/png;base64,'));

    // Terhubung via QR
    sockets[0].ev.emit('connection.update', { connection: 'open' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(whatsappEngine.getStatus().status, 'connected');
    assert.equal(whatsappEngine.getStatus().phoneNumber, '6281234567890');

    // Cegah pembuatan sesi baru saat sudah terhubung
    const duplicateConnect = await whatsappEngine.connect({
      method: 'pairing_code',
      phoneNumber: '6281234567890',
      actor: 'test-owner',
    });
    assert.equal(duplicateConnect.ok, false);
    assert.equal(sockets.length, 1, 'Tidak boleh membuat socket Baileys kedua saat sudah terhubung');

    // 3) Reset Koneksi: putuskan socket aktif, bersihkan state sementara, pertahankan kredensial valid & sambung ulang
    fs.writeFileSync(path.join(tmpAuthDir, 'creds.json'), JSON.stringify({ registered: true, noiseKey: 'secret-keep' }), 'utf8');
    fs.writeFileSync(path.join(tmpAuthDir, 'app-state-sync-key-1.json'), '{"key":"keep"}', 'utf8');

    const resetConnRes = await whatsappEngine.resetConnection('test-owner');
    assert.equal(resetConnRes.ok, true);
    assert.equal(resetConnRes.hasStoredAuth, true);
    assert.equal(sockets[0].endCalls, 1, 'Socket lama wajib dihentikan saat Reset Koneksi');
    assert.equal(sockets.length, 2, 'Reset Koneksi dengan kredensial tersimpan harus inisialisasi socket baru');
    assert.equal(fs.existsSync(path.join(tmpAuthDir, 'creds.json')), true, 'creds.json harus tetap ada saat Reset Koneksi');
    assert.equal(fs.existsSync(path.join(tmpAuthDir, 'app-state-sync-key-1.json')), true);

    // 4) Reset Sesi Penuh: wajib konfirmasi tambahan, hapus auth files, JANGAN sentuh data aplikasi
    const usersBefore = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
    const settingsBefore = (db.prepare(`SELECT COUNT(*) AS c FROM settings`).get() as { c: number }).c;
    const cmdsBefore = (db.prepare(`SELECT COUNT(*) AS c FROM commands`).get() as { c: number }).c;
    const prefixesBefore = (db.prepare(`SELECT COUNT(*) AS c FROM prefixes`).get() as { c: number }).c;
    const redeemBefore = (db.prepare(`SELECT COUNT(*) AS c FROM redeem_codes`).get() as { c: number }).c;

    const resetWithoutConfirm = await whatsappEngine.resetFullSession({ confirm: false, actor: 'test-owner' });
    assert.equal(resetWithoutConfirm.ok, false);

    const resetFullRes = await whatsappEngine.resetFullSession({ confirm: true, actor: 'test-owner' });
    assert.equal(resetFullRes.ok, true);
    assert.equal(sockets[1].endCalls, 1, 'Socket sebelumnya wajib dihentikan saat Reset Sesi Penuh');
    assert.equal(fs.existsSync(path.join(tmpAuthDir, 'app-state-sync-key-1.json')), false, 'File key lama wajib terhapus');
    assert.equal(whatsappEngine.getStatus().status, 'disconnected');
    assert.equal(whatsappEngine.getStatus().phoneNumber, null);
    assert.equal(whatsappEngine.getStatus().hasStoredAuth, false);

    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c, usersBefore);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM settings`).get() as { c: number }).c, settingsBefore);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM commands`).get() as { c: number }).c, cmdsBefore);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM prefixes`).get() as { c: number }).c, prefixesBefore);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM redeem_codes`).get() as { c: number }).c, redeemBefore);

    // 5) Re-auth pakai Pairing Code setelah Reset Sesi Penuh + Cancel + Expired + Berhasil
    const badPhoneRes = await whatsappEngine.connect({
      method: 'pairing_code',
      phoneNumber: '081234567890',
      actor: 'test-owner',
    });
    assert.equal(badPhoneRes.ok, false);
    assert.equal(badPhoneRes.pairingStatus, 'failed');

    // Request pairing code valid -> qr trigger requestPairingCode -> cancel
    nextCredsRegistered = false;
    const pairCancelPromise = whatsappEngine.connect({
      method: 'pairing_code',
      phoneNumber: '+62 812-3456-7890',
      actor: 'test-owner',
    });
    await new Promise((r) => setTimeout(r, 30));
    const pairSock1 = sockets[sockets.length - 1];
    pairSock1.ev.emit('connection.update', { qr: 'trigger-pairing-1' });
    const pairCancelRes = await pairCancelPromise;
    assert.equal(pairCancelRes.ok, true);
    assert.equal(pairCancelRes.pairingStatus, 'code_ready');
    assert.equal(pairCancelRes.pairingCode, 'ABCD1234');
    assert.deepEqual(pairSock1.pairingRequestedWith, ['6281234567890']);

    const cancelAction = await whatsappEngine.cancelPairing('test-owner');
    assert.equal(cancelAction.ok, true);
    assert.equal(cancelAction.pairingStatus, 'cancelled');
    assert.equal(pairSock1.endCalls, 1);

    // Simulasi pairing kedaluwarsa (timedOut)
    const pairExpirePromise = whatsappEngine.connect({
      method: 'pairing_code',
      phoneNumber: '6281234567890',
      actor: 'test-owner',
    });
    await new Promise((r) => setTimeout(r, 30));
    const pairSock2 = sockets[sockets.length - 1];
    pairSock2.ev.emit('connection.update', { qr: 'trigger-pairing-2' });
    await pairExpirePromise;
    pairSock2.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 408 }, message: 'Timed Out' } },
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(whatsappEngine.getStatus().pairingStatus, 'expired');

    // Simulasi pairing sukses sampai terhubung
    const pairSuccessPromise = whatsappEngine.connect({
      method: 'pairing_code',
      phoneNumber: '6281234567890',
      actor: 'test-owner',
    });
    await new Promise((r) => setTimeout(r, 30));
    const pairSock3 = sockets[sockets.length - 1];
    pairSock3.ev.emit('connection.update', { qr: 'trigger-pairing-3' });
    await pairSuccessPromise;
    pairSock3.ev.emit('connection.update', { connection: 'open' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(whatsappEngine.getStatus().status, 'connected');
    assert.equal(whatsappEngine.getStatus().pairingStatus, 'success');
    assert.equal(whatsappEngine.getStatus().pairingCode, null);

    // 6) Locking saat operasi koneksi/reset bersamaan
    await whatsappEngine.disconnect('test-owner');
    useSlowFactoryOnce = true;
    const slowConnect = whatsappEngine.connect({ method: 'qr', actor: 'test-owner' });
    await new Promise((r) => setTimeout(r, 20));
    const concurrentReset = await whatsappEngine.resetConnection('test-owner');
    assert.equal(concurrentReset.ok, false);
    assert.match(concurrentReset.message, /lagi berjalan/i);
    if (slowAuthRelease) (slowAuthRelease as () => void)();
    await slowConnect;

    // 7) Audit riwayat koneksi & reset (tanpa bocor kredensial/nomor mentah/bahasa baku)
    const historyRows = db
      .prepare(`SELECT * FROM wa_connection_history WHERE id > ? ORDER BY id ASC`)
      .all(historyBefore) as Array<{ event_type: string; target_masked: string | null; detail: string }>;
    const eventTypes = new Set(historyRows.map((r) => r.event_type));
    assert.ok(eventTypes.has('connect_qr'));
    assert.ok(eventTypes.has('connect_open'));
    assert.ok(eventTypes.has('reset_connection'));
    assert.ok(eventTypes.has('reset_full_session'));
    assert.ok(eventTypes.has('pairing_code_issued'));
    assert.ok(eventTypes.has('pairing_cancelled'));
    assert.ok(eventTypes.has('pairing_expired'));
    assert.ok(eventTypes.has('pairing_success'));

    for (const row of historyRows) {
      assert.ok(!row.detail.includes('secret-'), 'Riwayat tidak boleh berisi kredensial mentah');
      assert.ok(!row.detail.includes('6281234567890'), 'Nomor mentah wajib disamarkan di riwayat');
      assert.deepEqual(findFormalIndonesianViolations(row.detail), []);
    }
  } finally {
    await whatsappEngine.disconnect('test-cleanup').catch(() => {});
    whatsappEngine.setSocketFactoryForTests(null);
    whatsappEngine.setAuthDirForTests(null);
    fs.rmSync(tmpAuthDir, { recursive: true, force: true });
    db.prepare(`DELETE FROM wa_connection_history WHERE id > ?`).run(historyBefore);
    db.prepare(`
      UPDATE bot_sessions
      SET status = 'disconnected',
          phone_number = NULL,
          qr_code = NULL,
          last_error = NULL,
          reconnect_attempts = 0,
          connection_method = 'qr',
          pairing_status = 'idle',
          pairing_expires_at = NULL
      WHERE id = 'primary'
    `).run();
  }
});


