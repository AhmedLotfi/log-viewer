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

                    logMatch = after.match(/^\[([A-Z]{3})\]\s+\[([^\]]+)\]\s+(.*)$/);
                    if (logMatch) {
                        format = 'format1';
                        level = logMatch[1];
                        threadId = logMatch[2];
                        message = logMatch[3];
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

                        // Handle APIGW correlation IDs and empty brackets
                        const apigwMatch = message.match(/\["APIGW:([^:]+):([^\]]+)"\]/);
                        const emptyBracketMatch = message.match(/\[""\]/);
                        let correlationId = null;
                        let requestId = null;
                        
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

                        // Handle API paths and tracking
                        const pathMatch = message.match(/Path:\s+"([^"]+)"/);
                        if (pathMatch && (requestId || emptyBracketMatch)) {
                            const date = dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date();
                            currentApiCall = {
                                path: pathMatch[1],
                                startTime: date,
                                correlationId,
                                requestId
                            };
                        } else if (message.includes('Response') && currentApiCall && 
                                 (currentApiCall.correlationId === correlationId || 
                                  (currentApiCall.correlationId === null && emptyBracketMatch))) {
                            const date = dateParts ? new Date(dateParts[1] + 'T' + dateParts[2]) : new Date();
                            const duration = date - currentApiCall.startTime;
                            const apiKey = currentApiCall.path;
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
                            const [_, type, message] = exceptionMatch;
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
                            if (current.correlationId && this.apiCalls.size > 0) {
                                for (const [_, stats] of this.apiCalls) {
                                    if (stats.correlationId === current.correlationId) {
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

        const start = (this.currentPage - 1) * this.logsPerPage;
        const end = Math.min(start + this.logsPerPage, this.filteredLogs.length);
        const page = this.filteredLogs.slice(start, end);

        container.innerHTML = page.map(log => this.renderLog(log)).join('');

        container.querySelectorAll('.log-entry').forEach((el, i) => {
            el.addEventListener('click', () => this.showModal(page[i]));
        });

        const total = Math.ceil(this.filteredLogs.length / this.logsPerPage);
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

        document.getElementById('visibleCount').textContent = this.filteredLogs.length;
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

    escape(txt) {
        const div = document.createElement('div');
        div.textContent = txt;
        return div.innerHTML;
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

        // Update stats
        document.getElementById('fileCount').textContent = this.loadedFiles;
        document.getElementById('totalCount').textContent = this.logs.length;
        document.getElementById('debugCount').textContent = counts.debug;
        document.getElementById('infoCount').textContent = counts.information;
        document.getElementById('warningCount').textContent = counts.warning;
        document.getElementById('errorCount').textContent = counts.error;

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

        // Generate HTML report
        let html = '<div class="report-info"><strong>Date Range:</strong> ' + dateRange + '</div>';

        // Level distribution
        html += '<div class="report-section">';
        html += '<h3 class="report-title">Log Level Distribution</h3>';
        html += '<table class="report-table">';
        html += '<tr><th>Level</th><th>Count</th><th>Percentage</th></tr>';
        const total = this.logs.length;
        Object.entries(levelCounts).sort((a, b) => b[1] - a[1]).forEach(([level, count]) => {
            const pct = ((count / total) * 100).toFixed(1);
            html += '<tr>';
            html += '<td>' + level.toUpperCase() + '</td>';
            html += '<td>' + count + '</td>';
            html += '<td><div class="report-bar-container">' + pct + '%<div class="report-bar" style="width: ' + pct + '%"></div></div></td>';
            html += '</tr>';
        });
        html += '</table>';
        html += '</div>';

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

        // API Performance Section
        if (this.apiCalls.size > 0) {
            html += '<div class="report-section">';
            html += '<h3 class="report-title">API Performance</h3>';
            html += '<table class="report-table">';
            html += '<tr><th>API Path</th><th>Calls</th><th>Avg Time</th><th>Min Time</th><th>Max Time</th><th>Error Rate</th></tr>';
            
            for (const [path, stats] of this.apiCalls) {
                const avgTime = (stats.totalTime / stats.count).toFixed(2);
                const errorRate = ((stats.errors / stats.count) * 100).toFixed(1);
                
                html += '<tr>';
                html += '<td class="report-code">' + this.escape(path) + '</td>';
                html += '<td>' + stats.count + '</td>';
                html += '<td>' + avgTime + 'ms</td>';
                html += '<td>' + stats.minTime + 'ms</td>';
                html += '<td>' + stats.maxTime + 'ms</td>';
                html += '<td>' + errorRate + '%</td>';
                html += '</tr>';
            }
            html += '</table>';
            html += '</div>';
        }

        // Exception Analysis Section
        if (this.exceptions.size > 0) {
            html += '<div class="report-section">';
            html += '<h3 class="report-title">Exception Analysis</h3>';
            html += '<div class="report-summary">Total Errors: ' + totalErrors + '</div>';
            html += '<table class="report-table">';
            html += '<tr><th>Exception Type</th><th>Count</th><th>Most Common Message</th><th>Message Count</th></tr>';
            
            for (const [type, stats] of this.exceptions) {
                // Find most common message
                let topMessage = '';
                let topCount = 0;
                for (const [msg, count] of stats.messages) {
                    if (count > topCount) {
                        topCount = count;
                        topMessage = msg;
                    }
                }
                
                html += '<tr>';
                html += '<td class="report-code">' + this.escape(type) + '</td>';
                html += '<td>' + stats.count + '</td>';
                html += '<td>' + this.escape(topMessage) + '</td>';
                html += '<td>' + topCount + '</td>';
                html += '</tr>';
            }
            html += '</table>';
            html += '</div>';
        }

        document.getElementById('reportsContent').innerHTML = html;
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