/**
 * Oriental v3.0.0 - Milestone Manager
 * Project and task-level milestones with timeline view
 */

class MilestoneManager {
    constructor() {
        this.milestones = [];
        this.listeners = [];
    }

    async init() {
        await this.loadMilestones();
        this.setupRealtimeSubscription();
    }

    async loadMilestones(projectId = null) {
        const pid = projectId || app.state.currentProject?.id;
        if (!pid) return;

        try {
            const snapshot = await db.collection('milestones')
                .where('projectId', '==', pid)
                .orderBy('date', 'asc')
                .get();

            this.milestones = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            this.notifyListeners();
        } catch (error) {
            console.error('Error loading milestones:', error);
        }
    }

    async createMilestone(milestoneData) {
        if (!app.state.currentProject) {
            showToast('Please select a project first', 'warning');
            return null;
        }

        try {
            const milestone = {
                name: milestoneData.name,
                date: milestoneData.date,
                description: milestoneData.description || '',
                type: milestoneData.type || 'project', // 'project' or 'task'
                taskId: milestoneData.taskId || null,
                projectId: app.state.currentProject.id,
                organizationId: app.state.currentOrganization,
                createdBy: authManager.getCurrentUser().uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                completed: false,
                completedAt: null
            };

            const docRef = await db.collection('milestones').add(milestone);

            // Log activity
            await db.collection('activity_logs').add({
                action: 'milestone_created',
                entityType: 'milestone',
                entityId: docRef.id,
                entityName: milestone.name,
                organizationId: app.state.currentOrganization,
                userId: authManager.getCurrentUser().uid,
                userName: authManager.getCurrentUser().displayName || authManager.getCurrentUser().email,
                details: {
                    date: milestone.date,
                    type: milestone.type,
                    taskId: milestone.taskId
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast('Milestone created', 'success');
            await this.loadMilestones();
            
            return docRef.id;

        } catch (error) {
            console.error('Error creating milestone:', error);
            showToast('Error creating milestone', 'error');
            return null;
        }
    }

    async createTaskMilestone(taskId, milestoneData) {
        return this.createMilestone({
            ...milestoneData,
            type: 'task',
            taskId: taskId
        });
    }

    async updateMilestone(milestoneId, updates) {
        try {
            await db.collection('milestones').doc(milestoneId).update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            if (updates.completed) {
                await db.collection('milestones').doc(milestoneId).update({
                    completedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Log milestone completion
                const milestoneDoc = await db.collection('milestones').doc(milestoneId).get();
                const milestone = milestoneDoc.data();
                
                await db.collection('activity_logs').add({
                    action: 'milestone_completed',
                    entityType: 'milestone',
                    entityId: milestoneId,
                    entityName: milestone.name,
                    organizationId: app.state.currentOrganization,
                    userId: authManager.getCurrentUser().uid,
                    userName: authManager.getCurrentUser().displayName,
                    details: { 
                        completedDate: new Date().toISOString(),
                        type: milestone.type
                    },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            showToast('Milestone updated', 'success');
            await this.loadMilestones();

        } catch (error) {
            console.error('Error updating milestone:', error);
            showToast('Error updating milestone', 'error');
        }
    }

    async deleteMilestone(milestoneId) {
        try {
            const milestoneDoc = await db.collection('milestones').doc(milestoneId).get();
            const milestone = milestoneDoc.data();

            await db.collection('milestones').doc(milestoneId).delete();

            await db.collection('activity_logs').add({
                action: 'milestone_deleted',
                entityType: 'milestone',
                entityId: milestoneId,
                entityName: milestone.name,
                organizationId: app.state.currentOrganization,
                userId: authManager.getCurrentUser().uid,
                userName: authManager.getCurrentUser().displayName,
                details: {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast('Milestone deleted', 'success');
            await this.loadMilestones();

        } catch (error) {
            console.error('Error deleting milestone:', error);
            showToast('Error deleting milestone', 'error');
        }
    }

    getProjectMilestones() {
        return this.milestones.filter(m => m.type === 'project');
    }

    getTaskMilestones(taskId) {
        return this.milestones.filter(m => m.taskId === taskId);
    }

    getUpcomingMilestones(days = 7) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        const future = new Date(now);
        future.setDate(future.getDate() + days);

        return this.milestones.filter(m => {
            const milestoneDate = new Date(m.date);
            milestoneDate.setHours(0, 0, 0, 0);
            return milestoneDate >= now && milestoneDate <= future && !m.completed;
        });
    }

    getOverdueMilestones() {
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        return this.milestones.filter(m => {
            const milestoneDate = new Date(m.date);
            milestoneDate.setHours(0, 0, 0, 0);
            return milestoneDate < now && !m.completed;
        });
    }

    getMilestoneProgress() {
        const projectMilestones = this.getProjectMilestones();
        if (projectMilestones.length === 0) return { completed: 0, total: 0, percentage: 0 };

        const completed = projectMilestones.filter(m => m.completed).length;
        const total = projectMilestones.length;
        const percentage = Math.round((completed / total) * 100);

        return { completed, total, percentage };
    }

    renderTimeline() {
        const container = document.getElementById('milestone-timeline');
        if (!container) return;

        const milestones = [...this.milestones]
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        if (milestones.length === 0) {
            container.innerHTML = `
                <div class="empty-state-small">
                    <i class="fas fa-flag"></i>
                    <p>No milestones yet</p>
                    <button class="btn-primary btn-sm" onclick="app.modules.ui.openMilestoneModal()">
                        <i class="fas fa-plus"></i> Add Milestone
                    </button>
                </div>
            `;
            return;
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // Calculate timeline range
        const dates = milestones.map(m => new Date(m.date));
        const minDate = new Date(Math.min(...dates));
        minDate.setDate(minDate.getDate() - 7);
        const maxDate = new Date(Math.max(...dates));
        maxDate.setDate(maxDate.getDate() + 7);
        const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));

        container.innerHTML = `
            <div class="timeline-header">
                <h4><i class="fas fa-flag-checkered"></i> Project Timeline</h4>
                <button class="btn-secondary btn-sm" onclick="app.modules.ui.openMilestoneModal()">
                    <i class="fas fa-plus"></i> Add
                </button>
            </div>
            <div class="timeline-track">
                ${milestones.map(milestone => {
                    const milestoneDate = new Date(milestone.date);
                    const position = Math.round(((milestoneDate - minDate) / (maxDate - minDate)) * 100);
                    const isPast = milestoneDate < now;
                    const isToday = milestoneDate.toDateString() === now.toDateString();
                    const isCompleted = milestone.completed;
                    
                    let statusClass = 'future';
                    let statusIcon = 'fa-clock';
                    
                    if (isCompleted) {
                        statusClass = 'completed';
                        statusIcon = 'fa-check-circle';
                    } else if (isPast) {
                        statusClass = 'overdue';
                        statusIcon = 'fa-exclamation-circle';
                    } else if (isToday) {
                        statusClass = 'today';
                        statusIcon = 'fa-flag';
                    }

                    const daysUntil = Math.ceil((milestoneDate - now) / (1000 * 60 * 60 * 24));
                    const daysLabel = isCompleted ? 'Completed' :
                        isPast ? `${Math.abs(daysUntil)}d ago` :
                        isToday ? 'Today' :
                        `In ${daysUntil}d`;

                    return `
                        <div class="timeline-marker ${statusClass}" 
                             style="left: ${position}%"
                             title="${escapeHtml(milestone.name)} - ${formatDate(milestone.date)}">
                            <div class="marker-dot">
                                <i class="fas ${statusIcon}"></i>
                            </div>
                            <div class="marker-label">
                                <span class="marker-name">${escapeHtml(milestone.name)}</span>
                                <span class="marker-date">${daysLabel}</span>
                                ${milestone.type === 'task' ? '<span class="marker-type">Task</span>' : ''}
                            </div>
                            <div class="marker-line"></div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderMilestoneList() {
        const container = document.getElementById('milestone-list');
        if (!container) return;

        const upcoming = this.getUpcomingMilestones(14);
        const overdue = this.getOverdueMilestones();

        container.innerHTML = `
            ${overdue.length > 0 ? `
                <div class="milestone-section">
                    <h4 class="milestone-section-title overdue">
                        <i class="fas fa-exclamation-triangle"></i> Overdue (${overdue.length})
                    </h4>
                    ${overdue.map(m => this.renderMilestoneItem(m, 'overdue')).join('')}
                </div>
            ` : ''}
            
            ${upcoming.length > 0 ? `
                <div class="milestone-section">
                    <h4 class="milestone-section-title upcoming">
                        <i class="fas fa-calendar-alt"></i> Upcoming (${upcoming.length})
                    </h4>
                    ${upcoming.map(m => this.renderMilestoneItem(m, 'upcoming')).join('')}
                </div>
            ` : ''}
            
            ${overdue.length === 0 && upcoming.length === 0 ? `
                <div class="empty-state-small">
                    <i class="fas fa-check-circle" style="color: #10b981"></i>
                    <p>All milestones on track!</p>
                </div>
            ` : ''}
        `;
    }

    renderMilestoneItem(milestone, status) {
        const isTaskMilestone = milestone.type === 'task';
        const taskInfo = isTaskMilestone ? '• Task milestone' : '';
        const isPast = new Date(milestone.date) < new Date(new Date().setHours(0,0,0,0));
        
        return `
            <div class="milestone-item ${status} ${milestone.completed ? 'completed' : ''}" 
                 onclick="app.modules.ui.openMilestoneDetail('${milestone.id}')">
                <div class="milestone-status">
                    <i class="fas ${milestone.completed ? 'fa-check-circle' : isPast ? 'fa-exclamation-circle' : 'fa-clock'}"></i>
                </div>
                <div class="milestone-info">
                    <span class="milestone-name">${escapeHtml(milestone.name)}</span>
                    <span class="milestone-meta">
                        ${formatDate(milestone.date)} ${taskInfo}
                    </span>
                </div>
                <div class="milestone-actions">
                    ${!milestone.completed ? `
                        <button class="btn-icon" onclick="event.stopPropagation(); app.modules.milestones.completeMilestone('${milestone.id}')" title="Mark complete">
                            <i class="fas fa-check"></i>
                        </button>
                    ` : ''}
                    <button class="btn-icon" onclick="event.stopPropagation(); app.modules.milestones.deleteMilestone('${milestone.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    async completeMilestone(milestoneId) {
        const confirmed = await this.confirmDialog(
            'Complete Milestone',
            'Mark this milestone as completed?',
            'success'
        );
        
        if (confirmed) {
            await this.updateMilestone(milestoneId, { completed: true });
            showToast('Milestone completed! 🎉', 'success');
            
            // Trigger confetti if available
            if (typeof triggerConfetti === 'function') {
                triggerConfetti();
            }
        }
    }

    confirmDialog(title, message, type = 'danger') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'confirm-dialog-overlay';
            
            overlay.innerHTML = `
                <div class="confirm-dialog">
                    <h3>${escapeHtml(title)}</h3>
                    <p>${escapeHtml(message)}</p>
                    <div class="confirm-actions">
                        <button class="btn-secondary" id="confirm-cancel">Cancel</button>
                        <button class="btn-${type}" id="confirm-ok">Confirm</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            overlay.querySelector('#confirm-cancel').addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });
            
            overlay.querySelector('#confirm-ok').addEventListener('click', () => {
                overlay.remove();
                resolve(true);
            });
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            });
        });
    }

    setupRealtimeSubscription() {
        if (!app.state.currentProject) return;

        this.unsubscribe = db.collection('milestones')
            .where('projectId', '==', app.state.currentProject.id)
            .onSnapshot(() => {
                this.loadMilestones();
            });
    }

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    notifyListeners() {
        this.listeners.forEach(callback => {
            try {
                callback(this.milestones);
            } catch (error) {
                console.error('Milestone listener error:', error);
            }
        });
    }

    refresh() {
        this.loadMilestones();
    }

    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        this.listeners = [];
    }
}