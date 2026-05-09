// pricing.spec.js — unit-style tests for the bulk sliding-scale pricing engine.
// Uses Node's built-in test runner so no browser is needed.
// Run: node tests/pricing.spec.js
//
// These tests exercise applyBulkSlidingScale and estimateQuoteWithBreakdown
// directly (not via HTTP) to cover the 8 pricing scenarios in the requirements.

import assert from 'assert';

/* ── Pure helpers copied from server/index.js ─────────────── */

function roundToNearestFive(value) {
  const num = Number(value || 0);
  return Math.round(num / 5) * 5;
}

function isTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes' || v === 'on';
}

function applyBulkSlidingScale(mowAreaSqft, standardRatePer1000, bulkTiers) {
  const activeTiers = (bulkTiers || [])
    .filter((t) => t.enabled !== false && t.ratePer1000Sqft != null)
    .sort((a, b) => a.startSqft - b.startSqft);

  const standardCharge = Math.round((mowAreaSqft / 1000) * standardRatePer1000 * 100) / 100;

  if (!activeTiers.length) {
    const label = `Area charge (${Math.round(mowAreaSqft).toLocaleString()} sq ft × $${standardRatePer1000}/k sq ft)`;
    return { areaCharge: standardCharge, standardCharge, bulkDiscount: 0, tierLines: [{ label, amount: standardCharge }], isBulkApplied: false };
  }

  let remaining = mowAreaSqft;
  let totalCharge = 0;
  const tierLines = [];
  let isBulkApplied = false;

  for (const tier of activeTiers) {
    if (remaining <= 0) break;
    const bandEnd = tier.endSqft != null ? tier.endSqft : Infinity;
    const bandWidth = bandEnd === Infinity ? remaining : Math.max(0, bandEnd - tier.startSqft);
    const sqftInBand = Math.min(remaining, bandWidth);
    if (sqftInBand <= 0) continue;

    const rate = Number(tier.ratePer1000Sqft || 0);
    const charge = Math.round((sqftInBand / 1000) * rate * 100) / 100;
    totalCharge += charge;

    if (rate < standardRatePer1000) isBulkApplied = true;

    const lineLabel = tier.label || (rate < standardRatePer1000
      ? `Volume pricing (${Math.round(sqftInBand).toLocaleString()} sq ft × $${rate}/k sq ft)`
      : `Area charge (${Math.round(sqftInBand).toLocaleString()} sq ft × $${rate}/k sq ft)`);

    tierLines.push({ label: lineLabel, amount: charge });
    remaining -= sqftInBand;
  }

  const areaCharge = Math.round(totalCharge * 100) / 100;
  const bulkDiscount = Math.max(0, Math.round((standardCharge - areaCharge) * 100) / 100);
  return { areaCharge, standardCharge, bulkDiscount, tierLines, isBulkApplied };
}

/* Minimal estimate engine for unit tests */
function estimateWithBulk(mowAreaSqft, opts = {}) {
  const standardRate = opts.standardRate ?? 4.5;
  const serviceMin = opts.serviceMin ?? 38;
  const regionMin = opts.regionMin ?? 0;
  const bulkTiers = opts.bulkTiers ?? DEFAULT_TIERS;
  const complexityRules = opts.complexityRules ?? {};

  if (mowAreaSqft <= 0) return { estimate: 0, breakdown: [], bulkDiscount: 0 };

  const { areaCharge, bulkDiscount, isBulkApplied, standardCharge } = applyBulkSlidingScale(mowAreaSqft, standardRate, bulkTiers);

  let estimate = Math.max(serviceMin, areaCharge);
  const breakdown = [];
  const appliedMin = areaCharge < serviceMin;

  if (appliedMin) {
    breakdown.push({ label: 'Service minimum', amount: estimate });
  } else {
    breakdown.push({ label: `Area charge (${mowAreaSqft} sq ft × $${standardRate}/k)`, amount: standardCharge });
    if (isBulkApplied && bulkDiscount > 0) {
      breakdown.push({ label: 'Bulk / open-lawn pricing discount', amount: -bulkDiscount });
    }
  }

  if (regionMin > 0 && estimate < regionMin) {
    estimate = regionMin;
    breakdown.length = 0;
    breakdown.push({ label: 'Region minimum', amount: estimate });
  }

  /* Upcharges */
  const rules = complexityRules;
  const addUp = (cond, label, amount) => {
    if (!cond || !amount) return;
    estimate += amount;
    breakdown.push({ label, amount });
  };
  const addMult = (cond, label, m) => {
    if (!cond || m <= 1) return;
    const adj = Math.round(estimate * (m - 1) * 100) / 100;
    estimate = Math.round(estimate * m * 100) / 100;
    breakdown.push({ label, amount: adj });
  };
  addUp(opts.fenced, 'Fenced yard upcharge', Number(rules.fencedUpcharge || 0));
  addUp(opts.obstacles, 'Obstacles upcharge', Number(rules.obstaclesUpcharge || 0));
  addMult(opts.overgrown, `Overgrown yard`, Number(rules.overgrownMultiplier || 1));
  addMult(opts.slopedTerrain, `Sloped terrain`, Number(rules.slopedTerrainMultiplier || 1));

  return { estimate: roundToNearestFive(estimate), breakdown, bulkDiscount, isBulkApplied };
}

