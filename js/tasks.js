/**
 * Oriental v3.0.0 - Task Manager
 * Handles task CRUD, subtasks, and task history
 */

class TaskManager {
    constructor() {
        this.currentTask = null;
        this.subtasks = [];
    }

    async createTask(taskData) {
        if (!app.state.currentProject) {
            showToast('Please select a project first', 'warning');
            return null;
        }

        try {
            const user = authManager.getCurrentUser();
            
            const task = {
                title: taskData.title,
                description: taskData.description || '',
                status: taskData.status || 'planned',
                priority: taskData.priority || 'medium',
                assignedToId: taskData.assignedToId || null,
                assignedTo: taskData.assignedTo || null,
                dueDate: taskData.dueDate || null,
                estimatedHours: parseFloat(taskData.estimatedHours) || 0,
                tags: taskData.tags || [],
                projectId: app.state.currentProject.id,
                organizationId: app.state.currentOrganization,
                createdBy: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                subtaskCount: 0,
                completedSubtasks: 0,
                progress: 0,
                order: Date.now()
            };

            const docRef = await db.collection('tasks').add(task);

            // Create task history
            await db.collection('task_history').add({
                taskId: docRef.id,
                action: 'created',
                changes: {
                    status: { from: null, to: task.status },
                    priority: { from: null, to: task.priority },
                    assignedTo: { from: null, to: task.assignedToId }
                },
                userId: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Log activity
            await this.logActivity('create_task', docRef.id, task.title, {
                assignedTo: task.assignedTo,
                priority: task.priority
            });

            // Create subtasks if provided
            if (taskData.subtasks?.length) {
                await this.createSubtasks(docRef.id, taskData.subtasks);
            }

            // Create milestone if provided
            if (taskData.milestone) {
                await app.modules.milestones.createTaskMilestone(
                    docRef.id,
                    taskData.milestone
                );
            }

            showToast('Task created successfully', 'success');
            
            // Refresh board and admin widgets
            await app.modules.board.render();
            app.modules.admin?.update();

            return docRef.id;

        } catch (error) {
            console.error('Error creating task:', error);
            showToast('Error creating task', 'error');
            return null;
        }
    }

    async updateTask(taskId, updates) {
        try {
            const taskRef = db.collection('tasks').doc(taskId);
            const taskDoc = await taskRef.get();
            
            if (!taskDoc.exists) {
                showToast('Task not found', 'error');
                return false;
            }

            const oldData = taskDoc.data();
            const changes = {};

            // Track changes for history
            for (const [key, value] of Object.entries(updates)) {
                if (key === 'tags' && Array.isArray(value)) {
                    if (JSON.stringify(value) !== JSON.stringify(oldData[key])) {
                        changes[key] = { from: oldData[key], to: value };
                    }
                } else if (value !== oldData[key]) {
                    changes[key] = { from: oldData[key], to: value };
                }
            }

            // Update task
            await taskRef.update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Record history
            if (Object.keys(changes).length > 0) {
                await db.collection('task_history').add({
                    taskId: taskId,
                    action: 'updated',
                    changes: changes,
                    userId: authManager.getCurrentUser().uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            // Log activity
            await this.logActivity('update_task', taskId, oldData.title, changes);

            showToast('Task updated', 'success');
            
            // Refresh views
            await app.modules.board.render();
            app.modules.admin?.update();

            return true;

        } catch (error) {
            console.error('Error updating task:', error);
            showToast('Error updating task', 'error');
            return false;
        }
    }

    async deleteTask(taskId) {
        try {
            const taskDoc = await db.collection('tasks').doc(taskId).get();
            if (!taskDoc.exists) {
                showToast('Task not found', 'error');
                return false;
            }

            const taskData = taskDoc.data();
            const batch = db.batch();

            // Delete subtasks
            const subtasksSnapshot = await db.collection('subtasks')
                .where('parentTaskId', '==', taskId)
                .get();
            subtasksSnapshot.forEach(doc => batch.delete(doc.ref));

            // Delete task history
            const historySnapshot = await db.collection('task_history')
                .where('taskId', '==', taskId)
                .get();
            historySnapshot.forEach(doc => batch.delete(doc.ref));

            // Delete comments
            const commentsSnapshot = await db.collection('comments')
                .where('taskId', '==', taskId)
                .get();
            commentsSnapshot.forEach(doc => batch.delete(doc.ref));

            // Delete task milestones
            const milestonesSnapshot = await db.collection('milestones')
                .where('taskId', '==', taskId)
                .get();
            milestonesSnapshot.forEach(doc => batch.delete(doc.ref));

            // Remove from sprints
            const sprintsSnapshot = await db.collection('sprints')
                .where('tasks', 'array-contains', taskId)
                .get();
            sprintsSnapshot.forEach(doc => {
                const tasks = doc.data().tasks.filter(id => id !== taskId);
                batch.update(doc.ref, { tasks });
            });

            // Delete task
            batch.delete(taskRef);

            await batch.commit();

            // Log activity
            await this.logActivity('delete_task', taskId, taskData.title, {});

            showToast('Task deleted', 'success');
            
            // Refresh views
            await app.modules.board.render();
            app.modules.admin?.update();
            app.modules.ui.closeAllModals();

            return true;

        } catch (error) {
            console.error('Error deleting task:', error);
            showToast('Error deleting task', 'error');
            return false;
        }
    }

    async createSubtasks(parentTaskId, subtasks) {
        const batch = db.batch();
        const user = authManager.getCurrentUser();

        for (let i = 0; i < subtasks.length; i++) {
            const subtask = subtasks[i];
            const subtaskRef = db.collection('subtasks').doc();
            
            batch.set(subtaskRef, {
                parentTaskId: parentTaskId,
                title: subtask.title,
                description: subtask.description || '',
                status: subtask.status || 'planned',
                assignedToId: subtask.assignedToId || null,
                assignedTo: subtask.assignedTo || null,
                projectId: app.state.currentProject.id,
                organizationId: app.state.currentOrganization,
                createdBy: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                order: i
            });
        }

        await batch.commit();

        // Update parent task
        await this.updateParentProgress(parentTaskId);

        showToast(`${subtasks.length} subtasks created`, 'success');
    }

    async updateSubtask(subtaskId, updates) {
        try {
            const subtaskRef = db.collection('subtasks').doc(subtaskId);
            const subtaskDoc = await subtaskRef.get();
            
            if (!subtaskDoc.exists) {
                showToast('Subtask not found', 'error');
                return false;
            }

            await subtaskRef.update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update parent progress if status changed
            if (updates.status) {
                await this.updateParentProgress(subtaskDoc.data().parentTaskId);
            }

            return true;
        } catch (error) {
            console.error('Error updating subtask:', error);
            return false;
        }
    }

    async deleteSubtask(subtaskId) {
        try {
            const subtaskDoc = await db.collection('subtasks').doc(subtaskId).get();
            const parentTaskId = subtaskDoc.data()?.parentTaskId;

            await subtaskRef.delete();

            if (parentTaskId) {
                await this.updateParentProgress(parentTaskId);
            }

            return true;
        } catch (error) {
            console.error('Error deleting subtask:', error);
            return false;
        }
    }

    async getSubtasks(parentTaskId) {
        try {
            const snapshot = await db.collection('subtasks')
                .where('parentTaskId', '==', parentTaskId)
                .orderBy('order', 'asc')
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error loading subtasks:', error);
            return [];
        }
    }

    async getTaskHistory(taskId) {
        try {
            const snapshot = await db.collection('task_history')
                .where('taskId', '==', taskId)
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error loading task history:', error);
            return [];
        }
    }

    async logActivity(action, taskId, taskTitle, details) {
        try {
            await db.collection('activity_logs').add({
                action: action,
                entityType: 'task',
                entityId: taskId,
                entityName: taskTitle,
                organizationId: app.state.currentOrganization,
                userId: authManager.getCurrentUser().uid,
                userName: authManager.getCurrentUser().displayName || authManager.getCurrentUser().email,
                details: details,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('Error logging activity:', error);
        }
    }

    async getTaskStats(projectId = null) {
        try {
            let query = db.collection('tasks');
            
            if (projectId) {
                query = query.where('projectId', '==', projectId);
            } else if (app.state.currentOrganization) {
                query = query.where('organizationId', '==', app.state.currentOrganization);
            }

            const snapshot = await query.get();
            const tasks = snapshot.docs.map(doc => doc.data());

            return {
                total: tasks.length,
                byStatus: {
                    planned: tasks.filter(t => t.status === 'planned').length,
                    started: tasks.filter(t => t.status === 'started').length,
                    stuck: tasks.filter(t => t.status === 'stuck').length,
                    review: tasks.filter(t => t.status === 'review').length,
                    completed: tasks.filter(t => t.status === 'completed').length,
                    archived: tasks.filter(t => t.status === 'archived').length
                },
                byPriority: {
                    high: tasks.filter(t => t.priority === 'high').length,
                    medium: tasks.filter(t => t.priority === 'medium').length,
                    low: tasks.filter(t => t.priority === 'low').length
                },
                overdue: tasks.filter(t => {
                    if (!t.dueDate || ['completed', 'archived'].includes(t.status)) return false;
                    return getDaysOverdue(t.dueDate) > 0;
                }).length,
                dueSoon: tasks.filter(t => {
                    if (!t.dueDate || ['completed', 'archived'].includes(t.status)) return false;
                    const days = getDaysOverdue(t.dueDate);
                    const daysUntil = Math.ceil(
                        (new Date(t.dueDate) - new Date()) / (1000 * 60 * 60 * 24)
                    );
                    return daysUntil >= 0 && daysUntil <= 2;
                }).length
            };
        } catch (error) {
            console.error('Error getting task stats:', error);
            return null;
        }
    }
}