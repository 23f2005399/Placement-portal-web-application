/* Shared dashboard helpers + Student dashboard logic */

(function () {
  "use strict";

  // Small DOM helper to avoid repeating document.getElementById everywhere.
  function byId(id) {
    return document.getElementById(id);
  }

  // Toggle a class safely even if the element is missing.
  function toggleClass(el, className, force) {
    if (!el) return;
    if (typeof force === "boolean") {
      el.classList.toggle(className, force);
      return;
    }
    el.classList.toggle(className);
  }

  function toggleSidebar(sidebarId, overlayId) {
    toggleClass(byId(sidebarId), "open");
    toggleClass(byId(overlayId), "show");
  }

  function closeSidebar(sidebarId, overlayId) {
    toggleClass(byId(sidebarId), "open", false);
    toggleClass(byId(overlayId), "show", false);
  }

  // Basic HTML escaping for any user-supplied or API-supplied text injected into templates.
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function autoDismissBootstrapAlerts(delayMs) {
    var delay = Number(delayMs || 5000);
    setTimeout(function () {
      document.querySelectorAll(".alert").forEach(function (alertEl) {
        try {
          bootstrap.Alert.getOrCreateInstance(alertEl).close();
        } catch (e) {
          // Ignore if bootstrap alert plugin is unavailable on the page.
        }
      });
    }, delay);
  }

  // Attach click listeners for any sidebar/nav links that have data-section.
  function bindSectionLinks(linkSelector, onSelect) {
    document.querySelectorAll(linkSelector).forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        if (!link.dataset || !link.dataset.section) return;
        onSelect(link.dataset.section, link);
      });
    });
  }

  // Standard profile dropdown behavior shared across dashboards.
  function initProfileDropdown(triggerId, menuId, openClass) {
    var triggerEl = byId(triggerId);
    var menuEl = byId(menuId);
    var cls = openClass || "open";
    function open() {
      if (!triggerEl || !menuEl) return;
      menuEl.classList.add(cls);
      triggerEl.classList.add(cls);
    }
    function close() {
      if (!triggerEl || !menuEl) return;
      menuEl.classList.remove(cls);
      triggerEl.classList.remove(cls);
    }
    function toggle() {
      if (!triggerEl || !menuEl) return;
      var isOpen = menuEl.classList.contains(cls);
      close();
      if (!isOpen) open();
    }
    document.addEventListener("click", function (event) {
      if (!triggerEl || !menuEl) return;
      if (triggerEl.contains(event.target) || menuEl.contains(event.target)) return;
      close();
    });
    return { open: open, close: close, toggle: toggle };
  }

  window.DashboardUtils = {
    byId: byId,
    toggleSidebar: toggleSidebar,
    closeSidebar: closeSidebar,
    escapeHtml: escapeHtml,
    autoDismissBootstrapAlerts: autoDismissBootstrapAlerts,
    bindSectionLinks: bindSectionLinks,
    initProfileDropdown: initProfileDropdown,
  };
})();

/*
 * Student Dashboard Script
 * ------------------------
 * Beginner map:
 * 1) Section navigation + profile/menu controls
 * 2) Notifications + banners
 * 3) Search/filter helpers for drives, orgs, applications
 * 4) Detail modal openers for drives/applications
 */
const INITIAL_SECTION = (window.STUDENT_DASHBOARD_DATA && window.STUDENT_DASHBOARD_DATA.initialSection) || 'overview';
window._studentNotifs = Array.isArray(window.STUDENT_DASHBOARD_DATA?.notificationsSeed) ? window.STUDENT_DASHBOARD_DATA.notificationsSeed : [];
const DISMISSED_BROADCASTS_KEY = 'student_dismissed_broadcast_ids';
const SEEN_INTERVIEW_NOTIFS_KEY = 'student_seen_interview_notification_keys';

