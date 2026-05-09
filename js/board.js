/**
 * Oriental v3.0.0 - Board Manager
 * Collapsible kanban board with new task states
 */

class BoardManager {
    constructor() {
        this.tasks = [];
        this.collapsedColumns = new Set();
        this.draggedTask = null;
        this.filters = {
            search: '',
            priorities: [],
            assignees: [],
            tags: []
        };
    }

    async render() {
        const project = app.state.currentProject;
        if (!project) {
            this.showEmptyState();
            return;
        }

        try {
            // Load tasks based on user role
            const role = app.state.userRole;
            let query = db.collection('tasks')
                .where('projectId', '==', project.id);

            // Filter tasks based on role
            if (role.role === 'member') {
                query = query.where('assignedToId', '==', authManager.getCurrentUser().uid);
            } else if (role.role === 'team_lead') {
                const members = await rolesManager.getOrganizationMembers(
                    app.state.currentOrganization
                );
                const teamMemberIds = [authManager.getCurrentUser().uid, 
                    ...Object.keys(members).filter(id => members[id].role === 'member')];
                query = query.where('assignedToId', 'in', teamMemberIds);
            }

            const snapshot = await query.orderBy('order', 'asc').get();
            this.tasks = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            this.renderBoard();
        } catch (error) {
            console.error('Error loading board tasks:', error);
            showToast('Error loading tasks', 'error');
        }
    }

    renderBoard() {
        const boardView = document.getElementById('board-view');
        if (!boardView) return;

        // Task states (columns)
        const states = ['planned', 'started', 'stuck', 'review', 'completed', 'archived'];
        
        boardView.innerHTML = `
            <div class="board-scroll">
                ${states.map(state => this.renderColumn(state)).join('')}
            </div>
        `;

        // Setup drag and drop
        this.setupDragAndDrop();
        
        // Setup column collapse
        this.setupColumnCollapse();

        // Load subtasks for each task
        this.loadSubtasks();
    }

    renderColumn(state) {
        const stateTasks = this.tasks.filter(t => t.status === state);
        const isCollapsed = this.collapsedColumns.has(state);
        
        return `
            <div class="board-column" data-state="${state}">
                <div class="column-header" onclick="app.modules.board.toggleColumn('${state}')">
                    <div class="column-header-left">
                        <i class="fas ${getTaskStateIcon(state)}" style="color: ${getTaskStateColor(state)}"></i>
                        <span class="column-title">${getTaskStateLabel(state)}</span>
                        <span class="column-count">${stateTasks.length}</span>
                    </div>
                    <button class="column-collapse-btn">
                        <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}"></i>
                    </button>
                </div>
                <div class="tasks-container ${isCollapsed ? 'collapsed' : ''}" data-state="${state}">
                    ${stateTasks.map(task => this.renderTaskCard(task)).join('')}
                    ${stateTasks.length === 0 ? this.renderEmptyColumn() : ''}
                </div>
            </div>
        `;
    }

