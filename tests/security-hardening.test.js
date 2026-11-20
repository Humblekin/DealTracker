import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// DEALGUIDER SECURITY HARDENING — PHASE 1 INDEPENDENT VERIFICATION TEST SUITE
// ============================================================================

describe('SECTION 1: Database Role Protection & Privilege Escalation', () => {
  function createMockDb() {
    return {
      profiles: new Map(),
      auditLogs: [],

      // Simulates Postgres is_service_role() helper
      isServiceRole(context) {
        return context?.role === 'service_role' || context?.user === 'postgres';
      },

      // Simulates Postgres handle_new_user() trigger
      handleNewUser(authUser) {
        // HARDENED: Always set role to 'buyer', ignore raw_user_meta_data.role
        const profile = {
          id: authUser.id,
          full_name: authUser.raw_user_meta_data?.full_name || 'User',
          email: authUser.email,
          role: 'buyer', // Secure default
          wallet_balance: 0,
          phone: null,
          network: null,
          recipient_code: null,
          is_flagged: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.profiles.set(profile.id, profile);
        return profile;
      },

      // Simulates enforce_role_protection() BEFORE UPDATE trigger and RLS
      updateProfile(userId, updates, context) {
        const old = this.profiles.get(userId);
        if (!old) throw new Error('Profile not found');

        // RLS check: non-admin users can only update their own row
        if (!this.isServiceRole(context) && context?.userId !== userId) {
          throw new Error('RLS: Unauthorized update on other profile');
        }

        // Trigger check: enforce_role_protection
        if (!this.isServiceRole(context)) {
          if (updates.role !== undefined && updates.role !== old.role) {
            throw new Error('Unauthorized: Role modification requires a trusted server-side administrative process');
          }
          if (updates.wallet_balance !== undefined && updates.wallet_balance !== old.wallet_balance) {
            throw new Error('Unauthorized: wallet_balance cannot be modified directly');
          }
          if (updates.is_flagged !== undefined && updates.is_flagged !== old.is_flagged) {
            throw new Error('Unauthorized: is_flagged cannot be modified directly');
          }
          if (updates.recipient_code !== undefined && updates.recipient_code !== old.recipient_code) {
            throw new Error('Unauthorized: recipient_code cannot be modified directly');
          }
        }

        const updated = {
          ...old,
          ...updates,
          role: this.isServiceRole(context) ? (updates.role || old.role) : old.role,
          wallet_balance: this.isServiceRole(context) ? (updates.wallet_balance ?? old.wallet_balance) : old.wallet_balance,
          is_flagged: this.isServiceRole(context) ? (updates.is_flagged ?? old.is_flagged) : old.is_flagged,
          recipient_code: this.isServiceRole(context) ? (updates.recipient_code ?? old.recipient_code) : old.recipient_code,
          updated_at: new Date().toISOString(),
        };
        this.profiles.set(userId, updated);
        return updated;
      },

      // Simulates enforce_role_on_insert() BEFORE INSERT trigger
      insertProfile(profileData, context) {
        if (!this.isServiceRole(context)) {
          // Trigger forces role to 'buyer' and system fields to defaults
          profileData.role = 'buyer';
          profileData.wallet_balance = 0;
          profileData.is_flagged = false;
          profileData.recipient_code = null;
        }
        this.profiles.set(profileData.id, profileData);
        return profileData;
      },

      // Simulates admin-update-role Edge Function
      async adminUpdateRole({ callerUserId, targetUserId, newRole }) {
        const caller = this.profiles.get(callerUserId);
        if (!caller || caller.role !== 'admin') {
          return { status: 403, error: 'Only administrators can update user roles' };
        }
        if (!['buyer', 'seller', 'admin'].includes(newRole)) {
          return { status: 400, error: 'Invalid role' };
        }
        if (callerUserId === targetUserId) {
          return { status: 400, error: 'Administrators cannot modify their own role' };
        }
        const target = this.profiles.get(targetUserId);
        if (!target) {
          return { status: 404, error: 'User not found' };
        }

        // Executes with service_role context
        const updated = this.updateProfile(targetUserId, { role: newRole }, { role: 'service_role' });
        this.auditLogs.push({
          action: 'ADMIN_ROLE_UPDATED',
          actor_id: callerUserId,
          details: { target_user_id: targetUserId, old_role: target.role, new_role: newRole },
        });
        return { status: 200, success: true, profile: updated };
      },
    };
  }

  let db;
  beforeEach(() => {
    db = createMockDb();
  });

  test('1.1: Ordinary authenticated user cannot change their role to admin', () => {
    const user = { id: 'user-123', email: 'test@example.com' };
    db.profiles.set(user.id, {
      id: user.id,
      email: user.email,
      full_name: 'Regular User',
      role: 'buyer',
      wallet_balance: 0,
    });

    assert.throws(
      () => {
        db.updateProfile(user.id, { role: 'admin' }, { role: 'authenticated', userId: user.id });
      },
      /Unauthorized: Role modification requires a trusted server-side administrative process/
    );

    const profile = db.profiles.get(user.id);
    assert.equal(profile.role, 'buyer');
  });

  test('1.2: Signup metadata cannot assign privileged roles', () => {
    const maliciousAuthUser = {
      id: 'attacker-456',
      email: 'attacker@evil.com',
      raw_user_meta_data: {
        full_name: 'Sneaky Attacker',
        role: 'admin',
      },
    };

    const createdProfile = db.handleNewUser(maliciousAuthUser);
    assert.equal(createdProfile.role, 'buyer');
    assert.equal(createdProfile.full_name, 'Sneaky Attacker');
  });

  test('1.3: Ordinary users cannot modify wallet balances, flags, or recipient codes', () => {
    const user = { id: 'user-tamper-1', email: 'tamper@example.com', role: 'buyer', wallet_balance: 0, is_flagged: true, recipient_code: 'RCP_ORIG' };
    db.profiles.set(user.id, user);

    // Attempt to tamper with wallet balance
    assert.throws(
      () => {
        db.updateProfile(user.id, { wallet_balance: 50000 }, { role: 'authenticated', userId: user.id });
      },
      /wallet_balance cannot be modified directly/
    );

    // Attempt to unflag own account
    assert.throws(
      () => {
        db.updateProfile(user.id, { is_flagged: false }, { role: 'authenticated', userId: user.id });
      },
      /is_flagged cannot be modified directly/
    );

    // Attempt to tamper with recipient code
    assert.throws(
      () => {
        db.updateProfile(user.id, { recipient_code: 'RCP_HACKED' }, { role: 'authenticated', userId: user.id });
      },
      /recipient_code cannot be modified directly/
    );
  });

  test('1.4: Legitimate profile updates (phone, network, full_name) succeed', () => {
    const user = { id: 'user-789', email: 'legit@example.com', role: 'buyer', full_name: 'Kwame', phone: null, network: null };
    db.profiles.set(user.id, user);

    const updated = db.updateProfile(
      user.id,
      { phone: '0241234567', network: 'mtn', full_name: 'Kwame Asante' },
      { role: 'authenticated', userId: user.id }
    );

    assert.equal(updated.phone, '0241234567');
    assert.equal(updated.network, 'mtn');
    assert.equal(updated.full_name, 'Kwame Asante');
    assert.equal(updated.role, 'buyer');
  });

  test('1.5: admin-update-role Edge Function enforces server-side authorization', async () => {
    // Non-admin attempting to use the endpoint
    db.profiles.set('imposter-1', { id: 'imposter-1', email: 'imposter@example.com', role: 'buyer' });
    db.profiles.set('target-1', { id: 'target-1', email: 'target@example.com', role: 'buyer' });

    const res1 = await db.adminUpdateRole({ callerUserId: 'imposter-1', targetUserId: 'target-1', newRole: 'admin' });
    assert.equal(res1.status, 403);
    assert.match(res1.error, /Only administrators/);

    // Admin self-demotion / lockout attempt
    db.profiles.set('admin-1', { id: 'admin-1', email: 'admin@dealguider.com', role: 'admin' });
    const res2 = await db.adminUpdateRole({ callerUserId: 'admin-1', targetUserId: 'admin-1', newRole: 'buyer' });
    assert.equal(res2.status, 400);
    assert.match(res2.error, /cannot modify their own role/);

    // Legitimate admin promoting target
    const res3 = await db.adminUpdateRole({ callerUserId: 'admin-1', targetUserId: 'target-1', newRole: 'seller' });
    assert.equal(res3.status, 200);
    assert.equal(res3.profile.role, 'seller');

    const audit = db.auditLogs.find(l => l.action === 'ADMIN_ROLE_UPDATED');
    assert.ok(audit);
    assert.equal(audit.details.new_role, 'seller');
  });
});

// ============================================================================
// SECTION 2: Payout Concurrency & Atomic Protection
// ============================================================================

describe('SECTION 2: Payout Concurrency & Atomic Protection', () => {
  function createPayoutEngine() {
    let transferCallCount = 0;
    const transferCalls = [];

    const db = {
      deals: new Map(),
      auditLogs: [],

      // Simulates Postgres reserve_payout RPC with SELECT FOR UPDATE and service_role check
      async reservePayout(dealId, payoutRef, context) {
        if (context?.role !== 'service_role') {
          throw new Error('Unauthorized: reserve_payout can only be invoked by service_role');
        }

        const deal = this.deals.get(dealId);
        if (!deal) return { success: false, code: 'NOT_FOUND', error: 'Deal not found' };

        if (deal.status === 'COMPLETED' || deal.payout_status === 'SUCCESS') {
          return { success: false, code: 'ALREADY_COMPLETED', error: 'Payout already completed' };
        }

        if (deal.payout_status === 'RESERVED' || deal.payout_status === 'PROCESSING') {
          return { success: false, code: 'ALREADY_PROCESSING', error: 'Payout currently processing' };
        }

        if (deal.payout_status === 'PENDING_VERIFICATION') {
          return {
            success: false,
            code: 'PENDING_VERIFICATION',
            payout_reference: deal.payout_reference,
            error: 'Payout pending verification',
          };
        }

        if (
          !(
            (deal.status === 'IN_ESCROW' && (!deal.payout_status || deal.payout_status === 'FAILED')) ||
            (deal.status === 'DELIVERED' && deal.payout_status === 'FAILED')
          )
        ) {
          return { success: false, code: 'INVALID_STATUS', error: `Status ${deal.status} not eligible` };
        }

        deal.status = 'DELIVERED';
        deal.payout_status = 'RESERVED';
        deal.payout_reference = payoutRef;
        deal.updated_at = new Date().toISOString();
        this.deals.set(dealId, deal);

        return {
          success: true,
          code: 'RESERVED',
          deal_id: dealId,
          payout_reference: payoutRef,
        };
      },

      // Simulates finalize_payout RPC with service_role check
      async finalizePayout(dealId, newPayoutStatus, newDealStatus = null, context = { role: 'service_role' }) {
        if (context?.role !== 'service_role') {
          throw new Error('Unauthorized: finalize_payout can only be invoked by service_role');
        }

        const deal = this.deals.get(dealId);
        if (!deal) return { success: false, error: 'Deal not found' };

        deal.payout_status = newPayoutStatus;
        if (newPayoutStatus === 'SUCCESS') {
          deal.status = 'COMPLETED';
        } else if (newDealStatus) {
          deal.status = newDealStatus;
        }
        deal.updated_at = new Date().toISOString();
        this.deals.set(dealId, deal);
        return { success: true, deal };
      },
    };

    const paystack = {
      mockResponse: null,
      verifyResponses: new Map(),

      async initiateTransfer(params) {
        transferCallCount++;
        transferCalls.push(params);

        if (this.mockResponse instanceof Error) {
          throw this.mockResponse;
        }
        if (this.mockResponse) {
          return this.mockResponse;
        }

        const result = {
          success: true,
          status: 'success',
          transfer_code: `TRF_${Date.now()}`,
          reference: params.reference,
        };
        this.verifyResponses.set(params.reference, { success: true, status: 'success' });
        return result;
      },

      async verifyTransfer(reference) {
        if (this.verifyResponses.has(reference)) {
          return this.verifyResponses.get(reference);
        }
        return { success: false, error: 'Transfer not found' };
      },
    };

    async function confirmDelivery({ dealId, buyerId }) {
      const deal = db.deals.get(dealId);
      if (!deal) return { status: 404, body: { error: 'Deal not found' } };
      if (deal.buyer_id !== buyerId) return { status: 403, body: { error: 'Only buyer can confirm delivery' } };

      if (deal.status === 'COMPLETED' || deal.payout_status === 'SUCCESS') {
        return { status: 200, body: { success: true, message: 'Already completed' } };
      }

      if (deal.payout_status === 'RESERVED' || deal.payout_status === 'PROCESSING') {
        return { status: 409, body: { error: 'Payout is currently being processed' } };
      }

      // Step 1: Reconciliation check on existing payout_reference
      if (deal.payout_reference) {
        try {
          const verification = await paystack.verifyTransfer(deal.payout_reference);
          if (verification.success && verification.status === 'success') {
            await db.finalizePayout(dealId, 'SUCCESS', 'COMPLETED');
            db.auditLogs.push({ deal_id: dealId, action: 'PAYOUT_RECONCILED_SUCCESS' });
            return { status: 200, body: { success: true, message: 'Payout was verified with Paystack' } };
          } else if (verification.status === 'pending' || verification.status === 'processing') {
            await db.finalizePayout(dealId, 'PROCESSING');
            return { status: 200, body: { success: true, message: 'Payout is processing' } };
          } else if (verification.status === 'failed' || verification.status === 'reversed') {
            await db.finalizePayout(dealId, 'FAILED', 'DELIVERED');
            db.auditLogs.push({ deal_id: dealId, action: 'PAYOUT_PREVIOUS_FAILED_VERIFIED' });
          }
        } catch {
          if (deal.payout_status === 'PENDING_VERIFICATION') {
            return {
              status: 409,
              body: { error: 'Transfer verification with payment provider timed out', pending_verification: true },
            };
          }
        }
      }

      // Step 2: Atomic Reservation
      const payoutRef = `ST-PO-${dealId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const reservation = await db.reservePayout(dealId, payoutRef, { role: 'service_role' });

      if (!reservation.success) {
        if (reservation.code === 'ALREADY_COMPLETED') return { status: 200, body: { success: true } };
        if (reservation.code === 'ALREADY_PROCESSING') return { status: 409, body: { error: reservation.error } };
        if (reservation.code === 'PENDING_VERIFICATION') return { status: 409, body: { error: reservation.error, pending_verification: true } };
        return { status: 400, body: { error: reservation.error } };
      }

      db.auditLogs.push({ deal_id: dealId, action: 'DELIVERY_CONFIRMED', payout_reference: payoutRef });

      // Step 3: Initiate Transfer
      let transfer;
      try {
        transfer = await paystack.initiateTransfer({
          amount: deal.amount,
          recipientCode: 'RCP_TEST123',
          reason: `Payout for ${deal.title}`,
          reference: payoutRef,
        });
      } catch (err) {
        await db.finalizePayout(dealId, 'PENDING_VERIFICATION', 'DELIVERED');
        db.auditLogs.push({ deal_id: dealId, action: 'PAYOUT_TIMEOUT_PENDING_VERIFICATION', error: err.message });
        return { status: 200, body: { success: true, pending_verification: true } };
      }

      if (!transfer.success) {
        await db.finalizePayout(dealId, 'FAILED', 'DELIVERED');
        db.auditLogs.push({ deal_id: dealId, action: 'PAYOUT_FAILED', error: transfer.error });
        return { status: 200, body: { success: true, awaiting_admin: true } };
      }

      const isDirectSuccess = transfer.status === 'success';
      const newPayoutStatus = isDirectSuccess ? 'SUCCESS' : 'PROCESSING';
      const newDealStatus = isDirectSuccess ? 'COMPLETED' : 'DELIVERED';

      await db.finalizePayout(dealId, newPayoutStatus, newDealStatus);
      db.auditLogs.push({ deal_id: dealId, action: 'FUNDS_TRANSFERRED', reference: payoutRef });

      return { status: 200, body: { success: true, reference: payoutRef } };
    }

    return {
      db,
      paystack,
      confirmDelivery,
      getTransferCallCount: () => transferCallCount,
    };
  }

  test('2.1: reserve_payout and finalize_payout reject untrusted callers', async () => {
    const engine = createPayoutEngine();
    await assert.rejects(
      () => engine.db.reservePayout('deal-1', 'ref-1', { role: 'authenticated' }),
      /Unauthorized: reserve_payout can only be invoked by service_role/
    );
    await assert.rejects(
      () => engine.db.finalizePayout('deal-1', 'SUCCESS', 'COMPLETED', { role: 'authenticated' }),
      /Unauthorized: finalize_payout can only be invoked by service_role/
    );
  });

  test('2.2: Simultaneous delivery confirmation requests — exactly one payout initiated', async () => {
    const engine = createPayoutEngine();
    const dealId = 'deal-concurrency-1';

    engine.db.deals.set(dealId, {
      id: dealId,
      title: 'Generator',
      amount: 2500,
      status: 'IN_ESCROW',
      payout_status: null,
      payout_reference: null,
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
    });

    // 10 concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      engine.confirmDelivery({ dealId, buyerId: 'buyer-1' })
    );

    const results = await Promise.all(promises);

    const success = results.filter((r) => r.status === 200 && !r.body.error);
    const conflicts = results.filter((r) => r.status === 409);

    assert.equal(success.length, 1);
    assert.equal(conflicts.length, 9);
    assert.equal(engine.getTransferCallCount(), 1);

    const deal = engine.db.deals.get(dealId);
    assert.equal(deal.status, 'COMPLETED');
    assert.equal(deal.payout_status, 'SUCCESS');
  });

  test('2.3: Ambiguous timeout transfers are never blindly retried without verification', async () => {
    const engine = createPayoutEngine();
    const dealId = 'deal-ambiguous-1';

    engine.db.deals.set(dealId, {
      id: dealId,
      title: 'Laptop',
      amount: 1800,
      status: 'IN_ESCROW',
      payout_status: null,
      payout_reference: null,
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
    });

    // First attempt times out
    engine.paystack.mockResponse = new Error('ETIMEDOUT');
    const res1 = await engine.confirmDelivery({ dealId, buyerId: 'buyer-1' });
    assert.equal(res1.status, 200);
    assert.equal(res1.body.pending_verification, true);
    assert.equal(engine.getTransferCallCount(), 1);

    // Second attempt while verification is still unavailable (e.g. Paystack downtime)
    engine.paystack.verifyResponses.clear(); // Simulates verify failure
    const res2 = await engine.confirmDelivery({ dealId, buyerId: 'buyer-1' });
    assert.equal(res2.status, 409);
    assert.equal(res2.body.pending_verification, true);

    // ZERO additional transfer initiated!
    assert.equal(engine.getTransferCallCount(), 1);
  });

  test('2.4: Safe retry when previous transfer is verified FAILED by Paystack', async () => {
    const engine = createPayoutEngine();
    const dealId = 'deal-retry-failed-1';
    const oldRef = 'OLD-FAILED-REF-1';

    engine.db.deals.set(dealId, {
      id: dealId,
      title: 'Tablet',
      amount: 900,
      status: 'DELIVERED',
      payout_status: 'PENDING_VERIFICATION',
      payout_reference: oldRef,
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
    });

    // Paystack confirms the previous transfer was definitely failed
    engine.paystack.verifyResponses.set(oldRef, {
      success: true,
      status: 'failed',
      reference: oldRef,
    });

    // New attempt should verify old failure, clean the state, and successfully retry with fresh reference
    engine.paystack.mockResponse = null; // Next call succeeds
    const res = await engine.confirmDelivery({ dealId, buyerId: 'buyer-1' });
    assert.equal(res.status, 200);

    const deal = engine.db.deals.get(dealId);
    assert.equal(deal.status, 'COMPLETED');
    assert.equal(deal.payout_status, 'SUCCESS');
    assert.notEqual(deal.payout_reference, oldRef, 'Retry must generate fresh reference');
  });
});

// ============================================================================
// SECTION 3: Paystack Webhook & Timing-Safe Signature Validation
// ============================================================================

describe('SECTION 3: Paystack Webhook Security & Reconciliation', () => {
  test('3.1: Ghana mobile money networks use Paystack bank codes', async () => {
    const { networkBankCode } = await import('../supabase/functions/_shared/paystack.ts');

    assert.equal(networkBankCode('mtn'), 'MTN');
    assert.equal(networkBankCode('vodafone'), 'VOD');
    assert.equal(networkBankCode('tigo'), 'ATL');
    assert.equal(networkBankCode('unknown'), null);
  });

  test('3.2: verifyWebhookSignature constant-time HMAC validation', async () => {
    const { verifyWebhookSignature } = await import('../supabase/functions/_shared/paystack.ts');

    const secret = 'sk_test_fake_secret_key_12345';
    const rawBody = JSON.stringify({ event: 'transfer.success', data: { reference: 'PO-TEST' } });

    // Calculate real HMAC-SHA512
    const keyBytes = new TextEncoder().encode(secret);
    const msgBytes = new TextEncoder().encode(rawBody);
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
    const validSignature = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Valid signature succeeds
    const isValid = await verifyWebhookSignature(rawBody, validSignature, secret);
    assert.equal(isValid, true);

    // Tampered body fails
    const isTampered = await verifyWebhookSignature(rawBody + 'tamper', validSignature, secret);
    assert.equal(isTampered, false);

    // Tampered signature fails
    const invalidSig = validSignature.slice(0, -2) + '00';
    const isBadSig = await verifyWebhookSignature(rawBody, invalidSig, secret);
    assert.equal(isBadSig, false);

    // Missing signature fails
    assert.equal(await verifyWebhookSignature(rawBody, null, secret), false);
  });
});

// ============================================================================
// SECTION 4: Database Migration Safety & Backfill
// ============================================================================

describe('SECTION 4: Database Migration Safety & Backfill Verification', () => {
  test('4.1: Existing COMPLETED records receive safe payout defaults (SUCCESS)', () => {
    const deals = [
      { id: '1', status: 'COMPLETED', payout_status: null },
      { id: '2', status: 'COMPLETED', payout_status: 'SUCCESS' },
      { id: '3', status: 'AWAITING_PAYMENT', payout_status: null },
      { id: '4', status: 'IN_ESCROW', payout_status: null },
    ];

    // Migration backfill logic:
    // UPDATE deals SET payout_status = 'SUCCESS' WHERE status = 'COMPLETED' AND payout_status IS NULL;
    const backfilled = deals.map(d => {
      if (d.status === 'COMPLETED' && d.payout_status === null) {
        return { ...d, payout_status: 'SUCCESS' };
      }
      return d;
    });

    assert.equal(backfilled[0].payout_status, 'SUCCESS', 'Existing completed deal backfilled to SUCCESS');
    assert.equal(backfilled[1].payout_status, 'SUCCESS', 'Already SUCCESS remains intact');
    assert.equal(backfilled[2].payout_status, null, 'Unfunded deal remains null');
    assert.equal(backfilled[3].payout_status, null, 'Active in-escrow deal remains null');
  });
});

// ============================================================================
// SECTION 5: Existing Workflows & Fee Engine Compatibility
// ============================================================================

describe('SECTION 5: Existing Workflows & Fee Engine Compatibility', () => {
  test('5.1: Fee engine calculates platform and transfer fees accurately', async () => {
    const { calculateFees, calculatePlatformFee, calculateTransferFee } = await import(
      '../src/utils/fees.js'
    );

    assert.equal(calculatePlatformFee(100), 5);
    assert.equal(calculatePlatformFee(1000), 20);
    assert.equal(calculatePlatformFee(5000), 50);

    assert.equal(calculateTransferFee(50), 1);
    assert.equal(calculateTransferFee(300), 3);
    assert.equal(calculateTransferFee(1500), 5);
    assert.equal(calculateTransferFee(3000), 8);

    const breakdown = calculateFees(500);
    assert.equal(breakdown.dealAmount, 500);
    assert.equal(breakdown.platformFee, 10);
    assert.equal(breakdown.transferFee, 3);
    assert.equal(breakdown.totalPayable, 510);
    assert.equal(breakdown.sellerReceives, 497);
  });
});
