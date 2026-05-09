/**
 * Oriental v3.0.0 - Admin Overview
 * Draggable widgets for admin dashboard
 */

class AdminOverview {
    constructor() {
        this.widgets = [];
        this.widgetOrder = [];
        this.charts = {};
        this.refreshInterval = null;
    }

    async init() {
        this.loadWidgetOrder();
        await this.render();
        this.startAutoRefresh();
    }

    async render() {
        const container = document.getElementById('admin-view');
        if (!container) return;

        container.innerHTML = `
            <div class="admin-header">
                <h2><i class="fas fa-chart-pie"></i> Overview</h2>
                <div class="admin-actions">
                    <button class="btn-secondary" onclick="app.modules.admin.refreshAll()">
                        <i class="fas fa-sync-alt"></i> Refresh
                    </button>
                    <button class="btn-secondary" onclick="app.modules.admin.resetWidgets()">
                        <i class="fas fa-undo"></i> Reset Layout
                    </button>
                </div>
            </div>
            <div class="admin-widgets" id="admin-widgets"></div>
        `;

        await this.renderWidgets();
        this.setupDragAndDrop();
    }

    async renderWidgets() {
        const container = document.getElementById('admin-widgets');
        if (!container) return;

        const widgetConfigs = [
            { id: 'projectPerformance', title: 'Project Performance', icon: 'fa-chart-bar' },
            { id: 'taskDistribution', title: 'Task Distribution', icon: 'fa-pie-chart' },
            { id: 'teamVelocity', title: 'Team Velocity', icon: 'fa-tachometer-alt' },
            { id: 'overdueTasks', title: 'Overdue Tasks', icon: 'fa-exclamation-triangle' },
            { id: 'recentActivity', title: 'Recent Activity', icon: 'fa-history' },
            { id: 'milestoneProgress', title: 'Milestone Progress', icon: 'fa-flag-checkered' }
        ];

        container.innerHTML = widgetConfigs.map(config => `
            <div class="admin-widget" data-widget="${config.id}" draggable="true">
                <div class="widget-header">
                    <div class="widget-title">
                        <i class="fas ${config.icon}"></i>
                        <span>${config.title}</span>
                    </div>
                    <div class="widget-actions">
                        <button class="widget-refresh" onclick="app.modules.admin.updateWidget('${config.id}')">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="widget-collapse" onclick="this.closest('.admin-widget').classList.toggle('collapsed')">
                            <i class="fas fa-chevron-up"></i>
                        </button>
                    </div>
                </div>
                <div class="widget-content" id="widget-${config.id}">
                    <div class="skeleton-loader"></div>
                </div>
            </div>
        `).join('');

        // Update each widget
        await Promise.all(
            widgetConfigs.map(config => this.updateWidget(config.id))
        );
    }

    async updateWidget(widgetId) {
        switch (widgetId) {
            case 'projectPerformance':
                await this.renderProjectPerformance();
                break;
            case 'taskDistribution':
                await this.renderTaskDistribution();
                break;
            case 'teamVelocity':
                await this.renderTeamVelocity();
                break;
            case 'overdueTasks':
                await this.renderOverdueTasks();
                break;
            case 'recentActivity':
                await this.renderRecentActivity();
                break;
            case 'milestoneProgress':
                await this.renderMilestoneProgress();
                break;
        }
    }

