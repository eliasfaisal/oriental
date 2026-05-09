/**
 * Oriental v3.0.0 - Role-Based Access Control
 * Manages roles, permissions, and seed data setup
 */

const ROLES = {
    admin: {
        name: 'Admin',
        icon: 'fa-crown',
        color: '#8b5cf6',
        badge: 'purple',
        viewType: 'overview'
    },
    manager: {
        name: 'Manager',
        icon: 'fa-briefcase',
        color: '#3b82f6',
        badge: 'blue',
        viewType: 'project'
    },
    team_lead: {
        name: 'Team Lead',
        icon: 'fa-users',
        color: '#10b981',
        badge: 'green',
        viewType: 'team'
    },
    member: {
        name: 'Member',
        icon: 'fa-user',
        color: '#6b7280',
        badge: 'gray',
        viewType: 'list'
    }
};

const PERMISSION_CATEGORIES = {
    organization: ['manage_organization', 'manage_members', 'manage_roles'],
    projects: ['create_projects', 'delete_projects'],
    tasks: ['create_tasks', 'edit_tasks', 'delete_tasks', 'assign_tasks'],
    visibility: ['view_all_tasks', 'view_team_tasks', 'view_assigned_tasks'],
    features: ['view_reports', 'manage_sprints', 'manage_templates', 'manage_milestones'],
    data: ['export_data']
};

class RolesManager {
    async setUserRole(userId, organizationId, role, assignedBy = null) {
        if (!ROLES[role]) throw new Error(`Invalid role: ${role}`);

        const existing = await db.collection('user_roles')
            .where('userId', '==', userId)
            .where('organizationId', '==', organizationId)
            .limit(1)
            .get();

        const roleData = {
            userId,
            organizationId,
            role,
            permissions: PERMISSIONS[role],
            assignedBy: assignedBy || 'system',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!existing.empty) {
            await existing.docs[0].ref.update(roleData);
        } else {
            roleData.assignedAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('user_roles').add(roleData);
        }

        // Update organization members
        await db.collection('organizations').doc(organizationId).update({
            members: firebase.firestore.FieldValue.arrayUnion(userId)
        });

        // Update user's organizations
        await db.collection('users').doc(userId).update({
            organizations: firebase.firestore.FieldValue.arrayUnion(organizationId)
        });

        return { success: true };
    }

    async getUserRole(userId, organizationId) {
        const snapshot = await db.collection('user_roles')
            .where('userId', '==', userId)
            .where('organizationId', '==', organizationId)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const data = snapshot.docs[0].data();
            return { ...data, ...ROLES[data.role], id: snapshot.docs[0].id };
        }

        return { role: 'member', permissions: PERMISSIONS.member, ...ROLES.member };
    }

    async getOrganizationMembers(organizationId) {
        const rolesSnapshot = await db.collection('user_roles')
            .where('organizationId', '==', organizationId)
            .get();

        const members = {};
        for (const doc of rolesSnapshot.docs) {
            const data = doc.data();
            const userDoc = await db.collection('users').doc(data.userId).get();
            if (userDoc.exists) {
                members[data.userId] = {
                    ...userDoc.data(),
                    role: data.role,
                    roleData: ROLES[data.role],
                    permissions: data.permissions
                };
            }
        }

        return members;
    }

    async canViewTask(userId, task, organizationId) {
        const role = await this.getUserRole(userId, organizationId);
        
        if (['admin', 'manager'].includes(role.role)) return true;
        if (role.role === 'team_lead') {
            const members = await this.getOrganizationMembers(organizationId);
            const teamMemberIds = Object.keys(members).filter(id => 
                members[id].role === 'member'
            );
            return task.assignedToId === userId || teamMemberIds.includes(task.assignedToId);
        }
        return task.assignedToId === userId;
    }

    getViewType(role) {
        return ROLES[role]?.viewType || 'list';
    }
}

const rolesManager = new RolesManager();