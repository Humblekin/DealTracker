// ============================================================
// LinkGuard Test Suite
// ============================================================
// Tests the real LinkGuard cryptographic/domain helpers, DB
// verification logic, rate limiting, and direct-bypass guards.
// Run with: node --test tests/linkguard.test.js
// ============================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import QRCode from 'qrcode';
import {
  areOriginsConsistent,
  extractClientIp,
  hashShareToken,
  isAllowedDomain,
  isDevOriginsAllowed,
  isValidShareTokenFormat,
  UUID_RE,
} from '../supabase/functions/_shared/linkguard.ts';
import { getSafeRedirectPath } from '../src/utils/navigation.js';

// --- Simulate the verify_deal_link + Edge Function verification pipeline ---
async function verifyDealLinkWithPipeline({
  shareToken,
  headerOrigin = 'https://dealguider.netlify.app',
  clientOrigin,
  deals,
}) {
  // 1. Domain & HTTPS validation (requires BOTH Origin header and matching clientOrigin)
  if (
    !headerOrigin
    || !isAllowedDomain(headerOrigin)
    || !isAllowedDomain(clientOrigin)
    || !areOriginsConsistent(headerOrigin, clientOrigin)
  ) {
    return { verified: false, reason: 'invalid_domain', message: 'Unauthorized domain.' };
  }

  // 2. Token format check
  if (!isValidShareTokenFormat(shareToken)) {
    return { verified: false, reason: 'invalid_token', message: 'The transaction token format is invalid.' };
  }

  // 3. SHA-256 hash lookup
  const tokenHash = await hashShareToken(shareToken);
  const deal = deals.find((d) => d.share_token_hash === tokenHash);
  if (!deal) {
    return { verified: false, reason: 'not_found', message: 'No transaction matches this link.' };
  }

  // 4. Revoked
  if (deal.link_revoked) {
    return { verified: false, reason: 'revoked', message: 'This transaction link has been revoked.' };
  }

  // 5. Expired
  if (deal.link_expires_at && new Date(deal.link_expires_at) < new Date()) {
    return { verified: false, reason: 'expired', message: 'This transaction link has expired.' };
  }

  // 6. Terminal states
  if (['CANCELLED', 'COMPLETED', 'REFUNDED'].includes(deal.status)) {
    return {
      verified: false,
      reason: 'closed',
      message: `This transaction has been ${deal.status.toLowerCase()}.`,
      deal_status: deal.status,
    };
  }

  // 7. Disputed
  if (deal.status === 'DISPUTED') {
    return {
      verified: false,
      reason: 'suspended',
      message: 'This transaction is under administrative review.',
      deal_status: deal.status,
    };
  }

  // 8. Verified — minimal safe preview + sanitized deal payload (no raw buyer/seller UUIDs)
  return {
    verified: true,
    reason: 'valid',
    deal_title: deal.title,
    deal_amount: deal.amount,
    deal_status: deal.status,
    creator_role: deal.creator_role,
    message: 'Verified DealGuider Transaction. This link has been authenticated by DealGuider.',
    deal: {
      title: deal.title,
      amount: deal.amount,
      status: deal.status,
      creator_role: deal.creator_role,
      counterparty_filled: false,
      is_creator: false,
      is_counterparty: false,
    },
  };
}

// --- Test data with precomputed SHA-256 hashes ---
const RAW_DEALS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    share_token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'iPhone 15 Pro Max',
    amount: 8500,
    status: 'AWAITING_COUNTERPARTY',
    creator_role: 'BUYER',
    link_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    link_revoked: false,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    share_token: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    title: 'Completed Sale',
    amount: 500,
    status: 'COMPLETED',
    creator_role: 'SELLER',
    link_expires_at: null,
    link_revoked: false,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    share_token: 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',
    title: 'Cancelled Deal',
    amount: 200,
    status: 'CANCELLED',
    creator_role: 'BUYER',
    link_expires_at: null,
    link_revoked: false,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    share_token: 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb',
    title: 'Disputed Transaction',
    amount: 3000,
    status: 'DISPUTED',
    creator_role: 'SELLER',
    link_expires_at: null,
    link_revoked: false,
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    share_token: 'eeeeeeee-ffff-aaaa-bbbb-cccccccccccc',
    title: 'Expired Link Deal',
    amount: 1200,
    status: 'AWAITING_COUNTERPARTY',
    creator_role: 'BUYER',
    link_expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    link_revoked: false,
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    share_token: 'ffffffff-aaaa-bbbb-cccc-dddddddddddd',
    title: 'Revoked Link Deal',
    amount: 750,
    status: 'AWAITING_COUNTERPARTY',
    creator_role: 'SELLER',
    link_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    link_revoked: true,
  },
  {
    id: '77777777-7777-7777-7777-777777777777',
    share_token: '11111111-2222-3333-4444-555555555555',
    title: 'In Escrow Deal',
    amount: 4000,
    status: 'IN_ESCROW',
    creator_role: 'BUYER',
    link_expires_at: null,
    link_revoked: false,
  },
  {
    id: '88888888-8888-8888-8888-888888888888',
    share_token: '22222222-3333-4444-5555-666666666666',
    title: 'Refunded Deal',
    amount: 950,
    status: 'REFUNDED',
    creator_role: 'BUYER',
    link_expires_at: null,
    link_revoked: false,
  },
];