function getDismissedBroadcastIds() {
    try {
        const raw = JSON.parse(localStorage.getItem(DISMISSED_BROADCASTS_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw.map(x => String(x)) : []);
    } catch (e) {
        return new Set();
    }
}

function saveDismissedBroadcastIds(setObj) {
    try {
        localStorage.setItem(DISMISSED_BROADCASTS_KEY, JSON.stringify([...setObj]));
    } catch (e) {}
}

function dismissBroadcastBanner() {
    const banner = document.getElementById('broadcastBanner');
    if (!banner) return;
    const bId = banner.dataset.broadcastId ? String(banner.dataset.broadcastId) : '';
    if (bId) {
        const dismissed = getDismissedBroadcastIds();
        dismissed.add(bId);
        saveDismissedBroadcastIds(dismissed);
    }
    banner.style.display = 'none';
}

function applyBroadcastBannerDismissState() {
    const banner = document.getElementById('broadcastBanner');
    if (!banner) return;
    const bId = banner.dataset.broadcastId ? String(banner.dataset.broadcastId) : '';
    if (!bId) return;
    const dismissed = getDismissedBroadcastIds();
    if (dismissed.has(bId)) {
        banner.style.display = 'none';
    }
}

function getSeenInterviewNotifKeys() {
    try {
        const raw = JSON.parse(localStorage.getItem(SEEN_INTERVIEW_NOTIFS_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw.map(x => String(x)) : []);
    } catch (e) {
        return new Set();
    }
}

function saveSeenInterviewNotifKeys(setObj) {
    try {
        localStorage.setItem(SEEN_INTERVIEW_NOTIFS_KEY, JSON.stringify([...setObj]));
    } catch (e) {}
}

function getInterviewNotifKey(n) {
    if (!n) return '';
    if (n.key) return String(n.key);
    if (n.interview_schedule_id) return `interview_schedule_${n.interview_schedule_id}`;
    return '';
}

function dismissCelebrationBanner() {
    const banner = document.getElementById('celebrationBanner');
    if (!banner) return;
    banner.style.display = 'none';
}

/* ================================================
   NAVIGATION
================================================ */
function navigateToSection(section) {
    const target = document.getElementById(section + '-section') || document.getElementById('overview-section');
    const resolvedSection = target ? target.id.replace('-section', '') : 'overview';
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    target?.classList.add('active');
    document.querySelectorAll('.sidebar-nav-link').forEach(l => {
        l.classList.toggle('active', l.dataset.section === resolvedSection);
    });
    try { localStorage.setItem('student_dashboard_section', resolvedSection); } catch(e) {}
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('section', resolvedSection);
        window.history.replaceState({}, '', url.toString());
    } catch(e) {}
    closeSidebar();
    window.scrollTo({top: 0, behavior: 'smooth'});
}

// Wire sidebar navigation once with shared helper.
DashboardUtils.bindSectionLinks('.sidebar-nav-link[data-section]', function (section) {
    navigateToSection(section);
});

/* ================================================
   SIDEBAR MOBILE
================================================ */
function toggleSidebar() {
    DashboardUtils.toggleSidebar('sidebar','sidebarOverlay');
}
function closeSidebar() {
    DashboardUtils.closeSidebar('sidebar','sidebarOverlay');
}

/* ================================================
   PROFILE DROPDOWN
================================================ */
const studentProfileDropdown = DashboardUtils.initProfileDropdown('userPill', 'profileDropdown');
function toggleProfileDropdown() {
    studentProfileDropdown.toggle();
}

/* ================================================
   EDIT PROFILE SECTION NAVIGATION
================================================ */
function openEditProfileModal() {
    navigateToSection('edit-profile');
}

/* ================================================
   NOTIFICATION PANEL
================================================ */
let notifPanelOpen = false;
const _seedStudentNotifs = Array.isArray(window._studentNotifs) ? window._studentNotifs : [];
async function toggleNotifPanel() {
    notifPanelOpen = !notifPanelOpen;
    document.getElementById('notifPanel').classList.toggle('open', notifPanelOpen);
    if (notifPanelOpen) {
        if (!allStudentNotifs.length && _seedStudentNotifs.length) {
            allStudentNotifs = _seedStudentNotifs.slice().sort((a, b) => (b.sort_ts || 0) - (a.sort_ts || 0));
            renderNotifications(allStudentNotifs);
        }
        await loadNotifications();
        markAllRead(false);
    }
}
function closeNotifPanel() {
    notifPanelOpen = false;
    document.getElementById('notifPanel').classList.remove('open');
}

function openResumePreviewModal() {
    const modalEl = document.getElementById('resumePreviewModal');
    const frame = document.getElementById('resumePreviewModalFrame');
    if (!modalEl || !frame) return;
    if (!frame.getAttribute('src')) {
        frame.setAttribute('src', frame.dataset.src || '');
    }
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// Backward compatibility for any remaining inline calls.
function openBannerResumeModal() {
    openResumePreviewModal();
}

let allStudentNotifs = [];

async function markAllRead(reloadAfter = true) {
    try {
        await fetch('/api/student/notifications/mark-all-read', {
            method: 'POST',
            credentials: 'same-origin'
        });
        const seenInterviewKeys = getSeenInterviewNotifKeys();
        (allStudentNotifs || []).forEach(n => {
            if ((n.kind || 'notification') === 'interview') {
                const k = getInterviewNotifKey(n);
                if (k) seenInterviewKeys.add(k);
            }
        });
        saveSeenInterviewNotifKeys(seenInterviewKeys);
        if (!allStudentNotifs.length) return;
        allStudentNotifs = (allStudentNotifs || []).map(n => {
            if ((n.kind || 'notification') === 'notification') return { ...n, read: true };
            if ((n.kind || 'notification') === 'interview') return { ...n, read: true };
            return n;
        });
        renderNotifications(allStudentNotifs);
        if (reloadAfter) await loadNotifications();
    } catch (e) {
        console.log('Mark-all-read failed');
    }
}

async function loadNotifications() {
    try {
        const res = await fetch('/api/student/notifications', {
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const data = await res.json();
        const primaryItems = Array.isArray(data.items) ? data.items : [];
        const notifItems = Array.isArray(data.notifications) ? data.notifications : [];
        const interviewItems = Array.isArray(data.interviews) ? data.interviews : [];
        const broadcastItems = Array.isArray(data.broadcasts) ? data.broadcasts : [];
        const items = primaryItems.length
            ? primaryItems
            : (notifItems.length || interviewItems.length || broadcastItems.length)
                ? [...notifItems, ...interviewItems, ...broadcastItems]
                : [];
        const finalItems = items.length
            ? items
            : (_seedStudentNotifs.length ? _seedStudentNotifs.slice() : []);
        const seenInterviewKeys = getSeenInterviewNotifKeys();
        allStudentNotifs = finalItems.map(n => {
            if ((n.kind || 'notification') !== 'interview') return n;
            const k = getInterviewNotifKey(n);
            const seen = k ? seenInterviewKeys.has(k) : false;
            return { ...n, read: seen };
        }).sort((a, b) => (b.sort_ts || 0) - (a.sort_ts || 0));
        renderNotifications(allStudentNotifs);
    } catch(e) {
        console.log('Notification fetch failed');
        if (!allStudentNotifs.length && _seedStudentNotifs.length) {
            allStudentNotifs = _seedStudentNotifs.slice().sort((a, b) => (b.sort_ts || 0) - (a.sort_ts || 0));
            renderNotifications(allStudentNotifs);
        }
    }
}

function renderNotifications(notifs) {
    const body = document.getElementById('notifPanelBody');
    const panelItems = (notifs || []);
    const seenInterviewKeys = getSeenInterviewNotifKeys();
    if (!panelItems.length) {
        body.innerHTML = '<div class="notif-empty"><i class="bi bi-bell-slash"></i>No notifications yet</div>';
        document.getElementById('notifBadge').style.display = 'none';
        document.getElementById('notifCountLabel').style.display = 'none';
        return;
    }
    let unreadCount = 0;
    body.innerHTML = panelItems.map((n, idx) => {
        const kind = n.kind || 'notification';
        const isUnread = kind === 'notification'
            ? !Boolean(n.read)
            : kind === 'interview'
                ? !Boolean(n.read) && !seenInterviewKeys.has(getInterviewNotifKey(n))
                : false;
        if (isUnread) unreadCount++;
        const chipLabel = kind === 'interview'
            ? 'Interview'
            : kind === 'broadcast'
                ? 'Broadcast'
                : (n.type === 'drive' ? 'Drive' : 'Status');
        const chipCls = kind === 'interview'
            ? 'interview'
            : kind === 'broadcast'
                ? 'broadcast'
                : (n.type === 'drive' ? 'drive' : 'status');
        const subject = n.subject ? `<div class="notif-subject">${n.subject}</div>` : '';
        const actionLink = (n.kind === 'interview')
            ? `<a href="#" class="notif-action-link" data-view-details="${idx}">View Detail</a>`
            : '';
        return `<div class="notif-item ${isUnread ? 'unread' : ''}" data-key="${n.key || ''}" data-notif-idx="${idx}">
            <div class="notif-icon ${n.type || 'info'}"><i class="bi ${n.icon || 'bi-bell-fill'}"></i></div>
            <div class="notif-content">
                <div class="notif-row-top">
                    <span class="notif-chip ${chipCls}">${chipLabel}</span>
                    <span class="notif-time">${n.time || ''}</span>
                </div>
                ${subject}
                <div class="notif-text">${n.text || ''}</div>
                ${actionLink}
            </div>
        </div>`;
    }).join('');

    body.querySelectorAll('.notif-item').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            const idx = Number(el.dataset.notifIdx || 0);
            const n = panelItems[idx];
            if (!n) return;
            openNotificationTarget(n);
        });
    });
    body.querySelectorAll('[data-view-details]').forEach(el => {
        el.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const idx = Number(el.dataset.viewDetails || 0);
            const n = panelItems[idx];
            if (!n) return;
            openNotificationTarget(n);
        });
    });

    const badge = document.getElementById('notifBadge');
    const label = document.getElementById('notifCountLabel');
    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'flex';
        label.textContent = unreadCount;
        label.style.display = 'inline';
    } else {
        badge.style.display = 'none';
        label.style.display = 'none';
    }
}

