/**
 * Oriental v3.0.0 - Utility Functions
 */

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span>${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    document.body.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function getDaysOverdue(dueDate) {
    if (!dueDate) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    
    const diff = today - due;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
}

function getTaskStateLabel(state) {
    const labels = {
        planned: 'Planned',
        started: 'Started',
        stuck: 'Stuck',
        review: 'In Review',
        completed: 'Completed',
        archived: 'Archived'
    };
    return labels[state] || state;
}

function getTaskStateIcon(state) {
    const icons = {
        planned: 'fa-circle',
        started: 'fa-play-circle',
        stuck: 'fa-exclamation-triangle',
        review: 'fa-eye',
        completed: 'fa-check-circle',
        archived: 'fa-archive'
    };
    return icons[state] || 'fa-circle';
}

function getTaskStateColor(state) {
    const colors = {
        planned: '#9ca3af',
        started: '#3b82f6',
        stuck: '#ef4444',
        review: '#f59e0b',
        completed: '#10b981',
        archived: '#6b7280'
    };
    return colors[state] || '#9ca3af';
}

function getPriorityColor(priority) {
    const colors = {
        high: '#ef4444',
        medium: '#f59e0b',
        low: '#10b981'
    };
    return colors[priority] || '#6b7280';
}

function generateId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}