    async renderProjectPerformance() {
        const container = document.getElementById('widget-projectPerformance');
        if (!container) return;

        try {
            const projectsSnapshot = await db.collection('projects')
                .where('organizationId', '==', app.state.currentOrganization)
                .where('isArchived', '==', false)
                .get();

            const projectStats = [];
            
            for (const doc of projectsSnapshot.docs) {
                const project = { id: doc.id, ...doc.data() };
                const tasksSnapshot = await db.collection('tasks')
                    .where('projectId', '==', project.id)
                    .get();

                const tasks = tasksSnapshot.docs.map(d => d.data());
                const total = tasks.length;
                const completed = tasks.filter(t => t.status === 'completed').length;
                const overdue = tasks.filter(t => {
                    if (!t.dueDate || ['completed', 'archived'].includes(t.status)) return false;
                    return getDaysOverdue(t.dueDate) > 0;
                }).length;

                projectStats.push({
                    name: project.name,
                    total,
                    completed,
                    overdue,
                    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
                });
            }

            projectStats.sort((a, b) => b.total - a.total);

            container.innerHTML = `
                <div class="performance-list">
                    ${projectStats.map(stat => `
                        <div class="performance-item">
                            <div class="performance-header">
                                <span class="performance-name">${escapeHtml(stat.name)}</span>
                                <span class="performance-rate" style="color: ${this.getHealthColor(stat.completionRate)}">
                                    ${stat.completionRate}%
                                </span>
                            </div>
                            <div class="performance-bar">
                                <div class="performance-fill" style="width: ${stat.completionRate}%; background: ${this.getHealthColor(stat.completionRate)}"></div>
                            </div>
                            <div class="performance-stats">
                                <span>${stat.completed}/${stat.total} completed</span>
                                ${stat.overdue > 0 ? `<span class="overdue-count">${stat.overdue} overdue</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering project performance:', error);
        }
    }

    async renderTaskDistribution() {
        const container = document.getElementById('widget-taskDistribution');
        if (!container) return;

        try {
            const snapshot = await db.collection('tasks')
                .where('organizationId', '==', app.state.currentOrganization)
                .get();

            const tasks = snapshot.docs.map(d => d.data());
            
            // Distribution by status
            const statusDist = {
                planned: tasks.filter(t => t.status === 'planned').length,
                started: tasks.filter(t => t.status === 'started').length,
                stuck: tasks.filter(t => t.status === 'stuck').length,
                review: tasks.filter(t => t.status === 'review').length,
                completed: tasks.filter(t => t.status === 'completed').length
            };

            // Distribution by assignee
            const assigneeDist = {};
            tasks.forEach(t => {
                const assignee = t.assignedTo || 'Unassigned';
                assigneeDist[assignee] = (assigneeDist[assignee] || 0) + 1;
            });

            container.innerHTML = `
                <div class="distribution-charts">
                    <div class="chart-container" style="height: 200px;">
                        <canvas id="status-dist-chart"></canvas>
                    </div>
                    <div class="chart-container" style="height: 200px;">
                        <canvas id="assignee-dist-chart"></canvas>
                    </div>
                </div>
            `;

            // Render status distribution chart
            const statusCtx = document.getElementById('status-dist-chart');
            if (statusCtx) {
                this.charts.statusDist = new Chart(statusCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Planned', 'Started', 'Stuck', 'Review', 'Completed'],
                        datasets: [{
                            data: [statusDist.planned, statusDist.started, statusDist.stuck, 
                                   statusDist.review, statusDist.completed],
                            backgroundColor: ['#9ca3af', '#3b82f6', '#ef4444', '#f59e0b', '#10b981']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom' } }
                    }
                });
            }

            // Render assignee distribution chart
            const assigneeCtx = document.getElementById('assignee-dist-chart');
            if (assigneeCtx) {
                const sortedAssignees = Object.entries(assigneeDist)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);

                this.charts.assigneeDist = new Chart(assigneeCtx, {
                    type: 'bar',
                    data: {
                        labels: sortedAssignees.map(([name]) => name.substring(0, 10)),
                        datasets: [{
                            label: 'Tasks',
                            data: sortedAssignees.map(([, count]) => count),
                            backgroundColor: '#8b5cf6'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }
        } catch (error) {
            console.error('Error rendering task distribution:', error);
        }
    }

    async renderTeamVelocity() {
        const container = document.getElementById('widget-teamVelocity');
        if (!container) return;

        try {
            // Get completed sprints
            const sprintsSnapshot = await db.collection('sprints')
                .where('organizationId', '==', app.state.currentOrganization)
                .where('status', '==', 'completed')
                .orderBy('completedAt', 'desc')
                .limit(10)
                .get();

            const velocityData = [];
            sprintsSnapshot.forEach(doc => {
                const sprint = doc.data();
                const total = sprint.tasks?.length || 0;
                velocityData.push({
                    name: sprint.name,
                    total: total,
                    completedAt: sprint.completedAt?.toDate()
                });
            });

            velocityData.reverse();

            container.innerHTML = `
                <div class="chart-container" style="height: 250px;">
                    <canvas id="velocity-chart"></canvas>
                </div>
            `;

            const ctx = document.getElementById('velocity-chart');
            if (ctx) {
                this.charts.velocity = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: velocityData.map(d => d.name),
                        datasets: [{
                            label: 'Tasks Completed',
                            data: velocityData.map(d => d.total),
                            backgroundColor: '#3b82f6',
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            title: {
                                display: true,
                                text: 'Sprint Velocity (Tasks per Sprint)'
                            }
                        },
                        scales: { y: { beginAtZero: true } }
                    }
                });
            }
        } catch (error) {
            console.error('Error rendering team velocity:', error);
        }
    }

    async renderOverdueTasks() {
        const container = document.getElementById('widget-overdueTasks');
        if (!container) return;

        try {
            const snapshot = await db.collection('tasks')
                .where('organizationId', '==', app.state.currentOrganization)
                .get();

            const tasks = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const overdueTasks = tasks.filter(t => {
                if (!t.dueDate || ['completed', 'archived'].includes(t.status)) return false;
                return getDaysOverdue(t.dueDate) > 0;
            }).sort((a, b) => getDaysOverdue(b.dueDate) - getDaysOverdue(a.dueDate));

            container.innerHTML = `
                <div class="overdue-list">
                    ${overdueTasks.length === 0 ? `
                        <div class="empty-state-small">
                            <i class="fas fa-check-circle" style="color: #10b981"></i>
                            <p>No overdue tasks! 🎉</p>
                        </div>
                    ` : overdueTasks.slice(0, 10).map(task => `
                        <div class="overdue-item" onclick="app.modules.ui.openTaskDetail('${task.id}')">
                            <div class="overdue-info">
                                <span class="overdue-title">${escapeHtml(task.title)}</span>
                                <span class="overdue-assignee">${escapeHtml(task.assignedTo || 'Unassigned')}</span>
                            </div>
                            <span class="overdue-days overdue-severity-${this.getOverdueSeverity(task.dueDate)}">
                                +${getDaysOverdue(task.dueDate)}d
                            </span>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering overdue tasks:', error);
        }
    }

    async renderRecentActivity() {
        const container = document.getElementById('widget-recentActivity');
        if (!container) return;

        try {
            const snapshot = await db.collection('activity_logs')
                .where('organizationId', '==', app.state.currentOrganization)
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();

            const activities = snapshot.docs.map(doc => doc.data());

            container.innerHTML = `
                <div class="activity-feed">
                    ${activities.map(activity => `
                        <div class="activity-item">
                            <i class="fas ${this.getActivityIcon(activity.action)}"></i>
                            <div class="activity-content">
                                <span class="activity-user">${escapeHtml(activity.userName)}</span>
                                <span class="activity-action">${this.formatActivityAction(activity)}</span>
                                <span class="activity-time">${this.formatTimeAgo(activity.createdAt)}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering recent activity:', error);
        }
    }

    async renderMilestoneProgress() {
        const container = document.getElementById('widget-milestoneProgress');
        if (!container) return;

        try {
            const snapshot = await db.collection('milestones')
                .where('organizationId', '==', app.state.currentOrganization)
                .orderBy('date', 'asc')
                .limit(10)
                .get();

            const milestones = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            const now = new Date();
            now.setHours(0, 0, 0, 0);

            container.innerHTML = `
                <div class="milestone-list">
                    ${milestones.map(milestone => {
                        const milestoneDate = new Date(milestone.date);
                        const daysUntil = Math.ceil((milestoneDate - now) / (1000 * 60 * 60 * 24));
                        const isPast = daysUntil < 0;
                        const isToday = daysUntil === 0;
                        
                        return `
                            <div class="milestone-item ${isPast ? 'past' : ''} ${isToday ? 'today' : ''}">
                                <div class="milestone-indicator" style="background: ${isPast ? '#ef4444' : isToday ? '#f59e0b' : '#3b82f6'}">
                                    <i class="fas fa-flag"></i>
                                </div>
                                <div class="milestone-content">
                                    <span class="milestone-name">${escapeHtml(milestone.name)}</span>
                                    <span class="milestone-date">
                                        ${isPast ? `${Math.abs(daysUntil)} days ago` : 
                                          isToday ? 'Today' : 
                                          `In ${daysUntil} days`}
                                    </span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering milestones:', error);
        }
    }

    getHealthColor(rate) {
        if (rate >= 80) return '#10b981';
        if (rate >= 50) return '#f59e0b';
        return '#ef4444';
    }

    getOverdueSeverity(dueDate) {
        const days = getDaysOverdue(dueDate);
        if (days > 7) return 'critical';
        if (days > 3) return 'high';
        if (days > 1) return 'medium';
        return 'low';
    }

    getActivityIcon(action) {
        const icons = {
            create_task: 'fa-plus-circle',
            update_task: 'fa-edit',
            delete_task: 'fa-trash',
            task_completed: 'fa-check-circle',
            comment_added: 'fa-comment',
            sprint_created: 'fa-calendar-plus',
            member_added: 'fa-user-plus'
        };
        return icons[action] || 'fa-info-circle';
    }

    formatActivityAction(activity) {
        switch (activity.action) {
            case 'create_task':
                return `created task "${activity.entityName}"`;
            case 'update_task':
                return `updated task "${activity.entityName}"`;
            case 'delete_task':
                return `deleted task "${activity.entityName}"`;
            case 'task_completed':
                return `completed task "${activity.entityName}"`;
            case 'comment_added':
                return `commented on "${activity.entityName}"`;
            default:
                return activity.action.replace(/_/g, ' ');
        }
    }

    formatTimeAgo(timestamp) {
        if (!timestamp?.toDate) return '';
        const now = new Date();
        const date = timestamp.toDate();
        const diff = Math.floor((now - date) / 1000);
        
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return formatDate(date);
    }

    setupDragAndDrop() {
        const container = document.getElementById('admin-widgets');
        if (!container) return;

        let draggedWidget = null;

        container.addEventListener('dragstart', (e) => {
            draggedWidget = e.target.closest('.admin-widget');
            if (draggedWidget) {
                draggedWidget.classList.add('dragging');
                e.dataTransfer.setData('text/plain', draggedWidget.dataset.widget);
            }
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.admin-widget');
            if (target && target !== draggedWidget) {
                const rect = target.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    container.insertBefore(draggedWidget, target);
                } else {
                    container.insertBefore(draggedWidget, target.nextSibling);
                }
            }
        });

        container.addEventListener('dragend', () => {
            if (draggedWidget) {
                draggedWidget.classList.remove('dragging');
                draggedWidget = null;
            }
            this.saveWidgetOrder();
        });
    }

    saveWidgetOrder() {
        const container = document.getElementById('admin-widgets');
        if (!container) return;

        const order = [];
        container.querySelectorAll('.admin-widget').forEach(widget => {
            order.push(widget.dataset.widget);
        });

        localStorage.setItem('oriental_widget_order', JSON.stringify(order));
    }

    loadWidgetOrder() {
        const saved = localStorage.getItem('oriental_widget_order');
        if (saved) {
            try {
                this.widgetOrder = JSON.parse(saved);
            } catch {
                this.widgetOrder = [];
            }
        }
    }

    resetWidgets() {
        localStorage.removeItem('oriental_widget_order');
        this.widgetOrder = [];
        this.render();
        showToast('Widget layout reset', 'success');
    }

    async refreshAll() {
        showToast('Refreshing widgets...', 'info');
        const widgetIds = [
            'projectPerformance', 'taskDistribution', 'teamVelocity',
            'overdueTasks', 'recentActivity', 'milestoneProgress'
        ];
        
        await Promise.all(widgetIds.map(id => this.updateWidget(id)));
        showToast('Widgets refreshed', 'success');
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.updateWidget('overdueTasks');
            this.updateWidget('recentActivity');
        }, 30000); // Refresh every 30 seconds
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    destroy() {
        this.stopAutoRefresh();
        Object.values(this.charts).forEach(chart => chart?.destroy());
    }
}