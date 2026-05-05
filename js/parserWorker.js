/**
 * Parser worker — keeps the main thread responsive while parsing large logs.
 *
 * Receives: { type: 'parse', files: [{ name, content }, ...] }
 * Replies:  { type: 'done', state: { logs, apiCalls, innerApiCalls, apiByCorrelation } }
 *           or { type: 'error', message }
 *
 * `parser.js` is loaded via importScripts so the same parsing code runs here
 * as on the main thread (UMD pattern means it exposes a global LogParser).
 */
importScripts('parser.js');

self.addEventListener('message', (e) => {
    const msg = e.data || {};
    if (msg.type !== 'parse') return;
    try {
        const state = LogParser.parseAll(msg.files || []);
        self.postMessage({ type: 'done', state });
    } catch (err) {
        self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
    }
});
