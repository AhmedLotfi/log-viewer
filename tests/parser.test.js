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
    healthClass,
    detectJsonLines,
    mapJsonLevel,
    parseJsonLine,
    parseTextChunk,
    parseTextChunkInto,
    flushPartialChunk,
    parseJsonChunk,
    parseAll
} = require('../js/parser.js');

// Helpers shared by parseTextChunk / parseAll tests.
function makeState() {
    return {
        logs: [],
        apiCalls: new Map(),
        innerApiCalls: new Map(),
        apiByCorrelation: new Map(),
        currentInnerCall: null
    };
}

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

// ---------- detectJsonLines ----------

test('detectJsonLines: bracketed text returns false', () => {
    assert.equal(detectJsonLines('2024-01-15 10:30:45.123 +00:00 [INF] [thread-1] hello'), false);
});

test('detectJsonLines: CLEF first line returns true', () => {
    const sample = '{"@t":"2024-01-15T10:30:45.123Z","@l":"Information","@m":"hi"}\n{"@t":"..."}';
    assert.equal(detectJsonLines(sample), true);
});

test('detectJsonLines: empty string returns false', () => {
    assert.equal(detectJsonLines(''), false);
    assert.equal(detectJsonLines(null), false);
});

test('detectJsonLines: plain "{" without parseable JSON returns false', () => {
    assert.equal(detectJsonLines('{ this is not json }'), false);
});

test('detectJsonLines: tolerates BOM + leading whitespace', () => {
    assert.equal(detectJsonLines('﻿\n  {"@t":"2024-01-15T10:30:45Z","@m":"x"}'), true);
});

// ---------- mapJsonLevel ----------

test('mapJsonLevel: Serilog CLEF abbreviations', () => {
    assert.equal(mapJsonLevel('Verbose'), 'debug');
    assert.equal(mapJsonLevel('Debug'), 'debug');
    assert.equal(mapJsonLevel('Information'), 'information');
    assert.equal(mapJsonLevel('Warning'), 'warning');
    assert.equal(mapJsonLevel('Error'), 'error');
    assert.equal(mapJsonLevel('Fatal'), 'error');
});

test('mapJsonLevel: short codes', () => {
    assert.equal(mapJsonLevel('DBG'), 'debug');
    assert.equal(mapJsonLevel('INF'), 'information');
    assert.equal(mapJsonLevel('WRN'), 'warning');
    assert.equal(mapJsonLevel('ERR'), 'error');
});

test('mapJsonLevel: generic syslog terms', () => {
    assert.equal(mapJsonLevel('trace'), 'debug');
    assert.equal(mapJsonLevel('info'), 'information');
    assert.equal(mapJsonLevel('warn'), 'warning');
    assert.equal(mapJsonLevel('critical'), 'error');
});

test('mapJsonLevel: unknown defaults to information', () => {
    assert.equal(mapJsonLevel('notice'), 'information');
    assert.equal(mapJsonLevel(null), 'information');
});

// ---------- parseJsonLine ----------

test('parseJsonLine: Serilog CLEF', () => {
    const log = parseJsonLine('{"@t":"2024-01-15T10:30:45.123Z","@l":"Warning","@m":"slow query","@x":"stack","TraceId":"abc"}');
    assert.equal(log.level, 'warning');
    assert.equal(log.message, 'slow query');
    assert.equal(log.exception, 'stack');
    assert.equal(log.correlationId, 'abc');
    assert.equal(log.format, 'json');
    assert.ok(log.date instanceof Date && !isNaN(log.date.getTime()));
});

test('parseJsonLine: generic JSON shape', () => {
    const log = parseJsonLine('{"timestamp":"2024-01-15T10:30:45Z","level":"ERROR","message":"boom","correlation_id":"xyz"}');
    assert.equal(log.level, 'error');
    assert.equal(log.message, 'boom');
    assert.equal(log.correlationId, 'xyz');
});

test('parseJsonLine: missing timestamp returns null', () => {
    assert.equal(parseJsonLine('{"@l":"Information","@m":"hi"}'), null);
});

test('parseJsonLine: invalid JSON returns null', () => {
    assert.equal(parseJsonLine('not json'), null);
    assert.equal(parseJsonLine(''), null);
    assert.equal(parseJsonLine('   '), null);
});

test('parseJsonLine: array (not object) returns null', () => {
    assert.equal(parseJsonLine('[{"@t":"2024-01-15T10:30:45Z"}]'), null);
});

test('parseJsonLine: invalid timestamp returns null', () => {
    assert.equal(parseJsonLine('{"@t":"not-a-date","@m":"x"}'), null);
});

test('parseJsonLine: defaults level to information when absent', () => {
    const log = parseJsonLine('{"@t":"2024-01-15T10:30:45Z","@m":"x"}');
    assert.equal(log.level, 'information');
});