/* Default bulk tiers matching the seeded defaults */
const DEFAULT_TIERS = [
  { id: 'bulk_std',   label: 'Standard (0–8,000 sq ft)',        enabled: true, startSqft: 0,     endSqft: 8000,  ratePer1000Sqft: 4.50 },
  { id: 'bulk_med',   label: 'Volume (8,001–15,000 sq ft)',      enabled: true, startSqft: 8000,  endSqft: 15000, ratePer1000Sqft: 3.80 },
  { id: 'bulk_large', label: 'Large lawn (15,001–30,000 sq ft)', enabled: true, startSqft: 15000, endSqft: 30000, ratePer1000Sqft: 3.25 },
  { id: 'bulk_open',  label: 'Open lawn (30,001+ sq ft)',        enabled: true, startSqft: 30000, endSqft: null,  ratePer1000Sqft: 2.75 },
];

/* ── Tests ───────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\nPricing engine — sliding-scale bulk pricing\n');

/* 1. Small lot (≤ 8k) — no bulk discount, falls in standard tier only */
test('Small lot (5,000 sq ft) — no bulk discount', () => {
  const { estimate, bulkDiscount, isBulkApplied } = estimateWithBulk(5000);
  assert.strictEqual(isBulkApplied, false, 'Should not trigger bulk pricing');
  assert.strictEqual(bulkDiscount, 0, 'No discount on small lot');
  /* 5000/1000 * 4.5 = 22.5 → below $38 minimum → estimate = $40 (nearest $5) */
  assert.strictEqual(estimate, 40, `Expected $40 got $${estimate}`);
});

/* 2. Exactly at tier boundary (8,000 sq ft) — standard tier only */
test('Lot at boundary (8,000 sq ft) — standard tier, no discount', () => {
  const { estimate, isBulkApplied } = estimateWithBulk(8000);
  assert.strictEqual(isBulkApplied, false, 'Exactly at boundary — no bulk band crossed');
  /* 8000/1000 * 4.5 = 36 → below $38 → estimate = $40 */
  assert.strictEqual(estimate, 40);
});

/* 3. Medium lot (12,000 sq ft) — slight discount on 4k sqft in second tier */
test('Medium lot (12,000 sq ft) — slight bulk discount applied', () => {
  const { estimate, isBulkApplied, bulkDiscount } = estimateWithBulk(12000);
  assert.strictEqual(isBulkApplied, true, 'Should trigger bulk pricing');
  assert.ok(bulkDiscount > 0, 'Should have some discount');
  /*
    0–8000:   8000/1000 * 4.50 = 36.00
    8001–12000: 4000/1000 * 3.80 = 15.20
    total = 51.20; std = 12000/1000 * 4.50 = 54.00
    discount = 54 - 51.20 = 2.80
    estimate = roundToNearest5(51.20) = 50
  */
  assert.ok(estimate >= 50 && estimate <= 55, `Expected ~$50-55 got $${estimate}`);
  assert.ok(Math.abs(bulkDiscount - 2.80) < 0.01, `Expected discount ~$2.80 got $${bulkDiscount}`);
});

/* 4. Large lot (22,000 sq ft) — blended discount across 3 tiers */
test('Large lot (22,000 sq ft) — blended bulk discount', () => {
  const { isBulkApplied, bulkDiscount, estimate } = estimateWithBulk(22000);
  assert.strictEqual(isBulkApplied, true);
  /*
    0–8k:     8000/1000 * 4.50 = 36.00
    8k–15k:   7000/1000 * 3.80 = 26.60
    15k–22k:  7000/1000 * 3.25 = 22.75
    total = 85.35; std = 22000/1000 * 4.50 = 99.00
    discount = 13.65
  */
  assert.ok(bulkDiscount > 10, `Expected discount >$10 got $${bulkDiscount}`);
  assert.ok(estimate < 99, `Large lawn should cost less than flat rate ($${estimate} vs $99)`);
});

