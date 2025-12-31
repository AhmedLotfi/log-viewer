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

                            if (!status.startsWith('2')) {
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
            document.getElementById('reportsContent').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><h2>No Data Available</h2><p>Load log files to generate reports</p></div>';
            return;
        }

        const dateRange = this.formatDate(this.logs[0].date) + ' to ' + this.formatDate(this.logs[this.logs.length - 1].date);

        // Calculate total errors
        const totalErrors = this.logs.filter(log => log.level === 'error').length;

        // Count logs by level
        const levelCounts = {};
        this.logs.forEach(log => {
            levelCounts[log.level] = (levelCounts[log.level] || 0) + 1;
        });

        // Count logs by thread
        const threadCounts = {};
        this.logs.forEach(log => {
            const thread = log.correlationId || log.threadId;
            threadCounts[thread] = (threadCounts[thread] || 0) + 1;
        });

        // Count logs by hour
        const hourCounts = {};
        this.logs.forEach(log => {
            const hour = log.date.getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });

        // Parse exceptions by TYPE and REASON
        this.parseExceptionResponses();

        // Generate HTML report
        console.log('Generating reports with:', {
            apiCallsSize: this.apiCalls.size,
            innerApiCallsSize: this.innerApiCalls?.size,
            exceptionsSize: this.exceptions.size,
            exceptionResponsesSize: this.exceptionResponses?.size
        });

        let html = '<div class="report-info"><strong>Date Range:</strong> ' + dateRange + '</div>';

        // Level distribution
        html += '<div class="report-section">';
        html += '<h3 class="report-title">📊 Log Level Distribution</h3>';
        
        const total = this.logs.length;
        const sortedLevels = Object.entries(levelCounts).sort((a, b) => b[1] - a[1]);
        
        // Calculate health score (100 = all debug/info, 0 = all errors)
        const errorCount = levelCounts.error || 0;
        const warningCount = levelCounts.warning || 0;
        const healthScore = Math.max(0, 100 - ((errorCount * 5) + (warningCount * 2)));
        const healthStatus = healthScore >= 80 ? '✅ Excellent' : healthScore >= 60 ? '⚠️ Good' : healthScore >= 40 ? '⚡ Fair' : '❌ Critical';
        const healthColor = healthScore >= 80 ? '#22c55e' : healthScore >= 60 ? '#eab308' : healthScore >= 40 ? '#f97316' : '#ef4444';
        
        // Summary Cards for each level
        html += '<div class="level-distribution-cards">';
        sortedLevels.forEach(([level, count]) => {
            const pct = ((count / total) * 100).toFixed(1);
            const levelClass = 'level-' + level.toLowerCase();
            html += '<div class="distribution-card ' + levelClass + '">';
            html += '<div class="distribution-level-badge">' + level.toUpperCase() + '</div>';
            html += '<div class="distribution-count">' + count + '</div>';
            html += '<div class="distribution-percentage">' + pct + '%</div>';
            html += '<div class="distribution-bar"><div class="distribution-bar-fill" style="width: ' + pct + '%"></div></div>';
            html += '</div>';
        });
        html += '</div>';
        
        // Statistics Table
        html += '<div class="level-stats-section">';
        html += '<h4 class="level-stats-title">📈 Distribution Statistics</h4>';
        html += '<table class="report-table level-stats-table">';
        html += '<thead><tr><th>Level</th><th class="numeric">Count</th><th class="numeric">%</th><th class="numeric">Avg/Hour</th></tr></thead>';
        html += '<tbody>';
        sortedLevels.forEach(([level, count]) => {
            const pct = ((count / total) * 100).toFixed(1);
            const levelClass = 'level-' + level.toLowerCase();
            const avgPerHour = (count / 24).toFixed(1);
            html += '<tr class="level-row ' + levelClass + '">';
            html += '<td class="level-cell"><span class="level-badge ' + level.toLowerCase() + '">' + level.toUpperCase() + '</span></td>';
            html += '<td class="numeric">' + count + '</td>';
            html += '<td class="numeric">' + pct + '%</td>';
            html += '<td class="numeric">' + avgPerHour + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        html += '</div>';
        html += '</div>';

        // API Performance Section
        console.log('API Calls Map:', Array.from(this.apiCalls.entries()));

        if (this.apiCalls && this.apiCalls.size > 0) {
            console.log('Generating API Performance section with', this.apiCalls.size, 'entries');
            
            // Calculate API statistics
            let totalCalls = 0;
            let totalTime = 0;
            let totalErrors = 0;
            let slowestEndpoint = { path: '', avgTime: 0 };
            let fastestEndpoint = { path: '', avgTime: Infinity };
            let highestErrorRate = { path: '', rate: 0 };
            const endpoints = [];

            try {
                for (const [path, stats] of this.apiCalls) {
                    const avgTime = stats.count > 0 ? stats.totalTime / stats.count : 0;
                    const errorRate = stats.count > 0 ? (stats.errors / stats.count) * 100 : 0;
                    
                    totalCalls += stats.count;
                    totalTime += stats.totalTime;
                    totalErrors += stats.errors;
                    
                    if (avgTime > slowestEndpoint.avgTime) {
                        slowestEndpoint = { path, avgTime };
                    }
                    if (avgTime < fastestEndpoint.avgTime) {
                        fastestEndpoint = { path, avgTime };
                    }
                    if (errorRate > highestErrorRate.rate) {
                        highestErrorRate = { path, rate: errorRate };
                    }
                    
                    endpoints.push({ path, stats, avgTime, errorRate });
                }
                
                // Sort endpoints using the sorting method
                const sortedEndpoints = this.getSortedApiEndpoints(endpoints);
                
                // Calculate API Health Score
                const apiHealthScore = totalCalls > 0 ? Math.max(0, 100 - ((totalErrors / totalCalls) * 100 * 2)) : 100;
                const apiHealthStatus = apiHealthScore >= 90 ? '✅ Excellent' : apiHealthScore >= 75 ? '⚡ Good' : apiHealthScore >= 50 ? '⚠️ Fair' : '❌ Poor';
                const apiHealthColor = apiHealthScore >= 90 ? '#22c55e' : apiHealthScore >= 75 ? '#3b82f6' : apiHealthScore >= 50 ? '#eab308' : '#ef4444';
                
                // Response time distribution buckets
                const fastCount = endpoints.filter(e => e.avgTime < 100).length;
                const mediumCount = endpoints.filter(e => e.avgTime >= 100 && e.avgTime < 500).length;
                const slowCount = endpoints.filter(e => e.avgTime >= 500 && e.avgTime < 2000).length;
                const verySlowCount = endpoints.filter(e => e.avgTime >= 2000).length;
                
                // Throughput calculation (calls per minute)
                const throughputPerMin = (totalCalls / Math.max(1, 60)).toFixed(0);
                const successRate = totalCalls > 0 ? (((totalCalls - totalErrors) / totalCalls) * 100).toFixed(1) : 100;
                
                html += '<div class="report-section">';
                html += '<h3 class="report-title">🚀 API Performance Overview</h3>';
                
                // Summary Cards
                html += '<div class="api-summary-cards">';
                html += '<div class="summary-card">';
                html += '<div class="summary-label">Total API Calls</div>';
                html += '<div class="summary-value">' + totalCalls + '</div>';
                html += '</div>';
                html += '<div class="summary-card">';
                html += '<div class="summary-label">Success Rate</div>';
                html += '<div class="summary-value">' + successRate + '<span class="summary-unit">%</span></div>';
                html += '</div>';
                html += '<div class="summary-card">';
                html += '<div class="summary-label">Average Response</div>';
                html += '<div class="summary-value">' + (totalCalls > 0 ? (totalTime / totalCalls).toFixed(2) : 0) + '<span class="summary-unit">ms</span></div>';
                html += '</div>';
                html += '<div class="summary-card">';
                html += '<div class="summary-label">Throughput</div>';
                html += '<div class="summary-value">' + throughputPerMin + '<span class="summary-unit">/min</span></div>';
                html += '</div>';
                html += '</div>';
                
                // API Health Score Card
                html += '<div class="api-health-score-card">';
                html += '<div class="api-health-label">API Health</div>';
                html += '<div class="api-health-value" style="color: ' + apiHealthColor + '">' + Math.round(apiHealthScore) + '/100</div>';
                html += '<div class="api-health-status">' + apiHealthStatus + '</div>';
                html += '<div class="api-health-bar"><div class="api-health-bar-fill" style="width: ' + apiHealthScore + '%; background-color: ' + apiHealthColor + ';"></div></div>';
                html += '</div>';
                
                // Response Time Distribution
                html += '<div class="response-distribution-section">';
                html += '<h4 class="distribution-title">⏱️ Response Time Distribution</h4>';
                html += '<div class="response-distribution-cards">';
                html += '<div class="response-card fast"><div class="response-label">Fast (&lt;100ms)</div><div class="response-count">' + fastCount + '</div><div class="response-bar"><div class="response-bar-fill" style="width: ' + ((fastCount / endpoints.length) * 100 || 0) + '%"></div></div></div>';
                html += '<div class="response-card medium"><div class="response-label">Medium (100-500ms)</div><div class="response-count">' + mediumCount + '</div><div class="response-bar"><div class="response-bar-fill" style="width: ' + ((mediumCount / endpoints.length) * 100 || 0) + '%"></div></div></div>';
                html += '<div class="response-card slow"><div class="response-label">Slow (500-2000ms)</div><div class="response-count">' + slowCount + '</div><div class="response-bar"><div class="response-bar-fill" style="width: ' + ((slowCount / endpoints.length) * 100 || 0) + '%"></div></div></div>';
                html += '<div class="response-card veryflow"><div class="response-label">Very Slow (&gt;2000ms)</div><div class="response-count">' + verySlowCount + '</div><div class="response-bar"><div class="response-bar-fill" style="width: ' + ((verySlowCount / endpoints.length) * 100 || 0) + '%"></div></div></div>';
                html += '</div>';
                html += '</div>';
                
                // Performance Insights
                html += '<div class="api-insights">';
                html += '<div class="insight-item">';
                html += '<span class="insight-label">⚡ Fastest Endpoint:</span>';
                html += '<span class="insight-value">' + (fastestEndpoint.avgTime === Infinity ? 'N/A' : this.escape(fastestEndpoint.path) + ' (' + fastestEndpoint.avgTime.toFixed(2) + 'ms)') + '</span>';
                html += '</div>';
                html += '<div class="insight-item">';
                html += '<span class="insight-label">🐢 Slowest Endpoint:</span>';
                html += '<span class="insight-value">' + this.escape(slowestEndpoint.path) + ' (' + slowestEndpoint.avgTime.toFixed(2) + 'ms)' + '</span>';
                html += '</div>';
                html += '<div class="insight-item">';
                html += '<span class="insight-label">⚠️ Highest Error Rate:</span>';
                html += '<span class="insight-value">' + this.escape(highestErrorRate.path) + ' (' + highestErrorRate.rate.toFixed(1) + '%)' + '</span>';
                html += '</div>';
                html += '</div>';
                
                // Detailed table with performance tags
                html += '<div class="report-description">Endpoints Performance Breakdown - Click headers to sort</div>';
                html += '<table class="report-table api-performance-table">';
                html += '<thead><tr>';
                html += '<th>API Endpoint</th>';
                
                // Sortable headers with indicators
                const getSortIndicator = (column) => {
                    if (this.apiTableSortColumn !== column) return '';
                    return this.apiTableSortDirection === 'asc' ? ' ▲' : ' ▼';
                };
                
                const getHeaderClass = (column) => {
                    return this.apiTableSortColumn === column ? ' class="numeric sortable-col active"' : ' class="numeric sortable-col"';
                };
                
                html += '<th' + getHeaderClass('calls') + ' data-sort-column="calls">Calls' + getSortIndicator('calls') + '</th>';
                html += '<th' + getHeaderClass('avgTime') + ' data-sort-column="avgTime">Avg Time' + getSortIndicator('avgTime') + '</th>';
                html += '<th' + getHeaderClass('minTime') + ' data-sort-column="minTime">Min Time' + getSortIndicator('minTime') + '</th>';
                html += '<th' + getHeaderClass('maxTime') + ' data-sort-column="maxTime">Max Time' + getSortIndicator('maxTime') + '</th>';
                html += '<th class="numeric">Success Rate</th>';
                html += '<th class="numeric">Status Codes</th>';
                html += '<th class="numeric">Performance</th>';
                html += '</tr></thead>';
                html += '<tbody>';

                sortedEndpoints.forEach(endpoint => {
                    const { path, stats, avgTime, errorRate } = endpoint;
                    const successCallRate = stats.count > 0 ? (((stats.count - stats.errors) / stats.count) * 100).toFixed(1) : 100;
                    const performanceTag = avgTime < 100 ? '🟢 Optimal' : avgTime < 500 ? '🔵 Good' : avgTime < 2000 ? '🟡 Fair' : '🔴 Critical';
                    const statusCodeStr = stats.statusCodes && stats.statusCodes.size > 0 
                        ? Array.from(stats.statusCodes.entries())
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 3)
                            .map(([code, count]) => code + ':' + count)
                            .join(' ')
                        : 'N/A';
                    
                    html += '<tr class="api-row api-status-' + (errorRate > 10 ? 'poor' : errorRate > 0 ? 'fair' : 'good') + '">';
                    html += '<td class="report-code">' + this.escape(path) + '</td>';
                    html += '<td class="numeric">' + stats.count + '</td>';
                    html += '<td class="numeric">' + avgTime.toFixed(2) + 'ms</td>';
                    html += '<td class="numeric">' + (stats.minTime === Infinity ? 0 : stats.minTime).toFixed(0) + 'ms</td>';
                    html += '<td class="numeric">' + stats.maxTime.toFixed(0) + 'ms</td>';
                    html += '<td class="numeric">' + successCallRate + '%</td>';
                    html += '<td class="numeric status-codes">' + statusCodeStr + '</td>';
                    html += '<td class="status-badge">' + performanceTag + '</td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table>';
                html += '</div>';
            } catch (error) {
                console.error('Error generating API Performance section:', error);
                html += '<div class="report-section"><h3 class="report-title">🚀 API Performance</h3><p>Error generating API statistics</p></div>';
            }
        }

        // Exception Response Analysis Section
        if (this.exceptionResponses && (this.exceptionResponses.byType.size > 0 || this.exceptionResponses.byReason.size > 0)) {
            let totalExceptions = 0;
            for (const [_, stats] of this.exceptionResponses.byType) {
                totalExceptions += stats.count;
            }
            
            html += '<div class="report-section">';
            html += '<h3 class="report-title">🔍 Exception Response Analysis</h3>';
            
            // Summary stats
            html += '<div class="exception-summary-cards">';
            html += '<div class="exception-summary-card">';
            html += '<div class="exception-summary-label">Total Exceptions</div>';
            html += '<div class="exception-summary-value">' + totalExceptions + '</div>';
            html += '</div>';
            html += '<div class="exception-summary-card">';
            html += '<div class="exception-summary-label">Exception Types</div>';
            html += '<div class="exception-summary-value">' + this.exceptionResponses.byType.size + '</div>';
            html += '</div>';
            html += '<div class="exception-summary-card">';
            html += '<div class="exception-summary-label">Unique Reasons</div>';
            html += '<div class="exception-summary-value">' + this.exceptionResponses.byReason.size + '</div>';
            html += '</div>';
            html += '</div>';
            
            html += '<div class="exception-tabs">';
            html += '<button class="exception-tab-btn active" data-tab="by-type">Grouped by TYPE</button>';
            html += '<button class="exception-tab-btn" data-tab="by-reason">Grouped by REASON</button>';
            html += '</div>';

            // Exception by TYPE
            let typeEntries = Array.from(this.exceptionResponses.byType.entries());
            typeEntries.sort((a, b) => b[1].count - a[1].count); // Sort by count descending
            
            let typeHtml = '<table class="report-table exception-table">';
            typeHtml += '<thead><tr>';
            typeHtml += '<th>Exception Type</th>';
            typeHtml += '<th class="numeric">Count</th>';
            typeHtml += '<th class="numeric">Percentage</th>';
            typeHtml += '<th>Most Common Reason</th>';
            typeHtml += '<th class="numeric">Reason Count</th>';
            typeHtml += '</tr></thead>';
            typeHtml += '<tbody>';

            for (const [type, stats] of typeEntries) {
                let topReason = 'N/A';
                let topReasonCount = 0;

                for (const [reason, count] of stats.reasons) {
                    if (count > topReasonCount) {
                        topReasonCount = count;
                        topReason = reason;
                    }
                }
                
                const percentage = totalExceptions > 0 ? ((stats.count / totalExceptions) * 100).toFixed(1) : 0;
                const percentageBar = '<div class="exception-percentage-bar" style="width: ' + percentage + '%"></div>';

                typeHtml += '<tr class="exception-row">';
                typeHtml += '<td class="report-code exception-type-name">' + this.escape(type) + '</td>';
                typeHtml += '<td class="numeric">' + stats.count + '</td>';
                typeHtml += '<td class="numeric"><div class="percentage-container">' + percentage + '%' + percentageBar + '</div></td>';
                typeHtml += '<td class="exception-reason">' + this.escape(topReason) + '</td>';
                typeHtml += '<td class="numeric">' + topReasonCount + '</td>';
                typeHtml += '</tr>';
            }
            typeHtml += '</tbody></table>';

            // Exception by REASON
            let reasonEntries = Array.from(this.exceptionResponses.byReason.entries());
            reasonEntries.sort((a, b) => b[1].count - a[1].count); // Sort by count descending
            
            let reasonHtml = '<table class="report-table exception-table">';
            reasonHtml += '<thead><tr>';
            reasonHtml += '<th>Reason</th>';
            reasonHtml += '<th class="numeric">Count</th>';
            reasonHtml += '<th class="numeric">Percentage</th>';
            reasonHtml += '<th>Most Common Type</th>';
            reasonHtml += '<th>Thrown By API</th>';
            reasonHtml += '</tr></thead>';
            reasonHtml += '<tbody>';

            for (const [reason, stats] of reasonEntries) {
                let topType = 'N/A';
                let topTypeCount = 0;

                for (const [type, count] of stats.types) {
                    if (count > topTypeCount) {
                        topTypeCount = count;
                        topType = type;
                    }
                }

                // Find the most common API that threw this reason
                let topApi = 'N/A';
                let topApiCount = 0;
                for (const [api, count] of stats.apis) {
                    if (count > topApiCount) {
                        topApiCount = count;
                        topApi = api;
                    }
                }
                
                const percentage = totalExceptions > 0 ? ((stats.count / totalExceptions) * 100).toFixed(1) : 0;
                const percentageBar = '<div class="exception-percentage-bar" style="width: ' + percentage + '%"></div>';

                reasonHtml += '<tr class="exception-row">';
                reasonHtml += '<td class="report-code exception-reason-name">' + this.escape(reason) + '</td>';
                reasonHtml += '<td class="numeric">' + stats.count + '</td>';
                reasonHtml += '<td class="numeric"><div class="percentage-container">' + percentage + '%' + percentageBar + '</div></td>';
                reasonHtml += '<td class="exception-type">' + this.escape(topType) + '</td>';
                reasonHtml += '<td class="report-code exception-api">' + this.escape(topApi) + '</td>';
                reasonHtml += '</tr>';
            }
            reasonHtml += '</tbody></table>';

            html += '<div id="exceptionByType" class="exception-tab-content active">' + typeHtml + '</div>';
            html += '<div id="exceptionByReason" class="exception-tab-content">' + reasonHtml + '</div>';
            html += '</div>';
        }

        // Inner HTTP Calls Section
        if (this.innerApiCalls && this.innerApiCalls.size > 0) {
            html += '<div class="report-section">';
            html += '<h3 class="report-title">🔄 Internal HTTP Calls</h3>';
            html += '<div class="report-description">HTTP requests made within API calls</div>';
            html += '<table class="report-table">';
            html += '<tr><th>Method & Path</th><th>Calls</th><th>Avg Time</th><th>Min Time</th><th>Max Time</th><th>Error Rate</th><th>Status Codes</th></tr>';

            for (const [path, stats] of this.innerApiCalls) {
                const avgTime = stats.count > 0 ? (stats.totalTime / stats.count).toFixed(2) : 0;
                const errorRate = stats.count > 0 ? ((stats.errors / stats.count) * 100).toFixed(1) : 0;
                const statusDist = stats.statusCodes && stats.statusCodes.size > 0
                    ? Array.from(stats.statusCodes.entries())
                        .map(([code, count]) => `${code}: ${count}`)
                        .join(', ')
                    : 'N/A';

                html += '<tr>';
                html += '<td class="report-code">' + this.escape(path) + '</td>';
                html += '<td>' + stats.count + '</td>';
                html += '<td>' + avgTime + 'ms</td>';
                html += '<td>' + stats.minTime + 'ms</td>';
                html += '<td>' + stats.maxTime + 'ms</td>';
                html += '<td>' + errorRate + '%</td>';
                html += '<td>' + statusDist + '</td>';
                html += '</tr>';
            }
            html += '</table>';
            html += '</div>';
        }

        // Thread distribution
        html += '<div class="report-section">';
        html += '<h3 class="report-title">Thread Distribution</h3>';
        html += '<div class="report-description">Top 10 most active threads</div>';
        html += '<table class="report-table">';
        html += '<tr><th>Thread ID</th><th>Count</th><th>Percentage</th></tr>';
        Object.entries(threadCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([thread, count]) => {
                const pct = ((count / total) * 100).toFixed(1);
                html += '<tr>';
                html += '<td class="report-code">' + this.escape(thread) + '</td>';
                html += '<td>' + count + '</td>';
                html += '<td><div class="report-bar-container">' + pct + '%<div class="report-bar" style="width: ' + pct + '%"></div></div></td>';
                html += '</tr>';
            });
        html += '</table>';
        html += '</div>';

        // Time distribution
        html += '<div class="report-section">';
        html += '<h3 class="report-title">Time Distribution</h3>';
        html += '<div class="timeline-container">';
        for (let h = 0; h < 24; h++) {
            const count = hourCounts[h] || 0;
            const pct = ((count / total) * 100).toFixed(1);
            html += '<div class="timeline-item">';
            html += '<div class="timeline-time">' + String(h).padStart(2, '0') + ':00 - ' + String(h).padStart(2, '0') + ':59</div>';
            html += '<div class="timeline-count">' + count + '</div>';
            html += '<div class="report-bar" style="width: ' + pct + '%"></div>';
            html += '</div>';
        }
        html += '</div>';
        html += '</div>';

        document.getElementById('reportsContent').innerHTML = html;

        // Re-attach tab event listeners for exception tabs
        document.querySelectorAll('.exception-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchExceptionTab(e.target.dataset.tab));
        });
        
        // Attach event listeners for API Performance table headers
        document.querySelectorAll('.api-performance-table .sortable-col').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => this.handleApiTableSort(th.dataset.sortColumn));
        });
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