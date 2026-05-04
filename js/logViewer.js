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
        this.init();
    }

    init() {
        document.getElementById('fileInput').addEventListener('change', (e) => this.loadFiles(e));
        document.getElementById('searchBox').addEventListener('input', (e) => this.search(e.target.value));
        document.getElementById('clearBtn').addEventListener('click', () => this.clear());
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
    }

    setTheme(theme) {
        document.body.className = 'theme-' + theme;
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        this.showToast('Theme changed to ' + theme);
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
            let current = null;
            let currentApiCall = null;

            console.log('Starting to parse', lines.length, 'lines...');

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
                                console.log('Found APIGW match:', { correlationId, requestId, message });
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
                        const pathMatch = message.match(/Path:\s*"?([^"]+)"?/); // Made more flexible for quotes
                        if (pathMatch) {
                            console.log('Found Path match:', {
                                path: pathMatch[1],
                                message,
                                correlationId,
                                requestId,
                                threadId
                            });
                        }
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
                                console.log('Created new API stats for:', normalizedPath);
                            }

                            currentApiCall = {
                                path: normalizedPath,
                                startTime: date,
                                correlationId,
                                requestId
                            };
                            console.log('Found API call start:', {
                                path: normalizedPath,
                                correlationId,
                                requestId
                            });
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
                            console.log('Found API call end:', {
                                path: apiKey,
                                duration,
                                totalCalls: stats.count,
                                correlationId: currentApiCall.correlationId,
                                requestId: currentApiCall.requestId
                            });
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

                            // If this is related to an API call, increment error count
                            if ((current.correlationId || current.requestId) && this.apiCalls.size > 0) {
                                for (const [_, stats] of this.apiCalls) {
                                    if (stats.correlationId === current.correlationId ||
                                        stats.requestId === current.requestId) {
                                        stats.errors++;
                                        break;
                                    }
                                }
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
                document.getElementById('logContainer').innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><h2>No logs parsed</h2><p>Expected formats:<br/><code>[LEVEL] [ThreadID] Message</code><br/><code>[LEVEL] Message</code></p><p style="font-size: 11px; margin-top: 10px; opacity: 0.7;">Open browser console (F12) for details</p></div>';
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
        this.currentPage = 1;
        this.applyFilters();
    }

    search(q) {
        this.searchQuery = q.toLowerCase();
        this.currentPage = 1;
        this.applyFilters();
    }

    setDateFrom(v) {
        this.dateFrom = v ? new Date(v) : null;
        this.applyFilters();
    }

    setDateTo(v) {
        this.dateTo = v ? new Date(v) : null;
        this.applyFilters();
    }

    clearDateFilter() {
        this.dateFrom = this.dateTo = null;
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        this.applyFilters();
        this.showToast('Date filters cleared');
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
    }

    lastPage() {
        this.currentPage = Math.ceil(this.filteredLogs.length / this.logsPerPage);
        this.render();
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.render();
        }
    }

    nextPage() {
        const total = Math.ceil(this.filteredLogs.length / this.logsPerPage);
        if (this.currentPage < total) {
            this.currentPage++;
            this.render();
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
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><h2>' + (this.logs.length ? 'No matches' : 'No logs loaded') + '</h2></div>';
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

        // Add header sort handlers
        container.querySelectorAll('.log-table thead th[data-column]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => this.handleColumnSort(th.dataset.column));
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
        document.getElementById('modalTimestamp').textContent = this.formatDate(log.date);
        document.getElementById('modalLevel').textContent = log.level.toUpperCase();
        document.getElementById('modalThread').textContent = log.correlationId || log.threadId;
        document.getElementById('modalLength').textContent = log.message.length + ' characters';
        document.getElementById('modalMessage').textContent = log.message;

        const modalExceptionSection = document.getElementById('modalExceptionSection');
        if (log.exception.trim()) {
            modalExceptionSection.classList.remove('hidden');
            document.getElementById('modalException').textContent = log.exception;
        } else {
            modalExceptionSection.classList.add('hidden');
        }

        document.getElementById('logModal').classList.add('show');
    }

    closeModal() {
        document.getElementById('logModal').classList.remove('show');
    }

    copyModalLog() {
        if (this.currentModalLog) {
            this.copyLog(this.currentModalLog);
            this.closeModal();
        }
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

    // ⭐ Sorting Performance Optimization
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
            return this.sortDirection === 'asc' ? ' ▲' : ' ▼';
        };

        let html = '<table class="log-table"><thead><tr>';
        
        headerCells.forEach(cell => {
            const indicator = getSortIndicator(cell.column);
            const isActive = this.sortColumn === cell.column ? ' active' : '';
            html += `<th data-column="${cell.column}" class="sortable-header${isActive}">${cell.label}${indicator}</th>`;
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

    renderLog(log) {
        const msg = this.highlight(this.escape(log.message));
        const exc = this.highlight(this.escape(log.exception));
        const threadDisplay = log.correlationId ? log.correlationId.substring(0, 8) + '...' : log.threadId;
        return '<div class="log-entry ' + log.level + '">' +
            '<div class="log-header">' +
            '<span class="log-timestamp">' + this.escape(log.timestamp) + '</span>' +
            '<span class="log-level ' + log.level + '">' + log.level.toUpperCase() + '</span>' +
            '</div>' +
            '<div class="log-message">' + msg + '</div>' +
            '<div class="log-meta">' +
            '<span>Thread: ' + this.escape(threadDisplay) + '</span>' +
            '<span>' + log.message.length + ' chars</span>' +
            (log.format === 'format2' ? '<span title="' + this.escape(log.correlationId) + '">📍 Correlation ID</span>' : '') +
            '</div>' +
            (log.exception.trim() ? '<div class="log-exception">' + exc + '</div>' : '') +
            '</div>';
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
                    <span class="file-icon">📄</span>
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
        this.exceptions = new Map();
        document.getElementById('searchBox').value = '';
        document.getElementById('fileInput').value = '';
        document.getElementById('dateFrom').value = '';
        document.getElementById('dateTo').value = '';
        document.getElementById('logContainer').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><h2>No logs loaded</h2><p>Load log files to get started</p></div>';
        document.getElementById('pagination').classList.add('hidden');
        document.getElementById('fileList').innerHTML = '';
        this.updateStats();
        this.showToast('All logs cleared');
    }

    showReports() {
        document.getElementById('reportsModal').classList.add('show');
        this.generateReports();
    }

    closeReports() {
        document.getElementById('reportsModal').classList.remove('show');
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

            html += '<tr class="api-row ' + statusClass + '">';
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

            html += '<tr class="internal-http-row">';
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
        typeHtml += '<thead><tr><th>Type</th><th class="numeric">Count</th><th class="numeric">Share</th><th>Top reason</th><th class="numeric">Reason count</th></tr></thead><tbody>';
        for (const [type, stats] of typeEntries) {
            let topReason = '—';
            let topReasonCount = 0;
            for (const [reason, count] of stats.reasons) {
                if (count > topReasonCount) { topReasonCount = count; topReason = reason; }
            }
            const pct = (stats.count / totalExceptions) * 100;
            typeHtml += '<tr class="exception-row">';
            typeHtml += '<td class="report-code exception-type-name">' + this.escape(type) + '</td>';
            typeHtml += '<td class="numeric">' + this._formatNumber(stats.count) + '</td>';
            typeHtml += '<td class="numeric"><div class="percentage-container">' + pct.toFixed(1) + '%<div class="exception-percentage-bar" style="width:' + pct.toFixed(1) + '%"></div></div></td>';
            typeHtml += '<td class="exception-reason">' + this.escape(topReason) + '</td>';
            typeHtml += '<td class="numeric">' + this._formatNumber(topReasonCount) + '</td>';
            typeHtml += '</tr>';
        }
        typeHtml += '</tbody></table>';

        // By reason
        const reasonEntries = Array.from(this.exceptionResponses.byReason.entries())
            .sort((a, b) => b[1].count - a[1].count);
        let reasonHtml = '<table class="report-table exception-table">';
        reasonHtml += '<thead><tr><th>Reason</th><th class="numeric">Count</th><th class="numeric">Share</th><th>Top type</th><th>Thrown by</th></tr></thead><tbody>';
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
            reasonHtml += '<tr class="exception-row">';
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
                html += '<tr>';
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
                // Look for TYPE: and REASON: patterns in the exception
                const typeMatch = log.exception.match(/TYPE:\s*(\w+)/i);
                const reasonMatch = log.exception.match(/REASON:\s*([^\n]+)/i);
                const httpMatch = log.exception.match(/HTTP:\s*(\w+)\s+([^\s\n]+)/i);

                if (typeMatch || reasonMatch) {
                    const type = typeMatch ? typeMatch[1] : 'Unknown';
                    const rawReason = reasonMatch ? reasonMatch[1].trim() : 'Unknown';
                    const reason = this.normalizeExceptionMessage(rawReason);
                    
                    // Extract API path from HTTP: METHOD /path pattern in exception
                    let apiPath = 'Unknown API';
                    if (httpMatch) {
                        const method = httpMatch[1];
                        const path = httpMatch[2];
                        apiPath = method + ' ' + path;
                    } else if (log.apiPath) {
                        apiPath = log.apiPath;
                    }

                    // Group by TYPE
                    if (!this.exceptionResponses.byType.has(type)) {
                        this.exceptionResponses.byType.set(type, {
                            count: 0,
                            reasons: new Map()
                        });
                    }
                    const typeStats = this.exceptionResponses.byType.get(type);
                    typeStats.count++;

                    if (reason !== 'Unknown') {
                        const reasonCount = typeStats.reasons.get(reason) || 0;
                        typeStats.reasons.set(reason, reasonCount + 1);
                    }

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
                        const typeCount = reasonStats.types.get(type) || 0;
                        reasonStats.types.set(type, typeCount + 1);
                    }

                    // Track which API threw this reason
                    const apiCount = reasonStats.apis.get(apiPath) || 0;
                    reasonStats.apis.set(apiPath, apiCount + 1);
                }
            }
        });

        console.log('Parsed exception responses:', {
            byType: Array.from(this.exceptionResponses.byType.entries()),
            byReason: Array.from(this.exceptionResponses.byReason.entries())
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

        const report = {
            dateRange: {
                from: this.formatDate(this.logs[0].date),
                to: this.formatDate(this.logs[this.logs.length - 1].date)
            },
            totalLogs: this.logs.length,
            byLevel: {},
            byThread: {},
            byHour: {}
        };

        // Count by level
        this.logs.forEach(log => {
            report.byLevel[log.level] = (report.byLevel[log.level] || 0) + 1;
        });

        // Count by thread
        this.logs.forEach(log => {
            const thread = log.correlationId || log.threadId;
            report.byThread[thread] = (report.byThread[thread] || 0) + 1;
        });

        // Count by hour
        this.logs.forEach(log => {
            const hour = log.date.getHours();
            report.byHour[hour] = (report.byHour[hour] || 0) + 1;
        });

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'log-report-' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Report exported successfully');
    }
}

// Initialize the LogViewer when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LogViewer();
});