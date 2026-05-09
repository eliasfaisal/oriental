/**
 * Oriental v3.0.0 - Seed Data Generator
 * Creates test data for development and testing
 */

class SeedGenerator {
    async createSeedData() {
        console.log('🌱 Creating seed data...');
        
        const user = auth.currentUser;
        if (!user) {
            console.error('No authenticated user');
            return false;
        }

        try {
            // 1. Create organization
            const orgRef = await db.collection('organizations').add({
                name: 'Acme Corp',
                slug: 'acme-corp',
                createdBy: user.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                members: [user.uid],
                admins: [user.uid],
                settings: {
                    defaultView: 'board',
                    theme: 'light',
                    inviteExpiry: 7
                }
            });

            const orgId = orgRef.id;
            console.log('✅ Organization created:', orgId);

            // 2. Set current user as admin
            await db.collection('user_roles').add({
                userId: user.uid,
                organizationId: orgId,
                role: 'admin',
                permissions: PERMISSIONS.admin,
                assignedBy: 'system',
                assignedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update user document
            await db.collection('users').doc(user.uid).update({
                currentOrganization: orgId,
                organizations: firebase.firestore.FieldValue.arrayUnion(orgId)
            });

            // 3. Create seed users with different roles
            const seedUsers = [
                { name: 'Sarah Manager', email: 'sarah@acme.com', role: 'manager' },
                { name: 'Tom Lead', email: 'tom@acme.com', role: 'team_lead' },
                { name: 'Alice Member', email: 'alice@acme.com', role: 'member' },
                { name: 'Bob Member', email: 'bob@acme.com', role: 'member' },
                { name: 'Carol Member', email: 'carol@acme.com', role: 'member' }
            ];

            console.log('👥 Creating seed users...');
            
            for (const seedUser of seedUsers) {
                // Create user document (without Firebase Auth)
                const userRef = await db.collection('users').add({
                    name: seedUser.name,
                    email: seedUser.email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    organizations: [orgId],
                    currentOrganization: orgId,
                    isSeedData: true
                });

                // Assign role
                await db.collection('user_roles').add({
                    userId: userRef.id,
                    organizationId: orgId,
                    role: seedUser.role,
                    permissions: PERMISSIONS[seedUser.role],
                    assignedBy: user.uid,
                    assignedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Add to organization members
                await orgRef.update({
                    members: firebase.firestore.FieldValue.arrayUnion(userRef.id)
                });
            }

            console.log('✅ Seed users created');

            // 4. Create projects
            const projects = [
                {
                    name: 'Website Redesign',
                    description: 'Complete overhaul of company website with modern design',
                    color: '#8b5cf6'
                },
                {
                    name: 'Mobile App v2',
                    description: 'New version of the mobile application with enhanced features',
                    color: '#3b82f6'
                },
                {
                    name: 'API Platform',
                    description: 'Build the core API platform for integrations',
                    color: '#10b981'
                },
                {
                    name: 'DevOps Pipeline',
                    description: 'Set up CI/CD pipeline and infrastructure',
                    color: '#f59e0b'
                }
            ];

            console.log('📁 Creating projects...');
            const projectRefs = [];
            
            for (const project of projects) {
                const projectRef = await db.collection('projects').add({
                    ...project,
                    organizationId: orgId,
                    createdBy: user.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    isArchived: false,
                    memberCount: 0
                });
                projectRefs.push(projectRef);
            }

            console.log('✅ Projects created');

            // 5. Create tasks with new states
            const taskStates = ['planned', 'started', 'stuck', 'review', 'completed'];
            const priorities = ['high', 'medium', 'low'];
            const assigneeIds = [user.uid];
            
            // Get seed user IDs
            const usersSnapshot = await db.collection('users')
                .where('organizations', 'array-contains', orgId)
                .get();
            usersSnapshot.forEach(doc => {
                if (doc.id !== user.uid) assigneeIds.push(doc.id);
            });

            console.log('📝 Creating tasks...');
            
            for (const projectRef of projectRefs) {
                const taskCount = 5 + Math.floor(Math.random() * 10); // 5-15 tasks per project
                
                for (let i = 0; i < taskCount; i++) {
                    const state = taskStates[Math.floor(Math.random() * taskStates.length)];
                    const priority = priorities[Math.floor(Math.random() * priorities.length)];
                    const assigneeId = assigneeIds[Math.floor(Math.random() * assigneeIds.length)];
                    
                    // Create due date (some in past, some in future)
                    const daysOffset = Math.floor(Math.random() * 20) - 10; // -10 to +10 days
                    const dueDate = new Date();
                    dueDate.setDate(dueDate.getDate() + daysOffset);
                    
                    const taskData = {
                        title: this.getRandomTaskTitle(),
                        description: this.getRandomTaskDescription(),
                        status: state,
                        priority: priority,
                        assignedToId: assigneeId,
                        assignedTo: (await db.collection('users').doc(assigneeId).get()).data()?.name || 'Unknown',
                        dueDate: dueDate.toISOString().split('T')[0],
                        estimatedHours: Math.floor(Math.random() * 40) + 2,
                        tags: this.getRandomTags(),
                        projectId: projectRef.id,
                        organizationId: orgId,
                        createdBy: user.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        order: i,
                        isSeedData: true
                    };

                    const taskRef = await db.collection('tasks').add(taskData);

                    // Add task history
                    await this.createTaskHistory(taskRef.id, taskData, user.uid);

                    // Create subtasks for some tasks
                    if (i % 3 === 0) { // Every third task gets subtasks
                        await this.createSubtasks(taskRef.id, projectRef.id, orgId, assigneeIds, user.uid);
                    }

                    // Create milestones for some tasks
                    if (i % 5 === 0) { // Every fifth task gets a milestone
                        await this.createMilestone(taskRef.id, projectRef.id, orgId, user.uid);
                    }
                }

                // Create project milestones
                await this.createProjectMilestones(projectRef.id, orgId, user.uid);
            }

            console.log('✅ Tasks created');

            // 6. Create sprints
            console.log('🏃 Creating sprints...');
            await this.createSprints(projectRefs[0].id, orgId, user.uid);

            // 7. Create sample activities
            console.log('📜 Creating activity logs...');
            await this.createActivityLogs(orgId, user.uid);

            console.log('🎉 Seed data created successfully!');
            
            return { success: true, organizationId: orgId };

        } catch (error) {
            console.error('Error creating seed data:', error);
            return { success: false, error: error.message };
        }
    }

    async createSubtasks(parentTaskId, projectId, organizationId, assigneeIds, createdBy) {
        const subtaskCount = 2 + Math.floor(Math.random() * 3); // 2-4 subtasks
        
        for (let i = 0; i < subtaskCount; i++) {
            const assigneeId = assigneeIds[Math.floor(Math.random() * assigneeIds.length)];
            const userDoc = await db.collection('users').doc(assigneeId).get();
            
            await db.collection('subtasks').add({
                parentTaskId: parentTaskId,
                title: `Subtask ${i + 1}: ${this.getRandomSubtaskTitle()}`,
                description: 'Subtask description',
                status: ['planned', 'started', 'completed'][Math.floor(Math.random() * 3)],
                assignedToId: assigneeId,
                assignedTo: userDoc.data()?.name || 'Unknown',
                projectId: projectId,
                organizationId: organizationId,
                createdBy: createdBy,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                order: i,
                isSeedData: true
            });
        }
    }

    async createMilestone(taskId, projectId, organizationId, createdBy) {
        const milestoneDate = new Date();
        milestoneDate.setDate(milestoneDate.getDate() + Math.floor(Math.random() * 30));
        
        await db.collection('milestones').add({
            name: `Milestone for task`,
            date: milestoneDate.toISOString().split('T')[0],
            description: 'Key milestone for task completion',
            taskId: taskId,
            projectId: projectId,
            organizationId: organizationId,
            createdBy: createdBy,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            isSeedData: true
        });
    }

    async createProjectMilestones(projectId, organizationId, createdBy) {
        const milestones = [
            { name: 'Phase 1 Launch', days: 15, description: 'Initial feature set deployment' },
            { name: 'Phase 2 Release', days: 45, description: 'Second phase with enhanced features' },
            { name: 'Production Go-Live', days: 90, description: 'Full production deployment' }
        ];

        for (const milestone of milestones) {
            const date = new Date();
            date.setDate(date.getDate() + milestone.days);
            
            await db.collection('milestones').add({
                name: milestone.name,
                date: date.toISOString().split('T')[0],
                description: milestone.description,
                projectId: projectId,
                organizationId: organizationId,
                createdBy: createdBy,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isSeedData: true
            });
        }
    }

    async createSprints(projectId, organizationId, createdBy) {
        // Active sprint
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 5);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 9);

        const sprintRef = await db.collection('sprints').add({
            name: 'Sprint 1 - Core Features',
            goal: 'Complete core feature set and initial testing',
            organizationId: organizationId,
            projectId: projectId,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            status: 'active',
            tasks: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            isSeedData: true
        });

        // Add some tasks to sprint
        const tasksSnapshot = await db.collection('tasks')
            .where('projectId', '==', projectId)
            .limit(5)
            .get();

        const taskIds = tasksSnapshot.docs.map(d => d.id);
        await sprintRef.update({ tasks: taskIds });

        // Completed sprint
        const pastStart = new Date();
        pastStart.setDate(pastStart.getDate() - 25);
        const pastEnd = new Date();
        pastEnd.setDate(pastEnd.getDate() - 12);

        await db.collection('sprints').add({
            name: 'Sprint 0 - Setup',
            goal: 'Project setup and initial architecture',
            organizationId: organizationId,
            projectId: projectId,
            startDate: pastStart.toISOString().split('T')[0],
            endDate: pastEnd.toISOString().split('T')[0],
            status: 'completed',
            tasks: [],
            completedAt: firebase.firestore.Timestamp.fromDate(pastEnd),
            createdAt: firebase.firestore.Timestamp.fromDate(pastStart),
            isSeedData: true
        });
    }

    async createActivityLogs(organizationId, userId) {
        const activities = [
            { action: 'create_task', entityType: 'task', entityName: 'Design homepage' },
            { action: 'assign_task', entityType: 'task', entityName: 'API integration' },
            { action: 'comment_added', entityType: 'comment', entityName: 'Feature discussion' },
            { action: 'task_started', entityType: 'task', entityName: 'Database setup' },
            { action: 'task_completed', entityType: 'task', entityName: 'Login page' },
            { action: 'sprint_created', entityType: 'sprint', entityName: 'Sprint 1' },
            { action: 'milestone_reached', entityType: 'milestone', entityName: 'Phase 1 Launch' },
            { action: 'member_added', entityType: 'user', entityName: 'Sarah Manager' }
        ];

        for (let i = activities.length - 1; i >= 0; i--) {
            const activity = activities[i];
            const timestamp = new Date();
            timestamp.setHours(timestamp.getHours() - i);

            await db.collection('activity_logs').add({
                ...activity,
                organizationId: organizationId,
                userId: userId,
                userName: 'Admin User',
                details: {},
                createdAt: firebase.firestore.Timestamp.fromDate(timestamp),
                isSeedData: true
            });
        }
    }

    async createTaskHistory(taskId, taskData, userId) {
        await db.collection('task_history').add({
            taskId: taskId,
            action: 'created',
            changes: {
                status: { from: null, to: taskData.status },
                priority: { from: null, to: taskData.priority },
                assignedTo: { from: null, to: taskData.assignedToId }
            },
            userId: userId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            isSeedData: true
        });
    }

    getRandomTaskTitle() {
        const titles = [
            'Design user dashboard',
            'Implement authentication flow',
            'Create API endpoints',
            'Set up database schema',
            'Write unit tests',
            'Optimize database queries',
            'Add responsive layouts',
            'Fix navigation bug',
            'Update documentation',
            'Code review pull request',
            'Deploy staging environment',
            'Performance optimization',
            'Security audit',
            'User testing session',
            'Integrate payment gateway',
            'Build notification system',
            'Create onboarding flow',
            'Refactor legacy code',
            'Add search functionality',
            'Implement caching layer'
        ];
        return titles[Math.floor(Math.random() * titles.length)];
    }

    getRandomTaskDescription() {
        const descriptions = [
            'Complete implementation with unit tests and documentation',
            'Need to discuss approach with the team before starting',
            'High priority feature for the upcoming release',
            'Includes both frontend and backend work',
            'Customer reported issue that needs investigation',
            'Part of the Q2 roadmap deliverables',
            'Requires coordination with design team',
            'Performance-critical component'
        ];
        return descriptions[Math.floor(Math.random() * descriptions.length)];
    }

    getRandomSubtaskTitle() {
        const subtasks = [
            'Setup database tables',
            'Create API endpoints',
            'Design UI components',
            'Write tests',
            'Update documentation',
            'Code review',
            'Integration testing',
            'Deploy to staging'
        ];
        return subtasks[Math.floor(Math.random() * subtasks.length)];
    }

    getRandomTags() {
        const allTags = ['frontend', 'backend', 'bug', 'feature', 'improvement', 
                        'documentation', 'testing', 'security', 'performance', 'ui'];
        const count = 1 + Math.floor(Math.random() * 3);
        return shuffleArray(allTags).slice(0, count);
    }

    async clearSeedData() {
        const collections = ['tasks', 'subtasks', 'milestones', 'task_history', 
                           'projects', 'sprints', 'activity_logs', 'user_roles'];
        
        for (const collection of collections) {
            const snapshot = await db.collection(collection)
                .where('isSeedData', '==', true)
                .get();
            
            const batch = db.batch();
            snapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            console.log(`Cleared ${snapshot.size} documents from ${collection}`);
        }

        // Clear seed users
        const usersSnapshot = await db.collection('users')
            .where('isSeedData', '==', true)
            .get();
        
        const batch = db.batch();
        usersSnapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        console.log('✅ Seed data cleared');
    }
}

const seedGenerator = new SeedGenerator();