test('parseJsonLine: numeric ids stringified', () => {
    const log = parseJsonLine('{"@t":"2024-01-15T10:30:45Z","@m":"x","correlationId":12345,"ThreadId":7}');
    assert.equal(log.correlationId, '12345');
    assert.equal(log.threadId, '7');
});

// ---------- parseTextChunk ----------

test('parseTextChunk: single format1 line produces one log', () => {
    const state = makeState();
    parseTextChunk('2024-01-15 10:30:45.123 +00:00 [INF] [Worker-1] Hello world', 'a.log', state);
    assert.equal(state.logs.length, 1);
    const log = state.logs[0];
    assert.equal(log.level, 'information');
    assert.equal(log.threadId, 'Worker-1');
    assert.equal(log.message, 'Hello world');
    assert.equal(log.format, 'format1');
    assert.equal(log.source, 'a.log');
    assert.equal(log.exception, '');
});

test('parseTextChunk: format2 line (no thread bracket) sets threadId to N/A', () => {
    const state = makeState();
    parseTextChunk('2024-01-15 10:30:45.123 +00:00 [WRN] Something happened', 'b.log', state);
    assert.equal(state.logs.length, 1);
    assert.equal(state.logs[0].level, 'warning');
    assert.equal(state.logs[0].threadId, 'N/A');
    assert.equal(state.logs[0].format, 'format2');
});

test('parseTextChunk: continuation lines append to exception of previous entry', () => {
    const state = makeState();
    const content = [
        '2024-01-15 10:30:45.123 +00:00 [ERR] [Worker-1] Failed',
        '   at Foo.bar (Foo.cs:42)',
        '   at Baz.qux (Baz.cs:7)'
    ].join('\n');
    parseTextChunk(content, 'a.log', state);
    assert.equal(state.logs.length, 1);
    assert.match(state.logs[0].exception, /Foo\.bar/);
    assert.match(state.logs[0].exception, /Baz\.qux/);
});

test('parseTextChunk: multiple entries in one chunk', () => {
    const state = makeState();
    const content = [
        '2024-01-15 10:30:45.123 +00:00 [INF] [Worker-1] One',
        '2024-01-15 10:30:46.000 +00:00 [INF] [Worker-1] Two',
        '2024-01-15 10:30:47.000 +00:00 [ERR] [Worker-1] Three'
    ].join('\n');
    parseTextChunk(content, 'a.log', state);
    assert.equal(state.logs.length, 3);
    assert.deepEqual(state.logs.map(l => l.level), ['information', 'information', 'error']);
});

test('parseTextChunk: stamps source on every log', () => {
    const state = makeState();
    const content = [
        '2024-01-15 10:30:45.123 +00:00 [INF] [t] a',
        '2024-01-15 10:30:46.000 +00:00 [INF] [t] b'
    ].join('\n');
    parseTextChunk(content, 'pod-7.log', state);
    for (const log of state.logs) assert.equal(log.source, 'pod-7.log');
});

test('parseTextChunk: empty/blank lines are ignored', () => {
    const state = makeState();
    const content = [
        '',
        '2024-01-15 10:30:45.123 +00:00 [INF] [t] a',
        '   ',
        '2024-01-15 10:30:46.000 +00:00 [INF] [t] b'
    ].join('\n');
    parseTextChunk(content, 'a.log', state);
    assert.equal(state.logs.length, 2);
});

test('parseTextChunk: APIGW Path line is tracked even without a Response', () => {
    const state = makeState();
    parseTextChunk(
        '2024-01-15 10:30:45.123 +00:00 [INF] [Worker-1] Path: "/api/users/123"',
        'a.log',
        state
    );
    // 1 log entry for the Path line, normalized API path stored.
    assert.equal(state.logs.length, 1);
    assert.ok(state.apiCalls.has('/api/users/{id}'));
    const stats = state.apiCalls.get('/api/users/{id}');
    assert.equal(stats.started, 1);
    assert.equal(stats.count, 0); // no Response yet
});

test('parseTextChunk: Inner HTTP Start + End populates innerApiCalls', () => {
    const state = makeState();
    const content = [
        '2024-01-15 10:30:45.123 +00:00 [INF] [t] Start processing HTTP request "GET" "https://api.example.com/widgets/42"',
        '2024-01-15 10:30:45.456 +00:00 [INF] [t] End processing HTTP request after 333ms - 200'
    ].join('\n');
    parseTextChunk(content, 'a.log', state);
    assert.equal(state.innerApiCalls.size, 1);
    const stats = state.innerApiCalls.get('GET /widgets/42');
    assert.ok(stats);
    assert.equal(stats.count, 1);
    assert.equal(stats.totalTime, 333);
    assert.equal(stats.errors, 0);
    assert.equal(stats.statusCodes.get('200'), 1);
});

