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

    return {
        normalizeApiPath,
        normalizeExceptionMessage,
        formatMs,
        formatSpan,
        formatNumber,
        healthLabel,
        healthClass
    };
}));