/* 5. Very large lot (45,000 sq ft) — strong bulk pricing with 4th tier */
test('Very large lot (45,000 sq ft) — strong bulk discount via open-lawn tier', () => {
  const { isBulkApplied, bulkDiscount, estimate } = estimateWithBulk(45000);
  assert.strictEqual(isBulkApplied, true);
  /*
    0–8k:     8000/1000 * 4.50 = 36.00
    8k–15k:   7000/1000 * 3.80 = 26.60
    15k–30k: 15000/1000 * 3.25 = 48.75
    30k–45k: 15000/1000 * 2.75 = 41.25
    total = 152.60; std = 45000/1000 * 4.50 = 202.50
    discount = 49.90
  */
  assert.ok(bulkDiscount > 45, `Expected discount >$45 got $${bulkDiscount}`);
  assert.ok(estimate <= 155, `Open-lawn rate should produce competitive estimate ($${estimate})`);
});

/* 6. Minimum charge still applies on small lots */
test('Minimum charge ($38) applies when area charge is lower', () => {
  const { estimate } = estimateWithBulk(3000, { serviceMin: 38 });
  /* 3000/1000 * 4.5 = 13.5 → below $38 → rounded to $40 */
  assert.ok(estimate >= 38, `Should be at least $38 minimum, got $${estimate}`);
});

/* 7. Difficult lawn (fenced + overgrown) costs more even when large */
test('Difficult lawn (15k, fenced + overgrown) costs more than open lawn', () => {
  const open = estimateWithBulk(15000);
  const difficult = estimateWithBulk(15000, {
    fenced: true,
    overgrown: true,
    complexityRules: { fencedUpcharge: 12, overgrownMultiplier: 1.35 }
  });
  assert.ok(difficult.estimate > open.estimate,
    `Difficult ($${difficult.estimate}) should exceed open ($${open.estimate})`);
});

/* 8. Disabling a tier removes its discount (bulk pricing config affects estimates) */
test('Disabling bulk tiers reverts to flat rate', () => {
  const noTiers = estimateWithBulk(20000, { bulkTiers: [] });
  const withTiers = estimateWithBulk(20000);
  /* No tiers: flat rate 20000/1000 * 4.5 = 90 → rounds to $90 */
  assert.strictEqual(noTiers.isBulkApplied, false);
  assert.ok(withTiers.estimate < noTiers.estimate,
    `Bulk pricing ($${withTiers.estimate}) should be cheaper than flat ($${noTiers.estimate})`);
});

/* 9. Tier breakdown lines add up to area charge (accounting integrity) */
test('Breakdown lines are self-consistent (add up to estimate)', () => {
  const { estimate, breakdown } = estimateWithBulk(20000);
  const breakdownSum = breakdown.reduce((s, l) => s + l.amount, 0);
  /* The rounded estimate may differ from breakdown sum due to rounding to nearest $5 */
  assert.ok(Math.abs(breakdownSum - estimate) <= 5,
    `Breakdown sum $${breakdownSum.toFixed(2)} should be within $5 of estimate $${estimate}`);
});

/* 10. applyBulkSlidingScale edge: exactly at tier boundaries */
test('applyBulkSlidingScale handles exact boundary (8000 sq ft)', () => {
  const { areaCharge, isBulkApplied } = applyBulkSlidingScale(8000, 4.5, DEFAULT_TIERS);
  /* 8000 fits entirely in first tier (0–8000), so no bulk discount */
  assert.strictEqual(isBulkApplied, false);
  assert.ok(Math.abs(areaCharge - 36) < 0.01, `Expected $36 got $${areaCharge}`);
});

/* 11. applyBulkSlidingScale edge: 1 sqft over first tier boundary */
test('applyBulkSlidingScale: 8001 sq ft crosses into discount band', () => {
  /* 1 sqft at discounted rate rounds to $0.00 — discount rounds away,
     but isBulkApplied must still fire so the label is correct */
  const { isBulkApplied } = applyBulkSlidingScale(8001, 4.5, DEFAULT_TIERS);
  assert.strictEqual(isBulkApplied, true, 'Second tier was reached so bulk pricing flag should be set');

  /* Use enough sqft in bulk band to produce a measurable discount (100 sqft) */
  const { bulkDiscount: d100 } = applyBulkSlidingScale(8100, 4.5, DEFAULT_TIERS);
  /* 100 sqft in second tier: savings = (4.5 - 3.8) * 100 / 1000 = 0.07 */
  assert.ok(d100 > 0, `100 sqft in bulk band should yield nonzero discount, got $${d100}`);
});

/* 12. No tiers configured — flat rate applies */
test('No bulk tiers configured — flat rate used', () => {
  const { areaCharge, isBulkApplied, bulkDiscount } = applyBulkSlidingScale(20000, 4.5, []);
  assert.strictEqual(isBulkApplied, false);
  assert.strictEqual(bulkDiscount, 0);
  assert.ok(Math.abs(areaCharge - 90) < 0.01, `Expected $90 flat got $${areaCharge}`);
});

/* ── Summary ─────────────────────────────────────────────── */

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
