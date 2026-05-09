/**
 * Oriental v3.0.0 - Authentication Module
 * Handles auth with role loading and permission checking
 */

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.userRoles = new Map();
        this.listeners = [];
    }

    async init() {
        return new Promise((resolve) => {
            auth.onAuthStateChanged(async (user) => {
                this.currentUser = user;
                if (user) {
                    await this.loadUserRoles();
                    this.notifyListeners(true);
                } else {
                    this.userRoles.clear();
                    this.notifyListeners(false);
                }
                resolve(user);
            });
        });
    }

    async login(email, password) {
        try {
            const result = await auth.signInWithEmailAndPassword(email, password);
            await this.loadUserRoles();
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: this.getError(error.code) };
        }
    }

    async loginWithGoogle() {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await auth.signInWithPopup(provider);
            await this.ensureUserDocument(result.user);
            await this.loadUserRoles();
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: this.getError(error.code) };
        }
    }

    async signup(email, password, name) {
        try {
            const result = await auth.createUserWithEmailAndPassword(email, password);
            await result.user.updateProfile({ displayName: name });
            await this.ensureUserDocument(result.user, name);
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: this.getError(error.code) };
        }
    }

    async logout() {
        await auth.signOut();
        this.currentUser = null;
        this.userRoles.clear();
        window.location.href = 'login.html';
    }

    async ensureUserDocument(user, name = null) {
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (!userDoc.exists) {
            await db.collection('users').doc(user.uid).set({
                name: name || user.displayName || user.email.split('@')[0],
                email: user.email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                organizations: [],
                currentOrganization: null,
                preferences: {
                    theme: 'system',
                    language: 'en',
                    notifications: {
                        email: true,
                        taskAssigned: true,
                        commentMention: true
                    }
                }
            });
        }
    }

    async loadUserRoles(orgId = null) {
        if (!this.currentUser) return;
        
        const organizationId = orgId || this.currentUser.userData?.currentOrganization;
        if (!organizationId) return;

        try {
            const roleDoc = await db.collection('user_roles')
                .where('userId', '==', this.currentUser.uid)
                .where('organizationId', '==', organizationId)
                .limit(1)
                .get();

            if (!roleDoc.empty) {
                const roleData = roleDoc.docs[0].data();
                this.userRoles.set(organizationId, roleData);
            } else {
                // Default member role
                this.userRoles.set(organizationId, {
                    role: 'member',
                    permissions: PERMISSIONS.member
                });
            }
        } catch (error) {
            console.error('Error loading roles:', error);
        }
    }

    hasPermission(permission, orgId = null) {
        const organizationId = orgId || this.currentUser?.userData?.currentOrganization;
        if (!organizationId || !this.userRoles.has(organizationId)) return false;
        
        const role = this.userRoles.get(organizationId);
        return role.permissions?.includes(permission) || false;
    }

    getRole(orgId = null) {
        const organizationId = orgId || this.currentUser?.userData?.currentOrganization;
        return this.userRoles.get(organizationId)?.role || 'member';
    }

    getCurrentUser() {
        return this.currentUser;
    }

    onAuthChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    notifyListeners(isAuthenticated) {
        this.listeners.forEach(cb => cb(isAuthenticated, this.currentUser));
    }

    getError(code) {
        const messages = {
            'auth/invalid-email': 'Invalid email format',
            'auth/user-not-found': 'No account found',
            'auth/wrong-password': 'Incorrect password',
            'auth/email-already-in-use': 'Email already registered',
            'auth/weak-password': 'Password too weak (min 6 characters)',
            'auth/popup-blocked': 'Popup was blocked by browser'
        };
        return messages[code] || 'Authentication failed';
    }
}

// Permission definitions
const PERMISSIONS = {
    admin: [
        'manage_organization', 'manage_members', 'manage_roles',
        'create_projects', 'delete_projects',
        'create_tasks', 'edit_tasks', 'delete_tasks', 'assign_tasks',
        'view_all_tasks', 'view_reports', 'manage_sprints',
        'manage_templates', 'manage_milestones', 'export_data'
    ],
    manager: [
        'create_projects', 'delete_projects',
        'create_tasks', 'edit_tasks', 'delete_tasks', 'assign_tasks',
        'view_all_tasks', 'view_reports', 'manage_sprints',
        'manage_milestones', 'export_data'
    ],
    team_lead: [
        'create_tasks', 'edit_tasks', 'assign_tasks',
        'view_team_tasks', 'view_reports', 'manage_sprints'
    ],
    member: [
        'create_tasks', 'edit_tasks', 'view_assigned_tasks'
    ]
};

const authManager = new AuthManager();