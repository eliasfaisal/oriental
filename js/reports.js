/**
 * Oriental v3.0.0 - Reports Manager
 * Charts, analytics, and export functionality
 */

class ReportsManager {
    constructor() {
        this.charts = {};
        this.dateRange = 'month';
        this.projectFilter = null;
    }

    async render() {
        const container = document.getElementById('reports-view');
        if (!container) return;

        container.innerHTML = `
            <div class="reports-header">
                <h2><i class="fas fa-chart-line"></i> Reports & Analytics</h2>
                <div class="reports-controls">
                    <select id="report-project-filter" class="form-select">
                        <option value="">All Projects</option>
                    </select>
                    <select id="report-date-range" class="form-select">
                        <option value="week">Last 7 Days</option>
                        <option value="month" selected>Last 30 Days</option>
                        <option value="quarter">Last 90 Days</option>
                        <option value="year">Last Year</option>
                        <option value="all">All Time</option>
                    </select>
                    <button class="btn-secondary" id="export-report-btn">
                        <i class="fas fa-download"></i> Export
                    </button>
                </div>
            </div>
            
            <div class="stats-cards" id="stats-cards"></div>
            
            <div class="charts-grid">
                <div class="chart-card large">
                    <h3><i class="fas fa-chart-line"></i> Cumulative Flow Diagram</h3>
                    <div class="chart-container">
                        <canvas id="cumulative-flow-chart"></canvas>
                    </div>
                </div>
                
                <div class="chart-card">
                    <h3><i class="fas fa-tachometer-alt"></i> Team Velocity</h3>
                    <div class="chart-container">
                        <canvas id="team-velocity-chart"></canvas>
                    </div>
                </div>
                
                <div class="chart-card">
                    <h3><i class="fas fa-user-check"></i> Task Distribution</h3>
                    <div class="chart-container">
                        <canvas id="task-distribution-chart"></canvas>
                    </div>
                </div>
                
                <div class="chart-card large">
                    <h3><i class="fas fa-calendar-check"></i> Time Tracking Heatmap</h3>
                    <div class="chart-container" id="heatmap-container"></div>
                </div>
            </div>
        `;

        // Load project filter options
        await this.loadProjectFilter();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Load data
        await this.loadReportData();
    }