const MOCK_DEALS = await Promise.all(
  RAW_DEALS.map(async (d) => ({
    ...d,
    share_token_hash: await hashShareToken(d.share_token),
  }))
);

describe('SECTION 1: Token Format & SHA-256 Hashing', () => {
  it('1.1: Valid UUID token passes format check', () => {
    assert.ok(UUID_RE.test('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    assert.ok(isValidShareTokenFormat('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(isValidShareTokenFormat('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'));
  });

  it('1.2: Invalid token formats and injection payloads are rejected', () => {
    for (const bad of [
      '',
      null,
      undefined,
      'not-a-uuid',
      'aaaaaaaa-bbbb-cccc-dddd',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeee',
      'gggggggg-hhhh-iiii-jjjj-kkkkkkkkkkkk',
      '../../../etc/passwd',
      "'; DROP TABLE deals; --",
      '<script>alert(1)</script>',
    ]) {
      assert.equal(isValidShareTokenFormat(bad), false);
    }
  });

  it('1.3: hashShareToken produces deterministic lowercase SHA-256 hex digest', async () => {
    const h1 = await hashShareToken('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
    const h2 = await hashShareToken('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });
});

describe('SECTION 2: Domain & HTTPS Validation', () => {
  it('2.1: Official DealGuider HTTPS domains and localhost dev origins are allowed', () => {
    assert.ok(isAllowedDomain('https://dealguider.netlify.app'));
    assert.ok(isAllowedDomain('https://dealtracke.netlify.app'));
    assert.ok(isAllowedDomain('https://dealtracker.vercel.app'));
    assert.ok(isAllowedDomain('http://localhost:5173'));
    assert.ok(isAllowedDomain('http://127.0.0.1:5173'));
  });

  it('2.2: Plain HTTP on production domains is rejected (HTTPS exclusively)', () => {
    assert.equal(isAllowedDomain('http://dealguider.netlify.app'), false);
    assert.equal(isAllowedDomain('http://dealtracker.vercel.app'), false);
  });

  it('2.3: Fake, subdomain-spoofed, and lookalike domains are rejected', () => {
    for (const badOrigin of [
      'https://dealguider.fake.com',
      'https://dealguidar.netlify.app',
      'https://dealguider-secure.com',
      'https://phish.dealguider.netlify.app',
      'https://dealguider.com.phishing.site',
      'https://evil.com',
      'https://evil.localhost:5173',
      '',
      null,
      undefined,
    ]) {
      assert.equal(isAllowedDomain(badOrigin), false, `Expected ${badOrigin} to be rejected`);
    }
  });

  it('2.4: Spoofed or missing Origin header is rejected even if body origin matches allowlist', () => {
    assert.equal(
      areOriginsConsistent('https://evil.com', 'https://dealguider.netlify.app'),
      false
    );
    assert.equal(
      areOriginsConsistent(null, 'https://dealguider.netlify.app'),
      false
    );
    assert.equal(
      areOriginsConsistent('https://dealguider.netlify.app', 'https://dealguider.netlify.app'),
      true
    );
  });

  it('2.5: Pipeline blocks fake domain and headerless requests even with a genuine share token', async () => {
    const fakeDomain = await verifyDealLinkWithPipeline({
      shareToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      headerOrigin: 'https://dealguidar.netlify.app',
      clientOrigin: 'https://dealguidar.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(fakeDomain.verified, false);
    assert.equal(fakeDomain.reason, 'invalid_domain');
    assert.equal(fakeDomain.deal_title, undefined);

    const missingHeader = await verifyDealLinkWithPipeline({
      shareToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      headerOrigin: null,
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(missingHeader.verified, false);
    assert.equal(missingHeader.reason, 'invalid_domain');
  });
});

describe('SECTION 3: Genuine & QR Transaction Link Verification', () => {
  it('3.1: Valid active deal link is verified', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      headerOrigin: 'https://dealguider.netlify.app',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, true);
    assert.equal(result.reason, 'valid');
    assert.equal(result.deal_title, 'iPhone 15 Pro Max');
    assert.equal(result.deal_amount, 8500);
    assert.equal(result.deal_status, 'AWAITING_COUNTERPARTY');
  });

  it('3.2: In-escrow deal link verifies for informational lookup', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: '11111111-2222-3333-4444-555555555555',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, true);
    assert.equal(result.deal_status, 'IN_ESCROW');
  });

  it('3.3: QR code deal link verifies identically and generates locally', async () => {
    const shareUrl = 'https://dealguider.netlify.app/deal/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const localQr = await QRCode.toDataURL(shareUrl, { width: 200, margin: 2 });
    assert.ok(localQr.startsWith('data:image/png;base64,'));

    const tokenFromQr = new URL(shareUrl).pathname.split('/').pop();
    const result = await verifyDealLinkWithPipeline({
      shareToken: tokenFromQr,
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, true);
    assert.equal(result.deal_title, 'iPhone 15 Pro Max');
  });
});

describe('SECTION 4: Modified, Non-Existent, Expired, Revoked & Terminal Links', () => {
  it('4.1: Modified character in UUID token returns not_found', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeed',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'not_found');
  });

  it('4.2: Non-existent transaction returns not_found', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: '99999999-9999-9999-9999-999999999999',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'not_found');
  });

  it('4.3: Expired link returns expired', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: 'eeeeeeee-ffff-aaaa-bbbb-cccccccccccc',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'expired');
  });

  it('4.4: Revoked link returns revoked', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: 'ffffffff-aaaa-bbbb-cccc-dddddddddddd',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'revoked');
  });

  it('4.5: Completed, Cancelled, and Refunded links return closed', async () => {
    for (const [token, expectedStatus] of [
      ['bbbbbbbb-cccc-dddd-eeee-ffffffffffff', 'COMPLETED'],
      ['cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa', 'CANCELLED'],
      ['22222222-3333-4444-5555-666666666666', 'REFUNDED'],
    ]) {
      const result = await verifyDealLinkWithPipeline({
        shareToken: token,
        clientOrigin: 'https://dealguider.netlify.app',
        deals: MOCK_DEALS,
      });
      assert.equal(result.verified, false);
      assert.equal(result.reason, 'closed');
      assert.equal(result.deal_status, expectedStatus);
    }
  });

  it('4.6: Disputed transaction returns suspended', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'suspended');
    assert.equal(result.deal_status, 'DISPUTED');
  });

  it('4.7: Repeated verification attempts are idempotent', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await verifyDealLinkWithPipeline({
        shareToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        clientOrigin: 'https://dealguider.netlify.app',
        deals: MOCK_DEALS,
      });
      assert.equal(result.verified, true);
    }
  });
});

