class LogViewer {
    constructor() {
        this.logs = [];
        this.filteredLogs = [];
        this.filters = { debug: true, information: true, warning: true, error: true };
        this.searchQuery = '';
        this.dateFrom = null;
        this.dateTo = null;
        this.loadedFiles = 0;
        this.loadedFileNames = [];
        this.currentPage = 1;
        this.logsPerPage = 100;
        this.currentModalLog = null;
        // Sorting state for logs table
        this.sortColumn = 'timestamp'; // Default sort column
        this.sortDirection = 'asc'; // 'asc' or 'desc'
        // Sorting state for API Performance table
        this.apiTableSortColumn = 'avgTime'; // Default sort column
        this.apiTableSortDirection = 'desc'; // 'asc' or 'desc'
        this.STORAGE_KEY_THEME = 'logViewer.theme';
        this.init();
        this.restoreTheme();
    }

    restoreTheme() {
        let saved = null;
        try { saved = localStorage.getItem(this.STORAGE_KEY_THEME); } catch (e) { /* storage blocked */ }
        if (saved && ['light', 'dark', 'blue'].includes(saved)) {
            this.applyTheme(saved, false);
        }
    }

    applyTheme(theme, announce) {
        document.body.className = 'theme-' + theme;
        document.querySelectorAll('.theme-btn').forEach(btn => {
            const active = btn.dataset.theme === theme;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        try { localStorage.setItem(this.STORAGE_KEY_THEME, theme); } catch (e) { /* storage blocked */ }
        if (announce) this.showToast('Theme: ' + theme);
    }

    init() {
        document.getElementById('fileInput').addEventListener('change', (e) => this.loadFiles(e));
        // Debounced search: avoid re-filtering on every keystroke when logs are large.
        let searchTimer = null;
        document.getElementById('searchBox').addEventListener('input', (e) => {
            const value = e.target.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => this.search(value), 150);
        });
        document.getElementById('clearBtn').addEventListener('click', () => this.clear());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetFilters());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportLogs());
        document.getElementById('clearDateBtn').addEventListener('click', () => this.clearDateFilter());
        document.getElementById('dateFrom').addEventListener('change', (e) => this.setDateFrom(e.target.value));
        document.getElementById('dateTo').addEventListener('change', (e) => this.setDateTo(e.target.value));
        document.getElementById('prevBtn').addEventListener('click', () => this.prevPage());
        document.getElementById('nextBtn').addEventListener('click', () => this.nextPage());
        document.getElementById('firstBtn').addEventListener('click', () => this.firstPage());
        document.getElementById('lastBtn').addEventListener('click', () => this.lastPage());
        document.getElementById('pageSize').addEventListener('change', (e) => this.changePageSize(e.target.value));
        document.getElementById('modalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('modalCloseBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('modalCopy').addEventListener('click', () => this.copyModalLog());
        document.getElementById('modalTrace').addEventListener('click', () => this.showTraceForCurrentLog());
        document.getElementById('logModal').addEventListener('click', (e) => {
            if (e.target.id === 'logModal') this.closeModal();
        });
        document.getElementById('reportsBtn').addEventListener('click', () => this.showReports());
        document.getElementById('reportsClose').addEventListener('click', () => this.closeReports());
        document.getElementById('reportsCloseBtn').addEventListener('click', () => this.closeReports());
        document.getElementById('exportReportBtn').addEventListener('click', () => this.exportReport());
        document.getElementById('reportsModal').addEventListener('click', (e) => {
            if (e.target.id === 'reportsModal') this.closeReports();
        });
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => this.toggleFilter(btn));
        });
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setTheme(btn.dataset.theme));
        });
        // Exception tab handlers
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchExceptionTab(e.target.dataset.tab));
        });
        this.attachKeyboardShortcuts();
        this.attachDragAndDrop();
        this.attachUrlState();
    }

    attachDragAndDrop() {
        const dropTarget = document.body;
        let dragDepth = 0; // track nested dragenter/leave so leaving a child doesn't dismiss

        const setActive = (active) => {
            document.body.classList.toggle('dropzone-active', active);
        };

        dropTarget.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            dragDepth++;
            setActive(true);
        });
        dropTarget.addEventListener('dragover', (e) => {
            if (!e.dataTransfer) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        dropTarget.addEventListener('dragleave', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) setActive(false);
        });
        dropTarget.addEventListener('drop', (e) => {
            if (!e.dataTransfer || !e.dataTransfer.files.length) return;
            e.preventDefault();
            dragDepth = 0;
            setActive(false);
            // Filter to .txt and .log files (matches the file input's accept attribute).
            const files = Array.from(e.dataTransfer.files).filter(f =>
                /\.(txt|log)$/i.test(f.name) || f.type === 'text/plain'
            );
            if (!files.length) {
                this.showToast('No .txt or .log files found in drop');
                return;
            }
            // Reuse loadFiles by faking the input event shape.
            this.loadFiles({ target: { files } });
        });
    }

    attachUrlState() {
        // Read filters from URL hash on load.
        this.applyUrlState();
        // Persist on change (debounced via the existing applyFilters path).
        window.addEventListener('hashchange', () => this.applyUrlState());
    }

    applyUrlState() {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const search = params.get('q');
        if (search != null && search !== this.searchQuery) {
            const box = document.getElementById('searchBox');
            box.value = search;
            this.searchQuery = search.toLowerCase();
        }
        for (const lvl of ['debug', 'information', 'warning', 'error']) {
            const v = params.get(lvl);
            if (v === '0' || v === '1') {
                this.filters[lvl] = v === '1';
                const btn = document.querySelector('.filter-btn[data-level="' + lvl + '"]');
                if (btn) btn.classList.toggle('active', this.filters[lvl]);
            }
        }
        const from = params.get('from');
        const to = params.get('to');
        if (from) {
            document.getElementById('dateFrom').value = from;
            this.setDateFrom(from);
        }
        if (to) {
            document.getElementById('dateTo').value = to;
            this.setDateTo(to);
        }
        const page = parseInt(params.get('p'), 10);
        if (!isNaN(page) && page > 0) this.currentPage = page;
        if (this.logs.length) {
            this.applyFilters();
        }
    }

    writeUrlState() {
        const params = new URLSearchParams();
        if (this.searchQuery) params.set('q', this.searchQuery);
        for (const lvl of ['debug', 'information', 'warning', 'error']) {
            if (!this.filters[lvl]) params.set(lvl, '0'); // only record off-state to keep URLs short
        }
        const fromInput = document.getElementById('dateFrom').value;
        const toInput = document.getElementById('dateTo').value;
        if (fromInput) params.set('from', fromInput);
        if (toInput) params.set('to', toInput);
        if (this.currentPage > 1) params.set('p', String(this.currentPage));
        const next = params.toString();
        const target = next ? '#' + next : window.location.pathname + window.location.search;
        // Replace state to avoid filling history with every keystroke.
        history.replaceState(null, '', target || '#');
    }

    attachKeyboardShortcuts() {
        const isTextField = (el) => {
            if (!el) return false;
            const tag = el.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
        };
        const isModalOpen = () =>
            document.getElementById('logModal').classList.contains('show') ||
            document.getElementById('reportsModal').classList.contains('show');

        document.addEventListener('keydown', (e) => {
            // Esc — close any open modal
            if (e.key === 'Escape') {
                if (document.getElementById('logModal').classList.contains('show')) {
                    this.closeModal();
                    e.preventDefault();
                    return;
                }
                if (document.getElementById('reportsModal').classList.contains('show')) {
                    this.closeReports();
                    e.preventDefault();
                    return;
                }
                // Esc inside the search box clears it
                const search = document.getElementById('searchBox');
                if (document.activeElement === search) {
                    search.value = '';
                    this.search('');
                    search.blur();
                    e.preventDefault();
                    return;
                }
            }

            // Tab focus trap inside open modals.
            if (e.key === 'Tab' && isModalOpen()) {
                this._trapFocusInModal(e);
                return;
            }

            // Don't intercept when user is typing or modal is open
            if (isTextField(document.activeElement) || isModalOpen()) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // "/" — focus search
            if (e.key === '/') {
                e.preventDefault();
                document.getElementById('searchBox').focus();
                return;
            }

            // Arrow keys — paginate (only when there are pages)
            if (this.filteredLogs.length === 0) return;
            if (e.key === 'ArrowRight') {
                this.nextPage();
                e.preventDefault();
            } else if (e.key === 'ArrowLeft') {
                this.prevPage();
                e.preventDefault();
            } else if (e.key === 'Home' && e.shiftKey === false) {
                // Avoid hijacking real Home key on inputs (already filtered above).
                this.firstPage();
                e.preventDefault();
            } else if (e.key === 'End' && e.shiftKey === false) {
                this.lastPage();
                e.preventDefault();
            }
        });
    }

    /**
     * Cycle focus inside whichever modal is currently open. Without this, Tab
     * escapes back into the page and screen-reader users lose the modal.
     */
    _trapFocusInModal(e) {
        const modal = document.querySelector('.modal.show');
        if (!modal) return;
        const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const nodes = Array.from(modal.querySelectorAll(FOCUSABLE))
            .filter(el => el.offsetParent !== null); // visible only
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !modal.contains(active)) {
                last.focus();
                e.preventDefault();
            }
        } else {
            if (active === last || !modal.contains(active)) {
                first.focus();
                e.preventDefault();
            }
        }
    }

    setTheme(theme) {
        this.applyTheme(theme, true);
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    showLoader(text) {
        document.getElementById('loaderOverlay').classList.add('show');
        document.getElementById('loaderSubtext').textContent = text || 'Processing files';
    }

    hideLoader() {
        document.getElementById('loaderOverlay').classList.remove('show');
    }

    loadFiles(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;

        setTimeout(() => {
            this.showLoader('Reading ' + files.length + ' file(s)...');
        }, 0);

        this.loadedFiles = files.length;
        this.loadedFileNames = files.map(f => f.name);
        let loaded = 0;
        const contents = [];

        files.forEach((file, i) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                contents[i] = e.target.result;
                loaded++;
                document.getElementById('loaderSubtext').textContent = 'Loaded ' + loaded + ' of ' + files.length + ' files';

                if (loaded === files.length) {
                    document.getElementById('loaderSubtext').textContent = 'Parsing logs...';
                    setTimeout(() => {
                        this.parseLogs(contents.join('\n'));
                        this.hideLoader();
                        this.showToast('Loaded ' + files.length + ' file(s) successfully');
                    }, 100);
                }
            };
            reader.onerror = () => {
                this.hideLoader();
                this.showToast('Error reading file');
            };
            reader.readAsText(file);
        });
    }

    parseLogs(content) {
        try {
            const lines = content.split('\n');
            this.logs = [];
            this.apiCalls = new Map(); // Track API calls
            this.exceptions = new Map(); // Track exceptions
            this.apiByCorrelation = new Map(); // correlationId/requestId -> normalized API path
            let current = null;
            let currentApiCall = null;

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

                    // Check for empty brackets first as it's used in multiple places
                    emptyBracketMatch = after.match(/\[""\]/);

                    // Check for both formats
                    logMatch = after.match(/^\[([A-Z]{3})\]\s+\[([^\]]+)\]\s+(.*)$/);
                    if (logMatch) {
                        format = 'format1';
                        level = logMatch[1];
                        threadId = logMatch[2];
                        message = logMatch[3];

                        // Handle CrlId format in thread ID
                        const crlIdMatch = threadId.match(/^CrlId\]:APIGW:([^:]+):(\d+)$/);
                        if (crlIdMatch) {
                            correlationId = crlIdMatch[1];
                            requestId = crlIdMatch[2];
                            message = message.replace(/^APIGW:[^:]+:\d+,\s*/, ''); // Remove any duplicate APIGW prefix in message
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
                        if (current) {
                            this.logs.push(current);
                        }

                        const levelMap = {
                            'DBG': 'debug',
                            'INF': 'information',
                            'WRN': 'warning',
                            'ERR': 'error',
                            'VRB': 'debug',
                            'FTL': 'error'
                        };

                        const levelKey = level.toUpperCase();
                        const dateParts = ts.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);

                        // First check for CrlId format in threadId
                        const crlIdMatch = threadId ? threadId.match(/^CrlId\]:APIGW:([^:]+):(\d+)$/) : null;
                        if (crlIdMatch) {
                            correlationId = crlIdMatch[1];
                            requestId = crlIdMatch[2];
                            message = message.replace(/^APIGW:[^:]+:\d+,\s*/, '');
                        } else {
                            // If not CrlId format, check for APIGW in message
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

                        // Handle API paths and tracking
                        const pathMatch = message.match(/Path:\s*"?([^"]+)"?/);
                        const startMatch = message.match(/Start processing HTTP request "([^"]+)" "([^"]+)"/);
                        const endMatch = message.match(/End processing HTTP request after ([\d.]+)ms - (\d+)/);

                        // Track original API calls
                        if (pathMatch) {  // Simplified condition to track all paths
                            const date = dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date();
                            const rawPath = pathMatch[1].trim();
                            const normalizedPath = this.normalizeApiPath(rawPath);

                            // Initialize API stats if not exists
                            if (!this.apiCalls.has(normalizedPath)) {
                                this.apiCalls.set(normalizedPath, {
                                    path: normalizedPath,
                                    count: 0,
                                    totalTime: 0,
                                    minTime: Infinity,
                                    maxTime: 0,
                                    errors: 0
                                });
                            }

                            currentApiCall = {
                                path: normalizedPath,
                                startTime: date,
                                correlationId,
                                requestId
                            };
                            // Index API path by correlation/request IDs so we can attribute
                            // exceptions back to the API that handled the request.
                            if (correlationId) this.apiByCorrelation.set(correlationId, normalizedPath);
                            if (requestId) this.apiByCorrelation.set(requestId, normalizedPath);
                        } else if ((message.includes('Response') || message.toLowerCase().includes('response')) &&
                            currentApiCall &&
                            (currentApiCall.correlationId === correlationId ||
                                currentApiCall.requestId === requestId ||
                                (currentApiCall.correlationId === null && emptyBracketMatch))) {
                            const date = dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date();
                            const duration = date - currentApiCall.startTime;
                            const apiKey = currentApiCall.path; // Already normalized

                            if (!this.apiCalls.has(apiKey)) {
                                this.apiCalls.set(apiKey, {
                                    path: apiKey,
                                    count: 0,
                                    totalTime: 0,
                                    minTime: Infinity,
                                    maxTime: 0,
                                    errors: 0
                                });
                            }
                            const stats = this.apiCalls.get(apiKey);
                            stats.count++;
                            stats.totalTime += duration;
                            stats.minTime = Math.min(stats.minTime, duration);
                            stats.maxTime = Math.max(stats.maxTime, duration);
                            currentApiCall = null;
                        }

                        // Track inner HTTP calls
                        if (startMatch) {
                            const method = startMatch[1];
                            const url = startMatch[2];
                            const urlPath = new URL(url).pathname;
                            this.currentInnerCall = {
                                path: `${method} ${urlPath}`,
                                threadId,
                                correlationId
                            };
                        } else if (endMatch && this.currentInnerCall &&
                            (this.currentInnerCall.threadId === threadId ||
                                this.currentInnerCall.correlationId === correlationId)) {
                            const duration = parseFloat(endMatch[1]);
                            const status = endMatch[2];
                            const innerKey = this.currentInnerCall.path;

                            if (!this.innerApiCalls) {
                                this.innerApiCalls = new Map();
                            }

                            if (!this.innerApiCalls.has(innerKey)) {
                                this.innerApiCalls.set(innerKey, {
                                    path: innerKey,
                                    count: 0,
                                    totalTime: 0,
                                    minTime: Infinity,
                                    maxTime: 0,
                                    errors: 0,
                                    statusCodes: new Map()
                                });
                            }

                            const stats = this.innerApiCalls.get(innerKey);
                            stats.count++;
                            stats.totalTime += duration;
                            stats.minTime = Math.min(stats.minTime, duration);
                            stats.maxTime = Math.max(stats.maxTime, duration);

                            const statusCount = stats.statusCodes.get(status) || 0;
                            stats.statusCodes.set(status, statusCount + 1);

                            // Treat only 4xx and 5xx as errors. 3xx redirects are not failures.
                            if (status.startsWith('4') || status.startsWith('5')) {
                                stats.errors++;
                            }

                            this.currentInnerCall = null;
                        }

                        current = {
                            timestamp: ts,
                            date: dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date(),
                            level: levelMap[levelKey] || 'information',
                            threadId: threadId,
                            message: message,
                            exception: '',
                            format: format,
                            correlationId: correlationId,
                            requestId: requestId
                        };
                    }
                } else if (current) {
                    current.exception += line + '\n';

                    // Track exceptions when we see them
                    if (current.level === 'error' && line.includes('Exception:')) {
                        const exceptionMatch = line.match(/([^:.]+Exception):\s*(.+)/);
                        if (exceptionMatch) {
                            const [_, type, rawMessage] = exceptionMatch;
                            const message = this.normalizeExceptionMessage(rawMessage);
                            if (!this.exceptions.has(type)) {
                                this.exceptions.set(type, {
                                    count: 0,
                                    messages: new Map()
                                });
                            }
                            const exStats = this.exceptions.get(type);
                            exStats.count++;

                            const msgCount = exStats.messages.get(message) || 0;
                            exStats.messages.set(message, msgCount + 1);

                            // Attribute this exception to the API call that owned the
                            // correlation/request id (built during parse), and bump that
                            // API's error count. Previously this loop checked
                            // stats.correlationId which is never stored on apiCalls
                            // entries, so error counts never incremented.
                            const apiPath = (current.correlationId && this.apiByCorrelation.get(current.correlationId))
                                || (current.requestId && this.apiByCorrelation.get(current.requestId));
                            if (apiPath && this.apiCalls.has(apiPath)) {
                                this.apiCalls.get(apiPath).errors++;
                            }
                        }
                    }
                }
            }

            if (current) {
                this.logs.push(current);
            }

            if (this.logs.length > 0) {
                this.logs.sort((a, b) => a.date - b.date);
                this.currentPage = 1;
                this.applyFilters();
                this.updateStats();

                const formatCounts = {
                    format1: this.logs.filter(l => l.format === 'format1').length,
                    format2: this.logs.filter(l => l.format === 'format2').length,
                    withCorrelation: this.logs.filter(l => l.correlationId).length
                };

                let formatMsg = 'Parsed ' + this.logs.length + ' logs';
                if (formatCounts.format1 > 0) formatMsg += ' (' + formatCounts.format1 + ' with Thread ID';
                if (formatCounts.format2 > 0) formatMsg += (formatCounts.format1 > 0 ? ', ' : ' (') + formatCounts.format2 + ' without Thread ID';
                if (formatCounts.withCorrelation > 0) formatMsg += ', ' + formatCounts.withCorrelation + ' with Correlation ID';
                formatMsg += ')';

                this.showToast(formatMsg);
            } else {
                document.getElementById('logContainer').innerHTML = '<div class="empty-state"><h2>No logs parsed</h2><p>Expected one of these line formats:<br/><code>[LEVEL] [ThreadID] Message</code><br/><code>[LEVEL] Message</code></p><p class="empty-state-hint">Open the browser console (F12) for parser details.</p></div>';
            }
        } catch (error) {
            console.error('Error parsing logs:', error);
            this.showToast('Error parsing log file: ' + error.message);
        }
    }

    toggleFilter(btn) {
        const lvl = btn.dataset.level;
        this.filters[lvl] = !this.filters[lvl];
        btn.classList.toggle('active');
        btn.setAttribute('aria-pressed', this.filters[lvl] ? 'true' : 'false');
        this.currentPage = 1;
        this.applyFilters();
    }

    search(q) {
        this.searchQuery = q.toLowerCase();
        this.currentPage = 1;
        this.applyFilters();
    }

    setDateFrom(v) {
        if (!v) {
            this.dateFrom = null;
        } else {
            const d = new Date(v);
            // date-only -> start of day so picking the same date for From and To
            // includes the entire day rather than excluding it.
            if (v.length <= 10) d.setHours(0, 0, 0, 0);
            this.dateFrom = d;
        }
        this.applyFilters();
    }

    setDateTo(v) {
        if (!v) {
            this.dateTo = null;
        } else {
            // datetime-local picker drops seconds. If user picked only a date or
            // a time without seconds, push to end of that minute so entries within
            // the chosen minute aren't silently excluded.
            const d = new Date(v);
            if (v.length <= 10) {
                d.setHours(23, 59, 59, 999); // date-only -> end of day
            } else {
                d.setSeconds(59, 999); // datetime -> end of minute
            }
            this.dateTo = d;
        }
        this.applyFilters();
    }

    clearDateFilter() {
        this.dateFrom = this.dateTo = null;
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        this.applyFilters();
        this.showToast('Date filters cleared');
    }

    /**
     * Reset all filtering state — search, level toggles, date range — back to
     * defaults. Useful after drilling in via report cross-links.
     */
    resetFilters() {
        this.searchQuery = '';
        document.getElementById('searchBox').value = '';
        this.dateFrom = this.dateTo = null;
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        this.filters = { debug: true, information: true, warning: true, error: true };
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
        });
        this.currentPage = 1;
        this.applyFilters();
        this.showToast('Filters reset');
    }

    applyFilters() {
        this.filteredLogs = this.logs.filter(log => {
            if (!this.filters[log.level]) return false;
            if (this.dateFrom && log.date < this.dateFrom) return false;
            if (this.dateTo && log.date > this.dateTo) return false;
            if (this.searchQuery) {
                const txt = (log.message + ' ' + log.exception).toLowerCase();
                if (!txt.includes(this.searchQuery)) return false;
            }
            return true;
        });
        this.render();
        if (typeof this.writeUrlState === 'function') this.writeUrlState();
    }

    changePageSize(size) {
        this.logsPerPage = parseInt(size);
        this.currentPage = 1;
        this.render();
        this.showToast('Page size changed to ' + size);
    }

    firstPage() {
        this.currentPage = 1;
        this.render();
        this.writeUrlState();
    }

    lastPage() {
        this.currentPage = Math.ceil(this.filteredLogs.length / this.logsPerPage);
        this.render();
        this.writeUrlState();
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.render();
            this.writeUrlState();
        }
    }

    nextPage() {
        const total = Math.ceil(this.filteredLogs.length / this.logsPerPage);
        if (this.currentPage < total) {
            this.currentPage++;
            this.render();
            this.writeUrlState();
        }
    }

    exportLogs() {
        if (!this.filteredLogs.length) {
            this.showToast('No logs to export');
            return;
        }
        this.showLoader('Exporting ' + this.filteredLogs.length + ' logs...');
        setTimeout(() => {
            let txt = '';
            this.filteredLogs.forEach(log => {
                const lvl = { debug: 'DBG', information: 'INF', warning: 'WRN', error: 'ERR' }[log.level];
                txt += log.timestamp + ' [' + lvl + '] [' + log.threadId + '] ' + log.message + '\n';
                if (log.exception.trim()) txt += log.exception;
            });
            const blob = new Blob([txt], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'logs-' + new Date().toISOString().split('T')[0] + '.txt';
            a.click();
            URL.revokeObjectURL(url);
            this.hideLoader();
            this.showToast('Exported ' + this.filteredLogs.length + ' logs');
        }, 300);
    }

    render() {
        const container = document.getElementById('logContainer');
        const pagination = document.getElementById('pagination');
        if (!this.filteredLogs.length) {
            container.innerHTML = '<div class="empty-state"><h2>' + (this.logs.length ? 'No matches' : 'No logs loaded') + '</h2>' + (this.logs.length ? '<p>Adjust filters or search to find entries.</p>' : '') + '</div>';
            pagination.classList.add('hidden');
            document.getElementById('visibleCount').textContent = '0';
            return;
        }

        // Sort the filtered logs based on current sort settings
        const logsToRender = this.getSortedLogs(this.filteredLogs);

        const start = (this.currentPage - 1) * this.logsPerPage;
        const end = Math.min(start + this.logsPerPage, logsToRender.length);
        const page = logsToRender.slice(start, end);

        // Render as table
        container.innerHTML = this.renderLogsTable(page);

        // Add click handlers for table rows
        container.querySelectorAll('.log-table tbody tr').forEach((el, i) => {
            el.addEventListener('click', () => this.showModal(page[i]));
            el.style.cursor = 'pointer';
        });

        // Add header sort handlers (mouse + keyboard)
        container.querySelectorAll('.log-table thead th[data-column]').forEach(th => {
            th.style.cursor = 'pointer';
            const sort = () => this.handleColumnSort(th.dataset.column);
            th.addEventListener('click', sort);
            th.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); }
            });
        });

        const total = Math.ceil(logsToRender.length / this.logsPerPage);
        if (total > 1) {
            pagination.classList.remove('hidden');
            document.getElementById('pageInfo').textContent = 'Page ' + this.currentPage + ' of ' + total;
            document.getElementById('prevBtn').disabled = this.currentPage === 1;
            document.getElementById('nextBtn').disabled = this.currentPage === total;
            document.getElementById('firstBtn').disabled = this.currentPage === 1;
            document.getElementById('lastBtn').disabled = this.currentPage === total;
        } else {
            pagination.classList.add('hidden');
        }

        document.getElementById('visibleCount').textContent = logsToRender.length;
    }

    showModal(log) {
        this.currentModalLog = log;
        this._lastFocus = document.activeElement;
        document.getElementById('modalTimestamp').textContent = this.formatDate(log.date);
        document.getElementById('modalLevel').textContent = log.level.toUpperCase();
        const threadEl = document.getElementById('modalThread');
        const id = log.correlationId || log.threadId;
        threadEl.textContent = id;
        const traceBtn = document.getElementById('modalTrace');
        if (traceBtn) {
            const hasTrace = id && id !== 'N/A';
            traceBtn.disabled = !hasTrace;
            traceBtn.style.opacity = hasTrace ? '' : '0.4';
            traceBtn.style.pointerEvents = hasTrace ? '' : 'none';
        }
        document.getElementById('modalLength').textContent = log.message.length + ' characters';
        document.getElementById('modalMessage').textContent = log.message;

        const modalExceptionSection = document.getElementById('modalExceptionSection');
        if (log.exception.trim()) {
            modalExceptionSection.classList.remove('hidden');
            document.getElementById('modalException').textContent = log.exception;
        } else {
            modalExceptionSection.classList.add('hidden');
        }

        const modal = document.getElementById('logModal');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        // Focus the close button so Esc / Enter immediately work for keyboard users.
        setTimeout(() => document.getElementById('modalClose').focus(), 0);
    }

    closeModal() {
        const modal = document.getElementById('logModal');
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
            this._lastFocus.focus();
            this._lastFocus = null;
        }
    }

    copyModalLog() {
        if (this.currentModalLog) {
            this.copyLog(this.currentModalLog);
            this.closeModal();
        }
    }

    /**
     * Filter the main log view to all entries sharing this log's correlation
     * (or thread, if no correlation is present). The result is a chronological
     * trace of the request.
     */
    showTraceForCurrentLog() {
        const log = this.currentModalLog;
        if (!log) return;
        const id = log.correlationId || log.threadId;
        if (!id || id === 'N/A') {
            this.showToast('No correlation/thread on this entry');
            return;
        }
        this.closeModal();
        this.filterByText(id);
        this.showToast('Showing trace: ' + (id.length > 16 ? id.substring(0, 12) + '…' : id));
    }

    formatDate(date) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = days[date.getDay()];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return dayName + ', ' + month + ' ' + day + ', ' + year + ' at ' + hours + ':' + minutes + ':' + seconds + '.' + ms;
    }

    handleColumnSort(column) {
        // Toggle sort direction if clicking the same column, otherwise reset to ascending
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        this.currentPage = 1; // Reset to first page
        this.render();
    }

    getSortedLogs(logs) {
        // Fast path: If no sort needed or empty logs
        if (!logs || logs.length === 0) return logs;

        // Cache: re-sort only when filteredLogs reference changes or sort
        // settings change. Pagination keeps the same reference, so flipping
        // pages is now O(1) instead of O(n log n).
        if (this._sortCache
            && this._sortCache.logs === logs
            && this._sortCache.column === this.sortColumn
            && this._sortCache.direction === this.sortDirection) {
            return this._sortCache.result;
        }

        // Use efficient sorting based on column type
        const sorted = [...logs]; // Shallow copy to avoid mutation
        
        const compareValues = (a, b, column, direction) => {
            let aVal, bVal;
            
            switch(column) {
                case 'timestamp':
                    aVal = a.date.getTime();
                    bVal = b.date.getTime();
                    break;
                case 'level':
                    // Order: error > warning > information > debug
                    const levelOrder = { error: 0, warning: 1, information: 2, debug: 3 };
                    aVal = levelOrder[a.level] || 99;
                    bVal = levelOrder[b.level] || 99;
                    break;
                case 'message':
                    aVal = a.message.toLowerCase();
                    bVal = b.message.toLowerCase();
                    break;
                case 'thread':
                    aVal = (a.correlationId || a.threadId || '').toLowerCase();
                    bVal = (b.correlationId || b.threadId || '').toLowerCase();
                    break;
                case 'length':
                    aVal = a.message.length;
                    bVal = b.message.length;
                    break;
                default:
                    return 0;
            }
            
            // Handle null/undefined
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            
            // Compare values
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        };
        
        sorted.sort((a, b) => compareValues(a, b, this.sortColumn, this.sortDirection));
        this._sortCache = {
            logs,
            column: this.sortColumn,
            direction: this.sortDirection,
            result: sorted
        };
        return sorted;
    }

    renderLogsTable(logs) {
        const headerCells = [
            { label: 'Timestamp', column: 'timestamp' },
            { label: 'Level', column: 'level' },
            { label: 'Message', column: 'message' },
            { label: 'Thread/Correlation', column: 'thread' },
            { label: 'Length', column: 'length' }
        ];

        const getSortIndicator = (column) => {
            if (this.sortColumn !== column) return '';
            return this.sortDirection === 'asc' ? ' ↑' : ' ↓';
        };

        let html = '<table class="log-table"><thead><tr>';

        headerCells.forEach(cell => {
            const indicator = getSortIndicator(cell.column);
            const isActive = this.sortColumn === cell.column;
            const ariaSort = isActive ? (this.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
            html += `<th data-column="${cell.column}" class="sortable-header${isActive ? ' active' : ''}" role="button" tabindex="0" aria-sort="${ariaSort}">${cell.label}${indicator}</th>`;
        });

        html += '</tr></thead><tbody>';
        
        logs.forEach(log => {
            const threadDisplay = log.correlationId ? log.correlationId.substring(0, 8) + '...' : log.threadId;
            const msgPreview = this.escape(log.message).substring(0, 100) + (log.message.length > 100 ? '...' : '');
            const levelClass = log.level;
            
            html += '<tr class="log-row ' + levelClass + '">' +
                '<td class="col-timestamp">' + this.escape(log.timestamp) + '</td>' +
                '<td class="col-level"><span class="level-badge ' + levelClass + '">' + log.level.toUpperCase() + '</span></td>' +
                '<td class="col-message">' + this.highlight(msgPreview) + '</td>' +
                '<td class="col-thread">' + this.escape(threadDisplay) + '</td>' +
                '<td class="col-length">' + log.message.length + '</td>' +
                '</tr>';
        });
        
        html += '</tbody></table>';
        return html;
    }

    normalizeApiPath(path) {
        // Replace numeric IDs and GUIDs with {id} placeholder to group similar endpoints
        // Examples:
        // Replace numeric IDs in the middle and at the end
        let normalized = path.replace(/\/(\d+)\//g, '/{id}/').replace(/(\/)\d+$/, '$1{id}');

        // Replace GUIDs/UUIDs (format: 8-4-4-4-12 hex digits separated by hyphens)
        normalized = normalized.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//gi, '/{id}/');
        normalized = normalized.replace(/(\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '$1{id}');

        return normalized;
    }

    normalizeExceptionMessage(message) {
        // Replace transaction numbers and reference numbers with {id} placeholder
        // Examples:

        // Replace alphanumeric codes after "No." pattern (handles AL6351, EXP123, etc.)
        let normalized = message.replace(/\bNo\.\s+[A-Z0-9]+/gi, 'No. {id}');

        // Replace numeric sequences (any continuous digits)
        normalized = normalized.replace(/\b\d+\b/g, '{id}');

        return normalized;
    }

    escape(txt) {
        const div = document.createElement('div');
        div.textContent = txt;
        return div.innerHTML;
    }

    // API Performance Table Sorting
    handleApiTableSort(column) {
        // Toggle sort direction if clicking the same column, otherwise reset to descending
        if (this.apiTableSortColumn === column) {
            this.apiTableSortDirection = this.apiTableSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.apiTableSortColumn = column;
            this.apiTableSortDirection = 'desc'; // Default descending for most metrics
        }
        // Regenerate reports to reflect new sort
        this.generateReports();
    }

    getSortedApiEndpoints(endpoints) {
        // Fast path: If no endpoints or single endpoint
        if (!endpoints || endpoints.length <= 1) return endpoints;
        
        // Create a copy to avoid mutation
        const sorted = [...endpoints];
        
        const compareValues = (a, b, column, direction) => {
            let aVal, bVal;
            
            switch(column) {
                case 'avgTime':
                    aVal = a.avgTime;
                    bVal = b.avgTime;
                    break;
                case 'calls':
                    aVal = a.stats.count;
                    bVal = b.stats.count;
                    break;
                case 'maxTime':
                    aVal = a.stats.maxTime;
                    bVal = b.stats.maxTime;
                    break;
                case 'minTime':
                    aVal = a.stats.minTime === Infinity ? 0 : a.stats.minTime;
                    bVal = b.stats.minTime === Infinity ? 0 : b.stats.minTime;
                    break;
                default:
                    return 0;
            }
            
            // Handle null/undefined
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            
            // Compare values
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        };
        
        sorted.sort((a, b) => compareValues(a, b, this.apiTableSortColumn, this.apiTableSortDirection));
        return sorted;
    }

    highlight(txt) {
        if (!this.searchQuery) return txt;
        const re = new RegExp('(' + this.searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return txt.replace(re, '<span class="highlight">$1</span>');
    }

    copyLog(log) {
        const lvl = { debug: 'DBG', information: 'INF', warning: 'WRN', error: 'ERR' }[log.level];
        let txt = log.timestamp + ' [' + lvl + '] [' + log.threadId + '] ' + log.message;
        if (log.exception.trim()) txt += '\n' + log.exception;
        navigator.clipboard.writeText(txt).then(() => this.showToast('Copied to clipboard'));
    }

    updateStats() {
        const counts = { debug: 0, information: 0, warning: 0, error: 0 };
        this.logs.forEach(log => counts[log.level]++);

        // Calculate API stats
        let totalApiCalls = 0;
        let totalResponseTime = 0;
        if (this.apiCalls) {
            for (const [_, stats] of this.apiCalls) {
                totalApiCalls += stats.count;
                totalResponseTime += stats.totalTime;
            }
        }
        const avgResponseTime = totalApiCalls > 0 ? (totalResponseTime / totalApiCalls).toFixed(2) : 0;

        // Update stats
        document.getElementById('fileCount').textContent = this.loadedFiles;
        document.getElementById('totalCount').textContent = this.logs.length;
        document.getElementById('debugCount').textContent = counts.debug;
        document.getElementById('infoCount').textContent = counts.information;
        document.getElementById('warningCount').textContent = counts.warning;
        document.getElementById('errorCount').textContent = counts.error;
        document.getElementById('apiCallCount').textContent = totalApiCalls;
        document.getElementById('avgResponseTime').textContent = avgResponseTime + 'ms';

        // Update file names list
        const fileList = document.getElementById('fileList');
        if (fileList) {
            fileList.innerHTML = this.loadedFileNames.map(name =>
                `<div class="file-item" title="${this.escape(name)}">
                    <span class="file-name">${this.escape(name)}</span>
                </div>`
            ).join('');
        }
    }

    clear() {
        if (!confirm('Clear all logs?')) return;
        this.logs = [];
        this.filteredLogs = [];
        this.searchQuery = '';
        this.dateFrom = this.dateTo = null;
        this.loadedFiles = 0;
        this.loadedFileNames = [];
        this.currentPage = 1;
        this.currentModalLog = null;
        this.apiCalls = new Map();
        this.innerApiCalls = new Map();
        this.exceptions = new Map();
        this.exceptionResponses = null;
        this.apiByCorrelation = new Map();
        document.getElementById('searchBox').value = '';
        document.getElementById('fileInput').value = '';
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        document.getElementById('logContainer').innerHTML = '<div class="empty-state"><h2>No logs loaded</h2><p>Load log files to get started.</p></div>';
        document.getElementById('pagination').classList.add('hidden');
        document.getElementById('fileList').innerHTML = '';
        this.updateStats();
        this.showToast('All logs cleared');
    }

    showReports() {
        this._lastFocus = document.activeElement;
        const modal = document.getElementById('reportsModal');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        this.generateReports();
        setTimeout(() => document.getElementById('reportsClose').focus(), 0);
    }

    closeReports() {
        const modal = document.getElementById('reportsModal');
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
            this._lastFocus.focus();
            this._lastFocus = null;
        }
    }

    generateReports() {
        if (!this.logs.length) {
            document.getElementById('reportsContent').innerHTML =
                '<div class="empty-state"><h2>No data</h2><p>Load log files to generate reports.</p></div>';
            return;
        }

        // ---------- Time-span calculations (used everywhere) ----------
        const firstDate = this.logs[0].date;
        const lastDate = this.logs[this.logs.length - 1].date;
        const spanMs = Math.max(1, lastDate - firstDate);
        const spanHours = spanMs / 3600000;
        const spanMinutes = spanMs / 60000;

        // ---------- Aggregations ----------
        const total = this.logs.length;
        const levelCounts = { debug: 0, information: 0, warning: 0, error: 0 };
        const threadCounts = {};
        const hourCounts = new Array(24).fill(0);

        for (const log of this.logs) {
            levelCounts[log.level] = (levelCounts[log.level] || 0) + 1;
            const thread = log.correlationId || log.threadId;
            threadCounts[thread] = (threadCounts[thread] || 0) + 1;
            hourCounts[log.date.getHours()]++;
        }

        // Level-driven health (rate-based, scales with volume)
        const errorRate = (levelCounts.error / total) * 100;
        const warningRate = (levelCounts.warning / total) * 100;
        const logHealth = Math.max(0, Math.min(100, Math.round(100 - errorRate * 5 - warningRate * 1.5)));
        const logHealthLabel = this._healthLabel(logHealth);

        // Parse exception responses
        this.parseExceptionResponses();

        // ---------- HTML ----------
        let html = '';

        // Top meta strip
        html += this._renderMetaStrip(firstDate, lastDate, spanMs, total, logHealth, logHealthLabel);

        // I. Logs distribution
        html += this._renderLogDistribution(levelCounts, total, spanHours);

        // II. API performance
        if (this.apiCalls && this.apiCalls.size > 0) {
            html += this._renderApiPerformance(spanMinutes);
        }

        // III. Internal HTTP
        if (this.innerApiCalls && this.innerApiCalls.size > 0) {
            html += this._renderInternalHttp(spanMinutes);
        }

        // IV. Exceptions
        if (this.exceptionResponses &&
            (this.exceptionResponses.byType.size > 0 || this.exceptionResponses.byReason.size > 0)) {
            html += this._renderExceptions();
        }

        // V. Activity (timeline + threads)
        html += this._renderActivity(hourCounts, threadCounts, total);

        document.getElementById('reportsContent').innerHTML = html;

        // Re-attach event listeners
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchExceptionTab(e.target.dataset.tab));
        });
        document.querySelectorAll('.api-performance-table .sortable-col').forEach(th => {
            th.addEventListener('click', () => this.handleApiTableSort(th.dataset.sortColumn));
        });

        // Click delegation inside the reports modal: row-expand buttons toggle
        // detail rows; otherwise rows with data-filter cross-link to the log view.
        const reportsContent = document.getElementById('reportsContent');
        reportsContent.addEventListener('click', (e) => {
            const expandBtn = e.target.closest('.row-expand');
            if (expandBtn) {
                e.stopPropagation();
                this.toggleExceptionDetail(expandBtn);
                return;
            }
            if (e.target.closest('th')) return;
            const row = e.target.closest('[data-filter]');
            if (!row) return;
            this.filterByText(row.dataset.filter);
        });
    }

    /**
     * Toggle a detail sub-row showing all reasons + APIs (or types + APIs) for
     * the given exception row. The lookup key is "type:..." or "reason:..."
     * stored in data-detail-key on the parent row.
     */
    toggleExceptionDetail(button) {
        const row = button.closest('tr');
        if (!row) return;
        const next = row.nextElementSibling;
        if (next && next.classList.contains('exception-detail-row')) {
            next.remove();
            button.classList.remove('expanded');
            button.textContent = '▸';
            return;
        }

        const key = row.dataset.detailKey || '';
        const [kind, ...rest] = key.split(':');
        const id = rest.join(':');
        if (!kind || !id) return;

        const map = kind === 'type'
            ? this.exceptionResponses.byType
            : this.exceptionResponses.byReason;
        const stats = map && map.get(id);
        if (!stats) return;

        const colspan = row.children.length;
        const detail = document.createElement('tr');
        detail.className = 'exception-detail-row';
        detail.innerHTML = '<td colspan="' + colspan + '">' + this._renderExceptionDetail(kind, stats) + '</td>';
        row.parentNode.insertBefore(detail, next);
        button.classList.add('expanded');
        button.textContent = '▾';
    }

    _renderExceptionDetail(kind, stats) {
        const sortedEntries = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
        const total = stats.count || 1;

        // The "other" facet for each kind:
        const otherLabel = kind === 'type' ? 'Reasons' : 'Types';
        const otherMap = kind === 'type' ? stats.reasons : stats.types;
        const otherEntries = sortedEntries(otherMap).slice(0, 10);
        const apiEntries = sortedEntries(stats.apis).slice(0, 10);

        const list = (entries, isApi) => {
            if (!entries.length) return '<p class="exception-detail-empty">No data</p>';
            return '<ul class="exception-detail-list">' + entries.map(([name, count]) => {
                const share = ((count / total) * 100).toFixed(1);
                const filterable = isApi
                    ? (name && name !== 'Unknown')
                    : (kind === 'type' ? true : (name !== 'Unknown'));
                const cls = filterable ? ' class="report-row-link"' : '';
                const filterAttr = filterable ? ' data-filter="' + this.escape(name) + '"' : '';
                return '<li' + cls + filterAttr + '>'
                    + '<span class="exception-detail-name">' + this.escape(name) + '</span>'
                    + '<span class="exception-detail-count">' + this._formatNumber(count) + '</span>'
                    + '<span class="exception-detail-share">' + share + '%</span>'
                    + '</li>';
            }).join('') + '</ul>';
        };

        return '<div class="exception-detail">'
            + '<div class="exception-detail-col">'
            + '<h5>' + otherLabel + '</h5>'
            + list(otherEntries, false)
            + '</div>'
            + '<div class="exception-detail-col">'
            + '<h5>Thrown by</h5>'
            + list(apiEntries, true)
            + '</div>'
            + '</div>';
    }

    /**
     * Apply a text filter from a report cross-link, close the reports modal,
     * and surface the active filter in the search box so it can be cleared.
     */
    filterByText(text) {
        if (!text) return;
        this.searchQuery = text.toLowerCase();
        const search = document.getElementById('searchBox');
        search.value = text;
        this.currentPage = 1;
        this.applyFilters();
        this.closeReports();
        this.showToast('Filtered: ' + text);
    }

    // ---------- Helpers ----------

    _healthLabel(score) {
        if (score >= 90) return 'Excellent';
        if (score >= 75) return 'Good';
        if (score >= 50) return 'Fair';
        return 'Critical';
    }

    _healthClass(score) {
        if (score >= 90) return 'health-excellent';
        if (score >= 75) return 'health-good';
        if (score >= 50) return 'health-fair';
        return 'health-critical';
    }

    _formatSpan(ms) {
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

    _formatNumber(n) {
        if (n == null || isNaN(n)) return '0';
        if (n >= 1000) return n.toLocaleString();
        return String(n);
    }

    _formatMs(ms) {
        if (ms == null || !isFinite(ms)) return '—';
        if (ms < 1) return ms.toFixed(2);
        if (ms < 100) return ms.toFixed(1);
        return Math.round(ms).toString();
    }

    _renderMetaStrip(firstDate, lastDate, spanMs, total, health, healthLabel) {
        const fmt = (d) => d.toISOString().slice(0, 16).replace('T', ' ');
        let html = '<div class="report-meta">';
        html += '<div class="report-meta__cell"><span class="report-meta__label">Range</span>';
        html += '<span class="report-meta__value">' + fmt(firstDate) + ' &middot; ' + fmt(lastDate) + '</span></div>';
        html += '<div class="report-meta__cell"><span class="report-meta__label">Span</span>';
        html += '<span class="report-meta__value">' + this._formatSpan(spanMs) + '</span></div>';
        html += '<div class="report-meta__cell"><span class="report-meta__label">Entries</span>';
        html += '<span class="report-meta__value">' + this._formatNumber(total) + '</span></div>';
        html += '<div class="report-meta__cell"><span class="report-meta__label">Files</span>';
        html += '<span class="report-meta__value">' + (this.loadedFiles || 0) + '</span></div>';
        html += '<div class="report-meta__cell report-meta__cell--end">';
        html += '<span class="report-meta__label">Health</span>';
        html += '<span class="report-meta__value health-pill ' + this._healthClass(health) + '">';
        html += health + ' <em>' + healthLabel + '</em></span></div>';
        html += '</div>';
        return html;
    }

    _renderLogDistribution(levelCounts, total, spanHours) {
        const order = ['error', 'warning', 'information', 'debug'];
        let html = '<section class="report-section">';
        html += '<h3 class="report-title">Logs</h3>';
        html += '<table class="report-table report-table--minimal">';
        html += '<thead><tr><th>Level</th><th class="numeric">Count</th><th class="numeric">Share</th><th class="numeric">/ hour</th><th>Distribution</th></tr></thead>';
        html += '<tbody>';
        for (const level of order) {
            const count = levelCounts[level] || 0;
            if (count === 0 && total > 0) continue;
            const pct = total > 0 ? (count / total) * 100 : 0;
            const perHour = spanHours > 0 ? count / spanHours : 0;
            html += '<tr class="level-row level-' + level + '">';
            html += '<td><span class="level-badge ' + level + '">' + level.toUpperCase() + '</span></td>';
            html += '<td class="numeric">' + this._formatNumber(count) + '</td>';
            html += '<td class="numeric">' + pct.toFixed(1) + '%</td>';
            html += '<td class="numeric">' + perHour.toFixed(1) + '</td>';
            html += '<td class="visual-bar"><div class="distribution-bar-full"><div class="distribution-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div></td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        html += '</section>';
        return html;
    }

    _renderApiPerformance(spanMinutes) {
        // Filter out endpoints with no completed responses (count: 0)
        const allEntries = Array.from(this.apiCalls.entries());
        const validEntries = allEntries.filter(([, s]) => s.count > 0);
        const incompleteCount = allEntries.length - validEntries.length;

        if (validEntries.length === 0) return '';

        let totalCalls = 0;
        let totalTime = 0;
        let apiErrorCount = 0;
        let slowest = null;
        let fastest = null;
        let highestErrorRate = null;
        const endpoints = [];

        for (const [path, stats] of validEntries) {
            const avgTime = stats.totalTime / stats.count;
            const errorRate = (stats.errors / stats.count) * 100;
            totalCalls += stats.count;
            totalTime += stats.totalTime;
            apiErrorCount += stats.errors;
            if (!slowest || avgTime > slowest.avgTime) slowest = { path, avgTime };
            if (!fastest || avgTime < fastest.avgTime) fastest = { path, avgTime };
            if (!highestErrorRate || errorRate > highestErrorRate.rate) highestErrorRate = { path, rate: errorRate };
            endpoints.push({ path, stats, avgTime, errorRate });
        }

        const avgResponse = totalTime / totalCalls;
        const successRate = ((totalCalls - apiErrorCount) / totalCalls) * 100;
        const throughputPerMin = spanMinutes > 0 ? totalCalls / spanMinutes : 0;
        const apiHealth = Math.max(0, Math.min(100, Math.round(100 - (apiErrorCount / totalCalls) * 200)));
        const apiHealthLabel = this._healthLabel(apiHealth);

        const fastCount = endpoints.filter(e => e.avgTime < 100).length;
        const mediumCount = endpoints.filter(e => e.avgTime >= 100 && e.avgTime < 500).length;
        const slowCount = endpoints.filter(e => e.avgTime >= 500 && e.avgTime < 2000).length;
        const verySlowCount = endpoints.filter(e => e.avgTime >= 2000).length;

        const sortedEndpoints = this.getSortedApiEndpoints(endpoints);

        let html = '<section class="report-section">';
        html += '<div class="report-section__head">';
        html += '<h3 class="report-title">API performance</h3>';
        html += '<span class="health-pill ' + this._healthClass(apiHealth) + '">' + apiHealth + ' <em>' + apiHealthLabel + '</em></span>';
        html += '</div>';

        // Metrics strip
        html += '<div class="metric-strip">';
        html += this._metricCell('Total calls', this._formatNumber(totalCalls));
        html += this._metricCell('Success', successRate.toFixed(1) + '%');
        html += this._metricCell('Avg response', this._formatMs(avgResponse) + ' ms');
        html += this._metricCell('Throughput', throughputPerMin.toFixed(1) + ' /min');
        html += this._metricCell('Endpoints', this._formatNumber(endpoints.length));
        html += '</div>';

        // Inline distribution chip row
        html += '<dl class="inline-buckets">';
        html += '<div class="inline-buckets__row"><dt>Fast <span class="muted">&lt;100ms</span></dt><dd>' + fastCount + '</dd></div>';
        html += '<div class="inline-buckets__row"><dt>Medium <span class="muted">100–500ms</span></dt><dd>' + mediumCount + '</dd></div>';
        html += '<div class="inline-buckets__row"><dt>Slow <span class="muted">500–2000ms</span></dt><dd>' + slowCount + '</dd></div>';
        html += '<div class="inline-buckets__row"><dt>Very slow <span class="muted">&gt;2000ms</span></dt><dd>' + verySlowCount + '</dd></div>';
        html += '</dl>';

        // Insights
        html += '<dl class="report-insights">';
        if (fastest) html += this._insightRow('Fastest', this.escape(fastest.path), this._formatMs(fastest.avgTime) + ' ms');
        if (slowest) html += this._insightRow('Slowest', this.escape(slowest.path), this._formatMs(slowest.avgTime) + ' ms');
        if (highestErrorRate && highestErrorRate.rate > 0) {
            html += this._insightRow('Highest error rate', this.escape(highestErrorRate.path), highestErrorRate.rate.toFixed(1) + '%');
        }
        html += '</dl>';

        // Endpoint table
        const sortInd = (col) => this.apiTableSortColumn === col ? (this.apiTableSortDirection === 'asc' ? ' ↑' : ' ↓') : '';
        const sortCls = (col) => this.apiTableSortColumn === col ? ' sortable-col active' : ' sortable-col';

        html += '<table class="report-table api-performance-table">';
        html += '<thead><tr>';
        html += '<th>Endpoint</th>';
        html += '<th class="numeric' + sortCls('calls') + '" data-sort-column="calls">Calls' + sortInd('calls') + '</th>';
        html += '<th class="numeric' + sortCls('avgTime') + '" data-sort-column="avgTime">Avg' + sortInd('avgTime') + '</th>';
        html += '<th class="numeric' + sortCls('minTime') + '" data-sort-column="minTime">Min' + sortInd('minTime') + '</th>';
        html += '<th class="numeric' + sortCls('maxTime') + '" data-sort-column="maxTime">Max' + sortInd('maxTime') + '</th>';
        html += '<th class="numeric">Success</th>';
        html += '<th>Status</th>';
        html += '</tr></thead><tbody>';

        for (const e of sortedEndpoints) {
            const { path, stats, avgTime, errorRate } = e;
            const statusClass = errorRate > 10 ? 'api-status-poor' : errorRate > 0 ? 'api-status-fair' : 'api-status-good';
            const successCallRate = ((stats.count - stats.errors) / stats.count) * 100;
            const statusCodeStr = stats.statusCodes && stats.statusCodes.size > 0
                ? Array.from(stats.statusCodes.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([code, count]) => code + ':' + count)
                    .join(' ')
                : '—';

            html += '<tr class="api-row report-row-link ' + statusClass + '" data-filter="' + this.escape(path) + '" title="Click to filter logs by this endpoint">';
            html += '<td class="report-code">' + this.escape(path) + '</td>';
            html += '<td class="numeric">' + this._formatNumber(stats.count) + '</td>';
            html += '<td class="numeric">' + this._formatMs(avgTime) + '</td>';
            html += '<td class="numeric">' + this._formatMs(stats.minTime === Infinity ? 0 : stats.minTime) + '</td>';
            html += '<td class="numeric">' + this._formatMs(stats.maxTime) + '</td>';
            html += '<td class="numeric">' + successCallRate.toFixed(1) + '%</td>';
            html += '<td class="status-codes">' + statusCodeStr + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        if (incompleteCount > 0) {
            html += '<p class="report-footnote">' + incompleteCount + ' endpoint' + (incompleteCount === 1 ? '' : 's') + ' had a request but no matching response and were excluded.</p>';
        }
        html += '</section>';
        return html;
    }

    _renderInternalHttp(spanMinutes) {
        const allEntries = Array.from(this.innerApiCalls.entries());
        const validEntries = allEntries.filter(([, s]) => s.count > 0);
        if (validEntries.length === 0) return '';

        let totalCalls = 0;
        let totalTime = 0;
        let errors = 0;
        let slowest = null;
        let fastest = null;
        const endpoints = [];

        for (const [path, stats] of validEntries) {
            const avgTime = stats.totalTime / stats.count;
            const errorRate = (stats.errors / stats.count) * 100;
            totalCalls += stats.count;
            totalTime += stats.totalTime;
            errors += stats.errors;
            if (!slowest || avgTime > slowest.avgTime) slowest = { path, avgTime };
            if (!fastest || avgTime < fastest.avgTime) fastest = { path, avgTime };
            endpoints.push({ path, stats, avgTime, errorRate });
        }

        const avgResponse = totalTime / totalCalls;
        const successRate = ((totalCalls - errors) / totalCalls) * 100;
        const throughputPerMin = spanMinutes > 0 ? totalCalls / spanMinutes : 0;
        const health = Math.max(0, Math.min(100, Math.round(100 - (errors / totalCalls) * 200)));
        const healthLabel = this._healthLabel(health);

        endpoints.sort((a, b) => b.avgTime - a.avgTime);

        let html = '<section class="report-section">';
        html += '<div class="report-section__head">';
        html += '<h3 class="report-title">Internal HTTP</h3>';
        html += '<span class="health-pill ' + this._healthClass(health) + '">' + health + ' <em>' + healthLabel + '</em></span>';
        html += '</div>';
        html += '<p class="report-description">Outbound HTTP calls made within request handling.</p>';

        html += '<div class="metric-strip">';
        html += this._metricCell('Total calls', this._formatNumber(totalCalls));
        html += this._metricCell('Success', successRate.toFixed(1) + '%');
        html += this._metricCell('Avg response', this._formatMs(avgResponse) + ' ms');
        html += this._metricCell('Throughput', throughputPerMin.toFixed(1) + ' /min');
        html += this._metricCell('Endpoints', this._formatNumber(endpoints.length));
        html += '</div>';

        html += '<dl class="report-insights">';
        if (fastest) html += this._insightRow('Fastest', this.escape(fastest.path), this._formatMs(fastest.avgTime) + ' ms');
        if (slowest) html += this._insightRow('Slowest', this.escape(slowest.path), this._formatMs(slowest.avgTime) + ' ms');
        html += '</dl>';

        html += '<table class="report-table internal-http-table">';
        html += '<thead><tr>';
        html += '<th>Method &amp; path</th>';
        html += '<th class="numeric">Calls</th>';
        html += '<th class="numeric">Avg</th>';
        html += '<th class="numeric">Min</th>';
        html += '<th class="numeric">Max</th>';
        html += '<th class="numeric">Success</th>';
        html += '<th>Status</th>';
        html += '</tr></thead><tbody>';

        for (const e of endpoints) {
            const { path, stats, avgTime } = e;
            const minTime = stats.minTime === Infinity ? 0 : stats.minTime;
            const successCallRate = ((stats.count - stats.errors) / stats.count) * 100;
            const statusCodeStr = stats.statusCodes && stats.statusCodes.size > 0
                ? Array.from(stats.statusCodes.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([code, count]) => code + ':' + count)
                    .join(' ')
                : '—';

            html += '<tr class="internal-http-row report-row-link" data-filter="' + this.escape(path) + '" title="Click to filter logs by this call">';
            html += '<td class="report-code">' + this.escape(path) + '</td>';
            html += '<td class="numeric">' + this._formatNumber(stats.count) + '</td>';
            html += '<td class="numeric">' + this._formatMs(avgTime) + '</td>';
            html += '<td class="numeric">' + this._formatMs(minTime) + '</td>';
            html += '<td class="numeric">' + this._formatMs(stats.maxTime) + '</td>';
            html += '<td class="numeric">' + successCallRate.toFixed(1) + '%</td>';
            html += '<td class="status-codes">' + statusCodeStr + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += '</section>';
        return html;
    }

    _renderExceptions() {
        let totalExceptions = 0;
        for (const [, stats] of this.exceptionResponses.byType) totalExceptions += stats.count;
        if (totalExceptions === 0) return '';

        let html = '<section class="report-section">';
        html += '<h3 class="report-title">Exceptions</h3>';

        html += '<div class="metric-strip">';
        html += this._metricCell('Total', this._formatNumber(totalExceptions));
        html += this._metricCell('Types', this._formatNumber(this.exceptionResponses.byType.size));
        html += this._metricCell('Reasons', this._formatNumber(this.exceptionResponses.byReason.size));
        html += '</div>';

        html += '<div class="exception-tabs">';
        html += '<button class="exception-tab-btn active" data-tab="by-type">By type</button>';
        html += '<button class="exception-tab-btn" data-tab="by-reason">By reason</button>';
        html += '</div>';

        // By type
        const typeEntries = Array.from(this.exceptionResponses.byType.entries())
            .sort((a, b) => b[1].count - a[1].count);
        let typeHtml = '<table class="report-table exception-table">';
        typeHtml += '<thead><tr><th class="col-expand"></th><th>Type</th><th class="numeric">Count</th><th class="numeric">Share</th><th>Top reason</th><th>Thrown by</th></tr></thead><tbody>';
        for (const [type, stats] of typeEntries) {
            let topReason = '—';
            let topReasonCount = 0;
            for (const [reason, count] of stats.reasons) {
                if (count > topReasonCount) { topReasonCount = count; topReason = reason; }
            }
            let topApi = '—';
            let topApiCount = 0;
            for (const [api, count] of stats.apis) {
                if (count > topApiCount) { topApiCount = count; topApi = api; }
            }
            const pct = (stats.count / totalExceptions) * 100;
            const filterable = type !== 'Unknown';
            typeHtml += '<tr class="exception-row' + (filterable ? ' report-row-link' : '') + '"'
                + (filterable ? ' data-filter="' + this.escape(type) + '" title="Click to filter logs by this exception type"' : '')
                + ' data-detail-key="type:' + this.escape(type) + '">';
            typeHtml += '<td class="col-expand"><button type="button" class="row-expand" aria-label="Toggle details">▸</button></td>';
            typeHtml += '<td class="report-code exception-type-name">' + this.escape(type) + '</td>';
            typeHtml += '<td class="numeric">' + this._formatNumber(stats.count) + '</td>';
            typeHtml += '<td class="numeric"><div class="percentage-container">' + pct.toFixed(1) + '%<div class="exception-percentage-bar" style="width:' + pct.toFixed(1) + '%"></div></div></td>';
            typeHtml += '<td class="exception-reason">' + this.escape(topReason) + (topReasonCount > 1 ? ' <span class="muted-count">×' + topReasonCount + '</span>' : '') + '</td>';
            typeHtml += '<td class="report-code exception-api">' + this.escape(topApi) + '</td>';
            typeHtml += '</tr>';
        }
        typeHtml += '</tbody></table>';

        // By reason
        const reasonEntries = Array.from(this.exceptionResponses.byReason.entries())
            .sort((a, b) => b[1].count - a[1].count);
        let reasonHtml = '<table class="report-table exception-table">';
        reasonHtml += '<thead><tr><th class="col-expand"></th><th>Reason</th><th class="numeric">Count</th><th class="numeric">Share</th><th>Top type</th><th>Thrown by</th></tr></thead><tbody>';
        for (const [reason, stats] of reasonEntries) {
            let topType = '—';
            let topTypeCount = 0;
            for (const [type, count] of stats.types) {
                if (count > topTypeCount) { topTypeCount = count; topType = type; }
            }
            let topApi = '—';
            let topApiCount = 0;
            for (const [api, count] of stats.apis) {
                if (count > topApiCount) { topApiCount = count; topApi = api; }
            }
            const pct = (stats.count / totalExceptions) * 100;
            reasonHtml += '<tr class="exception-row" data-detail-key="reason:' + this.escape(reason) + '">';
            reasonHtml += '<td class="col-expand"><button type="button" class="row-expand" aria-label="Toggle details">▸</button></td>';
            reasonHtml += '<td class="report-code exception-reason-name">' + this.escape(reason) + '</td>';
            reasonHtml += '<td class="numeric">' + this._formatNumber(stats.count) + '</td>';
            reasonHtml += '<td class="numeric"><div class="percentage-container">' + pct.toFixed(1) + '%<div class="exception-percentage-bar" style="width:' + pct.toFixed(1) + '%"></div></div></td>';
            reasonHtml += '<td class="exception-type">' + this.escape(topType) + '</td>';
            reasonHtml += '<td class="report-code exception-api">' + this.escape(topApi) + '</td>';
            reasonHtml += '</tr>';
        }
        reasonHtml += '</tbody></table>';

        html += '<div id="exceptionByType" class="exception-tab-content active">' + typeHtml + '</div>';
        html += '<div id="exceptionByReason" class="exception-tab-content hidden">' + reasonHtml + '</div>';
        html += '</section>';
        return html;
    }

    _renderActivity(hourCounts, threadCounts, total) {
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
        const peakValue = hourCounts[peakHour];
        const max = Math.max(1, ...hourCounts);

        let html = '<section class="report-section">';
        html += '<h3 class="report-title">Activity</h3>';

        // Hourly bars
        html += '<p class="report-description">Hourly distribution &middot; peak ' +
            String(peakHour).padStart(2, '0') + ':00 (' + this._formatNumber(peakValue) + ' entries)</p>';
        html += '<div class="hourly-timeline">';
        for (let h = 0; h < 24; h++) {
            const count = hourCounts[h];
            const heightPct = (count / max) * 100;
            html += '<div class="timeline-bar-container" title="' + String(h).padStart(2, '0') + ':00 — ' + count + ' entries">';
            html += '<div class="timeline-bar" style="height:' + heightPct.toFixed(1) + '%"></div>';
            html += '<div class="timeline-label">' + String(h).padStart(2, '0') + '</div>';
            html += '</div>';
        }
        html += '</div>';

        // Top threads
        const topThreads = Object.entries(threadCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        if (topThreads.length > 0) {
            html += '<h4 class="subsection-title">Top threads / correlation IDs</h4>';
            html += '<table class="report-table report-table--minimal">';
            html += '<thead><tr><th>Thread / Correlation</th><th class="numeric">Count</th><th class="numeric">Share</th><th>Distribution</th></tr></thead><tbody>';
            const topMax = topThreads[0][1];
            for (const [thread, count] of topThreads) {
                const pct = (count / total) * 100;
                const relPct = (count / topMax) * 100;
                const filterable = thread && thread !== 'N/A';
                html += '<tr' + (filterable ? ' class="report-row-link" data-filter="' + this.escape(thread) + '" title="Click to filter logs by this thread / correlation"' : '') + '>';
                html += '<td class="report-code">' + this.escape(thread) + '</td>';
                html += '<td class="numeric">' + this._formatNumber(count) + '</td>';
                html += '<td class="numeric">' + pct.toFixed(1) + '%</td>';
                html += '<td class="visual-bar"><div class="distribution-bar-full"><div class="distribution-bar-fill" style="width:' + relPct.toFixed(1) + '%;background:var(--accent)"></div></div></td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
        }

        html += '</section>';
        return html;
    }

    _metricCell(label, value) {
        return '<div class="metric-strip__cell">' +
            '<span class="metric-strip__label">' + label + '</span>' +
            '<span class="metric-strip__value">' + value + '</span></div>';
    }

    _insightRow(label, target, value) {
        return '<div class="report-insights__row">' +
            '<dt>' + label + '</dt>' +
            '<dd><span class="insight-target">' + target + '</span><span class="insight-metric">' + value + '</span></dd>' +
            '</div>';
    }

    parseExceptionResponses() {
        this.exceptionResponses = {
            byType: new Map(),
            byReason: new Map()
        };

        this.logs.forEach(log => {
            if (log.level === 'error' && log.exception) {
                // TYPE: capture full token until whitespace, comma, or newline.
                // (\w+ truncated qualified types like "System.NullReferenceException".)
                const typeMatch = log.exception.match(/TYPE:\s*([^\s,\n\r]+)/i);
                const reasonMatch = log.exception.match(/REASON:\s*([^\n\r]+)/i);
                const httpMatch = log.exception.match(/HTTP:\s*(\w+)\s+([^\s\n\r]+)/i);

                if (typeMatch || reasonMatch) {
                    const type = typeMatch ? typeMatch[1].trim() : 'Unknown';
                    const rawReason = reasonMatch ? reasonMatch[1].trim() : 'Unknown';
                    const reason = this.normalizeExceptionMessage(rawReason);

                    // Resolve API path: explicit HTTP: line first, then fall back to the
                    // API that owned this correlation/request id (built during parse).
                    let apiPath = 'Unknown';
                    if (httpMatch) {
                        apiPath = httpMatch[1] + ' ' + httpMatch[2];
                    } else if (log.correlationId && this.apiByCorrelation && this.apiByCorrelation.has(log.correlationId)) {
                        apiPath = this.apiByCorrelation.get(log.correlationId);
                    } else if (log.requestId && this.apiByCorrelation && this.apiByCorrelation.has(log.requestId)) {
                        apiPath = this.apiByCorrelation.get(log.requestId);
                    }

                    // Group by TYPE
                    if (!this.exceptionResponses.byType.has(type)) {
                        this.exceptionResponses.byType.set(type, {
                            count: 0,
                            reasons: new Map(),
                            apis: new Map()
                        });
                    }
                    const typeStats = this.exceptionResponses.byType.get(type);
                    typeStats.count++;

                    if (reason !== 'Unknown') {
                        typeStats.reasons.set(reason, (typeStats.reasons.get(reason) || 0) + 1);
                    }
                    typeStats.apis.set(apiPath, (typeStats.apis.get(apiPath) || 0) + 1);

                    // Group by REASON
                    if (!this.exceptionResponses.byReason.has(reason)) {
                        this.exceptionResponses.byReason.set(reason, {
                            count: 0,
                            types: new Map(),
                            apis: new Map()
                        });
                    }
                    const reasonStats = this.exceptionResponses.byReason.get(reason);
                    reasonStats.count++;

                    if (type !== 'Unknown') {
                        reasonStats.types.set(type, (reasonStats.types.get(type) || 0) + 1);
                    }
                    reasonStats.apis.set(apiPath, (reasonStats.apis.get(apiPath) || 0) + 1);
                }
            }
        });
    }

    switchExceptionTab(tab) {
        // Update button states
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tab) {
                btn.classList.add('active');
            }
        });

        // Update content visibility
        if (tab === 'by-type') {
            document.getElementById('exceptionByType').classList.add('active');
            document.getElementById('exceptionByReason').classList.remove('active');
        } else if (tab === 'by-reason') {
            document.getElementById('exceptionByType').classList.remove('active');
            document.getElementById('exceptionByReason').classList.add('active');
        }
    }

    exportReport() {
        if (!this.logs.length) {
            this.showToast('No data to export');
            return;
        }

        const firstDate = this.logs[0].date;
        const lastDate = this.logs[this.logs.length - 1].date;
        const spanMs = Math.max(1, lastDate - firstDate);
        const spanMinutes = spanMs / 60000;
        const spanHours = spanMs / 3600000;

        // Level distribution + log health (matches the report modal calc).
        const byLevel = { debug: 0, information: 0, warning: 0, error: 0 };
        const byThread = {};
        const byHour = new Array(24).fill(0);
        for (const log of this.logs) {
            byLevel[log.level] = (byLevel[log.level] || 0) + 1;
            const thread = log.correlationId || log.threadId;
            byThread[thread] = (byThread[thread] || 0) + 1;
            byHour[log.date.getHours()]++;
        }
        const errorRate = (byLevel.error / this.logs.length) * 100;
        const warningRate = (byLevel.warning / this.logs.length) * 100;
        const logHealth = Math.max(0, Math.min(100, Math.round(100 - errorRate * 5 - warningRate * 1.5)));

        // API performance (only completed call pairs).
        const apiEndpoints = [];
        let apiTotalCalls = 0, apiTotalTime = 0, apiTotalErrors = 0;
        if (this.apiCalls) {
            for (const [path, stats] of this.apiCalls) {
                if (stats.count === 0) continue;
                apiTotalCalls += stats.count;
                apiTotalTime += stats.totalTime;
                apiTotalErrors += stats.errors;
                apiEndpoints.push({
                    path,
                    calls: stats.count,
                    avgMs: +(stats.totalTime / stats.count).toFixed(2),
                    minMs: stats.minTime === Infinity ? 0 : +stats.minTime.toFixed(2),
                    maxMs: +stats.maxTime.toFixed(2),
                    errors: stats.errors,
                    errorRate: +((stats.errors / stats.count) * 100).toFixed(2)
                });
            }
            apiEndpoints.sort((a, b) => b.calls - a.calls);
        }
        const apiHealth = apiTotalCalls > 0
            ? Math.max(0, Math.min(100, Math.round(100 - (apiTotalErrors / apiTotalCalls) * 200)))
            : null;

        // Internal HTTP.
        const internalEndpoints = [];
        let internalTotalCalls = 0, internalTotalTime = 0, internalTotalErrors = 0;
        if (this.innerApiCalls) {
            for (const [path, stats] of this.innerApiCalls) {
                if (stats.count === 0) continue;
                internalTotalCalls += stats.count;
                internalTotalTime += stats.totalTime;
                internalTotalErrors += stats.errors;
                internalEndpoints.push({
                    path,
                    calls: stats.count,
                    avgMs: +(stats.totalTime / stats.count).toFixed(2),
                    minMs: stats.minTime === Infinity ? 0 : +stats.minTime.toFixed(2),
                    maxMs: +stats.maxTime.toFixed(2),
                    errors: stats.errors,
                    statusCodes: Object.fromEntries(stats.statusCodes || [])
                });
            }
            internalEndpoints.sort((a, b) => b.calls - a.calls);
        }
        const internalHealth = internalTotalCalls > 0
            ? Math.max(0, Math.min(100, Math.round(100 - (internalTotalErrors / internalTotalCalls) * 200)))
            : null;

        // Exceptions — re-parse to ensure fresh data.
        this.parseExceptionResponses();
        const exceptionsByType = [];
        if (this.exceptionResponses) {
            for (const [type, stats] of this.exceptionResponses.byType) {
                let topReason = null, topReasonCount = 0;
                for (const [r, c] of stats.reasons) if (c > topReasonCount) { topReason = r; topReasonCount = c; }
                let topApi = null, topApiCount = 0;
                for (const [a, c] of stats.apis) if (c > topApiCount) { topApi = a; topApiCount = c; }
                exceptionsByType.push({ type, count: stats.count, topReason, topApi });
            }
            exceptionsByType.sort((a, b) => b.count - a.count);
        }

        const report = {
            generatedAt: new Date().toISOString(),
            range: {
                from: firstDate.toISOString(),
                to: lastDate.toISOString(),
                spanMinutes: +spanMinutes.toFixed(1),
                spanHours: +spanHours.toFixed(2)
            },
            files: this.loadedFileNames,
            totals: {
                entries: this.logs.length,
                byLevel,
                logHealth
            },
            api: apiTotalCalls > 0 ? {
                totalCalls: apiTotalCalls,
                avgResponseMs: +(apiTotalTime / apiTotalCalls).toFixed(2),
                successRate: +(((apiTotalCalls - apiTotalErrors) / apiTotalCalls) * 100).toFixed(2),
                throughputPerMin: +(apiTotalCalls / spanMinutes).toFixed(2),
                health: apiHealth,
                endpoints: apiEndpoints
            } : null,
            internalHttp: internalTotalCalls > 0 ? {
                totalCalls: internalTotalCalls,
                avgResponseMs: +(internalTotalTime / internalTotalCalls).toFixed(2),
                successRate: +(((internalTotalCalls - internalTotalErrors) / internalTotalCalls) * 100).toFixed(2),
                health: internalHealth,
                endpoints: internalEndpoints
            } : null,
            exceptions: exceptionsByType.length > 0 ? {
                total: exceptionsByType.reduce((s, e) => s + e.count, 0),
                uniqueTypes: exceptionsByType.length,
                byType: exceptionsByType
            } : null,
            activity: {
                byHour: Object.fromEntries(byHour.map((v, h) => [String(h).padStart(2, '0'), v])),
                topThreads: Object.entries(byThread)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([thread, count]) => ({ thread, count }))
            }
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'log-report-' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Report exported');
    }
}

// Initialize the LogViewer when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LogViewer();
});