test('parseTextChunk: 5xx inner-HTTP status increments errors', () => {
    const state = makeState();
    const content = [
        '2024-01-15 10:30:45.123 +00:00 [INF] [t] Start processing HTTP request "POST" "https://api.example.com/orders"',
        '2024-01-15 10:30:46.000 +00:00 [INF] [t] End processing HTTP request after 877ms - 503'
    ].join('\n');
    parseTextChunk(content, 'a.log', state);
    const stats = state.innerApiCalls.get('POST /orders');
    assert.equal(stats.errors, 1);
});

test('parseTextChunk: 3xx status is NOT counted as an error', () => {
    const state = makeState();
    const content = [
        '2024-01-15 10:30:45.123 +00:00 [INF] [t] Start processing HTTP request "GET" "https://api.example.com/foo"',
        '2024-01-15 10:30:45.500 +00:00 [INF] [t] End processing HTTP request after 100ms - 304'
    ].join('\n');
    parseTextChunk(content, 'a.log', state);
    const stats = state.innerApiCalls.get('GET /foo');
    assert.equal(stats.errors, 0);
});

// ---------- parseTextChunkInto + flushPartialChunk (streaming) ----------

test('streaming: a log entry split across two chunks yields one final log', () => {
    const state = makeState();
    state._currentLog = null;
    state._currentApiCall = null;
    // Chunk 1 has the timestamped header but no trailing newline before the
    // next chunk arrives. Chunk 2 has continuation lines (which should be
    // appended to the carry-over log).
    parseTextChunkInto('2024-01-15 10:30:45.123 +00:00 [ERR] [t] Boom\n', 'a.log', state);
    parseTextChunkInto('   at Foo.bar\n   at Baz.qux\n', 'a.log', state);
    flushPartialChunk(state);
    assert.equal(state.logs.length, 1);
    assert.match(state.logs[0].exception, /Foo\.bar/);
    assert.match(state.logs[0].exception, /Baz\.qux/);
});

test('streaming: two timestamped entries split across chunks both land', () => {
    const state = makeState();
    parseTextChunkInto('2024-01-15 10:30:45.123 +00:00 [INF] [t] one\n', 'a.log', state);
    parseTextChunkInto('2024-01-15 10:30:46.000 +00:00 [INF] [t] two\n', 'a.log', state);
    flushPartialChunk(state);
    assert.equal(state.logs.length, 2);
    assert.equal(state.logs[0].message, 'one');
    assert.equal(state.logs[1].message, 'two');
});

// ---------- parseJsonChunk ----------

test('parseJsonChunk: each valid line becomes a log; invalid lines are skipped', () => {
    const state = makeState();
    const content = [
        '{"@t":"2024-01-15T10:30:45Z","@l":"Information","@m":"hi"}',
        'this is not JSON',
        '{"@t":"2024-01-15T10:30:46Z","@l":"Warning","@m":"slow"}',
        '',
        '{"@l":"Information","@m":"no timestamp"}'
    ].join('\n');
    parseJsonChunk(content, 'a.log', state);
    assert.equal(state.logs.length, 2);
    assert.equal(state.logs[0].message, 'hi');
    assert.equal(state.logs[1].message, 'slow');
});

test('parseJsonChunk: stamps source on every log', () => {
    const state = makeState();
    parseJsonChunk('{"@t":"2024-01-15T10:30:45Z","@m":"x"}', 'pod-7.log', state);
    assert.equal(state.logs[0].source, 'pod-7.log');
});

// ---------- parseAll ----------

test('parseAll: dispatches per-chunk based on format detection', () => {
    const result = parseAll([
        { name: 'plain.log', content: '2024-01-15 10:30:45.123 +00:00 [INF] [t] hi' },
        { name: 'json.log', content: '{"@t":"2024-01-15T10:30:46Z","@l":"Information","@m":"hi"}' }
    ]);
    assert.equal(result.logs.length, 2);
    assert.equal(result.logs[0].format, 'format1');
    assert.equal(result.logs[1].format, 'json');
    assert.equal(result.logs[0].source, 'plain.log');
    assert.equal(result.logs[1].source, 'json.log');
});

test('parseAll: returns Maps for collection state', () => {
    const result = parseAll([
        { name: 'a.log', content: '2024-01-15 10:30:45.123 +00:00 [INF] [t] Path: "/api/x"' }
    ]);
    assert.ok(result.apiCalls instanceof Map);
    assert.ok(result.innerApiCalls instanceof Map);
    assert.ok(result.apiByCorrelation instanceof Map);
});

test('parseAll: drops internal-only currentInnerCall from output', () => {
    const result = parseAll([{ name: 'a.log', content: '' }]);
    assert.ok(!('currentInnerCall' in result));
});
