/**
 * Pure helpers extracted from LogViewer for unit testing.
 *
 * UMD: works as a CommonJS module under Node (`require('./parser.js')`)
 * and as a global `window.LogParser` when loaded via <script> in the browser.
 * Lets us run tests with `node --test tests/` without touching the no-build
 * file:// runtime.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.LogParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    /**
     * Replace numeric IDs and GUIDs in an API path with `{id}` so similar
     * endpoints are grouped together.
     */
    function normalizeApiPath(path) {
        let normalized = path
            .replace(/\/(\d+)\//g, '/{id}/')
            .replace(/(\/)\d+$/, '$1{id}');
        normalized = normalized
            .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//gi, '/{id}/')
            .replace(/(\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '$1{id}');
        return normalized;
    }

    /**
     * Collapse identifier-like substrings to placeholders so reasons that
     * differ only by id/email/timestamp group together. Order matters —
     * specific patterns first, then generic numeric fallback.
     */
    function normalizeExceptionMessage(message) {
        if (!message) return message;
        let n = String(message);

        // GUIDs / UUIDs (hex, 8-4-4-4-12).
        n = n.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{id}');

        // ISO 8601 timestamps (with optional fractional seconds and tz).
        n = n.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, '{ts}');

        // Email addresses.
        n = n.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '{email}');

        // Hyphen-separated uppercase codes (ORD-2024-001, INV-12345-A).
        n = n.replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, '{id}');

        // Bare alphanumeric IDs — uppercase letters + digits in either order, 4+ chars.
        n = n.replace(/\b(?:[A-Z]{2,}\d{2,}|\d{2,}[A-Z]{2,})\b/g, '{id}');

        // Quoted values (capped so we don't swallow whole sentences).
        n = n.replace(/'([^'\n]{1,60})'/g, "'{val}'");
        n = n.replace(/"([^"\n]{1,60})"/g, '"{val}"');

        // Hex blobs of 6+ chars (e.g. partial hashes, request ids).
        n = n.replace(/\b[0-9a-f]{6,}\b/gi, '{hex}');

        // Numeric sequences (2+ digits).
        n = n.replace(/\b\d{2,}\b/g, '{id}');

        // Tidy whitespace and trim trailing punctuation.
        n = n.replace(/\s{2,}/g, ' ').trim().replace(/[.,;:\s]+$/, '');

        return n;
    }

    /**
     * Format a millisecond duration into a compact string. Uses fewer decimals
     * for larger numbers so the column reads cleanly.
     */
    function formatMs(ms) {
        if (ms == null || !isFinite(ms)) return '—';
        if (ms < 1) return ms.toFixed(2);
        if (ms < 100) return ms.toFixed(1);
        return Math.round(ms).toString();
    }

    /** Format a millisecond span as `2d 3h 4m`, omitting zero leading parts. */
    function formatSpan(ms) {
        const totalMin = Math.floor(ms / 60000);
        const days = Math.floor(totalMin / 1440);
        const hours = Math.floor((totalMin % 1440) / 60);
        const mins = totalMin % 60;
        const parts = [];
        if (days) parts.push(days + 'd');
        if (hours) parts.push(hours + 'h');
        if (mins || !parts.length) parts.push(mins + 'm');
        return parts.join(' ');
    }

    /** Locale-format integers >=1000, return raw string otherwise. */
    function formatNumber(n) {
        if (n == null || isNaN(n)) return '0';
        if (n >= 1000) return n.toLocaleString();
        return String(n);
    }

    /** Health-score → text label. */
    function healthLabel(score) {
        if (score >= 90) return 'Excellent';
        if (score >= 75) return 'Good';
        if (score >= 50) return 'Fair';
        return 'Critical';
    }

    /** Health-score → CSS class for the health-pill. */
    function healthClass(score) {
        if (score >= 90) return 'health-excellent';
        if (score >= 75) return 'health-good';
        if (score >= 50) return 'health-fair';
        return 'health-critical';
    }

    /**
     * Detect if a chunk of text is JSON-line formatted (CLEF or generic).
     * Strategy: find the first non-empty line and try `JSON.parse` it. If
     * the result is an object, treat the whole chunk as JSON lines.
     */
    function detectJsonLines(content) {
        if (!content) return false;
        const trimmed = String(content).replace(/^﻿/, '').trimStart();
        if (!trimmed.startsWith('{')) return false;
        const newline = trimmed.indexOf('\n');
        const firstLine = (newline >= 0 ? trimmed.slice(0, newline) : trimmed).trim();
        try {
            const obj = JSON.parse(firstLine);
            return obj && typeof obj === 'object' && !Array.isArray(obj);
        } catch (e) {
            return false;
        }
    }

    /** Map a JSON log's level field to the canonical lowercase set. */
    function mapJsonLevel(raw) {
        if (raw == null) return 'information';
        const s = String(raw).toLowerCase();
        if (s.startsWith('debug') || s === 'dbg' || s === 'verbose' || s === 'vrb' || s === 'trace' || s === 'trc') return 'debug';
        if (s.startsWith('info') || s === 'inf') return 'information';
        if (s.startsWith('warn') || s === 'wrn') return 'warning';
        if (s.startsWith('err') || s === 'fatal' || s === 'ftl' || s === 'crit' || s === 'critical') return 'error';
        return 'information';
    }

    /**
     * Parse a single JSON log line into a normalized log object, or null if
     * the line isn't valid JSON or lacks a timestamp. Supports Serilog
     * Compact Event Format (`@t`, `@l`, `@m`, `@x`) and a handful of common
     * generic field names.
     */
    function parseJsonLine(raw) {
        if (!raw || !raw.trim()) return null;
        let obj;
        try { obj = JSON.parse(raw); } catch (e) { return null; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

        const timestamp = obj['@t'] || obj.timestamp || obj.time || obj['@timestamp'] || obj.ts;
        if (!timestamp) return null;
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return null;

        const rawLevel = obj['@l'] || obj.level || obj.Level || obj.severity || 'Information';
        const messageRaw = obj['@m'] || obj.message || obj.Message || obj.msg || obj['@mt'] || '';
        const exceptionRaw = obj['@x'] || obj.exception || obj.err || obj.Exception || '';
        const correlationId = obj.correlation_id || obj.correlationId || obj.CorrelationId || obj.TraceId || obj.traceId || null;
        const requestId = obj.request_id || obj.requestId || obj.RequestId || obj.SpanId || obj.spanId || null;
        const threadId = obj.thread_id || obj.threadId || obj.ThreadId || obj.thread || null;

        return {
            timestamp: typeof timestamp === 'string' ? timestamp : date.toISOString(),
            date,
            level: mapJsonLevel(rawLevel),
            threadId: threadId != null ? String(threadId) : 'N/A',
            message: typeof messageRaw === 'string' ? messageRaw : JSON.stringify(messageRaw),
            exception: typeof exceptionRaw === 'string' ? exceptionRaw : (exceptionRaw ? JSON.stringify(exceptionRaw) : ''),
            format: 'json',
            correlationId: correlationId != null ? String(correlationId) : null,
            requestId: requestId != null ? String(requestId) : null
        };
    }

    /**
     * Parse a chunk of JSON-line content into `state.logs`. Each successfully
     * parsed line is stamped with the given source. Other state fields aren't
     * touched (JSON logs don't carry the structural cues used for API call
     * tracking).
     */
    function parseJsonChunk(content, source, state) {
        const lines = String(content).split(/\r?\n/);
        for (const raw of lines) {
            const log = parseJsonLine(raw);
            if (!log) continue;
            log.source = source || null;
            state.logs.push(log);
        }
    }

    /**
     * Parse a chunk of bracketed Serilog text content into `state`.
     * Backward-compatible single-shot variant — clears any prior carry-over,
     * processes the chunk, then pushes the trailing in-flight log entry.
     * Streaming users should use parseTextChunkInto + flushPartialChunk.
     */
    function parseTextChunk(content, source, state) {
        state._currentLog = null;
        state._currentApiCall = null;
        // Streamed-style carry-over also clears request-tracking so a Path:
        // in file A can't match a Response: in file B.
        state.currentInnerCall = null;
        parseTextChunkInto(content, source, state);
        flushPartialChunk(state);
    }

    /**
     * Push any in-flight log entry from streaming carry-over into state.logs
     * and clear partial state. Call once after the last parseTextChunkInto.
     */
    function flushPartialChunk(state) {
        if (state._currentLog) state.logs.push(state._currentLog);
        state._currentLog = null;
        state._currentApiCall = null;
    }

    /**
     * Streaming-friendly text-chunk parser. Carries over the in-flight log
     * entry and matched APIGW request across calls via state._currentLog
     * and state._currentApiCall — does NOT push the trailing entry to
     * state.logs (the caller must invoke flushPartialChunk at the end).
     */
    function parseTextChunkInto(content, source, state) {
        const lines = String(content).split('\n');
        let current = state._currentLog || null;
        let currentApiCall = state._currentApiCall || null;
        if (state.currentInnerCall === undefined) state.currentInnerCall = null;

        const corrPrefix = (source || '') + '|';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+[+-]\d{2}:\d{2})/);

            if (tsMatch) {
                const ts = tsMatch[1];
                const after = line.substring(ts.length).trim();

                let logMatch = null;
                let format = null;
                let threadId = null;
                let message = null;
                let level = null;
                let correlationId = null;
                let requestId = null;
                let emptyBracketMatch = null;

                emptyBracketMatch = after.match(/\[""\]/);

                logMatch = after.match(/^\[([A-Z]{3})\]\s+\[([^\]]+)\]\s+(.*)$/);
                if (logMatch) {
                    format = 'format1';
                    level = logMatch[1];
                    threadId = logMatch[2];
                    message = logMatch[3];
                    const crlIdMatch = threadId.match(/^CrlId\]:APIGW:([^:]+):(\d+)$/);
                    if (crlIdMatch) {
                        correlationId = crlIdMatch[1];
                        requestId = crlIdMatch[2];
                        message = message.replace(/^APIGW:[^:]+:\d+,\s*/, '');
                    }
                } else {
                    logMatch = after.match(/^\[([A-Z]{3})\]\s+(.*)$/);
                    if (logMatch) {
                        format = 'format2';
                        level = logMatch[1];
                        message = logMatch[2];
                        threadId = 'N/A';
                    }
                }

                if (logMatch) {
                    if (current) state.logs.push(current);

                    const levelMap = {
                        'DBG': 'debug', 'INF': 'information', 'WRN': 'warning',
                        'ERR': 'error', 'VRB': 'debug', 'FTL': 'error'
                    };

                    const levelKey = level.toUpperCase();
                    const dateParts = ts.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);

                    const crlIdMatch = threadId ? threadId.match(/^CrlId\]:APIGW:([^:]+):(\d+)$/) : null;
                    if (crlIdMatch) {
                        correlationId = crlIdMatch[1];
                        requestId = crlIdMatch[2];
                        message = message.replace(/^APIGW:[^:]+:\d+,\s*/, '');
                    } else {
                        const apigwMatch = message.match(/\["APIGW:([^:]+):([^\]]+)"\]/);
                        if (apigwMatch) {
                            correlationId = apigwMatch[1];
                            requestId = apigwMatch[2];
                            message = message.replace(/\["APIGW:[^"]+"\],\s*/, '');
                        } else if (emptyBracketMatch) {
                            message = message.replace(/\[""\],\s*/, '');
                        } else {
                            const correlationMatch = message.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s+-\s+(.*)$/i);
                            if (correlationMatch) {
                                correlationId = correlationMatch[1];
                                message = correlationMatch[2];
                            }
                        }
                    }

                    const pathMatch = message.match(/Path:\s*"?([^"]+)"?/);
                    const startMatch = message.match(/Start processing HTTP request "([^"]+)" "([^"]+)"/);
                    const endMatch = message.match(/End processing HTTP request after ([\d.]+)ms - (\d+)/);

                    if (pathMatch) {
                        const date = dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date();
                        const rawPath = pathMatch[1].trim();
                        const normalizedPath = normalizeApiPath(rawPath);

                        if (!state.apiCalls.has(normalizedPath)) {
                            state.apiCalls.set(normalizedPath, {
                                path: normalizedPath, started: 0, count: 0,
                                totalTime: 0, minTime: Infinity, maxTime: 0, errors: 0
                            });
                        }
                        state.apiCalls.get(normalizedPath).started++;

                        currentApiCall = {
                            path: normalizedPath, startTime: date,
                            correlationId, requestId
                        };
                        if (correlationId) state.apiByCorrelation.set(corrPrefix + correlationId, normalizedPath);
                        if (requestId) state.apiByCorrelation.set(corrPrefix + requestId, normalizedPath);
                    } else if ((message.includes('Response') || message.toLowerCase().includes('response')) &&
                        currentApiCall &&
                        (currentApiCall.correlationId === correlationId ||
                            currentApiCall.requestId === requestId ||
                            (currentApiCall.correlationId === null && emptyBracketMatch))) {
                        const date = dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date();
                        const duration = Math.max(0, date - currentApiCall.startTime);
                        const apiKey = currentApiCall.path;

                        if (!state.apiCalls.has(apiKey)) {
                            state.apiCalls.set(apiKey, {
                                path: apiKey, started: 0, count: 0,
                                totalTime: 0, minTime: Infinity, maxTime: 0, errors: 0
                            });
                        }
                        const stats = state.apiCalls.get(apiKey);
                        stats.count++;
                        stats.totalTime += duration;
                        stats.minTime = Math.min(stats.minTime, duration);
                        stats.maxTime = Math.max(stats.maxTime, duration);
                        currentApiCall = null;
                    }

                    if (startMatch) {
                        const method = startMatch[1];
                        const url = startMatch[2];
                        let urlPath = url;
                        try { urlPath = new URL(url).pathname; } catch (e) { /* not absolute, keep as-is */ }
                        state.currentInnerCall = {
                            path: method + ' ' + urlPath,
                            threadId, correlationId
                        };
                    } else if (endMatch && state.currentInnerCall &&
                        (state.currentInnerCall.threadId === threadId ||
                            state.currentInnerCall.correlationId === correlationId)) {
                        const duration = Math.max(0, parseFloat(endMatch[1]) || 0);
                        const status = endMatch[2];
                        const innerKey = state.currentInnerCall.path;

                        if (!state.innerApiCalls.has(innerKey)) {
                            state.innerApiCalls.set(innerKey, {
                                path: innerKey, count: 0,
                                totalTime: 0, minTime: Infinity, maxTime: 0, errors: 0,
                                statusCodes: new Map()
                            });
                        }

                        const stats = state.innerApiCalls.get(innerKey);
                        stats.count++;
                        stats.totalTime += duration;
                        stats.minTime = Math.min(stats.minTime, duration);
                        stats.maxTime = Math.max(stats.maxTime, duration);

                        const statusCount = stats.statusCodes.get(status) || 0;
                        stats.statusCodes.set(status, statusCount + 1);

                        if (status.startsWith('4') || status.startsWith('5')) {
                            stats.errors++;
                        }

                        state.currentInnerCall = null;
                    }

                    current = {
                        timestamp: ts,
                        date: dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date(),
                        level: levelMap[levelKey] || 'information',
                        threadId,
                        message,
                        exception: '',
                        format,
                        correlationId,
                        requestId,
                        source: source || null
                    };
                }
            } else if (current) {
                current.exception += line + '\n';
            }
        }

        // Carry-over: do NOT push the trailing in-flight log here. The
        // single-shot parseTextChunk wrapper calls flushPartialChunk after
        // this; streaming callers should call flushPartialChunk only after
        // the very last chunk.
        state._currentLog = current;
        state._currentApiCall = currentApiCall;
    }

    /**
     * Top-level worker entry point: parse an array of {name, content} pairs
     * into a fresh state object. Used by parserWorker.js.
     */
    function parseAll(files) {
        const state = {
            logs: [],
            apiCalls: new Map(),
            innerApiCalls: new Map(),
            apiByCorrelation: new Map(),
            currentInnerCall: null
        };
        for (const f of files) {
            if (detectJsonLines(f.content)) {
                parseJsonChunk(f.content, f.name, state);
            } else {
                parseTextChunk(f.content, f.name, state);
            }
        }
        // Clean up internal-only state fields.
        delete state.currentInnerCall;
        return state;
    }

    return {
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
    };
}));
