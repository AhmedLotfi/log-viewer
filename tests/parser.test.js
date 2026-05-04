/**
 * Tests for the pure helpers in js/parser.js.
 *
 * Run with:  node --test tests/
 *
 * Uses Node 18+ built-in test runner — no framework, no install step.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeApiPath,
    normalizeExceptionMessage,
    formatMs,
    formatSpan,
    formatNumber,
    healthLabel,
    healthClass
} = require('../js/parser.js');

// ---------- normalizeApiPath ----------

test('normalizeApiPath: numeric id in middle', () => {
    assert.equal(normalizeApiPath('/api/users/123/posts'), '/api/users/{id}/posts');
});

test('normalizeApiPath: numeric id at end', () => {
    assert.equal(normalizeApiPath('/api/users/123'), '/api/users/{id}');
});

test('normalizeApiPath: GUID in middle', () => {
    assert.equal(
        normalizeApiPath('/api/orders/b3a1f2c4-1234-5678-9abc-def012345678/items'),
        '/api/orders/{id}/items'
    );
});

test('normalizeApiPath: GUID at end', () => {
    assert.equal(
        normalizeApiPath('/api/orders/b3a1f2c4-1234-5678-9abc-def012345678'),
        '/api/orders/{id}'
    );
});

test('normalizeApiPath: leaves non-id segments alone', () => {
    assert.equal(normalizeApiPath('/api/health'), '/api/health');
});

test('normalizeApiPath: groups two paths with different ids identically', () => {
    const a = normalizeApiPath('/api/users/1/posts/99');
    const b = normalizeApiPath('/api/users/42/posts/1000');
    assert.equal(a, b);
});

// ---------- normalizeExceptionMessage ----------

test('normalizeExceptionMessage: collapses GUID', () => {
    assert.equal(
        normalizeExceptionMessage('Tenant b3a1f2c4-1234-5678-9abc-def012345678 not found'),
        'Tenant {id} not found'
    );
});

test('normalizeExceptionMessage: collapses ISO timestamp', () => {
    assert.equal(
        normalizeExceptionMessage('Failed at 2024-01-15T10:30:45.123Z'),
        'Failed at {ts}'
    );
});

test('normalizeExceptionMessage: collapses email', () => {
    assert.equal(
        normalizeExceptionMessage('User foo@example.com denied'),
        'User {email} denied'
    );
});

test('normalizeExceptionMessage: collapses hyphen-separated codes', () => {
    assert.equal(
        normalizeExceptionMessage('Order ORD-2024-001 cancelled'),
        'Order {id} cancelled'
    );
});

test('normalizeExceptionMessage: collapses bare alphanumeric IDs', () => {
    assert.equal(
        normalizeExceptionMessage('Account No. AL6351 not found'),
        'Account No. {id} not found'
    );
});

test('normalizeExceptionMessage: collapses numeric ids', () => {
    assert.equal(
        normalizeExceptionMessage('User 12345 does not exist'),
        'User {id} does not exist'
    );
});

test('normalizeExceptionMessage: collapses single-quoted values', () => {
    assert.equal(
        normalizeExceptionMessage("Could not find user 'jdoe'"),
        "Could not find user '{val}'"
    );
});

test('normalizeExceptionMessage: collapses double-quoted values', () => {
    assert.equal(
        normalizeExceptionMessage('Invalid input "blob"'),
        'Invalid input "{val}"'
    );
});

test('normalizeExceptionMessage: collapses hex blobs', () => {
    assert.equal(
        normalizeExceptionMessage('Hash mismatch: a1b2c3d4e5f6'),
        'Hash mismatch: {hex}'
    );
});

test('normalizeExceptionMessage: trims trailing punctuation', () => {
    assert.equal(
        normalizeExceptionMessage('Already exists.'),
        'Already exists'
    );
});

test('normalizeExceptionMessage: same template groups together', () => {
    const a = normalizeExceptionMessage('Account No. AL6351 not found');
    const b = normalizeExceptionMessage('Account No. AL9999 not found');
    assert.equal(a, b);
});

test('normalizeExceptionMessage: different templates stay distinct', () => {
    const a = normalizeExceptionMessage('Account No. AL6351 not found');
    const b = normalizeExceptionMessage('Account No. AL6351 expired');
    assert.notEqual(a, b);
});

test('normalizeExceptionMessage: handles null/empty', () => {
    assert.equal(normalizeExceptionMessage(null), null);
    assert.equal(normalizeExceptionMessage(''), '');
    assert.equal(normalizeExceptionMessage(undefined), undefined);
});

test('normalizeExceptionMessage: combined patterns in one string', () => {
    assert.equal(
        normalizeExceptionMessage(
            "Invalid token AL6351 for user foo@example.com at 2024-01-15T10:30:45Z"
        ),
        'Invalid token {id} for user {email} at {ts}'
    );
});

// ---------- formatMs ----------

test('formatMs: null/undefined/Infinity → em dash', () => {
    assert.equal(formatMs(null), '—');
    assert.equal(formatMs(undefined), '—');
    assert.equal(formatMs(Infinity), '—');
    assert.equal(formatMs(-Infinity), '—');
});

test('formatMs: sub-millisecond → 2 decimals', () => {
    assert.equal(formatMs(0.5), '0.50');
});

test('formatMs: under 100ms → 1 decimal', () => {
    assert.equal(formatMs(42.7), '42.7');
});

test('formatMs: 100ms+ → integer', () => {
    assert.equal(formatMs(150.4), '150');
    assert.equal(formatMs(1234), '1234');
});

// ---------- formatSpan ----------

test('formatSpan: zero or sub-minute → "0m"', () => {
    assert.equal(formatSpan(0), '0m');
    assert.equal(formatSpan(30 * 1000), '0m');
});

test('formatSpan: minutes only', () => {
    assert.equal(formatSpan(45 * 60 * 1000), '45m');
});

test('formatSpan: hours and minutes, no days', () => {
    assert.equal(formatSpan((2 * 60 + 30) * 60 * 1000), '2h 30m');
});

test('formatSpan: days, hours, minutes', () => {
    assert.equal(formatSpan(((1 * 24 + 5) * 60 + 12) * 60 * 1000), '1d 5h 12m');
});

test('formatSpan: omits zero leading parts but keeps last unit', () => {
    assert.equal(formatSpan(2 * 60 * 60 * 1000), '2h'); // exactly 2h, 0m skipped
});

// ---------- formatNumber ----------

test('formatNumber: small numbers as-is', () => {
    assert.equal(formatNumber(0), '0');
    assert.equal(formatNumber(42), '42');
    assert.equal(formatNumber(999), '999');
});

test('formatNumber: thousands locale-formatted', () => {
    // Locale separator can be , or space depending on environment;
    // test that it's not the bare digits.
    const result = formatNumber(1234567);
    assert.ok(/[,\s.]/.test(result), 'expected separator in: ' + result);
});

test('formatNumber: handles null and NaN', () => {
    assert.equal(formatNumber(null), '0');
    assert.equal(formatNumber(NaN), '0');
});

// ---------- healthLabel / healthClass ----------

test('healthLabel: thresholds', () => {
    assert.equal(healthLabel(95), 'Excellent');
    assert.equal(healthLabel(90), 'Excellent');
    assert.equal(healthLabel(89), 'Good');
    assert.equal(healthLabel(75), 'Good');
    assert.equal(healthLabel(74), 'Fair');
    assert.equal(healthLabel(50), 'Fair');
    assert.equal(healthLabel(49), 'Critical');
    assert.equal(healthLabel(0), 'Critical');
});

test('healthClass: thresholds', () => {
    assert.equal(healthClass(95), 'health-excellent');
    assert.equal(healthClass(80), 'health-good');
    assert.equal(healthClass(60), 'health-fair');
    assert.equal(healthClass(20), 'health-critical');
});