function openNotificationTarget(n) {
    if (!n) return;
    if (n.section === 'applications' && n.open_app) {
        openAppDetailById(Number(n.open_app), false);
        closeNotifPanel();
        return;
    }
    if (n.section === 'drives' && n.open_drive) {
        navigateToSection('drives');
        openDriveDetailModal(Number(n.open_drive));
        closeNotifPanel();
        return;
    }
}


/* ================================================
   CHART.JS — DONUT
================================================ */
document.addEventListener('DOMContentLoaded', () => {
    applyBroadcastBannerDismissState();

    // Overview donut
    const ctx = document.getElementById('statusDonut');
    if (ctx && window._chartData) {
        const d = window._chartData;
        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Applied','Shortlisted','Interview','Placed','Rejected'],
                datasets: [{
                    data: [d.applied, d.shortlisted, d.interview||0, d.selected, d.rejected],
                    backgroundColor: ['#06b6d4','#f59e0b','#8b5cf6','#10b981','#ef4444'],
                    borderWidth: 0,
                    hoverOffset: 6
                }]
            },
            options: {
                cutout: '72%',
                plugins: { legend: { display: false }, tooltip: {
                    callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` }
                }},
                animation: { animateRotate: true, duration: 800 }
            }
        });
    }

    allStudentNotifs = [];
    loadNotifications();
    setInterval(loadNotifications, 30000);
});

/* ================================================
   QUICK SEARCH (OVERVIEW)
================================================ */
document.getElementById('quickSearch')?.addEventListener('input', function() {
    const q = this.value.toLowerCase().trim();
    let anyVisible = false;
    document.querySelectorAll('.quick-drive-item').forEach(item => {
        const matches = !q || item.dataset.title.includes(q) || item.dataset.company.includes(q);
        item.style.display = matches ? '' : 'none';
        if (matches) anyVisible = true;
    });
    document.getElementById('noQuickResults').style.display = (!anyVisible && q) ? 'block' : 'none';
});

/* ================================================
   DRIVE SEARCH
================================================ */
function filterDrives() {
    const q = (document.getElementById('driveSearch')?.value || '').toLowerCase().trim();
    document.querySelectorAll('.drive-filterable').forEach(card => {
        const position = card.dataset.position || card.dataset.title || '';
        const company = card.dataset.company || '';
        const skills = card.dataset.skills || '';
        const matchQ = !q
            || position.includes(q)
            || company.includes(q)
            || skills.includes(q);
        card.style.display = matchQ ? '' : 'none';
    });
}
document.getElementById('driveSearch')?.addEventListener('input', filterDrives);

/* ================================================
   ORGANIZATION SEARCH & FILTER
================================================ */
function filterOrgs() {
    const q = (document.getElementById('orgSearch')?.value || '').toLowerCase().trim();
    const sector = (document.getElementById('orgSectorFilter')?.value || '').toLowerCase();
    document.querySelectorAll('.org-filterable').forEach(card => {
        const matchQ = !q || card.dataset.name.includes(q);
        const matchSector = !sector || card.dataset.sector.includes(sector);
        card.style.display = (matchQ && matchSector) ? '' : 'none';
    });
}
document.getElementById('orgSearch')?.addEventListener('input', filterOrgs);
document.getElementById('orgSectorFilter')?.addEventListener('change', filterOrgs);

/* ================================================
   APPLICATION HISTORY SEARCH & FILTER
================================================ */
function filterApplications() {
    const q = (document.getElementById('appSearch')?.value || '').toLowerCase().trim();
    const status = (document.getElementById('appStatusFilter')?.value || '').toLowerCase();
    document.querySelectorAll('.app-table-row').forEach(row => {
        const matchQ = !q || row.dataset.company.includes(q) || row.dataset.title.includes(q);
        const matchS = !status || row.dataset.status === status;
        row.style.display = (matchQ && matchS) ? '' : 'none';
    });
}
document.getElementById('appSearch')?.addEventListener('input', filterApplications);
document.getElementById('appStatusFilter')?.addEventListener('change', filterApplications);

/* ================================================
   APPLICATION DETAIL MODAL
================================================ */
window.openAppDetailModal = function(row) {
    const d = row.dataset;
    const toTitleCase = (value) => (value || '')
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    document.getElementById('appModalTitle').textContent   = d.job;
    document.getElementById('appModalCompany').textContent = d.companyName + (d.industry ? ' · ' + d.industry : '');

    const status = d.status.toLowerCase();
    const icons  = {
        applied: '<i class="bi bi-send-check-fill"></i>',
        shortlisted: '<i class="bi bi-star-fill"></i>',
        selected: '<i class="bi bi-trophy-fill"></i>',
        rejected: '<i class="bi bi-x-octagon-fill"></i>',
        interview: '<i class="bi bi-camera-video-fill"></i>'
    };
    const banner = document.getElementById('appModalStatusBanner');
    banner.className = 'app-modal-status ' + status;
    document.getElementById('appModalStatusIcon').innerHTML = icons[status] || '<i class="bi bi-hourglass-split"></i>';
    document.getElementById('appModalStatusVal').textContent  = toTitleCase(d.status);
    document.getElementById('appModalDate').textContent       = 'Applied on ' + d.date;

    // Timeline
    const steps = ['applied','shortlisted','interview','selected'];
    const currentIdx = steps.indexOf(status === 'rejected' ? 'applied' : status);
    steps.forEach((s, i) => {
        const el = document.getElementById('tl-' + s);
        if (!el) return;
        el.className = 'tl-step';
        if (i < currentIdx) el.classList.add('done');
        else if (i === currentIdx && status !== 'rejected') el.classList.add('current');
    });

    const remarkEl = document.getElementById('appModalRemark');
    if (d.remark) {
        remarkEl.style.display = 'block';
        remarkEl.innerHTML = `<div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.4px;color:var(--amber);margin-bottom:6px;"><i class="bi bi-chat-quote-fill me-1"></i>Company Feedback</div><div style="font-size:0.875rem;color:var(--grey-700);">${d.remark}</div>`;
    } else { remarkEl.style.display = 'none'; }

    document.getElementById('appModalClosedNotice').style.display = d.driveStatus === 'Closed' ? 'flex' : 'none';

    const strip = document.getElementById('appModalMetaStrip');
    const mi = (label, val, color) => val ? `<div style="background:var(--grey-50);border-radius:10px;padding:0.9rem;">
        <div style="font-size:0.7rem;color:var(--grey-400);text-transform:uppercase;letter-spacing:0.4px;font-weight:700;margin-bottom:3px;">${label}</div>
        <div style="font-weight:700;font-size:0.875rem;${color?'color:'+color+';':''}">${val}</div></div>` : '';
    const salFormatted = d.salary ? '₹' + d.salary + ' LPA' : '';
    strip.innerHTML = mi('Package', salFormatted, 'var(--success)')
                    + mi('Location', d.location, '')
                    + mi('Eligibility', d.eligibility, '')
                    + mi('Deadline', d.deadline, d.driveStatus === 'Closed' ? 'var(--grey-400)' : 'var(--warning)');

    const skillsWrap = document.getElementById('appModalSkillsWrap');
    if (d.skills) {
        skillsWrap.style.display = 'block';
        document.getElementById('appModalSkills').innerHTML = d.skills.split(',').map(s => `<span class="skill-chip">${s.trim()}</span>`).join('');
    } else { skillsWrap.style.display = 'none'; }

    const descWrap = document.getElementById('appModalDescWrap');
    if (d.desc) { descWrap.style.display = 'block'; document.getElementById('appModalDesc').textContent = d.desc; }
    else { descWrap.style.display = 'none'; }

    const intWrap = document.getElementById('appModalInterviewWrap');
    if (d.selectionProcess) { intWrap.style.display = 'block'; document.getElementById('appModalInterview').textContent = d.selectionProcess; }
    else { intWrap.style.display = 'none'; }
    const cw = document.getElementById('appModalContactWrap');
    let ch = '';
    if (d.website) ch += `<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;"><i class="bi bi-globe" style="color:var(--accent);"></i><div><div style="font-size:0.7rem;color:var(--grey-400);font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Website</div><a href="${d.website}" target="_blank" style="color:var(--accent);font-weight:600;text-decoration:none;">${d.website}</a></div></div>`;
    cw.style.display = ch ? 'flex' : 'none';
    cw.innerHTML = ch;

    new bootstrap.Modal(document.getElementById('appDetailModal')).show();
};

window.openAppDetailById = function(appId, stayOnCurrentSection, evt) {
    if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
    }
    const keepCurrentSection = Boolean(stayOnCurrentSection);
    const row = document.querySelector(`.app-table-row[data-app-id="${appId}"]`);
    if (!row) return;
    if (!keepCurrentSection) {
        navigateToSection('applications');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => openAppDetailModal(row), 150);
    return false;
};

window.openDriveDetailModal = function(driveId) {
    navigateToSection('drives');
    const modalEl = document.getElementById(`driveModal${driveId}`);
    if (modalEl) {
        setTimeout(() => new bootstrap.Modal(modalEl).show(), 150);
        return;
    }
    const card = document.querySelector(`.drive-filterable[data-drive-id="${driveId}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

async function markDriveAsViewed(driveId) {
    const quickItems = document.querySelectorAll(`.quick-drive-item[data-drive-id="${driveId}"]`);
    quickItems.forEach(el => el.classList.remove('unread-drive'));
    try {
        await fetch(`/api/student/drive/${driveId}/mark-viewed`, {
            method: 'POST',
            credentials: 'same-origin'
        });
    } catch (e) {
        console.log('Mark drive viewed failed');
    }
}

window.openOverviewDriveDetail = function(driveId, appId, evt) {
    if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
    }
    navigateToSection('overview');
    markDriveAsViewed(driveId);
    const modalEl = document.getElementById(`driveModal${driveId}`);
    if (modalEl) {
        // Drive modals are rendered in the drives section; move to body so they can open from Overview.
        if (modalEl.parentElement !== document.body) {
            document.body.appendChild(modalEl);
        }
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        return false;
    }
    if (appId) {
        const row = document.querySelector(`.app-table-row[data-app-id="${appId}"]`);
        if (row) {
            openAppDetailModal(row);
            return false;
        }
    }
    const quickItem = document.querySelector(`.quick-drive-item[data-drive-id="${driveId}"]`);
    quickItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
};

window.openDriveFromOrgModal = function(triggerEl, driveId) {
    const parentModalEl = triggerEl ? triggerEl.closest('.modal') : null;
    if (!parentModalEl) {
        openDriveDetailModal(driveId);
        return;
    }
    const parentModal = bootstrap.Modal.getInstance(parentModalEl);
    if (!parentModal) {
        openDriveDetailModal(driveId);
        return;
    }
    parentModalEl.addEventListener('hidden.bs.modal', function onHidden() {
        parentModalEl.removeEventListener('hidden.bs.modal', onHidden);
        openDriveDetailModal(driveId);
    });
    parentModal.hide();
};


/* ================================================
   GLOBAL SEARCH
================================================ */
(function() {
    const searchInput = document.getElementById('globalSearchInput');
    const searchClear = document.getElementById('globalSearchClear');
    const dropdown    = document.getElementById('searchDropdown');
    const searchWrap  = document.getElementById('globalSearchWrap');
    if (!searchInput) return;

    function buildIndex() {
        const drives = [], companies = [];
        document.querySelectorAll('.drive-filterable').forEach(card => {
            const titleEl = card.querySelector('.drive-job-title');
            if (!titleEl) return;
            drives.push({
                type:'drive',
                id: card.dataset.driveId || '',
                title: titleEl.textContent.trim(),
                company: card.dataset.company || '',
                industry: card.dataset.industry || '',
                skills: card.dataset.skills || '',
                raw: ((card.dataset.title || '') + ' ' + (card.dataset.company || '') + ' ' + (card.dataset.location || '') + ' ' + (card.dataset.industry || '') + ' ' + (card.dataset.skills || '')).toLowerCase()
            });
        });
        document.querySelectorAll('.org-filterable').forEach(card => {
            const nameEl = card.querySelector('.company-card-name');
            if (!nameEl) return;
            const modalId = card.dataset.bsTarget?.replace('#','');
            companies.push({ type:'company', name:nameEl.textContent.trim(), industry:card.dataset.industry||'', modalId, raw:(nameEl.textContent+' '+(card.dataset.industry||'')).toLowerCase() });
        });
        return { drives, companies };
    }

    let idx = { drives: [], companies: [] };
    setTimeout(() => { idx = buildIndex(); }, 500);

    function hl(text, term) {
        if (!term) return text;
        return text.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark style="background:rgba(37,99,235,0.15);color:var(--accent);border-radius:3px;padding:0 2px;">$1</mark>');
    }

    function renderDropdown(term) {
        const t = term.toLowerCase().trim();
        if (!t) { hideDropdown(); return; }
        const scoredDrives = idx.drives.map(d => {
            let score = 0;
            if ((d.title || '').toLowerCase().includes(t)) score += 5;
            if ((d.company || '').toLowerCase().includes(t)) score += 4;
            if ((d.skills || '').toLowerCase().includes(t)) score += 6;
            if ((d.industry || '').toLowerCase().includes(t)) score += 2;
            if (!score && d.raw.includes(t)) score = 1;
            return { d, score };
        }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);
        const mDrives = scoredDrives.map(x => x.d).slice(0,5);
        const mCos = idx.companies.filter(c => c.raw.includes(t)).slice(0,3);
        if (!mDrives.length && !mCos.length) {
            dropdown.innerHTML = `<div class="sd-empty"><i class="bi bi-search"></i>No results for "<strong>${term}</strong>"</div>`;
            showDropdown(); return;
        }
        let html = '';
        if (mDrives.length) {
            html += `<div class="sd-section-label"><i class="bi bi-briefcase-fill me-1"></i>Placement Drives</div>`;
            mDrives.forEach(d => {
                const skillHint = d.skills ? `<div class="sd-item-sub"><i class="bi bi-tools me-1"></i>${hl(d.skills.split(',').slice(0,4).join(', '), term)}</div>` : '';
                html += `<div class="sd-item" onclick="openDriveSearchResult(${JSON.stringify(d.id)}, ${JSON.stringify(term)})"><div class="sd-item-icon drive"><i class="bi bi-briefcase-fill"></i></div><div><div class="sd-item-title">${hl(d.title,term)}</div><div class="sd-item-sub">${hl(d.company,term)}</div>${skillHint}</div></div>`;
            });
        }
        if (mCos.length) {
            html += `<div class="sd-section-label"><i class="bi bi-buildings me-1"></i>Companies</div>`;
            mCos.forEach(c => { html += `<div class="sd-item" onclick="navigateToSection('organizations')"><div class="sd-item-icon company"><i class="bi bi-buildings"></i></div><div><div class="sd-item-title">${hl(c.name,term)}</div><div class="sd-item-sub">${c.industry}</div></div></div>`; });
        }
        dropdown.innerHTML = html;
        showDropdown();
    }

    function showDropdown() { dropdown.classList.add('visible'); }
    function hideDropdown() { dropdown.classList.remove('visible'); }

    window.openDriveSearchResult = function(driveId, term) {
        navigateToSection('drives');
        const driveSearch = document.getElementById('driveSearch');
        if (driveSearch) {
            driveSearch.value = term || '';
            filterDrives();
        }
        if (driveId) {
            const card = document.querySelector(`.drive-filterable[data-drive-id="${driveId}"]`);
            if (card) card.scrollIntoView({ behavior:'smooth', block:'center' });
        }
        hideDropdown();
    };

    window.clearGlobalSearch = function() { searchInput.value=''; searchClear.style.display='none'; hideDropdown(); searchInput.focus(); };
    searchInput.addEventListener('input', function() { searchClear.style.display = this.value ? 'block' : 'none'; renderDropdown(this.value); });
    searchInput.addEventListener('keydown', e => { if (e.key==='Escape') clearGlobalSearch(); });
    document.addEventListener('click', e => { if (!searchWrap.contains(e.target)) hideDropdown(); });
})();


/* ================================================
   INITIAL SECTION RESTORE
================================================ */
if (INITIAL_SECTION) {
    navigateToSection(INITIAL_SECTION);
} else {
    try {
        const saved = localStorage.getItem('student_dashboard_section');
        if (saved) navigateToSection(saved);
    } catch(e) {}
}

/* Auto-dismiss flash alerts */
DashboardUtils.autoDismissBootstrapAlerts(5000);