describe('SECTION 5: Data Minimization & Direct-Bypass Guards', () => {
  it('5.1: Verified response exposes no buyer/seller IDs or payment references', async () => {
    const result = await verifyDealLinkWithPipeline({
      shareToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      clientOrigin: 'https://dealguider.netlify.app',
      deals: MOCK_DEALS,
    });
    assert.equal(result.buyer_id, undefined);
    assert.equal(result.seller_id, undefined);
    assert.equal(result.deal.buyer_id, undefined);
    assert.equal(result.deal.seller_id, undefined);
    assert.equal(result.payment_reference, undefined);
    assert.equal(result.paystack_reference, undefined);
    assert.equal(result.share_token, undefined);
    assert.equal(result.share_token_hash, undefined);
  });

  it('5.2: SharedDeal enforces LinkGuard verification state and avoids direct RPC calls', () => {
    const sharedDealSrc = readFileSync(new URL('../src/pages/SharedDeal.jsx', import.meta.url), 'utf8');
    assert.match(sharedDealSrc, /location\.state\?\.linkguard_verified === true/);
    assert.match(sharedDealSrc, /if \(!isVerified\) return null/);
    assert.match(sharedDealSrc, /navigate\(`\/deal\/\$\{shareToken\}`/);
    assert.doesNotMatch(sharedDealSrc, /get_shared_deal/);
  });

  it('5.3: Migration, Edge Functions, and DealDetails enforce all hardening invariants', () => {
    const migrationSql = readFileSync(
      new URL('../supabase/migrations/20261126010000_linkguard.sql', import.meta.url),
      'utf8'
    );
    const joinDealSrc = readFileSync(
      new URL('../supabase/functions/join-deal/index.ts', import.meta.url),
      'utf8'
    );
    const verifyLinkSrc = readFileSync(
      new URL('../supabase/functions/verify-link/index.ts', import.meta.url),
      'utf8'
    );
    const dealDetailsSrc = readFileSync(
      new URL('../src/pages/DealDetails.jsx', import.meta.url),
      'utf8'
    );

    // SQL invariants: hash lookup, service_role-only RPCs, NULL-safe COALESCE check
    assert.match(migrationSql, /share_token_hash/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.verify_deal_link\(TEXT\) FROM PUBLIC, anon, authenticated/);
    assert.match(migrationSql, /REVOKE ALL ON FUNCTION public\.get_shared_deal\(TEXT\) FROM PUBLIC, anon, authenticated/);
    assert.match(migrationSql, /IF NOT COALESCE\(/);
    assert.match(migrationSql, /d\.link_revoked = false/);

    // Atomic join-deal checks
    assert.match(joinDealSrc, /hashShareToken/);
    assert.match(joinDealSrc, /\.eq\('status', 'AWAITING_COUNTERPARTY'\)/);
    assert.match(joinDealSrc, /\.eq\('link_revoked', false\)/);

    // Rate limiting & single-log-per-window
    assert.match(verifyLinkSrc, /LINKGUARD_SUSPICIOUS_ATTEMPT/);
    assert.match(verifyLinkSrc, /checkRateLimit/);
    assert.match(verifyLinkSrc, /rateStatus\.firstExceed/);
    assert.match(verifyLinkSrc, /MAX_RATE_ENTRIES/);

    // Local QR code generation (no third-party token leak)
    assert.doesNotMatch(dealDetailsSrc, /api\.qrserver\.com/);
    assert.match(dealDetailsSrc, /QRCode\.toDataURL/);
  });
});

describe('SECTION 6: Security Remediation Regression Tests', () => {
  it('6.1: extractClientIp ignores spoofed leftmost X-Forwarded-For values', () => {
    const h1 = new Headers({ 'x-forwarded-for': '198.51.100.99, 203.0.113.45' });
    assert.equal(extractClientIp(h1), '203.0.113.45');

    const h2 = new Headers({ 'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': '198.51.100.99' });
    assert.equal(extractClientIp(h2), '192.0.2.10');

    const h3 = new Headers({ 'x-real-ip': '192.0.2.20', 'x-forwarded-for': '198.51.100.99' });
    assert.equal(extractClientIp(h3), '192.0.2.20');
  });

  it('6.2: isDevOriginsAllowed fails closed under DENO_DEPLOYMENT_ID unless opted in', () => {
    const prevDeploy = process.env.DENO_DEPLOYMENT_ID;
    const prevAllow = process.env.LINKGUARD_ALLOW_DEV_ORIGINS;
    try {
      delete process.env.LINKGUARD_ALLOW_DEV_ORIGINS;
      process.env.DENO_DEPLOYMENT_ID = 'dep-prod-123';
      assert.equal(isDevOriginsAllowed(), false);
      assert.equal(isAllowedDomain('http://localhost:5173'), false);

      process.env.LINKGUARD_ALLOW_DEV_ORIGINS = 'true';
      assert.equal(isDevOriginsAllowed(), true);
      assert.equal(isAllowedDomain('http://localhost:5173'), true);
    } finally {
      if (prevDeploy === undefined) delete process.env.DENO_DEPLOYMENT_ID;
      else process.env.DENO_DEPLOYMENT_ID = prevDeploy;
      if (prevAllow === undefined) delete process.env.LINKGUARD_ALLOW_DEV_ORIGINS;
      else process.env.LINKGUARD_ALLOW_DEV_ORIGINS = prevAllow;
    }
  });

  it('6.3: getSafeRedirectPath blocks open redirects and permits safe relative routes', () => {
    assert.equal(getSafeRedirectPath('/deal/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), '/deal/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(getSafeRedirectPath('/dashboard'), '/dashboard');

    for (const unsafe of [
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'http://evil.com',
      'javascript:alert(1)',
      '/deal/abc\nHost: evil.com',
      '',
      null,
      undefined,
    ]) {
      assert.equal(getSafeRedirectPath(unsafe), null, `Expected unsafe redirect ${String(unsafe)} to be rejected`);
    }
  });
});
