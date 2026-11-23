import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db';
import {
  createRedeemCode,
  deleteRedeemCode,
  executeRedeemClaim,
  getClaimHistory,
  listRewardRegistry,
  resetRedeemClaims,
  toggleRedeemCode,
  updateRedeemCode,
} from './redeemService';

const TEST_PHONE_1 = '628999000111';
const TEST_PHONE_2 = '628999000222';

function cleanupTestRecords(): void {
  db.prepare(`DELETE FROM redeem_codes WHERE code LIKE 'TSTRDM_%'`).run();
  db.prepare(`DELETE FROM redeem_claims WHERE code LIKE 'TSTRDM_%'`).run();
  db.prepare(`DELETE FROM redeem_claim_logs WHERE code LIKE 'TSTRDM_%'`).run();
  db.prepare(`DELETE FROM users WHERE phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
  db.prepare(`DELETE FROM balances WHERE user_phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
  db.prepare(`DELETE FROM balance_transactions WHERE user_phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
  db.prepare(`DELETE FROM xp_transactions WHERE user_phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
  db.prepare(`DELETE FROM limits WHERE user_phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
  db.prepare(`DELETE FROM subscriptions WHERE user_phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
  db.prepare(`DELETE FROM achievements WHERE user_phone IN (?, ?)`).run(TEST_PHONE_1, TEST_PHONE_2);
}

test('Redeem Service handles full transactional lifecycle, security, rollback, and history preservation', () => {
  cleanupTestRecords();

  try {
    // 1. Reward Registry only exposes real implemented handlers
    const reg = listRewardRegistry();
    assert.ok(reg.active.every((r) => r.hasRealHandler));
    assert.equal(reg.active.some((r) => r.id === 'physical_merch_voucher'), false);

    // 2. Reject unimplemented additional reward during create
    const badCreate = createRedeemCode('test-owner', {
      code: 'TSTRDM_UNIMPL',
      rewardBalance: 50,
      additionalRewards: [{ rewardId: 'physical_merch_voucher', params: {} }],
    });
    assert.equal(badCreate.ok, false);

    // 3. Create valid multi-reward code (Balance + EXP + Level + Limit + Premium + Badge + Streak)
    const created = createRedeemCode('test-owner', {
      code: 'TSTRDM_MULTI1',
      name: 'Multi Reward Pack',
      description: 'Test full reward stack',
      rewardBalance: 200,
      rewardExp: 120,
      rewardLevel: 2,
      maxClaims: 2,
      perUserLimit: 1,
      cooldownSec: 0,
      additionalRewards: [
        { rewardId: 'daily_limit_bonus', params: { amount: 10 } },
        { rewardId: 'premium_access', params: { days: 5 } },
        { rewardId: 'badge_reward', params: { badgeName: 'Redeem Tester Badge', domain: '48group' } },
        { rewardId: 'streak_boost', params: { days: 4 } },
      ],
    });
    assert.equal(created.ok, true);

    // 4. Valid claim updates balance, exp, explicit level, limit, premium, badge, streak
    const idemKey = 'idem-multi-1';
    const claim1 = executeRedeemClaim({
      code: 'tstrdm_multi1',
      userPhone: TEST_PHONE_1,
      displayName: 'Tester Satu',
      idempotencyKey: idemKey,
    });
    assert.equal(claim1.ok, true);
    assert.equal(claim1.status, 'success');
    assert.equal(claim1.rewardsGranted?.balance, 200);
    assert.equal(claim1.rewardsGranted?.exp, 120);
    assert.equal(claim1.rewardsGranted?.levelBonus, 2);
    assert.equal(claim1.rewardsGranted?.dailyLimitBonus, 10);
    assert.equal(claim1.rewardsGranted?.premiumDays, 5);
    assert.equal(claim1.rewardsGranted?.streakBoost, 4);
    assert.ok(claim1.rewardsGranted?.badges.includes('Redeem Tester Badge'));

    // Starting balance was 100 -> 300, exp 0 -> 120 (level 2) + explicit levelBonus 2 -> level 4
    assert.equal(claim1.userAfter?.balance, 300);
    assert.equal(claim1.userAfter?.exp, 120);
    assert.equal(claim1.userAfter?.level, 4);
    assert.equal(claim1.userAfter?.dailyLimit, 35);
    assert.equal(claim1.userAfter?.isPremium, true);
    assert.equal(claim1.userAfter?.streak, 4);

    // 5. Idempotency replay returns same outcome without double reward
    const replay = executeRedeemClaim({
      code: 'TSTRDM_MULTI1',
      userPhone: TEST_PHONE_1,
      displayName: 'Tester Satu',
      idempotencyKey: idemKey,
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.duplicateIdempotent, true);
    const balRow = db.prepare('SELECT balance FROM users WHERE phone = ?').get(TEST_PHONE_1) as { balance: number };
    assert.equal(balRow.balance, 300);

    // 6. Duplicate claim without idempotency key hits perUserLimit = 1
    const dupClaim = executeRedeemClaim({
      code: 'TSTRDM_MULTI1',
      userPhone: TEST_PHONE_1,
      displayName: 'Tester Satu',
    });
    assert.equal(dupClaim.ok, false);
    assert.equal(dupClaim.status, 'rejected');

    // 7. Second user claims 2nd slot -> maxClaims (2) reached -> next user rejected
    const claim2 = executeRedeemClaim({
      code: 'TSTRDM_MULTI1',
      userPhone: TEST_PHONE_2,
      displayName: 'Tester Dua',
    });
    assert.equal(claim2.ok, true);

    const updatedQuota = updateRedeemCode('test-owner', 'TSTRDM_MULTI1', { perUserLimit: 2 });
    assert.equal(updatedQuota.ok, true);
    const overMax = executeRedeemClaim({
      code: 'TSTRDM_MULTI1',
      userPhone: TEST_PHONE_2,
      displayName: 'Tester Dua',
    });
    assert.equal(overMax.ok, false);
    assert.equal(overMax.status, 'rejected');

    // 8. Code not found & expired code & inactive code
    const notFound = executeRedeemClaim({
      code: 'TSTRDM_NO_SUCH_CODE',
      userPhone: TEST_PHONE_1,
    });
    assert.equal(notFound.ok, false);
    assert.equal(notFound.status, 'rejected');

    const expCreate = createRedeemCode('test-owner', {
      code: 'TSTRDM_EXPIRED',
      rewardBalance: 50,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(expCreate.ok, true);
    const expClaim = executeRedeemClaim({
      code: 'TSTRDM_EXPIRED',
      userPhone: TEST_PHONE_1,
    });
    assert.equal(expClaim.ok, false);
    assert.equal(expClaim.status, 'expired');

    const toggled = toggleRedeemCode('test-owner', 'TSTRDM_MULTI1', false);
    assert.equal(toggled.ok, true);

    // 9. Corrupt handler in DB triggers atomic ROLLBACK (balance & claimed_count untouched!)
    const rollCreate = createRedeemCode('test-owner', {
      code: 'TSTRDM_ROLLBACK',
      rewardBalance: 500,
    });
    assert.equal(rollCreate.ok, true);
    db.prepare(`UPDATE redeem_codes SET additional_rewards_json = ? WHERE code = 'TSTRDM_ROLLBACK'`).run(
      JSON.stringify([{ rewardId: 'physical_merch_voucher', params: {} }]),
    );
    const balanceBeforeRollback = (db.prepare('SELECT balance FROM users WHERE phone = ?').get(TEST_PHONE_1) as { balance: number }).balance;
    const rollbackRes = executeRedeemClaim({
      code: 'TSTRDM_ROLLBACK',
      userPhone: TEST_PHONE_1,
    });
    assert.equal(rollbackRes.ok, false);
    assert.equal(rollbackRes.status, 'failed');
    const balanceAfterRollback = (db.prepare('SELECT balance FROM users WHERE phone = ?').get(TEST_PHONE_1) as { balance: number }).balance;
    assert.equal(balanceAfterRollback, balanceBeforeRollback);

    // 10. Reset requires explicit confirm
    const resetNoConfirm = resetRedeemClaims('test-owner', 'TSTRDM_MULTI1', false);
    assert.equal(resetNoConfirm.ok, false);
    const resetWithConfirm = resetRedeemClaims('test-owner', 'TSTRDM_MULTI1', true);
    assert.equal(resetWithConfirm.ok, true);

    // 11. Deleting redeem code MUST PRESERVE claim history in redeem_claim_logs!
    const histBeforeDelete = getClaimHistory({ code: 'TSTRDM_MULTI1' });
    assert.ok(histBeforeDelete.total >= 3);
    const del = deleteRedeemCode('test-owner', 'TSTRDM_MULTI1');
    assert.equal(del.ok, true);
    const histAfterDelete = getClaimHistory({ code: 'TSTRDM_MULTI1' });
    assert.equal(histAfterDelete.total, histBeforeDelete.total);
  } finally {
    cleanupTestRecords();
  }
});
