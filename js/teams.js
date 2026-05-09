/**
 * Oriental v3.0.0 - Team Manager
 * Members, invites, and role management
 */

class TeamManager {
    constructor() {
        this.members = [];
        this.pendingInvites = [];
        this.listeners = [];
    }

    async loadMembers() {
        if (!app.state.currentOrganization) return;

        try {
            // Load organization members from user_roles
            const rolesSnapshot = await db.collection('user_roles')
                .where('organizationId', '==', app.state.currentOrganization)
                .get();

            const memberMap = {};
            
            for (const doc of rolesSnapshot.docs) {
                const roleData = doc.data();
                const userDoc = await db.collection('users').doc(roleData.userId).get();
                
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    memberMap[roleData.userId] = {
                        id: roleData.userId,
                        name: userData.name || userData.email,
                        email: userData.email,
                        role: roleData.role,
                        roleData: ROLES[roleData.role],
                        permissions: roleData.permissions,
                        joinedAt: roleData.assignedAt?.toDate() || new Date()
                    };
                }
            }

            // Also include members from organization document
            const orgDoc = await db.collection('organizations')
                .doc(app.state.currentOrganization)
                .get();

            if (orgDoc.exists) {
                const orgMembers = orgDoc.data().members || [];
                
                for (const memberId of orgMembers) {
                    if (!memberMap[memberId]) {
                        const userDoc = await db.collection('users').doc(memberId).get();
                        if (userDoc.exists) {
                            const userData = userDoc.data();
                            memberMap[memberId] = {
                                id: memberId,
                                name: userData.name || userData.email,
                                email: userData.email,
                                role: 'member',
                                roleData: ROLES.member,
                                permissions: PERMISSIONS.member,
                                joinedAt: new Date()
                            };
                        }
                    }
                }
            }

            this.members = Object.values(memberMap);
            this.notifyListeners('members');

        } catch (error) {
            console.error('Error loading team members:', error);
        }
    }

    async loadPendingInvites() {
        if (!app.state.currentOrganization) return;

        try {
            const snapshot = await db.collection('invites')
                .where('organizationId', '==', app.state.currentOrganization)
                .where('status', '==', 'pending')
                .orderBy('createdAt', 'desc')
                .get();

            this.pendingInvites = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            this.notifyListeners('invites');

        } catch (error) {
            console.error('Error loading invites:', error);
        }
    }

    async sendInvite(email, role = 'member') {
        if (!app.state.currentOrganization) {
            showToast('No organization selected', 'error');
            return false;
        }

        // Check if already a member
        const existingMember = this.members.find(m => 
            m.email?.toLowerCase() === email.toLowerCase()
        );
        
        if (existingMember) {
            showToast(`${existingMember.name} is already a member`, 'warning');
            return false;
        }

        // Check for existing pending invite
        const existingInvite = this.pendingInvites.find(i => 
            i.email?.toLowerCase() === email.toLowerCase()
        );
        
        if (existingInvite) {
            showToast('Invitation already sent to this email', 'warning');
            return false;
        }

        try {
            const token = this.generateToken();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            const orgDoc = await db.collection('organizations')
                .doc(app.state.currentOrganization)
                .get();
            const orgName = orgDoc.data()?.name || 'Organization';

            await db.collection('invites').add({
                email: email.toLowerCase(),
                organizationId: app.state.currentOrganization,
                organizationName: orgName,
                role: role,
                invitedBy: authManager.getCurrentUser().uid,
                invitedByName: authManager.getCurrentUser().displayName || authManager.getCurrentUser().email,
                token: token,
                status: 'pending',
                expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Log activity
            await db.collection('activity_logs').add({
                action: 'invite_sent',
                entityType: 'invite',
                entityId: email,
                entityName: email,
                organizationId: app.state.currentOrganization,
                userId: authManager.getCurrentUser().uid,
                userName: authManager.getCurrentUser().displayName,
                details: { role: role },
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Send email via EmailJS
            await this.sendInviteEmail(email, orgName, role, token);

            showToast(`Invitation sent to ${email}`, 'success');
            await this.loadPendingInvites();
            
            return true;

        } catch (error) {
            console.error('Error sending invite:', error);
            showToast('Error sending invitation', 'error');
            return false;
        }
    }

    async cancelInvite(inviteId) {
        try {
            await db.collection('invites').doc(inviteId).update({
                status: 'cancelled',
                cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast('Invitation cancelled', 'success');
            await this.loadPendingInvites();

        } catch (error) {
            console.error('Error cancelling invite:', error);
            showToast('Error cancelling invitation', 'error');
        }
    }

    async changeMemberRole(userId, newRole) {
        if (!ROLES[newRole]) {
            showToast('Invalid role', 'error');
            return false;
        }

        try {
            await rolesManager.setUserRole(
                userId,
                app.state.currentOrganization,
                newRole,
                authManager.getCurrentUser().uid
            );

            // Log activity
            const userDoc = await db.collection('users').doc(userId).get();
            const userName = userDoc.data()?.name || 'User';

            await db.collection('activity_logs').add({
                action: 'role_changed',
                entityType: 'user_role',
                entityId: userId,
                entityName: userName,
                organizationId: app.state.currentOrganization,
                userId: authManager.getCurrentUser().uid,
                userName: authManager.getCurrentUser().displayName,
                details: { 
                    newRole: newRole,
                    previousRole: this.getMemberRole(userId)
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast(`Role changed to ${ROLES[newRole].name}`, 'success');
            await this.loadMembers();

            return true;

        } catch (error) {
            console.error('Error changing role:', error);
            showToast('Error changing role', 'error');
            return false;
        }
    }

    async removeMember(userId) {
        try {
            // Remove from organization members
            await db.collection('organizations')
                .doc(app.state.currentOrganization)
                .update({
                    members: firebase.firestore.FieldValue.arrayRemove(userId)
                });

            // Remove role
            const roleQuery = await db.collection('user_roles')
                .where('userId', '==', userId)
                .where('organizationId', '==', app.state.currentOrganization)
                .limit(1)
                .get();

            if (!roleQuery.empty) {
                await roleQuery.docs[0].ref.delete();
            }

            // Update user's organizations
            await db.collection('users').doc(userId).update({
                organizations: firebase.firestore.FieldValue.arrayRemove(app.state.currentOrganization)
            });

            // Get user name for logging
            const userDoc = await db.collection('users').doc(userId).get();
            const userName = userDoc.data()?.name || 'User';

            // Log activity
            await db.collection('activity_logs').add({
                action: 'member_removed',
                entityType: 'user',
                entityId: userId,
                entityName: userName,
                organizationId: app.state.currentOrganization,
                userId: authManager.getCurrentUser().uid,
                userName: authManager.getCurrentUser().displayName,
                details: {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast('Member removed', 'success');
            await this.loadMembers();

            return true;

        } catch (error) {
            console.error('Error removing member:', error);
            showToast('Error removing member', 'error');
            return false;
        }
    }

    getMemberRole(userId) {
        const member = this.members.find(m => m.id === userId);
        return member?.role || 'member';
    }

    getCurrentUserRole() {
        return app.state.userRole;
    }

    canManageTeam() {
        return authManager.hasPermission('manage_members');
    }

    getAssignableMembers() {
        return this.members.filter(m => 
            !['member'].includes(m.role) || m.id === authManager.getCurrentUser().uid
        );
    }

    async sendInviteEmail(email, orgName, role, token) {
        try {
            const inviteLink = `${window.location.origin}/accept-invite.html?token=${token}`;
            
            await emailjs.send('service_oriental', 'team_invite', {
                to_email: email,
                to_name: email.split('@')[0],
                organization_name: orgName,
                role: ROLES[role]?.name || role,
                inviter_name: authManager.getCurrentUser().displayName || authManager.getCurrentUser().email,
                invite_link: inviteLink,
                expires_in: '7 days'
            });

            console.log('📧 Invite email sent to:', email);
        } catch (error) {
            console.error('Error sending invite email:', error);
            // Non-critical error, don't throw
        }
    }

    generateToken() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15) +
               Date.now().toString(36);
    }

    renderTeamList() {
        const container = document.getElementById('team-members-list');
        if (!container) return;

        if (this.members.length === 0) {
            container.innerHTML = `
                <div class="empty-state-small">
                    <i class="fas fa-users"></i>
                    <p>No team members yet</p>
                </div>
            `;
            return;
        }

        const canManage = this.canManageTeam();

        container.innerHTML = `
            <div class="team-list">
                ${this.members.map(member => `
                    <div class="team-member-card">
                        <div class="member-avatar" style="background: ${member.roleData?.color || '#6b7280'}20">
                            <span style="color: ${member.roleData?.color || '#6b7280'}">
                                ${(member.name || member.email).charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div class="member-info">
                            <span class="member-name">${escapeHtml(member.name || member.email)}</span>
                            <span class="member-email">${escapeHtml(member.email)}</span>
                            <span class="member-role" style="background: ${member.roleData?.color || '#6b7280'}20; color: ${member.roleData?.color || '#6b7280'}">
                                ${member.roleData?.name || member.role}
                            </span>
                        </div>
                        ${canManage && member.id !== authManager.getCurrentUser().uid ? `
                            <div class="member-actions">
                                <button class="btn-icon" onclick="app.modules.ui.openRoleChangeModal('${member.id}')" title="Change role">
                                    <i class="fas fa-user-cog"></i>
                                </button>
                                <button class="btn-icon danger" onclick="app.modules.teams.removeMember('${member.id}')" title="Remove member">
                                    <i class="fas fa-user-minus"></i>
                                </button>
                            </div>
                        ` : ''}
                        ${member.id === authManager.getCurrentUser().uid ? `
                            <span class="member-badge">You</span>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderPendingInvites() {
        const container = document.getElementById('pending-invites-list');
        if (!container) return;

        if (this.pendingInvites.length === 0) {
            container.innerHTML = `
                <div class="empty-state-small">
                    <i class="fas fa-envelope"></i>
                    <p>No pending invites</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="invites-list">
                ${this.pendingInvites.map(invite => {
                    const expiresAt = invite.expiresAt?.toDate();
                    const isExpired = expiresAt && expiresAt < new Date();
                    
                    return `
                        <div class="invite-card ${isExpired ? 'expired' : ''}">
                            <div class="invite-email">
                                <i class="fas fa-envelope"></i>
                                ${escapeHtml(invite.email)}
                            </div>
                            <div class="invite-details">
                                <span class="invite-role">${ROLES[invite.role]?.name || invite.role}</span>
                                <span class="invite-date">
                                    Sent ${formatDate(invite.createdAt?.toDate())}
                                </span>
                            </div>
                            <div class="invite-status">
                                ${isExpired ? 
                                    '<span class="badge-danger">Expired</span>' : 
                                    '<span class="badge-warning">Pending</span>'
                                }
                            </div>
                            <button class="btn-icon danger" onclick="app.modules.teams.cancelInvite('${invite.id}')" title="Cancel invite">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    notifyListeners(type) {
        this.listeners.forEach(callback => {
            try {
                callback(type, type === 'members' ? this.members : this.pendingInvites);
            } catch (error) {
                console.error('Team listener error:', error);
            }
        });
    }

    refresh() {
        this.loadMembers();
        this.loadPendingInvites();
    }
}