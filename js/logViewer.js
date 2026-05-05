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
        this.hourFilter = null; // 0..23 to filter to a single hour-of-day bucket
        // Sort state for exception tables (shared across by-type / by-reason tabs).
        this.exceptionSortColumn = 'count'; // 'name' | 'count'
        this.exceptionSortDirection = 'desc'; // 'asc' | 'desc'
        // Search modes (session-only — not persisted in URL).
        this.searchOptions = { caseSensitive: false, wholeWord: false, regex: false };
        this._searchPredicate = null; // compiled (text) -> boolean, null when no query
        this._searchHighlightRegex = null; // RegExp for highlight() use
        this._searchInvalid = false; // last regex compile failed
        this.expandedRows = new Set(); // log ids currently inline-expanded
        this.collapseRepeats = false; // group adjacent identical messages
        this.STORAGE_KEY_THEME = 'logViewer.theme';
        this.STORAGE_KEY_VIEWS = 'logViewer.views';
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
        document.getElementById('collapseBtn').addEventListener('click', () => this.toggleCollapseRepeats());
        document.getElementById('viewsBtn').addEventListener('click', () => this.toggleViewsPopover());
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
        document.getElementById('helpClose').addEventListener('click', () => this.closeHelp());
        document.getElementById('helpCloseBtn').addEventListener('click', () => this.closeHelp());
        document.getElementById('helpModal').addEventListener('click', (e) => {
            if (e.target.id === 'helpModal') this.closeHelp();
        });
        // Report-modal click + keyboard delegation. Registered once here so we
        // don't accumulate handlers each time generateReports() re-renders —
        // duplicates would cancel each other out (e.g. expand+collapse on a
        // single click), making the chevrons appear broken.
        this._attachReportsDelegation();
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => this.toggleFilter(btn));
        });
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setTheme(btn.dataset.theme));
        });
        document.querySelectorAll('.search-mod').forEach(btn => {
            btn.addEventListener('click', () => this.toggleSearchMod(btn));
        });
        // Exception tab handlers
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchExceptionTab(e.target.dataset.tab));
        });
        this.attachKeyboardShortcuts();
        this.attachDragAndDrop();
        this.attachUrlState();
        this.attachTailMode();
    }

    /**
     * Tail mode uses the File System Access API to keep a single file open
     * and re-read it when its size or mtime changes. Browsers without the API
     * (Firefox/Safari at time of writing) hide the button entirely.
     */
    attachTailMode() {
        const btn = document.getElementById('tailBtn');
        if (!btn) return;
        if (!('showOpenFilePicker' in window)) {
            // Already hidden in HTML; keep it hidden.
            return;
        }
        btn.classList.remove('hidden');
        btn.addEventListener('click', () => this.toggleTail());

        // When the user scrolls to the bottom (via wheel, drag, or End key),
        // dismiss the "N new" pill automatically.
        const container = document.getElementById('logContainer');
        if (container) {
            container.addEventListener('scroll', () => {
                if (this._tailNewCount && this._isScrolledNearBottom(container)) {
                    this._setTailNewCount(0);
                }
            }, { passive: true });
        }

        // Offer to resume a previously-tailed file from IndexedDB.
        this._restoreTailIfAny();
    }

    // ---------- IndexedDB helpers (for tail-handle persistence) ----------

    _openIdb() {
        if (this._idbPromise) return this._idbPromise;
        if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
        this._idbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open('logViewer', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = () => req.result.createObjectStore('handles');
        });
        return this._idbPromise;
    }

    async _idbPut(key, value) {
        const db = await this._openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async _idbGet(key) {
        const db = await this._openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async _idbDelete(key) {
        const db = await this._openIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async _restoreTailIfAny() {
        if (!('showOpenFilePicker' in window) || typeof indexedDB === 'undefined') return;
        let handle = null;
        try { handle = await this._idbGet('tailHandle'); } catch (e) { return; }
        if (!handle || typeof handle.queryPermission !== 'function') return;
        this._showResumeTailBanner(handle);
    }

    _showResumeTailBanner(handle) {
        // Don't double-show.
        if (document.querySelector('.tail-resume-banner')) return;
        const banner = document.createElement('div');
        banner.className = 'tail-resume-banner';
        banner.innerHTML =
            '<span class="tail-resume-banner__text">Resume tailing <strong></strong>?</span>'
            + '<button type="button" class="btn btn-primary tail-resume-banner__yes">Resume</button>'
            + '<button type="button" class="btn btn-secondary tail-resume-banner__no">Dismiss</button>';
        banner.querySelector('strong').textContent = handle.name;
        document.body.appendChild(banner);

        banner.querySelector('.tail-resume-banner__yes').addEventListener('click', async () => {
            banner.remove();
            await this._resumeTail(handle);
        });
        banner.querySelector('.tail-resume-banner__no').addEventListener('click', () => {
            banner.remove();
            this._idbDelete('tailHandle').catch(() => {});
        });
    }

    async _resumeTail(handle) {
        try {
            const perm = await handle.requestPermission({ mode: 'read' });
            if (perm !== 'granted') {
                this.showToast('Permission denied');
                return;
            }
            this._tailHandle = handle;
            this._tailLastSize = -1;
            this._tailLastModified = -1;
            const btn = document.getElementById('tailBtn');
            if (btn) {
                btn.classList.add('active');
                btn.textContent = 'Stop tail';
            }
            this.showToast('Resumed tailing: ' + handle.name);
            await this._tailPoll();
            this._tailInterval = setInterval(() => this._tailPoll(), 2000);
        } catch (e) {
            console.error('Resume tail failed:', e);
            this.showToast('Resume failed: ' + (e.message || e.name));
            this._idbDelete('tailHandle').catch(() => {});
        }
    }

    async toggleTail() {
        if (this._tailHandle) {
            this.stopTail();
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'Log files', accept: { 'text/plain': ['.txt', '.log'] } }],
                multiple: false
            });
            this._tailHandle = handle;
            this._tailLastSize = -1;
            this._tailLastModified = -1;
            const btn = document.getElementById('tailBtn');
            btn.classList.add('active');
            btn.textContent = 'Stop tail';
            this.showToast('Tailing: ' + handle.name);
            // Persist the handle so a refresh can offer to resume.
            this._idbPut('tailHandle', handle).catch(e => console.warn('IDB save failed:', e));
            await this._tailPoll();
            this._tailInterval = setInterval(() => this._tailPoll(), 2000);
        } catch (e) {
            // AbortError = user dismissed the picker — silent.
            if (e && e.name !== 'AbortError') {
                console.error('Tail start failed:', e);
                this.showToast('Tail failed: ' + (e.message || e.name));
            }
        }
    }

    stopTail() {
        if (this._tailInterval) clearInterval(this._tailInterval);
        this._tailInterval = null;
        this._tailHandle = null;
        const btn = document.getElementById('tailBtn');
        if (btn) {
            btn.classList.remove('active');
            btn.textContent = 'Tail';
        }
        this._setTailNewCount(0);
        this._idbDelete('tailHandle').catch(() => {});
        this.showToast('Tail stopped');
    }

    async _tailPoll() {
        if (!this._tailHandle) return;
        try {
            const file = await this._tailHandle.getFile();
            if (file.size === this._tailLastSize && file.lastModified === this._tailLastModified) {
                return; // no change since last poll
            }

            // Capture scroll state before re-render so we can decide whether to
            // sticky-scroll or surface a "N new" pill.
            const container = document.getElementById('logContainer');
            const wasAtBottom = container ? this._isScrolledNearBottom(container) : true;
            const prevLogCount = this.logs.length;

            this._tailLastSize = file.size;
            this._tailLastModified = file.lastModified;
            const text = await file.text();
            this.loadedFiles = 1;
            this.loadedFileNames = [file.name];
            this.parseLogs(text);

            const newCount = Math.max(0, this.logs.length - prevLogCount);
            if (newCount > 0) {
                if (wasAtBottom) {
                    this._scrollLogsToBottom();
                    this._setTailNewCount(0);
                } else {
                    this._setTailNewCount((this._tailNewCount || 0) + newCount);
                }
                // If the reports modal is open, surface a refresh notice
                // instead of auto-regenerating (which would lose scroll
                // position and expanded exception rows).
                const reportsOpen = document.getElementById('reportsModal')
                    && document.getElementById('reportsModal').classList.contains('show');
                if (reportsOpen) {
                    this._reportsStaleCount = (this._reportsStaleCount || 0) + newCount;
                    this._showReportsStaleNotice();
                }
            }
        } catch (e) {
            console.error('Tail poll error:', e);
            this.stopTail();
            this.showToast('Tail stopped: file unavailable');
        }
    }

    _isScrolledNearBottom(el, threshold) {
        if (!el) return true;
        const t = typeof threshold === 'number' ? threshold : 60;
        return (el.scrollTop + el.clientHeight) >= (el.scrollHeight - t);
    }

    _scrollLogsToBottom() {
        const container = document.getElementById('logContainer');
        if (container) container.scrollTop = container.scrollHeight;
    }

    /**
     * Show or hide the floating "N new" pill. n=0 hides it.
     * Lazy-creates the DOM element on first use.
     */
    _setTailNewCount(n) {
        this._tailNewCount = Math.max(0, n | 0);
        let pill = document.getElementById('tailNewPill');
        if (this._tailNewCount === 0) {
            if (pill) pill.classList.add('hidden');
            return;
        }
        if (!pill) {
            pill = document.createElement('button');
            pill.id = 'tailNewPill';
            pill.className = 'tail-new-pill';
            pill.type = 'button';
            pill.addEventListener('click', () => {
                this._scrollLogsToBottom();
                this._setTailNewCount(0);
            });
            document.body.appendChild(pill);
        }
        pill.innerHTML = '<span class="tail-new-pill__arrow" aria-hidden="true">↓</span> '
            + (this._tailNewCount > 99 ? '99+' : this._tailNewCount) + ' new';
        pill.title = this._tailNewCount + ' new entries since you last reached the bottom — click to jump';
        pill.classList.remove('hidden');
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
            this.searchQuery = search;
            this._compileSearch();
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
        const hour = parseInt(params.get('h'), 10);
        if (!isNaN(hour) && hour >= 0 && hour <= 23) this.hourFilter = hour;
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
        if (this.hourFilter !== null) params.set('h', String(this.hourFilter));
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
            document.getElementById('reportsModal').classList.contains('show') ||
            document.getElementById('helpModal').classList.contains('show');

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
                if (document.getElementById('helpModal').classList.contains('show')) {
                    this.closeHelp();
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

            // "?" — show keyboard help
            if (e.key === '?') {
                e.preventDefault();
                this.showHelp();
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

    // ---------- Saved views ----------

    _loadViews() {
        try {
            const json = localStorage.getItem(this.STORAGE_KEY_VIEWS);
            return json ? JSON.parse(json) : [];
        } catch (e) { return []; }
    }

    _writeViews(views) {
        try {
            localStorage.setItem(this.STORAGE_KEY_VIEWS, JSON.stringify(views));
        } catch (e) { /* storage blocked */ }
    }

    saveCurrentView(rawName) {
        const name = (rawName || '').trim();
        if (!name) return false;
        const views = this._loadViews();
        const state = {
            name,
            query: this.searchQuery || '',
            options: { ...this.searchOptions },
            levels: { ...this.filters },
            dateFrom: document.getElementById('dateFrom').value || null,
            dateTo: document.getElementById('dateTo').value || null,
            hour: this.hourFilter,
            sort: { column: this.sortColumn, direction: this.sortDirection },
            collapse: !!this.collapseRepeats,
            savedAt: new Date().toISOString()
        };
        const existing = views.findIndex(v => v.name === name);
        if (existing >= 0) views[existing] = state; else views.unshift(state);
        this._writeViews(views);
        this.showToast('View saved: ' + name);
        this._renderViewsPopover();
        return true;
    }

    applyView(name) {
        const views = this._loadViews();
        const v = views.find(view => view.name === name);
        if (!v) return;

        this.searchQuery = v.query || '';
        document.getElementById('searchBox').value = this.searchQuery;
        this.searchOptions = Object.assign(
            { caseSensitive: false, wholeWord: false, regex: false },
            v.options || {}
        );
        document.querySelectorAll('.search-mod').forEach(btn => {
            const key = btn.dataset.mod === 'case' ? 'caseSensitive'
                : btn.dataset.mod === 'word' ? 'wholeWord'
                : 'regex';
            const active = !!this.searchOptions[key];
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        this._compileSearch();

        this.filters = Object.assign(
            { debug: true, information: true, warning: true, error: true },
            v.levels || {}
        );
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const active = !!this.filters[btn.dataset.level];
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        document.getElementById('dateFrom').value = v.dateFrom || '';
        document.getElementById('dateTo').value = v.dateTo || '';
        if (v.dateFrom) this.setDateFrom(v.dateFrom); else this.dateFrom = null;
        if (v.dateTo) this.setDateTo(v.dateTo); else this.dateTo = null;

        this.hourFilter = (typeof v.hour === 'number') ? v.hour : null;

        // Sort state — default to timestamp asc if the saved view predates this field.
        if (v.sort && v.sort.column) {
            this.sortColumn = v.sort.column;
            this.sortDirection = v.sort.direction === 'desc' ? 'desc' : 'asc';
            this._sortCache = null;
        }

        // Collapse-repeats toggle.
        const wantCollapse = !!v.collapse;
        if (wantCollapse !== this.collapseRepeats) {
            this.collapseRepeats = wantCollapse;
            const cb = document.getElementById('collapseBtn');
            if (cb) {
                cb.classList.toggle('active', wantCollapse);
                cb.setAttribute('aria-pressed', wantCollapse ? 'true' : 'false');
            }
        }

        this.currentPage = 1;
        this.applyFilters();
        this.closeViewsPopover();
        this.showToast('Applied: ' + name);
    }

    deleteView(name) {
        const views = this._loadViews().filter(v => v.name !== name);
        this._writeViews(views);
        this._renderViewsPopover();
        this.showToast('Deleted: ' + name);
    }

    toggleViewsPopover() {
        const pop = document.getElementById('viewsPopover');
        const btn = document.getElementById('viewsBtn');
        if (!pop.classList.contains('hidden')) {
            this.closeViewsPopover();
            return;
        }
        this._renderViewsPopover();
        pop.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        // Close on outside click. Defer one tick so the opening click itself
        // doesn't immediately re-trigger close.
        setTimeout(() => {
            this._viewsOutsideHandler = (e) => {
                if (!pop.contains(e.target) && !btn.contains(e.target)) {
                    this.closeViewsPopover();
                }
            };
            document.addEventListener('click', this._viewsOutsideHandler);
        }, 0);
    }

    closeViewsPopover() {
        const pop = document.getElementById('viewsPopover');
        const btn = document.getElementById('viewsBtn');
        pop.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (this._viewsOutsideHandler) {
            document.removeEventListener('click', this._viewsOutsideHandler);
            this._viewsOutsideHandler = null;
        }
    }

    _renderViewsPopover() {
        const pop = document.getElementById('viewsPopover');
        const views = this._loadViews();
        let html = '<form class="views-popover__form" id="viewsSaveForm">';
        html += '<input type="text" class="views-popover__input" placeholder="Name this view" maxlength="60" aria-label="View name">';
        html += '<button type="submit" class="btn btn-primary views-popover__save">Save</button>';
        html += '</form>';
        if (views.length === 0) {
            html += '<p class="views-popover__empty">No saved views yet. Type a name above to bookmark the current filters.</p>';
        } else {
            html += '<ul class="views-popover__list">';
            for (const v of views) {
                html += '<li class="views-popover__item" data-view-name="' + this.escape(v.name) + '">';
                html += '<button type="button" class="views-popover__apply" data-action="apply">' + this.escape(v.name) + '</button>';
                html += '<button type="button" class="views-popover__delete" data-action="delete" aria-label="Delete view">×</button>';
                html += '</li>';
            }
            html += '</ul>';
        }
        pop.innerHTML = html;

        const form = pop.querySelector('#viewsSaveForm');
        const input = pop.querySelector('.views-popover__input');
        if (form && input) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (this.saveCurrentView(input.value)) {
                    input.value = '';
                }
            });
            // Pressing Esc inside the input closes the popover (consistent
            // with the modal Esc behavior).
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeViewsPopover();
                }
            });
            // Auto-focus once the popover is on screen.
            setTimeout(() => input.focus(), 0);
        }

        pop.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('[data-view-name]');
                if (!item) return;
                const name = item.dataset.viewName;
                if (btn.dataset.action === 'apply') this.applyView(name);
                else if (btn.dataset.action === 'delete') this.deleteView(name);
            });
        });
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    /**
     * Inline busy indicator (small dot in the wordmark) for incidental
     * background work — report generation, applyFilters on huge sets, etc.
     * Counter-based so nested jobs work; dot hides only when count returns
     * to zero. Use the heavy loader-overlay for explicit user-initiated
     * file/load/export jobs instead.
     */
    _jobStart() {
        this._activeJobs = (this._activeJobs || 0) + 1;
        const dot = document.getElementById('busyDot');
        if (dot) dot.hidden = false;
    }

    _jobEnd() {
        this._activeJobs = Math.max(0, (this._activeJobs || 1) - 1);
        if (this._activeJobs === 0) {
            const dot = document.getElementById('busyDot');
            if (dot) dot.hidden = true;
        }
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

        // For a single very large file, stream-read + incrementally parse so
        // we don't materialize the entire file as one in-memory string.
        const STREAMING_THRESHOLD = 10 * 1024 * 1024; // 10 MB
        if (files.length === 1
            && typeof files[0].stream === 'function'
            && typeof TextDecoderStream !== 'undefined'
            && files[0].size > STREAMING_THRESHOLD) {
            this._loadAndStreamParse(files[0]);
            return;
        }

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
                        this.parseFiles(files, contents);
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

    /**
     * Streaming load + parse for very large single files. Reads the file as a
     * decoded text stream, hands chunks to the parser at line boundaries, and
     * yields to the event loop between chunks so the UI stays responsive.
     * Uses the carry-over (Into + flush) parser variants so an in-flight log
     * entry survives the chunk boundary.
     */
    async _loadAndStreamParse(file) {
        this.loadedFiles = 1;
        this.loadedFileNames = [file.name];
        this.showLoader('Streaming ' + file.name + '…');
        const subtext = document.getElementById('loaderSubtext');

        const state = {
            logs: [],
            apiCalls: new Map(),
            innerApiCalls: new Map(),
            apiByCorrelation: new Map(),
            currentInnerCall: null,
            _currentLog: null,
            _currentApiCall: null
        };

        try {
            const decoded = file.stream().pipeThrough(new TextDecoderStream());
            const reader = decoded.getReader();
            let buffer = '';
            let isJsonLine = null; // null = not yet detected
            let chunkIdx = 0;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += value;

                // Detect format from the first complete line.
                if (isJsonLine === null) {
                    const nl = buffer.indexOf('\n');
                    if (nl >= 0) {
                        isJsonLine = LogParser.detectJsonLines(buffer.slice(0, nl) + '\n');
                    }
                }

                // Split at the last newline; everything before is processable.
                const lastNl = buffer.lastIndexOf('\n');
                if (lastNl < 0) continue;
                const chunk = buffer.slice(0, lastNl + 1);
                buffer = buffer.slice(lastNl + 1);

                if (isJsonLine === true) {
                    LogParser.parseJsonChunk(chunk, file.name, state);
                } else {
                    LogParser.parseTextChunkInto(chunk, file.name, state);
                }

                if (++chunkIdx % 5 === 0) {
                    if (subtext) subtext.textContent = 'Parsed ' + this._formatNumber(state.logs.length) + ' entries…';
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Trailing buffer (file with no final newline).
            if (buffer) {
                if (isJsonLine === true) {
                    LogParser.parseJsonChunk(buffer, file.name, state);
                } else {
                    LogParser.parseTextChunkInto(buffer, file.name, state);
                }
            }
            LogParser.flushPartialChunk(state);

            this._resetParseState();
            this.logs = state.logs;
            this.apiCalls = state.apiCalls;
            this.innerApiCalls = state.innerApiCalls;
            this.apiByCorrelation = state.apiByCorrelation;
            this._finalizeParseAndRender();
            this.hideLoader();
            this.showToast('Loaded ' + file.name + ' (streamed)');
        } catch (e) {
            console.error('Streaming load failed:', e);
            this.hideLoader();
            this.showToast('Streaming load failed: ' + (e.message || e.name));
        }
    }

    /** Single-file entry. Source defaults to loadedFileNames[0]. */
    parseLogs(content) {
        this._resetParseState();
        this._currentSource = (this.loadedFileNames && this.loadedFileNames[0]) || null;
        try {
            this._parseChunk(content);
        } catch (error) {
            console.error('Error parsing logs:', error);
            this.showToast('Error parsing log file: ' + error.message);
        }
        this._currentSource = null;
        this._finalizeParseAndRender();
    }

    /**
     * Multi-file entry. Each chunk is parsed independently with its own
     * source name stamped on every produced log entry. Per-request state
     * (currentApiCall, currentInnerCall) is reset between chunks so an
     * unfinished request in one file isn't matched in another.
     *
     * When a Web Worker is available, parsing is dispatched off the main
     * thread to keep the UI responsive on large files. Falls back to a
     * synchronous in-thread parse if the worker can't be created (e.g.
     * `file://` origin in some browsers).
     */
    parseFiles(files, contents) {
        const payload = files.map((f, i) => ({ name: f.name, content: contents[i] }));
        const worker = this._tryGetParserWorker();
        if (worker) {
            this._parseFilesViaWorker(worker, payload);
            return;
        }
        this._parseFilesSync(payload);
    }

    _parseFilesSync(payload) {
        this._resetParseState();
        for (const f of payload) {
            this._currentSource = f.name;
            try {
                this._parseChunk(f.content);
            } catch (error) {
                console.error('Error parsing chunk ' + f.name + ':', error);
            }
        }
        this._currentSource = null;
        this._finalizeParseAndRender();
    }

    _tryGetParserWorker() {
        if (this._workerDisabled) return null;
        if (this._parserWorker) return this._parserWorker;
        if (typeof Worker === 'undefined') return null;
        try {
            this._parserWorker = new Worker('js/parserWorker.js');
            this._parserWorker.addEventListener('error', (e) => {
                // Worker failed (e.g. file:// CORS) — disable and fall back.
                console.warn('Parser worker error, falling back to main-thread parse:', e.message);
                this._workerDisabled = true;
                try { this._parserWorker.terminate(); } catch (err) { /* ignore */ }
                this._parserWorker = null;
            });
            return this._parserWorker;
        } catch (e) {
            console.warn('Could not create parser worker:', e.message);
            this._workerDisabled = true;
            return null;
        }
    }

    _parseFilesViaWorker(worker, files) {
        const subtext = document.getElementById('loaderSubtext');
        if (subtext) subtext.textContent = 'Parsing in background…';
        const handler = (e) => {
            const msg = e.data || {};
            if (msg.type === 'done') {
                worker.removeEventListener('message', handler);
                const s = msg.state;
                this._resetParseState();
                this.logs = s.logs || [];
                this.apiCalls = s.apiCalls || new Map();
                this.innerApiCalls = s.innerApiCalls || new Map();
                this.apiByCorrelation = s.apiByCorrelation || new Map();
                this._finalizeParseAndRender();
            } else if (msg.type === 'error') {
                worker.removeEventListener('message', handler);
                console.error('Worker parse error:', msg.message);
                this.showToast('Parse failed: ' + msg.message);
                // Fall back synchronously so the user still sees something.
                this._workerDisabled = true;
                this._parseFilesSync(files);
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'parse', files });
    }

    /**
     * Parse JSON-line content (one object per line). Each parsed line becomes
     * a log entry stamped with the current source. API/inner-HTTP tracking is
     * skipped — those rely on structural cues from the bracketed text format.
     */
    _parseJsonChunk(content) {
        const lines = content.split(/\r?\n/);
        for (const raw of lines) {
            const log = LogParser.parseJsonLine(raw);
            if (!log) continue;
            log.source = this._currentSource || null;
            this.logs.push(log);
        }
    }

    _resetParseState() {
        this.logs = [];
        this.apiCalls = new Map();
        this.innerApiCalls = new Map();
        this.exceptions = new Map();
        this.apiByCorrelation = new Map();
        this.currentInnerCall = null;
        this._sortCache = null;
        this._sourceColorIndex = null;
        this.expandedRows = new Set();
    }

    /**
     * Walk every error-level log with an exception trace and bump the
     * `errors` counter on the matching apiCalls entry — exactly once per log.
     * Tries multiple resolution strategies in order of confidence so we still
     * count errors when the exception log lacks the originating correlation id.
     */
    _attributeApiErrors() {
        if (!this.apiCalls || this.apiCalls.size === 0) return;
        for (const log of this.logs) {
            if (log.level !== 'error' || !log.exception) continue;
            const apiPath = this._resolveApiForLog(log);
            if (apiPath && this.apiCalls.has(apiPath)) {
                this.apiCalls.get(apiPath).errors++;
            }
        }
    }

    _resolveApiForLog(log) {
        // 1. Direct correlation/request id match against the per-source index
        //    built during parse (prefix avoids cross-file collisions).
        const prefix = (log.source || '') + '|';
        if (log.correlationId && this.apiByCorrelation.has(prefix + log.correlationId)) {
            return this.apiByCorrelation.get(prefix + log.correlationId);
        }
        if (log.requestId && this.apiByCorrelation.has(prefix + log.requestId)) {
            return this.apiByCorrelation.get(prefix + log.requestId);
        }
        // 2. Look for an HTTP: METHOD /path line in the exception trace.
        const exc = log.exception || '';
        const httpMatch = exc.match(/HTTP:\s*\w+\s+([^\s\n\r]+)/i);
        if (httpMatch) {
            const path = LogParser.normalizeApiPath(httpMatch[1].trim());
            if (this.apiCalls.has(path)) return path;
        }
        // 3. Fall back to a Path: "..." marker, common in middleware traces.
        const pathMatch = exc.match(/Path:\s*"?([^"\n\r]+?)"?(?:\s|$)/i);
        if (pathMatch) {
            const path = LogParser.normalizeApiPath(pathMatch[1].trim());
            if (this.apiCalls.has(path)) return path;
        }
        return null;
    }

    /**
     * Parse one chunk of log content into this.logs (append). Caller is
     * responsible for resetting/finalizing. The parser logic lives in
     * js/parser.js so the same code path runs in the parser Worker.
     *
     * `this` is passed as the state object — its field shapes (logs,
     * apiCalls, innerApiCalls, apiByCorrelation, currentInnerCall) match
     * what the pure parser expects.
     */
    _parseChunk(content) {
        if (LogParser.detectJsonLines(content)) {
            LogParser.parseJsonChunk(content, this._currentSource, this);
        } else {
            LogParser.parseTextChunk(content, this._currentSource, this);
        }
    }

    _finalizeParseAndRender() {
        if (this.logs.length > 0) {
            this.logs.sort((a, b) => a.date - b.date);
            // Stamp a stable, post-sort id on each log so per-row UI state
            // (e.g. inline-expansion set) survives sort/filter/page changes.
            // Also cache a `_searchable` string so applyFilters doesn't
            // re-concatenate message + exception on every keystroke.
            for (let i = 0; i < this.logs.length; i++) {
                const log = this.logs[i];
                log.id = i;
                log._searchable = log.message + ' ' + (log.exception || '');
            }
            this._attributeApiErrors();
            // Preserve the URL-loaded currentPage if still valid; otherwise clamp.
            const maxPage = Math.max(1, Math.ceil(this.logs.length / this.logsPerPage));
            this.currentPage = Math.min(Math.max(1, this.currentPage || 1), maxPage);
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
        this.searchQuery = q || '';
        this._compileSearch();
        this.currentPage = 1;
        this.applyFilters();
    }

    toggleSearchMod(btn) {
        const mod = btn.dataset.mod;
        if (!mod || !(mod in { case: 1, word: 1, regex: 1 })) return;
        const key = mod === 'case' ? 'caseSensitive'
            : mod === 'word' ? 'wholeWord'
            : 'regex';
        this.searchOptions[key] = !this.searchOptions[key];
        btn.classList.toggle('active', this.searchOptions[key]);
        btn.setAttribute('aria-pressed', this.searchOptions[key] ? 'true' : 'false');
        this._compileSearch();
        this.currentPage = 1;
        this.applyFilters();
    }

    /**
     * Build the search predicate + highlight regex from the current query and
     * options. Called whenever query text or options change.
     */
    _compileSearch() {
        this._searchInvalid = false;
        const raw = this.searchQuery || '';
        if (!raw) {
            this._searchPredicate = null;
            this._searchHighlightRegex = null;
            this._reflectSearchInvalid(false);
            return;
        }
        const opts = this.searchOptions;
        const flags = opts.caseSensitive ? 'g' : 'gi';
        try {
            let pattern;
            if (opts.regex) {
                pattern = raw;
            } else {
                pattern = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            if (opts.wholeWord) {
                pattern = '\\b' + pattern + '\\b';
            }
            const re = new RegExp(pattern, flags);
            // Test predicate uses a fresh regex (without /g) so .test() doesn't
            // advance lastIndex on the shared instance.
            const testRe = new RegExp(pattern, opts.caseSensitive ? '' : 'i');
            this._searchPredicate = (text) => testRe.test(text);
            this._searchHighlightRegex = re;
            this._reflectSearchInvalid(false);
        } catch (e) {
            this._searchPredicate = null;
            this._searchHighlightRegex = null;
            this._searchInvalid = true;
            this._reflectSearchInvalid(true);
        }
    }

    _reflectSearchInvalid(invalid) {
        const box = document.getElementById('searchBox');
        if (!box) return;
        box.classList.toggle('search-invalid', !!invalid);
        box.title = invalid ? 'Invalid regular expression' : '';
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
        this.searchOptions = { caseSensitive: false, wholeWord: false, regex: false };
        document.querySelectorAll('.search-mod').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
        });
        this._compileSearch();
        this.dateFrom = this.dateTo = null;
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        this.hourFilter = null;
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
        const predicate = this._searchPredicate;
        this.filteredLogs = this.logs.filter(log => {
            if (!this.filters[log.level]) return false;
            if (this.dateFrom && log.date < this.dateFrom) return false;
            if (this.dateTo && log.date > this.dateTo) return false;
            if (this.hourFilter !== null && log.date.getHours() !== this.hourFilter) return false;
            if (predicate) {
                // _searchable is stamped at parse time (message + exception);
                // fall back to fresh concat for any log that pre-dates it.
                const txt = log._searchable != null
                    ? log._searchable
                    : (log.message + ' ' + (log.exception || ''));
                if (!predicate(txt)) return false;
            }
            return true;
        });
        this.render();
        this._renderFilterChips();
        if (typeof this.writeUrlState === 'function') this.writeUrlState();
    }

    /**
     * Build the active-filter chip strip above the log container. Visible only
     * when at least one filter is active. Each chip's × clears just that filter.
     */
    _renderFilterChips() {
        const strip = document.getElementById('filterChips');
        if (!strip) return;

        const chips = [];
        if (this.searchQuery) {
            chips.push({
                key: 'search',
                label: 'Search',
                value: this.searchQuery
            });
        }
        const offLevels = ['debug', 'information', 'warning', 'error']
            .filter(l => !this.filters[l])
            .map(l => ({ debug: 'DBG', information: 'INF', warning: 'WRN', error: 'ERR' }[l]));
        if (offLevels.length > 0) {
            chips.push({
                key: 'levels',
                label: 'Hidden',
                value: offLevels.join(', ')
            });
        }
        if (this.dateFrom) {
            chips.push({
                key: 'from',
                label: 'From',
                value: document.getElementById('dateFrom').value || this.dateFrom.toISOString().slice(0, 16)
            });
        }
        if (this.dateTo) {
            chips.push({
                key: 'to',
                label: 'To',
                value: document.getElementById('dateTo').value || this.dateTo.toISOString().slice(0, 16)
            });
        }
        if (this.hourFilter !== null) {
            chips.push({
                key: 'hour',
                label: 'Hour',
                value: String(this.hourFilter).padStart(2, '0') + ':00'
            });
        }

        if (chips.length === 0) {
            strip.classList.add('hidden');
            strip.innerHTML = '';
            return;
        }

        strip.classList.remove('hidden');
        strip.innerHTML = chips.map(c =>
            '<span class="filter-chip">'
                + '<span class="filter-chip__label">' + this.escape(c.label) + '</span>'
                + '<span class="filter-chip__value">' + this.escape(c.value) + '</span>'
                + '<button type="button" class="filter-chip__clear" data-clear="' + c.key + '" aria-label="Clear ' + this.escape(c.label) + ' filter">×</button>'
            + '</span>'
        ).join('');

        strip.querySelectorAll('.filter-chip__clear').forEach(btn => {
            btn.addEventListener('click', () => this._clearChip(btn.dataset.clear));
        });
    }

    _clearChip(key) {
        switch (key) {
            case 'search':
                this.searchQuery = '';
                document.getElementById('searchBox').value = '';
                this._compileSearch();
                break;
            case 'levels':
                this.filters = { debug: true, information: true, warning: true, error: true };
                document.querySelectorAll('.filter-btn').forEach(btn => {
                    btn.classList.add('active');
                    btn.setAttribute('aria-pressed', 'true');
                });
                break;
            case 'from':
                this.dateFrom = null;
                document.getElementById('dateFrom').value = '';
                break;
            case 'to':
                this.dateTo = null;
                document.getElementById('dateTo').value = '';
                break;
            case 'hour':
                this.hourFilter = null;
                break;
        }
        this.currentPage = 1;
        this.applyFilters();
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
        const fmtEl = document.getElementById('exportFormat');
        const fmt = (fmtEl && fmtEl.value) || 'txt';
        if (fmt === 'csv') {
            this._exportLogsCsv();
        } else {
            this._exportLogsTxt();
        }
    }

    _exportLogsTxt() {
        this.showLoader('Exporting ' + this.filteredLogs.length + ' logs...');
        setTimeout(() => {
            let txt = '';
            this.filteredLogs.forEach(log => {
                const lvl = { debug: 'DBG', information: 'INF', warning: 'WRN', error: 'ERR' }[log.level];
                txt += log.timestamp + ' [' + lvl + '] [' + log.threadId + '] ' + log.message + '\n';
                if (log.exception.trim()) txt += log.exception;
            });
            const blob = new Blob([txt], { type: 'text/plain' });
            this._downloadBlob(blob, 'logs-' + new Date().toISOString().split('T')[0] + '.txt');
            this.hideLoader();
            this.showToast('Exported ' + this.filteredLogs.length + ' logs');
        }, 300);
    }

    _exportLogsCsv() {
        this.showLoader('Exporting ' + this.filteredLogs.length + ' logs as CSV...');
        setTimeout(() => {
            const esc = this._csvEscape;
            const rows = ['Timestamp,Level,Thread,Correlation,Source,Message,Exception'];
            for (const log of this.filteredLogs) {
                rows.push([
                    log.timestamp,
                    log.level,
                    log.threadId === 'N/A' ? '' : log.threadId,
                    log.correlationId || '',
                    log.source || '',
                    log.message,
                    (log.exception || '').trim()
                ].map(esc).join(','));
            }
            // Lead with a UTF-8 BOM so Excel renders Unicode characters correctly.
            const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
            this._downloadBlob(blob, 'logs-' + new Date().toISOString().split('T')[0] + '.csv');
            this.hideLoader();
            this.showToast('Exported ' + this.filteredLogs.length + ' logs (CSV)');
        }, 300);
    }

    /** RFC 4180 escape: quote values containing comma, quote, CR, or LF. */
    _csvEscape(value) {
        if (value == null) return '';
        const s = String(value);
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
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

        // Sort the filtered logs based on current sort settings, then optionally
        // collapse adjacent identical messages into representative rows.
        const sortedLogs = this.getSortedLogs(this.filteredLogs);
        const viewLogs = this._collapseRepeats(sortedLogs);

        const start = (this.currentPage - 1) * this.logsPerPage;
        const end = Math.min(start + this.logsPerPage, viewLogs.length);
        const page = viewLogs.slice(start, end);

        // Render as table
        container.innerHTML = this.renderLogsTable(page);

        // Index page entries by id for row + chevron handlers.
        const pageById = new Map(page.map(l => [l.id, l]));

        // Row click → modal. Detail rows (.log-row-detail) and the chevron
        // button stop propagation so they don't trigger this.
        container.querySelectorAll('.log-table tbody tr.log-row').forEach((el) => {
            el.style.cursor = 'pointer';
            const log = pageById.get(parseInt(el.dataset.logId, 10));
            if (log) el.addEventListener('click', () => this.showModal(log));
        });

        // Chevron click → toggle inline expansion.
        container.querySelectorAll('.log-table tbody tr.log-row .row-expand').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tr = btn.closest('tr[data-log-id]');
                if (!tr) return;
                this._toggleLogExpansion(parseInt(tr.dataset.logId, 10));
            });
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

        const total = Math.ceil(viewLogs.length / this.logsPerPage);
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

        // Show pre-collapse count so "Visible" stays semantically the entry
        // count, not the row count after collapsing.
        document.getElementById('visibleCount').textContent = sortedLogs.length;
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
        const sourceItem = document.getElementById('modalSourceItem');
        if (sourceItem) {
            if (log.source) {
                sourceItem.classList.remove('hidden');
                document.getElementById('modalSource').textContent = log.source;
            } else {
                sourceItem.classList.add('hidden');
            }
        }
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

        // Logs are stored in timestamp-asc order at parse time and
        // Array.prototype.filter preserves order, so the filtered subset is
        // already in timestamp asc. Skip the O(n log n) sort entirely for
        // the default ordering — biggest hot-path win on large data sets.
        if (this.sortColumn === 'timestamp' && this.sortDirection === 'asc') {
            return logs;
        }
        // Timestamp desc is just a reverse — O(n) instead of O(n log n).
        if (this.sortColumn === 'timestamp' && this.sortDirection === 'desc') {
            if (this._sortCache
                && this._sortCache.logs === logs
                && this._sortCache.column === 'timestamp'
                && this._sortCache.direction === 'desc') {
                return this._sortCache.result;
            }
            const reversed = logs.slice().reverse();
            this._sortCache = { logs, column: 'timestamp', direction: 'desc', result: reversed };
            return reversed;
        }

        // Cache: re-sort only when filteredLogs reference changes or sort
        // settings change. Pagination keeps the same reference, so flipping
        // pages is O(1) instead of O(n log n).
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
        const showSource = this.loadedFileNames && this.loadedFileNames.length > 1;
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

        // Total column count for inline-detail colspan: expand + headers + (source).
        const colspan = 1 + headerCells.length + (showSource ? 1 : 0);

        let html = '<table class="log-table"><thead><tr>';
        html += '<th class="col-expand" aria-hidden="true"></th>';

        headerCells.forEach(cell => {
            const indicator = getSortIndicator(cell.column);
            const isActive = this.sortColumn === cell.column;
            const ariaSort = isActive ? (this.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
            html += `<th data-column="${cell.column}" class="sortable-header${isActive ? ' active' : ''}" role="button" tabindex="0" aria-sort="${ariaSort}">${cell.label}${indicator}</th>`;
        });
        if (showSource) {
            html += '<th class="col-source-head">Source</th>';
        }

        html += '</tr></thead><tbody>';

        logs.forEach(log => {
            const threadDisplay = log.correlationId ? log.correlationId.substring(0, 8) + '...' : log.threadId;
            const msgPreview = this.escape(log.message).substring(0, 100) + (log.message.length > 100 ? '...' : '');
            const levelClass = log.level;
            const repeatBadge = log.groupCount > 1
                ? ' <span class="repeat-badge" title="' + log.groupCount + ' adjacent identical entries'
                    + (log.groupSpanMs ? ' over ' + this._formatSpan(log.groupSpanMs) : '')
                    + '">×' + (log.groupCount > 99 ? '99+' : log.groupCount) + '</span>'
                : '';
            const expanded = this.expandedRows.has(log.id);
            const rowCls = 'log-row ' + levelClass + (expanded ? ' is-expanded' : '');

            html += '<tr class="' + rowCls + '" data-log-id="' + log.id + '">' +
                '<td class="col-expand"><button type="button" class="row-expand' + (expanded ? ' expanded' : '') + '" aria-label="Toggle details" aria-expanded="' + expanded + '">▸</button></td>' +
                '<td class="col-timestamp">' + this.escape(log.timestamp) + '</td>' +
                '<td class="col-level"><span class="level-badge ' + levelClass + '">' + log.level.toUpperCase() + '</span></td>' +
                '<td class="col-message">' + this.highlight(msgPreview) + repeatBadge + '</td>' +
                '<td class="col-thread">' + this.escape(threadDisplay) + '</td>' +
                '<td class="col-length">' + log.message.length + '</td>' +
                (showSource ? '<td class="col-source">' + this._renderSourceChip(log.source) + '</td>' : '') +
                '</tr>';

            if (expanded) {
                html += '<tr class="log-row-detail" data-log-id="' + log.id + '">' +
                    '<td colspan="' + colspan + '">' +
                    this._renderLogDetail(log) +
                    '</td></tr>';
            }
        });

        html += '</tbody></table>';
        return html;
    }

    /**
     * Inline detail content for a log row — shown beneath the row when
     * expanded. Tries to provide every piece of information the modal would
     * without requiring a click round-trip.
     */
    _renderLogDetail(log) {
        let html = '<div class="log-detail">';
        html += '<dl class="log-detail__meta">';
        html += '<div class="log-detail__meta-item"><dt>Timestamp</dt><dd>' + this.escape(log.timestamp) + '</dd></div>';
        if (log.correlationId) {
            html += '<div class="log-detail__meta-item"><dt>Correlation</dt><dd>' + this.escape(log.correlationId) + '</dd></div>';
        }
        if (log.threadId && log.threadId !== 'N/A') {
            html += '<div class="log-detail__meta-item"><dt>Thread</dt><dd>' + this.escape(log.threadId) + '</dd></div>';
        }
        if (log.requestId) {
            html += '<div class="log-detail__meta-item"><dt>Request</dt><dd>' + this.escape(log.requestId) + '</dd></div>';
        }
        if (log.source) {
            html += '<div class="log-detail__meta-item"><dt>Source</dt><dd>' + this.escape(log.source) + '</dd></div>';
        }
        html += '<div class="log-detail__meta-item"><dt>Length</dt><dd>' + log.message.length + ' chars</dd></div>';
        html += '</dl>';

        html += '<div class="log-detail__message">' + this.highlight(this.escape(log.message)) + '</div>';

        if (log.exception && log.exception.trim()) {
            html += '<div class="log-detail__exception">' + this.highlight(this.escape(log.exception)) + '</div>';
        }
        html += '</div>';
        return html;
    }

    /**
     * Toggle the inline detail row for a single log entry. Fast path —
     * mutates the DOM in place rather than re-rendering the entire table,
     * which is the dominant cost on big pages. Falls back to a full render
     * if the row isn't in the current page.
     */
    _toggleLogExpansion(id) {
        const row = document.querySelector('.log-table tr.log-row[data-log-id="' + id + '"]');
        if (!row) {
            // Row not in DOM (e.g., we're on a different page); flip the set
            // and let render() pick it up next time the page is shown.
            if (this.expandedRows.has(id)) this.expandedRows.delete(id);
            else this.expandedRows.add(id);
            return;
        }
        const btn = row.querySelector('.row-expand');

        if (this.expandedRows.has(id)) {
            // Collapse.
            this.expandedRows.delete(id);
            const next = row.nextElementSibling;
            if (next && next.classList.contains('log-row-detail')
                && next.dataset.logId === String(id)) {
                next.remove();
            }
            row.classList.remove('is-expanded');
            if (btn) {
                btn.classList.remove('expanded');
                btn.setAttribute('aria-expanded', 'false');
            }
        } else {
            // Expand. logs are id-indexed (id stamped post-sort in finalize).
            this.expandedRows.add(id);
            const log = this.logs[id];
            if (!log) return;
            const detail = document.createElement('tr');
            detail.className = 'log-row-detail';
            detail.dataset.logId = String(id);
            const colspan = row.children.length;
            detail.innerHTML = '<td colspan="' + colspan + '">' + this._renderLogDetail(log) + '</td>';
            row.parentNode.insertBefore(detail, row.nextSibling);
            row.classList.add('is-expanded');
            if (btn) {
                btn.classList.add('expanded');
                btn.setAttribute('aria-expanded', 'true');
            }
        }
    }

    /**
     * Collapse adjacent log entries that share level + normalized message
     * into a single representative carrying a `groupCount`. Runs after sort
     * (so adjacency is honored on the user's chosen ordering) and before
     * pagination. Originals aren't mutated — clones are returned.
     */
    _collapseRepeats(logs) {
        if (!this.collapseRepeats || !logs || logs.length < 2) return logs;
        const out = [];
        let prev = null;
        let prevKey = null;
        let groupLastDate = null;
        for (const log of logs) {
            const key = log.level + '\0' + LogParser.normalizeExceptionMessage(log.message || '');
            if (prev && key === prevKey) {
                prev.groupCount = (prev.groupCount || 1) + 1;
                // Track the time span between the first and last entry in the
                // group so the badge tooltip can hint when collapsed entries
                // are actually hours apart.
                if (log.date && prev.date) {
                    prev.groupSpanMs = Math.max(0, log.date - prev.date);
                    groupLastDate = log.date;
                }
            } else {
                const clone = Object.assign({}, log, { groupCount: 1, groupSpanMs: 0 });
                out.push(clone);
                prev = clone;
                prevKey = key;
                groupLastDate = log.date;
            }
        }
        return out;
    }

    toggleCollapseRepeats() {
        this.collapseRepeats = !this.collapseRepeats;
        const btn = document.getElementById('collapseBtn');
        btn.classList.toggle('active', this.collapseRepeats);
        btn.setAttribute('aria-pressed', this.collapseRepeats ? 'true' : 'false');
        this.currentPage = 1;
        this.render();
    }

    /**
     * Render a colored chip identifying the file an entry came from. Color
     * is assigned in load order (cycling through 5 token colors) so the same
     * filename always gets the same chip color within a session.
     */
    _renderSourceChip(source) {
        if (!source) return '';
        if (!this._sourceColorIndex) this._sourceColorIndex = new Map();
        if (!this._sourceColorIndex.has(source)) {
            this._sourceColorIndex.set(source, this._sourceColorIndex.size);
        }
        const idx = this._sourceColorIndex.get(source) % 5;
        const safe = this.escape(source);
        return '<span class="source-chip" data-color-idx="' + idx + '" title="' + safe + '">' + safe + '</span>';
    }

    normalizeApiPath(path) {
        return LogParser.normalizeApiPath(path);
    }

    normalizeExceptionMessage(message) {
        return LogParser.normalizeExceptionMessage(message);
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
                    // Sort by attempts (started); falls back to count for legacy entries.
                    aVal = a.attempts != null ? a.attempts : a.stats.count;
                    bVal = b.attempts != null ? b.attempts : b.stats.count;
                    break;
                case 'maxTime':
                    aVal = a.stats.maxTime;
                    bVal = b.stats.maxTime;
                    break;
                case 'minTime':
                    aVal = a.stats.minTime === Infinity ? 0 : a.stats.minTime;
                    bVal = b.stats.minTime === Infinity ? 0 : b.stats.minTime;
                    break;
                case 'successRate': {
                    const aAtt = a.attempts != null ? a.attempts : a.stats.count;
                    const bAtt = b.attempts != null ? b.attempts : b.stats.count;
                    const aErr = a.cappedErrors != null ? a.cappedErrors : a.stats.errors;
                    const bErr = b.cappedErrors != null ? b.cappedErrors : b.stats.errors;
                    aVal = aAtt > 0 ? (aAtt - aErr) / aAtt : 1;
                    bVal = bAtt > 0 ? (bAtt - bErr) / bAtt : 1;
                    break;
                }
                case 'errors':
                    aVal = a.cappedErrors != null ? a.cappedErrors : a.stats.errors;
                    bVal = b.cappedErrors != null ? b.cappedErrors : b.stats.errors;
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
        const re = this._searchHighlightRegex;
        if (!re) return txt;
        // Reset lastIndex since we share the /g regex across calls.
        re.lastIndex = 0;
        return txt.replace(re, '<span class="highlight">$&</span>');
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
        this.hourFilter = null;
        this.expandedRows = new Set();
        document.getElementById('searchBox').value = '';
        document.getElementById('fileInput').value = '';
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        document.getElementById('logContainer').innerHTML = '<div class="empty-state"><h2>No logs loaded</h2><p>Load log files to get started.</p></div>';
        document.getElementById('pagination').classList.add('hidden');
        document.getElementById('fileList').innerHTML = '';
        this._sortCache = null;
        this._renderFilterChips();
        this.updateStats();
        this.showToast('All logs cleared');
    }

    showReports() {
        this._lastFocus = document.activeElement;
        const modal = document.getElementById('reportsModal');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        // Reset stale-counter on open — generateReports below builds fresh data.
        this._reportsStaleCount = 0;
        const oldNotice = document.getElementById('reportsStaleNotice');
        if (oldNotice) oldNotice.remove();
        // Show a "Working…" placeholder immediately and defer the heavy
        // generateReports work to the next frame so the modal can animate
        // open before we block the main thread.
        const content = document.getElementById('reportsContent');
        if (content) {
            content.innerHTML = '<div class="empty-state"><h2>Working&hellip;</h2><p>Building reports.</p></div>';
        }
        this._jobStart();
        requestAnimationFrame(() => {
            try { this.generateReports(); }
            finally { this._jobEnd(); }
            setTimeout(() => document.getElementById('reportsClose').focus(), 0);
        });
    }

    closeReports() {
        const modal = document.getElementById('reportsModal');
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        // Drop the stale notice + counter so the next open is clean.
        this._reportsStaleCount = 0;
        const notice = document.getElementById('reportsStaleNotice');
        if (notice) notice.remove();
        if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
            this._lastFocus.focus();
            this._lastFocus = null;
        }
    }

    /**
     * Show or update a "N new — [Refresh]" banner at the top of the reports
     * modal when tail-mode polls bring in fresh data while the modal is open.
     * Lazy-creates the DOM element so existing report content isn't disturbed.
     */
    _showReportsStaleNotice() {
        const reportsContent = document.getElementById('reportsContent');
        if (!reportsContent) return;
        let banner = document.getElementById('reportsStaleNotice');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'reportsStaleNotice';
            banner.className = 'reports-stale';
            banner.innerHTML =
                '<span class="reports-stale__text"></span>'
                + '<button type="button" class="btn btn-primary reports-stale__refresh">Refresh</button>';
            reportsContent.parentNode.insertBefore(banner, reportsContent);
            banner.querySelector('.reports-stale__refresh').addEventListener('click', () => {
                this._reportsStaleCount = 0;
                banner.remove();
                this._jobStart();
                requestAnimationFrame(() => {
                    try { this.generateReports(); }
                    finally { this._jobEnd(); }
                });
            });
        }
        const n = this._reportsStaleCount || 0;
        banner.querySelector('.reports-stale__text').textContent =
            n + ' new ' + (n === 1 ? 'entry' : 'entries') + ' since last refresh';
    }

    showHelp() {
        this._lastFocus = document.activeElement;
        const modal = document.getElementById('helpModal');
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => document.getElementById('helpClose').focus(), 0);
    }

    closeHelp() {
        const modal = document.getElementById('helpModal');
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

        // 0. Per-file comparison (only when 2+ files were loaded)
        if (this.loadedFileNames && this.loadedFileNames.length > 1) {
            html += this._renderComparisonSection();
        }

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

        // Re-attach per-render event listeners (these target elements that
        // are recreated on every render, so they need fresh handlers).
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchExceptionTab(e.target.dataset.tab));
        });
        document.querySelectorAll('.api-performance-table .sortable-col').forEach(th => {
            th.addEventListener('click', () => this.handleApiTableSort(th.dataset.sortColumn));
        });
        // The reportsContent click/keydown delegation is bound ONCE at init
        // (see _attachReportsDelegation) — re-binding here would accumulate
        // duplicate handlers and cancel out single-click toggles.
    }

    /**
     * Bind the click + keyboard delegation on the reports modal content
     * exactly once (at construction). Because reportsContent itself persists
     * across re-renders — only its innerHTML changes — event delegation works
     * for all the dynamically generated controls inside it.
     */
    _attachReportsDelegation() {
        const reportsContent = document.getElementById('reportsContent');
        if (!reportsContent || reportsContent._delegationBound) return;
        reportsContent._delegationBound = true;

        reportsContent.addEventListener('click', (e) => {
            const expandBtn = e.target.closest('.row-expand');
            if (expandBtn) {
                e.stopPropagation();
                this.toggleExceptionDetail(expandBtn);
                return;
            }
            const excSort = e.target.closest('[data-exc-sort]');
            if (excSort) {
                this.handleExceptionSort(excSort.dataset.excSort);
                return;
            }
            const hourBar = e.target.closest('[data-hour]');
            if (hourBar) {
                this.filterByHour(parseInt(hourBar.dataset.hour, 10));
                return;
            }
            if (e.target.closest('th')) return;
            const row = e.target.closest('[data-filter]');
            if (!row) return;
            this.filterByText(row.dataset.filter);
        });
        reportsContent.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const hourBar = e.target.closest('[data-hour]');
            if (hourBar) {
                e.preventDefault();
                this.filterByHour(parseInt(hourBar.dataset.hour, 10));
                return;
            }
            const excSort = e.target.closest('[data-exc-sort]');
            if (excSort) {
                e.preventDefault();
                this.handleExceptionSort(excSort.dataset.excSort);
            }
        });
    }

    /** Filter to logs whose timestamp hour-of-day matches `hour` (0..23). */
    filterByHour(hour) {
        if (isNaN(hour) || hour < 0 || hour > 23) return;
        this.hourFilter = hour;
        this.currentPage = 1;
        this.applyFilters();
        this.closeReports();
        this.showToast('Filtered to ' + String(hour).padStart(2, '0') + ':00 hour');
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
     * Routes through _compileSearch so the predicate respects the current
     * search-mode toggles (case / whole-word / regex).
     */
    filterByText(text) {
        if (!text) return;
        this.searchQuery = text;
        const search = document.getElementById('searchBox');
        search.value = text;
        this._compileSearch();
        this.currentPage = 1;
        this.applyFilters();
        this.closeReports();
        this.showToast('Filtered: ' + text);
    }

    // ---------- Helpers (delegate to LogParser for testable purity) ----------

    _healthLabel(score)  { return LogParser.healthLabel(score); }
    _healthClass(score)  { return LogParser.healthClass(score); }
    _formatSpan(ms)      { return LogParser.formatSpan(ms); }
    _formatNumber(n)     { return LogParser.formatNumber(n); }
    _formatMs(ms)        { return LogParser.formatMs(ms); }

    /**
     * Per-file comparison table — only emitted when more than one file was
     * loaded. Shows side-by-side counts for the most diff-worthy metrics:
     * entries, by-level, exception count, log-health, span, and API attempts.
     */
    _renderComparisonSection() {
        const files = this.loadedFileNames || [];
        if (files.length < 2) return '';

        // Bucket logs by source.
        const bySource = new Map();
        for (const f of files) {
            bySource.set(f, {
                logs: 0,
                levels: { debug: 0, information: 0, warning: 0, error: 0 },
                exceptions: 0,
                first: null,
                last: null
            });
        }
        for (const log of this.logs) {
            const b = bySource.get(log.source);
            if (!b) continue;
            b.logs++;
            b.levels[log.level] = (b.levels[log.level] || 0) + 1;
            if (log.level === 'error' && log.exception && log.exception.trim()) b.exceptions++;
            if (!b.first || log.date < b.first) b.first = log.date;
            if (!b.last || log.date > b.last) b.last = log.date;
        }

        // Per-file API attempts (read source-prefixed apiByCorrelation entries).
        const apiAttempts = new Map(files.map(f => [f, 0]));
        if (this.apiByCorrelation) {
            for (const key of this.apiByCorrelation.keys()) {
                const sep = key.indexOf('|');
                if (sep < 0) continue;
                const src = key.slice(0, sep);
                if (apiAttempts.has(src)) apiAttempts.set(src, apiAttempts.get(src) + 1);
            }
        }

        const fmt = this._formatNumber.bind(this);

        let html = '<section class="report-section">';
        html += '<h3 class="report-title">Files compared</h3>';
        html += '<p class="report-description">Side-by-side counts per loaded file.</p>';
        html += '<table class="report-table compare-table">';

        // Header row: file names as colored chips.
        html += '<thead><tr><th class="compare-table__metric">Metric</th>';
        for (const f of files) {
            html += '<th>' + this._renderSourceChip(f) + '</th>';
        }
        html += '</tr></thead><tbody>';

        const row = (label, cellFn) => {
            html += '<tr><th class="compare-table__metric">' + this.escape(label) + '</th>';
            for (const f of files) html += cellFn(f);
            html += '</tr>';
        };

        row('Entries', f => '<td class="numeric">' + fmt(bySource.get(f).logs) + '</td>');
        row('Errors', f => {
            const n = bySource.get(f).levels.error;
            const cls = n > 0 ? 'rate-poor' : 'rate-muted';
            return '<td class="numeric ' + cls + '">' + fmt(n) + '</td>';
        });
        row('Warnings', f => {
            const n = bySource.get(f).levels.warning;
            const cls = n > 0 ? 'rate-warn' : 'rate-muted';
            return '<td class="numeric ' + cls + '">' + fmt(n) + '</td>';
        });
        row('Exceptions', f => {
            const n = bySource.get(f).exceptions;
            const cls = n > 0 ? 'rate-poor' : 'rate-muted';
            return '<td class="numeric ' + cls + '">' + fmt(n) + '</td>';
        });
        row('API attempts', f => '<td class="numeric">' + fmt(apiAttempts.get(f) || 0) + '</td>');
        row('Log health', f => {
            const b = bySource.get(f);
            const tot = Math.max(1, b.logs);
            const errR = (b.levels.error / tot) * 100;
            const warnR = (b.levels.warning / tot) * 100;
            const h = Math.max(0, Math.min(100, Math.round(100 - errR * 5 - warnR * 1.5)));
            return '<td class="numeric"><span class="health-pill ' + this._healthClass(h) + '">' + h + ' <em>' + this._healthLabel(h) + '</em></span></td>';
        });
        row('Span', f => {
            const b = bySource.get(f);
            const ms = (b.first && b.last) ? Math.max(0, b.last - b.first) : 0;
            return '<td class="numeric">' + (ms > 0 ? this._formatSpan(ms) : '—') + '</td>';
        });

        html += '</tbody></table>';
        html += '</section>';
        return html;
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
        // Keep only endpoints that completed at least one response or saw a
        // start. Without either there's nothing to display.
        const allEntries = Array.from(this.apiCalls.entries());
        const validEntries = allEntries.filter(([, s]) => (s.started || 0) > 0 || s.count > 0);
        const incompleteCount = allEntries.length - validEntries.length;

        if (validEntries.length === 0) return '';

        let totalAttempts = 0;
        let totalCompleted = 0;
        let totalTime = 0;
        let apiErrorCount = 0;
        let slowest = null;
        let fastest = null;
        let highestErrorRate = null;
        const endpoints = [];

        for (const [path, stats] of validEntries) {
            // Attempts (started) is the denominator for success/error rates;
            // count (completed responses) is the sample for duration stats.
            const attempts = (stats.started > 0 ? stats.started : stats.count) || 0;
            const cappedErrors = Math.min(stats.errors, attempts);
            const avgTime = stats.count > 0 ? stats.totalTime / stats.count : 0;
            const errorRate = attempts > 0 ? (cappedErrors / attempts) * 100 : 0;
            totalAttempts += attempts;
            totalCompleted += stats.count;
            totalTime += stats.totalTime;
            apiErrorCount += cappedErrors;
            if (stats.count > 0) {
                if (!slowest || avgTime > slowest.avgTime) slowest = { path, avgTime };
                if (!fastest || avgTime < fastest.avgTime) fastest = { path, avgTime };
            }
            if (!highestErrorRate || errorRate > highestErrorRate.rate) highestErrorRate = { path, rate: errorRate };
            endpoints.push({ path, stats, attempts, cappedErrors, avgTime, errorRate });
        }

        const avgResponse = totalCompleted > 0 ? totalTime / totalCompleted : 0;
        const successRate = totalAttempts > 0
            ? Math.max(0, ((totalAttempts - apiErrorCount) / totalAttempts) * 100)
            : 100;
        const throughputPerMin = spanMinutes > 0 ? totalAttempts / spanMinutes : 0;
        const apiHealth = totalAttempts > 0
            ? Math.max(0, Math.min(100, Math.round(100 - (apiErrorCount / totalAttempts) * 200)))
            : 100;
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
        html += this._metricCell('Total calls', this._formatNumber(totalAttempts),
            'All APIGW request starts observed in the log span (the denominator for success rate).');
        html += this._metricCell('Success', successRate.toFixed(1) + '%',
            'Share of attempts without an attributed exception. Errors are capped per endpoint at the attempt count so this stays in [0, 100].');
        html += this._metricCell('Avg response', this._formatMs(avgResponse) + ' ms',
            'Mean of (response timestamp − request timestamp) over completed call pairs only.');
        html += this._metricCell('Throughput', throughputPerMin.toFixed(1) + ' /min',
            'Total attempts divided by the wall-clock span between the first and last log entry.');
        html += this._metricCell('Endpoints', this._formatNumber(endpoints.length),
            'Distinct normalized paths that started or completed at least one request.');
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
        html += '<th class="numeric' + sortCls('successRate') + '" data-sort-column="successRate">Success' + sortInd('successRate') + '</th>';
        html += '<th class="numeric' + sortCls('errors') + '" data-sort-column="errors">Errors' + sortInd('errors') + '</th>';
        html += '<th>Status</th>';
        html += '</tr></thead><tbody>';

        for (const e of sortedEndpoints) {
            const { path, stats, attempts, cappedErrors, avgTime, errorRate } = e;
            const statusClass = errorRate > 10 ? 'api-status-poor' : errorRate > 0 ? 'api-status-fair' : 'api-status-good';
            const successCallRate = attempts > 0
                ? Math.max(0, ((attempts - cappedErrors) / attempts) * 100)
                : 100;
            const rateClass = successCallRate >= 99 ? 'rate-good'
                : successCallRate >= 90 ? 'rate-warn'
                : 'rate-poor';
            const errorsCellCls = cappedErrors > 0 ? 'numeric rate-poor' : 'numeric rate-muted';
            const minDisplay = stats.count > 0 && stats.minTime !== Infinity ? stats.minTime : null;
            const maxDisplay = stats.count > 0 ? stats.maxTime : null;
            const avgDisplay = stats.count > 0 ? avgTime : null;
            const statusCodeStr = this._renderStatusCodes(stats.statusCodes, 3);

            const incomplete = attempts > stats.count;
            const callsCell = this._formatNumber(attempts) + (incomplete ? ' <span class="incomplete-marker" aria-label="some attempts had no matching response">✱</span>' : '');

            html += '<tr class="api-row report-row-link ' + statusClass + '" data-filter="' + this.escape(path) + '" title="Click to filter logs by this endpoint">';
            html += '<td class="report-code">' + this.escape(path) + '</td>';
            html += '<td class="numeric" title="' + attempts + ' attempts, ' + stats.count + ' completed">' + callsCell + '</td>';
            html += '<td class="numeric">' + this._formatMs(avgDisplay) + '</td>';
            html += '<td class="numeric">' + this._formatMs(minDisplay) + '</td>';
            html += '<td class="numeric">' + this._formatMs(maxDisplay) + '</td>';
            html += '<td class="numeric ' + rateClass + '">' + successCallRate.toFixed(1) + '%</td>';
            html += '<td class="' + errorsCellCls + '">' + (cappedErrors > 0 ? this._formatNumber(cappedErrors) : '—') + '</td>';
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
        html += this._metricCell('Total calls', this._formatNumber(totalCalls),
            'Outbound HTTP calls observed inside request handling.');
        html += this._metricCell('Success', successRate.toFixed(1) + '%',
            'Share of internal calls returning a 2xx or 3xx status code.');
        html += this._metricCell('Avg response', this._formatMs(avgResponse) + ' ms',
            'Mean response time reported by the "End processing HTTP request after Xms" line.');
        html += this._metricCell('Throughput', throughputPerMin.toFixed(1) + ' /min',
            'Total internal calls divided by the wall-clock span of the logs.');
        html += this._metricCell('Endpoints', this._formatNumber(endpoints.length),
            'Distinct method+path pairs observed.');
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
            const rateClass = successCallRate >= 99 ? 'rate-good'
                : successCallRate >= 90 ? 'rate-warn'
                : 'rate-poor';
            const statusCodeStr = this._renderStatusCodes(stats.statusCodes, 3);

            html += '<tr class="internal-http-row report-row-link" data-filter="' + this.escape(path) + '" title="Click to filter logs by this call">';
            html += '<td class="report-code">' + this.escape(path) + '</td>';
            html += '<td class="numeric">' + this._formatNumber(stats.count) + '</td>';
            html += '<td class="numeric">' + this._formatMs(avgTime) + '</td>';
            html += '<td class="numeric">' + this._formatMs(minTime) + '</td>';
            html += '<td class="numeric">' + this._formatMs(stats.maxTime) + '</td>';
            html += '<td class="numeric ' + rateClass + '">' + successCallRate.toFixed(1) + '%</td>';
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
        html += this._metricCell('Total', this._formatNumber(totalExceptions),
            'All error-level entries that contained a TYPE: or REASON: line.');
        html += this._metricCell('Types', this._formatNumber(this.exceptionResponses.byType.size),
            'Distinct exception type names (e.g. ApplicationException).');
        html += this._metricCell('Reasons', this._formatNumber(this.exceptionResponses.byReason.size),
            'Distinct REASON: messages after id/email/timestamp normalization.');
        html += '</div>';

        html += '<div class="exception-tabs">';
        html += '<button class="exception-tab-btn active" data-tab="by-type">By type</button>';
        html += '<button class="exception-tab-btn" data-tab="by-reason">By reason</button>';
        html += '</div>';

        const typeHtml = this._renderExceptionTable({
            kind: 'type',
            entries: Array.from(this.exceptionResponses.byType.entries()),
            primaryLabel: 'Type',
            secondaryLabel: 'Top reason',
            totalExceptions,
            secondaryFor: (stats) => this._topEntry(stats.reasons),
            primaryClass: 'exception-type-name',
            secondaryClass: 'exception-reason'
        });

        const reasonHtml = this._renderExceptionTable({
            kind: 'reason',
            entries: Array.from(this.exceptionResponses.byReason.entries()),
            primaryLabel: 'Reason',
            secondaryLabel: 'Top type',
            totalExceptions,
            secondaryFor: (stats) => this._topEntry(stats.types),
            primaryClass: 'exception-reason-name',
            secondaryClass: 'exception-type'
        });

        html += '<div id="exceptionByType" class="exception-tab-content">' + typeHtml + '</div>';
        html += '<div id="exceptionByReason" class="exception-tab-content hidden">' + reasonHtml + '</div>';
        html += '</section>';
        return html;
    }

    /** Returns [name, count] of the most-common entry in a Map. */
    _topEntry(map) {
        let topName = null;
        let topCount = 0;
        if (map) {
            for (const [name, count] of map) {
                if (count > topCount) { topCount = count; topName = name; }
            }
        }
        return [topName, topCount];
    }

    /**
     * Render either by-type or by-reason exception table. Handles sorting,
     * the shared share-bar layout, and truncation of secondary cells.
     */
    _renderExceptionTable(opts) {
        const {
            kind, entries, primaryLabel, secondaryLabel,
            totalExceptions, secondaryFor, primaryClass, secondaryClass
        } = opts;

        // Sort by current state.
        const dir = this.exceptionSortDirection === 'asc' ? 1 : -1;
        const sorted = entries.slice().sort((a, b) => {
            if (this.exceptionSortColumn === 'name') {
                return a[0].localeCompare(b[0]) * dir;
            }
            // 'count' (default) — share sorts identically to count.
            return (a[1].count - b[1].count) * dir;
        });

        const sortInd = (col) => this.exceptionSortColumn === col
            ? (this.exceptionSortDirection === 'asc' ? ' ↑' : ' ↓') : '';
        const sortCls = (col, base) => this.exceptionSortColumn === col
            ? (base + ' sortable-col active')
            : (base + ' sortable-col');
        const ariaSort = (col) => this.exceptionSortColumn === col
            ? (this.exceptionSortDirection === 'asc' ? 'ascending' : 'descending')
            : 'none';

        let html = '<table class="report-table exception-table">';
        html += '<thead><tr>';
        html += '<th class="col-expand" aria-hidden="true"></th>';
        html += '<th data-exc-sort="name" class="' + sortCls('name', '') + '" aria-sort="' + ariaSort('name') + '" tabindex="0" role="button">' + primaryLabel + sortInd('name') + '</th>';
        html += '<th data-exc-sort="count" class="' + sortCls('count', 'numeric') + '" aria-sort="' + ariaSort('count') + '" tabindex="0" role="button">Count' + sortInd('count') + '</th>';
        html += '<th class="col-share">Share</th>';
        html += '<th class="col-secondary">' + secondaryLabel + '</th>';
        html += '<th class="col-thrown">Thrown by</th>';
        html += '</tr></thead><tbody>';

        for (const [name, stats] of sorted) {
            const [secondaryName, secondaryCount] = secondaryFor(stats);
            const [topApi] = this._topEntry(stats.apis);
            const pct = totalExceptions > 0 ? (stats.count / totalExceptions) * 100 : 0;
            const filterable = (kind === 'type') && name !== 'Unknown';

            html += '<tr class="exception-row' + (filterable ? ' report-row-link' : '') + '"'
                + (filterable ? ' data-filter="' + this.escape(name) + '" title="Click to filter logs by this exception type"' : '')
                + ' data-detail-key="' + kind + ':' + this.escape(name) + '">';
            html += '<td class="col-expand"><button type="button" class="row-expand" aria-label="Toggle details">▸</button></td>';
            html += '<td class="report-code ' + primaryClass + '" title="' + this.escape(name) + '">' + this.escape(name) + '</td>';
            html += '<td class="numeric exc-count">' + this._formatNumber(stats.count) + '</td>';
            html += '<td class="col-share"><div class="share-bar"><div class="share-bar__fill" style="width:' + pct.toFixed(1) + '%"></div><span class="share-bar__label">' + pct.toFixed(1) + '%</span></div></td>';
            html += '<td class="col-secondary ' + secondaryClass + '" title="' + this.escape(secondaryName || '—') + '">'
                + this.escape(secondaryName || '—')
                + (secondaryCount > 1 ? ' <span class="muted-count">×' + secondaryCount + '</span>' : '')
                + '</td>';
            html += '<td class="col-thrown report-code" title="' + this.escape(topApi || '—') + '">' + this.escape(topApi || '—') + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        return html;
    }

    /** Toggle sort direction on the shared exception sort state and re-render. */
    handleExceptionSort(column) {
        if (column !== 'name' && column !== 'count') return;
        if (this.exceptionSortColumn === column) {
            this.exceptionSortDirection = this.exceptionSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.exceptionSortColumn = column;
            this.exceptionSortDirection = column === 'name' ? 'asc' : 'desc';
        }
        // Remember which tab is active so we can restore it after re-render.
        const activeTab = document.querySelector('.exception-tab-btn.active');
        const activeTabName = activeTab ? activeTab.dataset.tab : 'by-type';
        this.generateReports();
        this.switchExceptionTab(activeTabName);
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
            const interactive = count > 0;
            html += '<div class="timeline-bar-container' + (interactive ? ' hour-bar' : '') + '"'
                + (interactive ? ' data-hour="' + h + '" role="button" tabindex="0"' : '')
                + ' title="' + String(h).padStart(2, '0') + ':00 — ' + count + ' entries' + (interactive ? ' (click to filter)' : '') + '">';
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

    _metricCell(label, value, tip) {
        const titleAttr = tip ? ' title="' + this.escape(tip) + '"' : '';
        const labelCls = tip ? 'metric-strip__label has-tip' : 'metric-strip__label';
        return '<div class="metric-strip__cell"' + titleAttr + '>' +
            '<span class="' + labelCls + '">' + label + '</span>' +
            '<span class="metric-strip__value">' + value + '</span></div>';
    }

    _insightRow(label, target, value) {
        return '<div class="report-insights__row">' +
            '<dt>' + label + '</dt>' +
            '<dd><span class="insight-target">' + target + '</span><span class="insight-metric">' + value + '</span></dd>' +
            '</div>';
    }

    /**
     * Render a Map<statusCode, count> as a row of color-coded chips.
     * 2xx success / 3xx neutral / 4xx warning / 5xx danger.
     */
    _renderStatusCodes(statusCodes, limit) {
        if (!statusCodes || statusCodes.size === 0) return '<span class="status-code-empty">—</span>';
        const top = Array.from(statusCodes.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit || 3);
        return top.map(([code, count]) => {
            const cls = this._statusCodeClass(code);
            return '<span class="status-code-chip ' + cls + '">'
                + '<span class="status-code">' + this.escape(String(code)) + '</span>'
                + '<span class="status-code-count">' + count + '</span>'
                + '</span>';
        }).join(' ');
    }

    _statusCodeClass(code) {
        const s = String(code);
        if (s.startsWith('2')) return 'status-code-2xx';
        if (s.startsWith('3')) return 'status-code-3xx';
        if (s.startsWith('4')) return 'status-code-4xx';
        if (s.startsWith('5')) return 'status-code-5xx';
        return 'status-code-other';
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
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        // Toggle the .hidden utility class — that's what controls panel
        // visibility (display: none !important wins over any .active style).
        const byType = document.getElementById('exceptionByType');
        const byReason = document.getElementById('exceptionByReason');
        if (byType) byType.classList.toggle('hidden', tab !== 'by-type');
        if (byReason) byReason.classList.toggle('hidden', tab !== 'by-reason');
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

        // API performance (attempts is the rate denominator; completed is the
        // sample for duration stats).
        const apiEndpoints = [];
        let apiTotalAttempts = 0, apiTotalCompleted = 0, apiTotalTime = 0, apiTotalErrors = 0;
        if (this.apiCalls) {
            for (const [path, stats] of this.apiCalls) {
                const attempts = (stats.started > 0 ? stats.started : stats.count) || 0;
                if (attempts === 0 && stats.count === 0) continue;
                const cappedErrors = Math.min(stats.errors, attempts);
                apiTotalAttempts += attempts;
                apiTotalCompleted += stats.count;
                apiTotalTime += stats.totalTime;
                apiTotalErrors += cappedErrors;
                apiEndpoints.push({
                    path,
                    attempts,
                    completed: stats.count,
                    avgMs: stats.count > 0 ? +(stats.totalTime / stats.count).toFixed(2) : null,
                    minMs: stats.count > 0 && stats.minTime !== Infinity ? +stats.minTime.toFixed(2) : null,
                    maxMs: stats.count > 0 ? +stats.maxTime.toFixed(2) : null,
                    errors: cappedErrors,
                    errorRate: attempts > 0 ? +((cappedErrors / attempts) * 100).toFixed(2) : 0
                });
            }
            apiEndpoints.sort((a, b) => b.attempts - a.attempts);
        }
        const apiHealth = apiTotalAttempts > 0
            ? Math.max(0, Math.min(100, Math.round(100 - (apiTotalErrors / apiTotalAttempts) * 200)))
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
            api: apiTotalAttempts > 0 ? {
                totalAttempts: apiTotalAttempts,
                totalCompleted: apiTotalCompleted,
                avgResponseMs: apiTotalCompleted > 0 ? +(apiTotalTime / apiTotalCompleted).toFixed(2) : null,
                successRate: +(Math.max(0, ((apiTotalAttempts - apiTotalErrors) / apiTotalAttempts) * 100)).toFixed(2),
                throughputPerMin: spanMinutes > 0 ? +(apiTotalAttempts / spanMinutes).toFixed(2) : 0,
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