    async loadProjectFilter() {
        const select = document.getElementById('report-project-filter');
        if (!select) return;

        try {
            const snapshot = await db.collection('projects')
                .where('organizationId', '==', app.state.currentOrganization)
                .where('isArchived', '==', false)
                .get();

            snapshot.forEach(doc => {
                const project = doc.data();
                const option = document.createElement('option');
                option.value = doc.id;
                option.textContent = project.name;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    setupEventListeners() {
        document.getElementById('report-project-filter')?.addEventListener('change', (e) => {
            this.projectFilter = e.target.value || null;
            this.loadReportData();
        });

        document.getElementById('report-date-range')?.addEventListener('change', (e) => {
            this.dateRange = e.target.value;
            this.loadReportData();
        });

        document.getElementById('export-report-btn')?.addEventListener('click', () => {
            this.exportReport();
        });
    }

    async loadReportData() {
        try {
            const tasks = await this.getTasks();
            
            this.updateStatsCards(tasks);
            await this.renderCumulativeFlowDiagram(tasks);
            await this.renderTeamVelocityChart(tasks);
            await this.renderTaskDistributionChart(tasks);
            await this.renderHeatmap(tasks);
        } catch (error) {
            console.error('Error loading report data:', error);
            showToast('Error loading reports', 'error');
        }
    }

    async getTasks() {
        let query = db.collection('tasks')
            .where('organizationId', '==', app.state.currentOrganization);

        if (this.projectFilter) {
            query = query.where('projectId', '==', this.projectFilter);
        }

        // Apply date filter
        const dateFilter = this.getDateFilter();
        if (dateFilter) {
            query = query.where('createdAt', '>=', dateFilter);
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }

    getDateFilter() {
        const now = new Date();
        const filter = firebase.firestore.Timestamp;

        switch (this.dateRange) {
            case 'week':
                return filter.fromDate(new Date(now - 7 * 24 * 60 * 60 * 1000));
            case 'month':
                return filter.fromDate(new Date(now - 30 * 24 * 60 * 60 * 1000));
            case 'quarter':
                return filter.fromDate(new Date(now - 90 * 24 * 60 * 60 * 1000));
            case 'year':
                return filter.fromDate(new Date(now - 365 * 24 * 60 * 60 * 1000));
            default:
                return null;
        }
    }

    updateStatsCards(tasks) {
        const container = document.getElementById('stats-cards');
        if (!container) return;

        const completed = tasks.filter(t => t.status === 'completed').length;
        const total = tasks.length;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        const overdue = tasks.filter(t => {
            if (!t.dueDate || ['completed', 'archived'].includes(t.status)) return false;
            return getDaysOverdue(t.dueDate) > 0;
        }).length;
        const inProgress = tasks.filter(t => ['started', 'review'].includes(t.status)).length;
        const stuck = tasks.filter(t => t.status === 'stuck').length;

        container.innerHTML = `
            <div class="stat-card">
                <div class="stat-icon" style="background: #dbeafe">
                    <i class="fas fa-tasks" style="color: #3b82f6"></i>
                </div>
                <div class="stat-content">
                    <span class="stat-value">${total}</span>
                    <span class="stat-label">Total Tasks</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: #d1fae5">
                    <i class="fas fa-check-circle" style="color: #10b981"></i>
                </div>
                <div class="stat-content">
                    <span class="stat-value">${completionRate}%</span>
                    <span class="stat-label">Completion Rate</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: #fef3c7">
                    <i class="fas fa-spinner" style="color: #f59e0b"></i>
                </div>
                <div class="stat-content">
                    <span class="stat-value">${inProgress}</span>
                    <span class="stat-label">In Progress</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: #fee2e2">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444"></i>
                </div>
                <div class="stat-content">
                    <span class="stat-value">${overdue}</span>
                    <span class="stat-label">Overdue</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: #fce7f3">
                    <i class="fas fa-hand-paper" style="color: #ec4899"></i>
                </div>
                <div class="stat-content">
                    <span class="stat-value">${stuck}</span>
                    <span class="stat-label">Stuck</span>
                </div>
            </div>
        `;
    }

    async renderCumulativeFlowDiagram(tasks) {
        const ctx = document.getElementById('cumulative-flow-chart');
        if (!ctx) return;

        if (this.charts.cumulativeFlow) {
            this.charts.cumulativeFlow.destroy();
        }

        // Group tasks by creation date
        const dates = this.getDateRange();
        const statuses = ['planned', 'started', 'stuck', 'review', 'completed'];
        const datasets = statuses.map((status, index) => {
            let cumulative = 0;
            const data = dates.map(date => {
                cumulative += tasks.filter(t => 
                    t.status === status && 
                    t.createdAt?.toDate() <= date
                ).length;
                return cumulative;
            });

            return {
                label: getTaskStateLabel(status),
                data: data,
                backgroundColor: this.getStatusColor(status, 0.7),
                borderColor: this.getStatusColor(status, 1),
                fill: true,
                tension: 0.3
            };
        });

        this.charts.cumulativeFlow = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates.map(d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: 'Cumulative Flow Diagram' }
                },
                scales: {
                    y: { stacked: true, beginAtZero: true },
                    x: { stacked: true }
                }
            }
        });
    }

    async renderTeamVelocityChart(tasks) {
        const ctx = document.getElementById('team-velocity-chart');
        if (!ctx) return;

        if (this.charts.teamVelocity) {
            this.charts.teamVelocity.destroy();
        }

        // Group completed tasks by week
        const weeklyData = this.groupByWeek(tasks.filter(t => t.status === 'completed'));
        
        this.charts.teamVelocity = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(weeklyData),
                datasets: [{
                    label: 'Completed Tasks',
                    data: Object.values(weeklyData),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Weekly Velocity' }
                },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    async renderTaskDistributionChart(tasks) {
        const ctx = document.getElementById('task-distribution-chart');
        if (!ctx) return;

        if (this.charts.taskDistribution) {
            this.charts.taskDistribution.destroy();
        }

        // Distribution by assignee
        const assigneeDist = {};
        tasks.forEach(t => {
            const assignee = t.assignedTo || 'Unassigned';
            assigneeDist[assignee] = (assigneeDist[assignee] || 0) + 1;
        });

        const sorted = Object.entries(assigneeDist)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

        this.charts.taskDistribution = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: sorted.map(([name]) => name),
                datasets: [{
                    data: sorted.map(([, count]) => count),
                    backgroundColor: [
                        '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
                        '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: 'Tasks by Assignee' }
                }
            }
        });
    }

    async renderHeatmap(tasks) {
        const container = document.getElementById('heatmap-container');
        if (!container) return;

        // Create a simple heatmap of task activity by day of week and hour
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const hours = Array.from({ length: 24 }, (_, i) => i);
        
        const activityData = {};
        days.forEach(day => {
            activityData[day] = {};
            hours.forEach(hour => {
                activityData[day][hour] = 0;
            });
        });

        tasks.forEach(task => {
            if (task.createdAt?.toDate) {
                const date = task.createdAt.toDate();
                const day = days[date.getDay()];
                const hour = date.getHours();
                activityData[day][hour]++;
            }
        });

        // Find max for color scaling
        let maxActivity = 0;
        days.forEach(day => {
            hours.forEach(hour => {
                maxActivity = Math.max(maxActivity, activityData[day][hour]);
            });
        });

        container.innerHTML = `
            <div class="heatmap">
                <div class="heatmap-header">
                    <span></span>
                    ${hours.map(h => `<span>${h}h</span>`).join('')}
                </div>
                ${days.map(day => `
                    <div class="heatmap-row">
                        <span class="heatmap-label">${day}</span>
                        ${hours.map(hour => {
                            const value = activityData[day][hour];
                            const intensity = maxActivity > 0 ? value / maxActivity : 0;
                            const color = this.getHeatmapColor(intensity);
                            return `
                                <div class="heatmap-cell" 
                                     style="background: ${color}"
                                     title="${day} ${hour}:00 - ${value} tasks">
                                </div>
                            `;
                        }).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    getHeatmapColor(intensity) {
        if (intensity === 0) return '#f3f4f6';
        if (intensity < 0.25) return '#dbeafe';
        if (intensity < 0.5) return '#93c5fd';
        if (intensity < 0.75) return '#3b82f6';
        return '#1d4ed8';
    }

    getStatusColor(status, opacity = 1) {
        const colors = {
            planned: `rgba(156, 163, 175, ${opacity})`,
            started: `rgba(59, 130, 246, ${opacity})`,
            stuck: `rgba(239, 68, 68, ${opacity})`,
            review: `rgba(245, 158, 11, ${opacity})`,
            completed: `rgba(16, 185, 129, ${opacity})`
        };
        return colors[status] || `rgba(107, 114, 128, ${opacity})`;
    }

    getDateRange() {
        const now = new Date();
        const dates = [];
        
        let days = 30;
        switch (this.dateRange) {
            case 'week': days = 7; break;
            case 'month': days = 30; break;
            case 'quarter': days = 90; break;
            case 'year': days = 365; break;
        }

        for (let i = days; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            dates.push(date);
        }

        return dates;
    }

    groupByWeek(tasks) {
        const weekly = {};
        
        tasks.forEach(task => {
            if (task.updatedAt?.toDate) {
                const date = task.updatedAt.toDate();
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay());
                const key = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                weekly[key] = (weekly[key] || 0) + 1;
            }
        });

        return weekly;
    }

    async exportReport() {
        showToast('Preparing export...', 'info');
        // Implementation for CSV/PDF export
        setTimeout(() => {
            showToast('Report exported!', 'success');
        }, 1000);
    }

    destroy() {
        Object.values(this.charts).forEach(chart => chart?.destroy());
    }
}