    renderTaskCard(task) {
        const daysOverdue = getDaysOverdue(task.dueDate);
        const overdueBadge = daysOverdue > 0 && task.status !== 'completed' && task.status !== 'archived' 
            ? `<span class="overdue-badge" title="${daysOverdue} days overdue">+${daysOverdue}</span>` 
            : '';
        
        const priorityColor = getPriorityColor(task.priority);
        const hasSubtasks = task.subtaskCount > 0;
        
        // Check if due date is approaching
        const dueDateWarning = this.getDueDateWarning(task.dueDate, task.status);
        
        return `
            <div class="task-card ${dueDateWarning}" 
                 draggable="true" 
                 data-task-id="${task.id}" 
                 data-state="${task.status}"
                 onclick="app.modules.ui.openTaskDetail('${task.id}')">
                
                <div class="task-card-header">
                    <span class="priority-dot" style="background: ${priorityColor}"></span>
                    <span class="task-title">${this.highlightSearch(escapeHtml(task.title))}</span>
                    ${overdueBadge}
                </div>
                
                ${task.description ? `
                    <div class="task-description">
                        ${escapeHtml(task.description.substring(0, 80))}${task.description.length > 80 ? '...' : ''}
                    </div>
                ` : ''}
                
                <div class="task-card-footer">
                    <div class="task-meta">
                        ${task.dueDate ? `
                            <span class="task-due-date ${daysOverdue > 0 ? 'overdue' : ''}">
                                <i class="fas fa-calendar-alt"></i>
                                ${formatDate(task.dueDate)}
                                ${overdueBadge}
                            </span>
                        ` : ''}
                        
                        <span class="task-assignee">
                            <i class="fas fa-user"></i>
                            ${escapeHtml(task.assignedTo || 'Unassigned')}
                        </span>
                        
                        ${hasSubtasks ? `
                            <span class="task-subtasks">
                                <i class="fas fa-list-check"></i>
                                ${task.completedSubtasks || 0}/${task.subtaskCount}
                            </span>
                        ` : ''}
                    </div>
                    
                    ${task.tags?.length ? `
                        <div class="task-tags">
                            ${task.tags.slice(0, 2).map(tag => 
                                `<span class="task-tag">${escapeHtml(tag)}</span>`
                            ).join('')}
                            ${task.tags.length > 2 ? 
                                `<span class="task-tag-more">+${task.tags.length - 2}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderEmptyColumn() {
        return `
            <div class="empty-column-state">
                <i class="fas fa-inbox"></i>
                <p>No tasks</p>
            </div>
        `;
    }

    getDueDateWarning(dueDate, status) {
        if (!dueDate || ['completed', 'archived'].includes(status)) return '';
        
        const daysOverdue = getDaysOverdue(dueDate);
        if (daysOverdue > 0) return 'overdue';
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        
        const daysUntilDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        if (daysUntilDue <= 2) return 'due-soon';
        
        return '';
    }

    highlightSearch(text) {
        if (!this.filters.search) return text;
        const regex = new RegExp(`(${this.filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark class="search-highlight">$1</mark>');
    }

    async loadSubtasks() {
        for (const task of this.tasks) {
            if (task.subtaskCount) continue; // Already loaded
            
            const subtasksSnapshot = await db.collection('subtasks')
                .where('parentTaskId', '==', task.id)
                .get();
            
            task.subtaskCount = subtasksSnapshot.size;
            task.completedSubtasks = subtasksSnapshot.docs.filter(
                d => d.data().status === 'completed'
            ).length;
        }
        
        // Re-render to show subtask counts
        this.renderBoard();
    }

    toggleColumn(state) {
        if (this.collapsedColumns.has(state)) {
            this.collapsedColumns.delete(state);
        } else {
            this.collapsedColumns.add(state);
        }
        this.renderBoard();
    }

    setupColumnCollapse() {
        document.querySelectorAll('.column-header').forEach(header => {
            const state = header.parentElement.dataset.state;
            if (this.collapsedColumns.has(state)) {
                header.parentElement.querySelector('.tasks-container').classList.add('collapsed');
            }
        });
    }

    setupDragAndDrop() {
        const taskCards = document.querySelectorAll('.task-card');
        const containers = document.querySelectorAll('.tasks-container');

        taskCards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                this.draggedTask = card;
                card.classList.add('dragging');
                e.dataTransfer.setData('text/plain', card.dataset.taskId);
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                this.draggedTask = null;
            });
        });

        containers.forEach(container => {
            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                container.classList.add('drag-over');
            });

            container.addEventListener('dragleave', () => {
                container.classList.remove('drag-over');
            });

            container.addEventListener('drop', async (e) => {
                e.preventDefault();
                container.classList.remove('drag-over');
                
                const taskId = e.dataTransfer.getData('text/plain');
                const newState = container.dataset.state;
                
                if (taskId && newState) {
                    await this.moveTask(taskId, newState);
                }
            });
        });
    }

    async moveTask(taskId, newState) {
        try {
            const taskRef = db.collection('tasks').doc(taskId);
            const taskDoc = await taskRef.get();
            const oldState = taskDoc.data()?.status;

            await taskRef.update({
                status: newState,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Record in task history
            await db.collection('task_history').add({
                taskId: taskId,
                action: 'status_change',
                changes: {
                    status: { from: oldState, to: newState }
                },
                userId: authManager.getCurrentUser().uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update parent task progress if subtask
            if (taskDoc.data()?.parentTaskId) {
                await this.updateParentProgress(taskDoc.data().parentTaskId);
            }

            showToast(`Task moved to ${getTaskStateLabel(newState)}`, 'success');
            
            // Refresh board
            await this.render();
            
            // Update admin widgets
            app.modules.admin?.update();

        } catch (error) {
            console.error('Error moving task:', error);
            showToast('Error moving task', 'error');
        }
    }

    async updateParentProgress(parentTaskId) {
        const subtasksSnapshot = await db.collection('subtasks')
            .where('parentTaskId', '==', parentTaskId)
            .get();

        const total = subtasksSnapshot.size;
        const completed = subtasksSnapshot.docs.filter(
            d => d.data().status === 'completed'
        ).length;

        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

        await db.collection('tasks').doc(parentTaskId).update({
            subtaskCount: total,
            completedSubtasks: completed,
            progress: progress,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    applyFilters(filters) {
        this.filters = { ...this.filters, ...filters };
        this.renderBoard();
    }

    showEmptyState() {
        document.getElementById('board-view').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard-list"></i>
                <h3>No project selected</h3>
                <p>Select or create a project to get started</p>
                <button class="btn-primary" onclick="app.modules.ui.openProjectModal()">
                    <i class="fas fa-plus"></i> Create Project
                </button>
            </div>
        `;
    }
}