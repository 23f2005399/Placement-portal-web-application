/* Shared dashboard helpers + Company dashboard logic */

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
 * Company Dashboard Script
 * ------------------------
 * Beginner map:
 * 1) Navigation + modal helpers
 * 2) Drive create/edit/review flows
 * 3) Search/filter views + notifications
 * 4) Analytics charts and page initialization
 */
/* ================================================
   SECTION NAVIGATION
================================================ */
function navigateToSection(name) {
    document.querySelectorAll('.content-section').forEach(function(s){ s.classList.remove('active'); });
    var target = document.getElementById(name + '-section');
    if (target) target.classList.add('active');
    document.querySelectorAll('.sidebar-nav-link[data-section]').forEach(function(l){ l.classList.remove('active'); });
    var link = document.querySelector('.sidebar-nav-link[data-section="' + name + '"]');
    if (link) link.classList.add('active');
    closeSidebar(); closeProfileDropdown();
    window.scrollTo(0, 0);
    try {
        localStorage.setItem('company_dashboard_section', name);
        var url = new URL(window.location.href);
        url.searchParams.set('section', name);
        url.searchParams.delete('open_drive');
        url.searchParams.delete('open_app');
        window.history.replaceState({}, '', url.toString());
    } catch(e) {}
    if (name === 'analytics') initCharts();
    if (name === 'broadcasts') clearNotifNumberOnly();
    if (name === 'broadcasts') markNotificationsSeen();
    if (name === 'broadcasts') markBroadcastsRead();
    if (name === 'active-drives') applyPreferredActiveDriveView();
}
DashboardUtils.bindSectionLinks('.sidebar-nav-link[data-section]', function (section) {
    navigateToSection(section);
});

/* ================================================
   SIDEBAR
================================================ */
function toggleSidebar(){ DashboardUtils.toggleSidebar('sidebar','sidebarOverlay'); }
function closeSidebar(){ DashboardUtils.closeSidebar('sidebar','sidebarOverlay'); }

/* ================================================
   PROFILE DROPDOWN
================================================ */
var companyProfileDropdown = DashboardUtils.initProfileDropdown('userPill', 'profileDropdown');
function toggleProfileDropdown(){ companyProfileDropdown.toggle(); }
function closeProfileDropdown(){ companyProfileDropdown.close(); }

/* ================================================
   MODAL SYSTEM
================================================ */
function openModal(id){ var el = document.getElementById(id); if (!el) return; el.classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeModal(id){ var el = document.getElementById(id); if (!el) return; el.classList.remove('show'); document.body.style.overflow = ''; }
function handleOverlayClick(e, id){ if (e.target === document.getElementById(id)) closeModal(id); }
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.show').forEach(function(m){ closeModal(m.id); }); });

/* ================================================
   FORM VALIDATION
================================================ */
function validateForm(formEl){
    var valid = true;
    formEl.querySelectorAll('[required]').forEach(function(field){
        var isEmpty = !field.value.trim();
        var tooShort = field.minLength && field.value.trim().length < field.minLength;
        if (isEmpty || tooShort){ field.classList.add('is-invalid'); valid = false; }
        else { field.classList.remove('is-invalid'); }
    });
    return valid;
}

/* ================================================
   CREATE DRIVE
================================================ */
function openCreateDriveModal(){
    var today = new Date().toISOString().split('T')[0];
    document.getElementById('cd_deadline').min = today;
    document.getElementById('cd_publish_date').min = today;
    toggleCreatePublishScheduleRequired();
    closeProfileDropdown();
    openModal('createDriveOverlay');
}
function toggleCreatePublishScheduleRequired(){
    var immediateEl = document.getElementById('cd_publish_immediately');
    var dateEl = document.getElementById('cd_publish_date');
    var timeEl = document.getElementById('cd_publish_time');
    if(!immediateEl || !dateEl || !timeEl) return;
    var immediate = !!immediateEl.checked;
    dateEl.required = !immediate;
    timeEl.required = !immediate;
    dateEl.disabled = immediate;
    timeEl.disabled = immediate;
    if(immediate){
        dateEl.value = '';
        timeEl.value = '';
        dateEl.classList.remove('is-invalid');
        timeEl.classList.remove('is-invalid');
    }
}
document.getElementById('cd_publish_immediately')?.addEventListener('change', toggleCreatePublishScheduleRequired);
document.getElementById('createDriveForm').addEventListener('submit', function(e){
    toggleCreatePublishScheduleRequired();
    if (!validateForm(this)){ e.preventDefault(); return; }
    var btn = document.getElementById('createDriveSubmitBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting…';
});

/* ================================================
   EDIT DRIVE
================================================ */
function openEditDriveModal(driveId, opts){
    opts = opts || {};
    var drive = DRIVE_DATA[driveId];
    if (!drive){ alert('Drive not found.'); return; }
    var isResubmit = !!opts.resubmit || drive.status === 'Rejected';
    var resubmitHint = document.getElementById('editDriveResubmitHint');
    var modalTitle = document.getElementById('editDriveModalTitle');
    var submitBtn = document.getElementById('editDriveSubmitBtn');
    if (resubmitHint){
        resubmitHint.style.display = isResubmit ? '' : 'none';
    }
    if (modalTitle){
        modalTitle.innerHTML = isResubmit
            ? '<i class="bi bi-arrow-repeat"></i> Re-submit Placement Drive'
            : '<i class="bi bi-pencil-square"></i> Edit Placement Drive';
    }
    if (submitBtn){
        submitBtn.className = isResubmit ? 'btn-c btn-c-success' : 'btn-c btn-c-warning';
        submitBtn.innerHTML = isResubmit
            ? '<i class="bi bi-send-check"></i> Re-submit for Approval'
            : '<i class="bi bi-check2-circle"></i> Save Changes';
    }
    document.getElementById('editDriveSubtitle').textContent = drive.drive_id + ' · ' + drive.job_title;
    document.getElementById('editDriveForm').action = '/company/drive/edit/' + driveId;
    document.getElementById('edit_job_title').value        = drive.job_title || '';
    document.getElementById('edit_job_description').value  = drive.job_description || '';
    document.getElementById('edit_eligibility').value      = drive.eligibility || '';
    document.getElementById('edit_salary').value           = drive.salary || '';
    document.getElementById('edit_location').value         = drive.location || '';
    document.getElementById('edit_deadline').value         = drive.deadline || '';
    document.getElementById('edit_deadline_time').value    = drive.deadline_time || '';
    document.getElementById('edit_publish_date').value     = drive.publish_date || '';
    document.getElementById('edit_publish_time').value     = drive.publish_time || '';
    document.getElementById('edit_publish_immediately').checked = !(drive.publish_date || drive.publish_time);
    toggleEditPublishScheduleRequired();
    document.getElementById('edit_required_skills').value  = drive.required_skills || '';
    document.getElementById('edit_vacancies').value        = drive.vacancies || '';
    document.getElementById('edit_selection_process').value = drive.selection_process || '';
    document.getElementById('edit_additional_notes').value = drive.additional_notes || '';
    setSelectValue('edit_job_type', drive.job_type);
    setSelectValue('edit_work_mode', drive.work_mode);
    setSelectValue('edit_experience_level', drive.experience_level);
    closeProfileDropdown();
    openModal('editDriveOverlay');
}
function openDriveResubmitFlow(driveId){
    var drive = DRIVE_DATA[driveId];
    if (!drive){ alert('Drive not found.'); return; }
    openEditDriveModal(driveId, { resubmit: true });
}
function setSelectValue(selectId, val){
    var sel = document.getElementById(selectId);
    if (!sel || !val) return;
    for (var i = 0; i < sel.options.length; i++){
        if (sel.options[i].value === val){ sel.selectedIndex = i; break; }
    }
}
document.getElementById('editDriveForm').addEventListener('submit', function(e){ if (!validateForm(this)) e.preventDefault(); });
function toggleEditPublishScheduleRequired(){
    var immediateEl = document.getElementById('edit_publish_immediately');
    var dateEl = document.getElementById('edit_publish_date');
    var timeEl = document.getElementById('edit_publish_time');
    if(!immediateEl || !dateEl || !timeEl) return;
    var immediate = !!immediateEl.checked;
    dateEl.disabled = immediate;
    timeEl.disabled = immediate;
    if(immediate){
        dateEl.value = '';
        timeEl.value = '';
        dateEl.classList.remove('is-invalid');
        timeEl.classList.remove('is-invalid');
    }
}
document.getElementById('edit_publish_immediately')?.addEventListener('change', toggleEditPublishScheduleRequired);
document.getElementById('editDriveForm').addEventListener('submit', function(){
    toggleEditPublishScheduleRequired();
});

/* ================================================
   DRIVE DETAIL MODAL
================================================ */
function openDriveDetailModal(driveId){
    var drive = DRIVE_DATA[driveId];
    if (!drive) return;
    _currentDriveDetailId = driveId;

    document.getElementById('driveDetailTitle').innerHTML = '<i class="bi bi-briefcase-fill"></i> ' + escHTML(drive.job_title);
    document.getElementById('driveDetailSub').textContent = drive.drive_id + ' · ' + drive.status + (drive.created_at ? ' · Created ' + drive.created_at : '');

    var infoItems = [
        { label:'Drive ID',           val: drive.drive_id },
        { label:'Job Type',           val: drive.job_type || '—' },
        { label:'Work Mode',          val: drive.work_mode || '—' },
        { label:'Experience Level',   val: drive.experience_level || '—' },
        { label:'Package / CTC',      val: drive.salary ? '₹' + Number(drive.salary).toLocaleString() + ' LPA' : '—' },
        { label:'Vacancies',          val: drive.vacancies || '—' },
        { label:'Location',           val: drive.location || '—' },
        { label:'Application Deadline', val: drive.is_live_for_students ? (drive.deadline_display || 'Open-ended') : 'Shown after student publish' },
        { label:'Student Publish Schedule', val: drive.publish_display || 'Immediate after approval' },
        { label:'Student Visibility', val: drive.is_live_for_students ? 'Live' : 'Scheduled' },
        { label:'Selection Process',   val: drive.selection_process || '—' }
    ];
    var bodyHtml = '<div class="drive-detail-info-grid">';
    infoItems.forEach(function(item){
        bodyHtml += '<div class="drive-detail-box"><div class="drive-detail-label">' + item.label + '</div><div class="drive-detail-value">' + escHTML(String(item.val)) + '</div></div>';
    });
    bodyHtml += '</div>';
    bodyHtml += '<div class="drive-desc-block"><div style="font-size:0.78rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.6rem;"><i class="bi bi-file-text me-1"></i>Job Description</div><p>' + escHTML(drive.job_description).replace(/\n/g,'<br>') + '</p></div>';
    if (drive.eligibility) bodyHtml += '<div class="drive-desc-block" style="border-color:rgba(245,158,11,0.15); background:rgba(245,158,11,0.04);"><div style="font-size:0.78rem; font-weight:700; color:var(--warning); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.6rem;"><i class="bi bi-mortarboard me-1"></i>Eligibility Criteria</div><p>' + escHTML(drive.eligibility) + '</p></div>';
    if (drive.required_skills){
        var skills = drive.required_skills.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        bodyHtml += '<div style="margin-bottom:1.25rem;"><div style="font-size:0.78rem; font-weight:700; color:var(--grey-400); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.5rem;">Required Skills</div><div class="skills-tags">' + skills.map(function(sk){ return '<span class="skill-tag">' + escHTML(sk) + '</span>'; }).join('') + '</div></div>';
    }
    if (drive.additional_notes) bodyHtml += '<div class="drive-desc-block" style="border-color:rgba(139,92,246,0.15); background:rgba(139,92,246,0.04);"><div style="font-size:0.78rem; font-weight:700; color:var(--purple); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:0.6rem;"><i class="bi bi-sticky me-1"></i>Additional Notes</div><p>' + escHTML(drive.additional_notes).replace(/\n/g,'<br>') + '</p></div>';

    document.getElementById('driveDetailBody').innerHTML = bodyHtml;
    document.getElementById('driveDetailBody').style.display = '';
    document.getElementById('driveDetailHintWrap').style.display = '';
    openModal('driveDetailOverlay');
}
function openDriveApplicationsModal(driveId){
    navigateToSection('pipeline');
    var driveFilter = document.getElementById('pipelineDriveFilter');
    if (driveFilter){
        driveFilter.value = String(driveId);
    }
    filterPipeline();
}

function buildDriveAppsSection(drive, filterStatus){
    _currentDriveFilterStatus = filterStatus || 'all';
    var apps = drive.applications;
    document.getElementById('driveAppsCount').textContent = apps.length;
    var totalPlaced = apps.filter(function(a){ return a.status === 'Placed'; }).length;
    var vacancies = Number(drive.vacancies || 0);
    var hasVacancy = vacancies > 0;
    var fillPct = hasVacancy ? Math.min(100, Math.round((totalPlaced / vacancies) * 100)) : 0;
    var fillColor = fillPct >= 80 ? 'linear-gradient(90deg,var(--success),#34d399)' : (fillPct >= 40 ? 'linear-gradient(90deg,var(--warning),#fbbf24)' : 'linear-gradient(90deg,var(--danger),#f87171)');
    var vacancyFillHtml = hasVacancy
        ? (
            '<div style="margin:0.25rem 0 0.9rem; padding:0.75rem 0.85rem; border:1px solid var(--grey-200); border-radius:10px; background:var(--grey-50);">' +
                '<div style="display:flex; align-items:center; justify-content:space-between; gap:0.6rem; margin-bottom:0.45rem;">' +
                    '<div style="font-size:0.78rem; font-weight:700; color:var(--grey-600); text-transform:uppercase; letter-spacing:0.35px;"><i class="bi bi-person-check-fill me-1" style="color:var(--success);"></i> Vacancy Fill</div>' +
                    '<div style="font-size:0.82rem; font-weight:700; color:var(--grey-700);">' + totalPlaced + ' / ' + vacancies + ' placed (' + fillPct + '%)</div>' +
                '</div>' +
                '<div style="height:8px; border-radius:999px; background:var(--grey-200); overflow:hidden;">' +
                    '<div style="height:100%; width:' + fillPct + '%; background:' + fillColor + ';"></div>' +
                '</div>' +
            '</div>'
        )
        : (
            '<div style="margin:0.25rem 0 0.9rem; padding:0.65rem 0.85rem; border:1px dashed var(--grey-300); border-radius:10px; background:var(--grey-50); font-size:0.78rem; color:var(--grey-500); font-weight:600;">' +
                '<i class="bi bi-info-circle me-1"></i>Vacancies not set for this drive, so fill rate cannot be calculated.' +
            '</div>'
        );

    var counts = { all: apps.length };
    ['Applied','Shortlisted','Interview','Placed','Rejected'].forEach(function(st){
        counts[st.toLowerCase()] = apps.filter(function(a){ return a.status === st; }).length;
    });

    var filterDefs = [
        { key:'all',         label:'All',         color:'var(--accent)' },
        { key:'applied',     label:'Pending',     color:'var(--info)' },
        { key:'shortlisted', label:'Shortlisted', color:'var(--warning)' },
        { key:'interview',   label:'Interview',   color:'var(--purple)' },
        { key:'selected',    label:'Placed',    color:'var(--success)' },
        { key:'rejected',    label:'Rejected',    color:'var(--danger)' }
    ];
    var filtersHtml = filterDefs.map(function(fs){
        var cnt = counts[fs.key] || 0;
        var isActive = filterStatus === fs.key;
        return '<button onclick="filterDriveApps(' + drive.id + ',\'' + fs.key + '\')" style="padding:0.3rem 0.75rem; border-radius:20px; font-size:0.78rem; font-weight:700; cursor:pointer; border:1.5px solid ' + fs.color + '; background:' + (isActive ? fs.color : 'transparent') + '; color:' + (isActive ? '#fff' : fs.color) + '; transition:all 0.2s;">' + fs.label + ' (' + cnt + ')</button>';
    }).join('');
    document.getElementById('driveAppsFilters').innerHTML = filtersHtml;

    var filtered = filterStatus === 'all' ? apps : apps.filter(function(a){ return a.status.toLowerCase() === filterStatus; });
    var minCgpa = parseFloat(document.getElementById('driveMinCgpa')?.value || '');
    var minTenth = parseFloat(document.getElementById('driveMinTenth')?.value || '');
    var minTwelfth = parseFloat(document.getElementById('driveMinTwelfth')?.value || '');
    var degreeTerm = (document.getElementById('driveDegreeFilter')?.value || '').toLowerCase();
    var skillsTerm = (document.getElementById('driveSkillsFilter')?.value || '').toLowerCase();
    filtered = filtered.filter(function(a){
        var s = a.student || {};
        var okCgpa = isNaN(minCgpa) || ((s.cgpa || 0) >= minCgpa);
        var okTenth = isNaN(minTenth) || ((s.tenth_percent || 0) >= minTenth);
        var okTwelfth = isNaN(minTwelfth) || ((s.twelfth_percent || 0) >= minTwelfth);
        var okDegree = !degreeTerm || (s.degree || '').toLowerCase().includes(degreeTerm);
        var okSkills = !skillsTerm || (s.skills || '').toLowerCase().includes(skillsTerm);
        return okCgpa && okTenth && okTwelfth && okDegree && okSkills;
    });
    var wrap = document.getElementById('driveAppsTableWrap');

    if (!filtered.length){
        wrap.innerHTML = vacancyFillHtml + '<div style="padding:2rem; text-align:center; color:var(--grey-400);"><i class="bi bi-inbox" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>No applications' + (filterStatus !== 'all' ? ' with status "' + filterStatus + '"' : '') + '</div>';
        return;
    }

    var tableHtml = '<table class="app-table"><thead><tr><th>#</th><th>Student</th><th>Academic</th><th>CGPA</th><th>10th</th><th>12th</th><th>Applied On</th><th>Status</th><th>Resume</th><th>Review</th></tr></thead><tbody>';
    filtered.forEach(function(app, idx){
        var s = app.student;
        var statusMeta = STATUS_LABELS[app.status] || { icon:'bi-circle', cls:'applied' };
        var displayStatus = app.status === 'Applied' ? 'Pending' : app.status;
        tableHtml += '<tr>' +
            '<td style="font-weight:700; color:var(--grey-400);">' + (idx+1) + '</td>' +
            '<td>' +
                '<div style="display:flex; align-items:center; gap:0.65rem;">' +
                    '<div style="width:32px; height:32px; border-radius:8px; background:linear-gradient(135deg,var(--sky),var(--accent)); display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; font-size:0.85rem; flex-shrink:0;">' + (s.name ? s.name[0].toUpperCase() : '?') + '</div>' +
                    '<div><div style="font-weight:600; color:var(--grey-700);">' + escHTML(s.name || '—') + '</div><small style="color:var(--grey-400);">' + escHTML(s.email || '') + '</small>' + (s.contact ? '<br><small style="color:var(--grey-400);"><i class="bi bi-phone"></i> ' + escHTML(s.contact) + '</small>' : '') + '</div>' +
                '</div>' +
            '</td>' +
            '<td><div style="font-size:0.875rem; font-weight:600;">' + escHTML(s.college || '—') + '</div><small style="color:var(--grey-400);">' + escHTML(s.degree || '') + (s.branch ? ' · ' + escHTML(s.branch) : '') + (s.graduation_year ? ' · ' + s.graduation_year : '') + '</small></td>' +
            '<td style="font-weight:700; color:var(--accent);">' + (s.cgpa ? s.cgpa.toFixed(2) : '—') + '</td>' +
            '<td style="font-weight:600; color:var(--grey-600);">' + (s.tenth_percent ? s.tenth_percent + '%' : '—') + '</td>' +
            '<td style="font-weight:600; color:var(--grey-600);">' + (s.twelfth_percent ? s.twelfth_percent + '%' : '—') + '</td>' +
            '<td style="font-size:0.82rem; color:var(--grey-400);">' + app.date + ' <small style="background:var(--grey-100); padding:0.1rem 0.35rem; border-radius:4px; font-size:0.68rem;">' + (app.time || '') + '</small></td>' +
            '<td><span class="badge-pill badge-' + app.status.toLowerCase() + '"><i class="bi ' + statusMeta.icon + '"></i> ' + displayStatus + '</span>' + (app.remark ? '<div style="font-size:0.72rem; color:var(--grey-400); margin-top:0.25rem; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escHTML(app.remark) + '">' + escHTML(app.remark) + '</div>' : '') + '</td>' +
            '<td>' + (s.resume_url ? '<a href="/static/' + s.resume_url + '" target="_blank" class="btn-c btn-c-xs btn-c-outline"><i class="bi bi-file-earmark-pdf-fill" style="color:var(--danger);"></i> CV</a>' : '<span style="color:var(--grey-300); font-size:0.8rem;">—</span>') + '</td>' +
            '<td><button onclick="openReviewFromDrive(' + app.id + ',' + drive.id + ')" class="btn-c btn-c-xs btn-c-primary"><i class="bi bi-pencil-square"></i></button></td>' +
        '</tr>';
    });
    tableHtml += '</tbody></table>';
    wrap.innerHTML = vacancyFillHtml + tableHtml;
}

function filterDriveApps(driveId, status){
    var drive = DRIVE_DATA[driveId];
    if (drive) buildDriveAppsSection(drive, status);
}

function toggleDriveAdvancedFilters(){
    var panel = document.getElementById('driveAdvancedFilters');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function rebuildCurrentDriveApps(){
    if (!_currentDriveDetailId) return;
    var drive = DRIVE_DATA[_currentDriveDetailId];
    if (!drive) return;
    buildDriveAppsSection(drive, _currentDriveFilterStatus || 'all');
}

/* ================================================
   STATUS LABELS
================================================ */
var STATUS_LABELS = {
    Applied:     { icon:'bi-hourglass-split',    cls:'applied'     },
    Shortlisted: { icon:'bi-bookmark-star-fill', cls:'shortlisted' },
    Interview:   { icon:'bi-camera-video-fill',  cls:'interview'   },
    Placed:    { icon:'bi-trophy-fill',        cls:'selected'    },
    Rejected:    { icon:'bi-x-circle-fill',      cls:'rejected'    }
};

/* Company can set these statuses (no Applied) */
var COMPANY_STATUS_LABELS = {
    Shortlisted: { label:'Shortlisted', icon:'bi-bookmark-star-fill', cls:'shortlisted' },
    Interview:   { label:'Interview',   icon:'bi-camera-video-fill',  cls:'interview'   },
    Placed:    { label:'Placed',    icon:'bi-trophy-fill',        cls:'selected'    },
    Rejected:    { label:'Rejected',    icon:'bi-x-circle-fill',      cls:'rejected'    }
};

/* ================================================
   REVIEW MODAL — FIX: status option icons & interview prompt
================================================ */
function openReviewFrom(appId, driveId, source){
    _currentReviewDriveId = driveId;
    _reviewOpenedFrom = source;
    openReviewModal(appId);
}
function openReviewFromDrive(appId, driveId){ openReviewFrom(appId, driveId, 'drive-detail'); }
function openReviewFromOverview(appId, driveId){ openReviewFrom(appId, driveId, 'overview'); }
function openReviewFromPipeline(appId, driveId){ openReviewFrom(appId, driveId, 'pipeline'); }
function openReviewModal(appId){
    var app = ALL_APPLICATIONS[appId];
    if (!app){ alert('Application not found.'); return; }
    _currentReviewAppId = appId;
    var loader = document.getElementById('reviewModalLoader');
    var content = document.getElementById('reviewModalContent');
    loader.style.display = 'flex'; content.style.display = 'none';
    openModal('reviewOverlay');
    setTimeout(function(){ buildReviewModal(app); loader.style.display = 'none'; content.style.display = 'block'; }, 200);
}
function closeReviewGoBack(){
    var fromDrive = (_reviewOpenedFrom === 'drive-detail');
    var driveId = _currentReviewDriveId;
    closeModal('reviewOverlay');
    _currentReviewAppId = null;
    _currentReviewDriveId = null;
    _reviewOpenedFrom = null;
    if (fromDrive && driveId){
        setTimeout(function(){ openDriveDetailModal(driveId); }, 220);
    }
}

function buildReviewModal(app){
    var s = app.student;
    document.getElementById('reviewModalSubtitle').innerHTML = 'Application for <strong>' + escHTML(app.drive_title) + '</strong> · ' + escHTML(app.drive_plx_id) + ' · Applied ' + app.date;
    document.getElementById('reviewStudentAvatar').textContent = s.name ? s.name[0].toUpperCase() : '?';
    document.getElementById('reviewStudentName').textContent = s.name || '—';
    document.getElementById('reviewStudentEmail').textContent = s.email || '';

    var tags = document.getElementById('reviewStudentTags');
    tags.innerHTML = '';
    if (s.degree)          tags.innerHTML += '<span class="student-qtag"><i class="bi bi-mortarboard me-1"></i>' + escHTML(s.degree) + '</span>';
    if (s.college)         tags.innerHTML += '<span class="student-qtag"><i class="bi bi-building me-1"></i>' + escHTML(s.college) + '</span>';
    if (s.graduation_year) tags.innerHTML += '<span class="student-qtag"><i class="bi bi-calendar me-1"></i>Grad: ' + escHTML(s.graduation_year) + '</span>';
    if (s.cgpa)            tags.innerHTML += '<span class="student-qtag" style="background:rgba(16,185,129,0.2); border-color:rgba(16,185,129,0.4);">CGPA: ' + s.cgpa.toFixed(2) + '</span>';

    var profileFields = [
        { label:'Branch / Specialization', val: s.branch || '—' },
        { label:'Year of Study',   val: s.year_of_study || '—' },
        { label:'Graduation Year', val: s.graduation_year || '—' },
        { label:'CGPA',            val: s.cgpa ? s.cgpa.toFixed(2) : '—', cls:'accent' },
        { label:'10th Percentage', val: s.tenth_percent ? s.tenth_percent + '%' : '—' },
        { label:'12th Percentage', val: s.twelfth_percent ? s.twelfth_percent + '%' : '—' },
        { label:'Date of Birth',   val: s.dob || '—' },
        { label:'Contact',         val: s.contact || '—' }
    ];
    var grid = document.getElementById('reviewProfileGrid');
    grid.innerHTML = profileFields.map(function(f){ return '<div class="profile-field"><div class="profile-field-label">' + f.label + '</div><div class="profile-field-val' + (f.cls ? ' '+f.cls : '') + '">' + escHTML(String(f.val)) + '</div></div>'; }).join('');
    if (s.bio) grid.innerHTML += '<div class="profile-field" style="grid-column:1/-1;"><div class="profile-field-label">Bio</div><div class="profile-field-val" style="font-weight:400; font-size:0.87rem; line-height:1.6;">' + escHTML(s.bio) + '</div></div>';

    var skillsSection = document.getElementById('reviewSkillsSection');
    var skillsTags = document.getElementById('reviewSkillsTags');
    if (s.skills){
        skillsSection.style.display = '';
        skillsTags.innerHTML = s.skills.split(',').map(function(sk){ return sk.trim(); }).filter(Boolean).map(function(sk){ return '<span class="skill-tag">' + escHTML(sk) + '</span>'; }).join('');
    } else { skillsSection.style.display = 'none'; }

    document.getElementById('reviewAppInfo').innerHTML =
        '<div style="flex:1; min-width:150px;"><div style="font-size:0.7rem; font-weight:700; color:var(--grey-400); text-transform:uppercase; letter-spacing:0.5px;">Applied For</div><div style="font-weight:600; font-size:0.9rem;">' + escHTML(app.drive_title) + '</div><div style="font-size:0.78rem; font-family:\'Outfit\',monospace; color:var(--accent);">' + escHTML(app.drive_plx_id) + '</div></div>' +
        '<div><div style="font-size:0.7rem; font-weight:700; color:var(--grey-400); text-transform:uppercase; letter-spacing:0.5px;">Applied On</div><div style="font-weight:600; font-size:0.9rem;">' + app.date + '</div></div>' +
        '<div><div style="font-size:0.7rem; font-weight:700; color:var(--grey-400); text-transform:uppercase; letter-spacing:0.5px;">Current Status</div><span class="badge-pill badge-' + app.status.toLowerCase() + '">' + app.status + '</span></div>';

    var linksEl = document.getElementById('reviewLinks');
    linksEl.innerHTML = '';
    if (s.resume_url) linksEl.innerHTML += '<a href="/static/' + s.resume_url + '" target="_blank" class="btn-c btn-c-sm btn-c-primary"><i class="bi bi-file-earmark-pdf-fill"></i> View Resume / CV</a>';
    if (s.linkedin)   linksEl.innerHTML += '<a href="' + s.linkedin + '" target="_blank" class="btn-c btn-c-sm btn-c-outline"><i class="bi bi-linkedin"></i> LinkedIn</a>';
    if (s.github)     linksEl.innerHTML += '<a href="' + s.github + '" target="_blank" class="btn-c btn-c-sm btn-c-outline"><i class="bi bi-github"></i> GitHub</a>';

    /* FIX: Build status options with correct active class */
    var statusOpts = document.getElementById('reviewStatusOptions');
    statusOpts.innerHTML = Object.entries(COMPANY_STATUS_LABELS).map(function(entry){
        var key = entry[0], meta = entry[1];
        var isActive = app.status === key;
        return '<div class="status-option' + (isActive ? ' active-' + meta.cls : '') + '" data-status="' + key + '" onclick="selectStatus(this,\'' + key + '\')">' +
            '<i class="bi ' + meta.icon + '"></i>' + meta.label + '</div>';
    }).join('');

    document.getElementById('reviewRemark').value = app.remark || '';
    document.getElementById('reviewInternalNote').value = app.internal_note || '';

    /* Set up form */
    var form = document.getElementById('reviewStatusForm');
    form.action = '/company/application/review/' + app.id;
    var old = form.querySelector('input[name="status"]');
    if (old) old.remove();
    var hid = document.createElement('input');
    hid.type = 'hidden'; hid.name = 'status'; hid.value = app.status; hid.id = 'reviewHiddenStatus';
    form.appendChild(hid);
    document.getElementById('reviewReturnDriveId').value = _currentReviewDriveId || '';
    var section = (_reviewOpenedFrom === 'drive-detail' || _reviewOpenedFrom === 'overview') ? 'overview' : 'pipeline';
    document.getElementById('reviewReturnSection').value = section;

    var scheduleWrap = document.getElementById('reviewInterviewScheduleFields');
    var intDate = document.getElementById('reviewInterviewDate');
    var intTime = document.getElementById('reviewInterviewTime');
    var intMode = document.getElementById('reviewInterviewMode');
    var intNotes = document.getElementById('reviewInterviewNotes');
    if (app.status === 'Interview'){
        scheduleWrap.style.display = '';
        intDate.value = app.interview_date || '';
        intTime.value = app.interview_time || '';
        intMode.value = app.interview_mode || 'Online';
        intNotes.value = app.interview_notes || '';
        toggleInterviewRequired(true);
    } else {
        scheduleWrap.style.display = 'none';
        intDate.value = '';
        intTime.value = '';
        intMode.value = 'Online';
        intNotes.value = '';
        toggleInterviewRequired(false);
    }

    var interviewActionWrap = document.getElementById('reviewInterviewActions');
    var scheduleId = Number(app.interview_schedule_id || 0);
    var scheduleStatus = String(app.interview_schedule_status || '').trim() || 'Scheduled';
    if (app.status === 'Interview' && scheduleId){
        var statusBadgeCls = scheduleStatus === 'Completed' ? 'selected' : scheduleStatus === 'Cancelled' ? 'rejected' : 'interview';
        var actionsHtml = '';
        if (scheduleStatus === 'Scheduled'){
            actionsHtml =
                '<button type="button" class="btn-c btn-c-sm btn-c-success" onclick="updateInterviewStatus(' + scheduleId + ', \'Completed\', true)">' +
                '<i class="bi bi-check2-circle"></i> Mark Completed</button>' +
                '<button type="button" class="btn-c btn-c-sm btn-c-danger" onclick="updateInterviewStatus(' + scheduleId + ', \'Cancelled\', true)">' +
                '<i class="bi bi-x-circle"></i> Cancel Interview</button>';
        } else {
            actionsHtml =
                '<span style="font-size:0.78rem;color:var(--grey-500);font-weight:600;">No further action available for this interview.</span>';
        }
        interviewActionWrap.style.display = '';
        interviewActionWrap.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">' +
                '<div style="display:flex;align-items:center;gap:0.55rem;">' +
                    '<span style="font-size:0.74rem;font-weight:700;color:var(--grey-500);text-transform:uppercase;letter-spacing:0.5px;">Interview Status</span>' +
                    '<span class="badge-pill badge-' + statusBadgeCls + '">' + escHTML(scheduleStatus) + '</span>' +
                '</div>' +
                '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">' + actionsHtml + '</div>' +
            '</div>';
    } else {
        interviewActionWrap.style.display = 'none';
        interviewActionWrap.innerHTML = '';
    }
}

/* FIX: selectStatus — properly clears ALL active classes before setting new one */
function selectStatus(el, status){
    /* Remove all active-* classes from all options */
    document.querySelectorAll('#reviewStatusOptions .status-option').forEach(function(opt){
        opt.className = 'status-option'; /* reset to base class only */
    });
    var meta = COMPANY_STATUS_LABELS[status];
    if (meta) el.classList.add('active-' + meta.cls);

    var hidden = document.getElementById('reviewHiddenStatus');
    if (hidden) hidden.value = status;

    if (status === 'Interview'){
        document.getElementById('reviewInterviewScheduleFields').style.display = '';
    } else {
        document.getElementById('reviewInterviewScheduleFields').style.display = 'none';
        document.getElementById('reviewInterviewDate').value = '';
        document.getElementById('reviewInterviewTime').value = '';
        document.getElementById('reviewInterviewMode').value = 'Online';
        document.getElementById('reviewInterviewNotes').value = '';
    }
    toggleInterviewRequired(status === 'Interview');
}

function toggleInterviewRequired(required){
    ['reviewInterviewDate', 'reviewInterviewTime'].forEach(function(id){
        var field = document.getElementById(id);
        if (!field) return;
        if (required) field.setAttribute('required', 'required');
        else field.removeAttribute('required');
    });
}

function confirmScheduleInterview(){ /* legacy modal kept for compatibility */ }

document.getElementById('reviewStatusForm').addEventListener('submit', async function(e){
    e.preventDefault();
    var status = document.getElementById('reviewHiddenStatus')?.value || '';
    if (status === 'Interview'){
        var d = document.getElementById('reviewInterviewDate').value;
        var t = document.getElementById('reviewInterviewTime').value;
        if (!d || !t){
            alert('Interview date and time are required for Interview status.');
            return;
        }
    }

    var form = e.currentTarget;
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn){
        submitBtn.disabled = true;
        submitBtn.dataset.prevHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';
    }

    try {
        var fd = new FormData(form);
        var res = await fetch(form.action, {
            method: 'POST',
            body: fd,
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        var data = await res.json().catch(function(){ return {}; });
        if (!res.ok || !data.success){
            alert(data.error || 'Unable to update application status.');
            return;
        }

        var appId = Number(_currentReviewAppId || 0);
        var driveId = Number(_currentReviewDriveId || 0);
        var app = ALL_APPLICATIONS[appId];
        if (app){
            app.status = data.status || app.status;
            app.remark = data.remark || '';
            app.internal_note = data.internal_note || '';
            app.status_updated_at = new Date().toISOString();
        }
        rebuildUpcomingEvents();

        var openedFrom = _reviewOpenedFrom;
        closeModal('reviewOverlay');
        _currentReviewAppId = null;

        if (openedFrom === 'drive-detail' && driveId){
            _currentReviewDriveId = driveId;
            _reviewOpenedFrom = null;
            setTimeout(function(){ openDriveApplicationsModal(driveId); }, 180);
        } else {
            _currentReviewDriveId = null;
            _reviewOpenedFrom = null;
        }
    } catch(err){
        alert('Unable to update application status. Please try again.');
    } finally {
        if (submitBtn){
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitBtn.dataset.prevHtml || '<i class="bi bi-check2-circle"></i> Save Status';
        }
    }
});


/* ================================================
   UPCOMING EVENTS TABS
================================================ */
function switchEventsTab(tab){
    document.querySelectorAll('.events-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.events-tab-pane').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('eventsTab_' + tab).classList.add('active');
    document.getElementById('eventsPane_' + tab).classList.add('active');
}

function rebuildUpcomingEvents(){
    renderInterviewsTab();
    renderDeadlinesTab();
}

function updateInterviewsTabCount(count){
    var badge = document.getElementById('eventsInterviewsCount');
    if (!badge) return;
    var safe = Number.isFinite(Number(count)) ? Number(count) : 0;
    badge.textContent = String(Math.max(0, safe));
}

function renderInterviewsTab(){
    var pane = document.getElementById('eventsPane_interviews');
    if (!pane) return;
    var interviews = Object.values(SCHEDULED_INTERVIEWS).filter(function(iv){
        return (iv.status || 'Scheduled') === 'Scheduled';
    });
    updateInterviewsTabCount(interviews.length);
    if (!interviews.length){
        pane.innerHTML = '<div style="padding:1.75rem 1.5rem; text-align:center; color:var(--grey-400);"><i class="bi bi-camera-video" style="font-size:1.75rem; display:block; margin-bottom:0.5rem;"></i><div style="font-size:0.88rem; font-weight:600;">No interviews scheduled</div><div style="font-size:0.78rem; margin-top:0.25rem;">Mark an application as Interview to schedule one.</div></div>';
        return;
    }
    interviews.sort(function(a,b){ return (a.date+a.time).localeCompare(b.date+b.time); });
    var html = '<div class="deadline-list">';
    interviews.forEach(function(iv){
        var d = new Date(iv.date);
        var today = new Date(); today.setHours(0,0,0,0);
        var daysLeft = Math.round((d - today) / 86400000);
        var dayLabel = daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : (daysLeft < 0 ? 'Past' : daysLeft + ' days');
        var isPast = daysLeft < 0;
        html += '<div class="deadline-item" onclick="openReviewFromDrive(' + iv.appId + ',' + iv.driveId + ')" style="opacity:' + (isPast ? '0.6' : '1') + ';">' +
            '<div class="interview-badge">' +
                '<div class="day-num">' + (isPast ? '✓' : d.getDate()) + '</div>' +
                '<div class="day-label">' + (isPast ? 'done' : d.toLocaleString('default',{month:'short'})) + '</div>' +
            '</div>' +
            '<div class="deadline-info">' +
                '<div class="deadline-title">' + escHTML(iv.studentName) + '</div>' +
                '<div class="deadline-sub"><i class="bi bi-briefcase me-1"></i>' + escHTML(iv.driveTitle.substring(0,25)) + ' · <i class="bi bi-clock me-1 ms-1"></i>' + iv.time + (iv.mode ? ' · <i class="bi bi-display me-1"></i>' + iv.mode : '') + '</div>' +
                (iv.notes ? '<div style="font-size:0.72rem; color:var(--grey-400); margin-top:0.15rem;">' + escHTML(iv.notes) + '</div>' : '') +
                '<div style="margin-top:0.55rem; display:flex; gap:0.45rem; flex-wrap:wrap;">' +
                    '<button type="button" class="btn-c btn-c-sm btn-c-outline" onclick="event.stopPropagation(); updateInterviewStatus(' + iv.scheduleId + ', \'Completed\')"><i class="bi bi-check2-circle"></i> Mark Completed</button>' +
                    '<button type="button" class="btn-c btn-c-sm btn-c-danger" onclick="event.stopPropagation(); updateInterviewStatus(' + iv.scheduleId + ', \'Cancelled\')"><i class="bi bi-x-circle"></i> Cancel</button>' +
                '</div>' +
            '</div>' +
            '<span class="deadline-countdown" style="' + (isPast ? 'background:var(--warning-light);color:var(--amber);' : 'background:var(--purple-light);color:var(--purple);') + '">' + dayLabel + '</span>' +
        '</div>';
    });
    html += '</div>';
    pane.innerHTML = html;
}

async function updateInterviewStatus(scheduleId, status, fromReviewModal){
    var actionLabel = status === 'Completed' ? 'mark this interview as completed' : 'cancel this interview';
    if (!confirm('Are you sure you want to ' + actionLabel + '?')) return;
    try {
        var res = await fetch('/company/interview/' + scheduleId + '/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            credentials: 'same-origin',
            body: 'status=' + encodeURIComponent(status)
        });
        var data = await res.json();
        if (!res.ok || !data.success){
            alert(data.error || 'Unable to update interview status.');
            return;
        }
        Object.keys(SCHEDULED_INTERVIEWS).forEach(function(k){
            if (Number(SCHEDULED_INTERVIEWS[k].scheduleId) === Number(scheduleId)){
                SCHEDULED_INTERVIEWS[k].status = status;
            }
        });
        Object.keys(ALL_APPLICATIONS).forEach(function(k){
            var app = ALL_APPLICATIONS[k];
            if (Number(app.interview_schedule_id) === Number(scheduleId)){
                app.interview_schedule_status = status;
                if (status === 'Cancelled' && app.status === 'Interview'){
                    app.status = 'Shortlisted';
                }
            }
        });
        renderInterviewsTab();
        addNotif('notification', 'info', 'bi-camera-video-fill',
            'Interview ' + (status === 'Completed' ? 'completed' : 'cancelled') + ' successfully.',
            new Date().toLocaleString('en-IN'),
            'interview_status_' + scheduleId + '_' + status + '_' + Date.now(),
            { sort_ts: Date.now() / 1000 }
        );
        if (fromReviewModal && _currentReviewAppId && ALL_APPLICATIONS[_currentReviewAppId]){
            buildReviewModal(ALL_APPLICATIONS[_currentReviewAppId]);
        }
    } catch (e){
        alert('Unable to update interview status right now.');
    }
}

function renderDeadlinesTab(){
    // No numeric tab badge for interviews tab.
}

/* ================================================
   CLOSE / DELETE CONFIRMS
================================================ */
function openCloseDriveConfirm(driveId, driveTitle){
    document.getElementById('closeDriveTitle').textContent = driveTitle;
    document.getElementById('closeDriveConfirmBtn').href = '/company/drive/close/' + driveId + '?section=active-drives';
    openModal('closeDriveOverlay');
}
function openDeleteDriveConfirm(driveId, driveTitle){
    document.getElementById('deleteDriveTitle').textContent = driveTitle;
    document.getElementById('deleteDriveConfirmBtn').href = '/company/drive/delete/' + driveId + '?section=active-drives';
    openModal('deleteDriveOverlay');
}

/* ================================================
   EDIT PROFILE MODAL
================================================ */
function openEditProfileModal(){ closeProfileDropdown(); openModal('editProfileOverlay'); }

/* ================================================
   HR DETAIL MODAL
================================================ */
function openHRDetailModal(){
    var hr = HR_DATA;
    var rows = [
        { icon:'bi-person-fill',    label:'HR Name',       val: hr.name || '—' },
        { icon:'bi-briefcase-fill', label:'Designation',   val: hr.designation || '—' },
        { icon:'bi-envelope-fill',  label:'Primary Email', val: hr.email || '—' },
        { icon:'bi-envelope',       label:'Alt. Email',    val: hr.alt_email || '—' },
        { icon:'bi-phone-fill',     label:'Mobile',        val: hr.mobile || '—' },
        { icon:'bi-telephone-fill', label:'Office',        val: hr.office || '—' }
    ];
    document.getElementById('hrDetailBody').innerHTML = rows.map(function(r){
        return '<div class="hr-detail-row"><div class="hr-detail-icon"><i class="bi ' + r.icon + '"></i></div><div><div class="hr-detail-lbl">' + r.label + '</div><div class="hr-detail-val">' + escHTML(r.val) + '</div></div></div>';
    }).join('') || '<p style="color:var(--grey-400); text-align:center; padding:1rem;">No HR details available</p>';
    openModal('hrDetailOverlay');
}

/* ================================================
   GLOBAL SEARCH
================================================ */
var searchInput = document.getElementById('globalSearchInput');
var searchDropdown = document.getElementById('searchResultsDropdown');
var DRIVE_INDEX = Object.values(DRIVE_DATA).map(function(drive){
    return { id: drive.id, title: drive.job_title, driveId: drive.drive_id, status: drive.status, type: drive.job_type || '', location: drive.location || '' };
});
searchInput.addEventListener('input', function(){
    var q = this.value.trim().toLowerCase();
    if (!q){ searchDropdown.classList.remove('open'); return; }
    var results = DRIVE_INDEX.filter(function(d){
        return d.title.toLowerCase().includes(q) || d.driveId.toLowerCase().includes(q) || d.type.toLowerCase().includes(q) || d.location.toLowerCase().includes(q);
    });
    if (!results.length){
        searchDropdown.innerHTML = '<div class="search-no-results"><i class="bi bi-search" style="display:block; font-size:1.5rem; margin-bottom:0.5rem;"></i>No drives found for "' + q + '"</div>';
    } else {
        searchDropdown.innerHTML = results.slice(0,8).map(function(d){
            var statusColor = d.status === 'Approved' ? 'var(--success)' : d.status === 'Closed' ? 'var(--grey-500)' : 'var(--warning)';
            var statusIcon  = d.status === 'Approved' ? 'check-circle-fill' : d.status === 'Closed' ? 'archive-fill' : 'clock-fill';
            return '<div class="search-result-item" onclick="handleSearchClick(' + d.id + ',\'' + d.status + '\')">' +
                '<div class="search-result-icon ' + d.status.toLowerCase() + '"><i class="bi bi-' + statusIcon + '"></i></div>' +
                '<div><div class="search-result-title">' + escHTML(d.title) + '</div>' +
                '<div class="search-result-sub">' + escHTML(d.driveId) + (d.type ? ' · ' + d.type : '') + ' · <strong style="color:' + statusColor + ';">' + d.status + '</strong></div></div>' +
            '</div>';
        }).join('');
    }
    searchDropdown.classList.add('open');
});
function handleSearchClick(driveId, status){
    searchInput.value = ''; searchDropdown.classList.remove('open');
    openDriveDetailModal(driveId);
}
document.addEventListener('click', function(e){
    var wrap = document.getElementById('globalSearchWrap');
    if (wrap && !wrap.contains(e.target)) searchDropdown.classList.remove('open');
});

/* ================================================
   FILTERS
================================================ */
function filterActiveDrives(){
    var term   = (document.getElementById('searchActive')?.value || '').toLowerCase();
    var type   = (document.getElementById('typeFilterActive')?.value || '').toLowerCase();
    var view   = window._activeDriveView || 'active';
    var visible = 0;
    var selector = view === 'pending_rejected' ? '.drive-item-pending-rejected' : '.drive-item-active';
    document.querySelectorAll(selector).forEach(function(card){
        var match = (!term || card.dataset.title.includes(term) || card.dataset.location.includes(term) || (card.dataset.driveid || '').includes(term)) &&
                    (!type   || card.dataset.type.includes(type));
        card.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    document.getElementById('noActiveMsg').style.display = visible === 0 ? '' : 'none';
}
function switchActiveDriveView(view){
    window._activeDriveView = (view === 'pending_rejected') ? 'pending_rejected' : 'active';
    var activeBtn = document.getElementById('activeViewBtn');
    var pendingBtn = document.getElementById('pendingRejectedViewBtn');
    var activeGrid = document.getElementById('activeDrivesGrid');
    var pendingGrid = document.getElementById('pendingRejectedDrivesGrid');
    if (activeBtn) activeBtn.classList.toggle('active', window._activeDriveView === 'active');
    if (pendingBtn) pendingBtn.classList.toggle('active', window._activeDriveView === 'pending_rejected');
    if (activeGrid) activeGrid.style.display = window._activeDriveView === 'active' ? '' : 'none';
    if (pendingGrid) pendingGrid.style.display = window._activeDriveView === 'pending_rejected' ? '' : 'none';
    try {
        localStorage.setItem('company_active_drive_view', window._activeDriveView);
        var url = new URL(window.location.href);
        if ((url.searchParams.get('section') || '') === 'active-drives') {
            url.searchParams.set('active_view', window._activeDriveView);
            window.history.replaceState({}, '', url.toString());
        }
    } catch (e) {}
    filterActiveDrives();
}

function applyPreferredActiveDriveView(){
    var preferred = 'active';
    try {
        var url = new URL(window.location.href);
        var queryView = (url.searchParams.get('active_view') || '').trim();
        if (queryView === 'active' || queryView === 'pending_rejected') {
            preferred = queryView;
        } else {
            var saved = (localStorage.getItem('company_active_drive_view') || '').trim();
            if (saved === 'active' || saved === 'pending_rejected') {
                preferred = saved;
            }
        }
    } catch (e) {}
    switchActiveDriveView(preferred);
}

function filterPipeline(){
    var term   = (document.getElementById('pipelineSearch')?.value || '').toLowerCase();
    var status = (document.getElementById('pipelineStatusFilter')?.value || '').toLowerCase();
    var drive  = (document.getElementById('pipelineDriveFilter')?.value || '');
    var minCgpa = parseFloat(document.getElementById('pipelineMinCgpa')?.value || '');
    var minTenth = parseFloat(document.getElementById('pipelineMinTenth')?.value || '');
    var minTwelfth = parseFloat(document.getElementById('pipelineMinTwelfth')?.value || '');
    var degreeTerm = (document.getElementById('pipelineDegreeFilter')?.value || '').toLowerCase();
    var skillsTerm = (document.getElementById('pipelineSkillsFilter')?.value || '').toLowerCase();
    var visible = 0;
    document.querySelectorAll('.pipeline-row').forEach(function(row){
        var match = (!term   || row.dataset.name.includes(term) || row.dataset.college.includes(term)) &&
                    (!status || row.dataset.status === status) &&
                    (!drive  || row.dataset.drive === drive) &&
                    (isNaN(minCgpa) || Number(row.dataset.cgpa || 0) >= minCgpa) &&
                    (isNaN(minTenth) || Number(row.dataset.tenth || 0) >= minTenth) &&
                    (isNaN(minTwelfth) || Number(row.dataset.twelfth || 0) >= minTwelfth) &&
                    (!degreeTerm || (row.dataset.degree || '').includes(degreeTerm)) &&
                    (!skillsTerm || (row.dataset.skills || '').includes(skillsTerm));
        row.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    var noMsg = document.getElementById('noPipelineMsg');
    if (noMsg) noMsg.style.display = visible === 0 ? '' : 'none';
}

function togglePipelineAdvancedFilters(){
    var panel = document.getElementById('pipelineAdvancedFilters');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

var closedSearch = document.getElementById('searchClosed');
if (closedSearch){
    closedSearch.addEventListener('input', function(){
        var term = this.value.toLowerCase();
        var visible = 0;
        document.querySelectorAll('.closed-row').forEach(function(row){
            var match = !term || row.dataset.title.includes(term);
            row.style.display = match ? '' : 'none';
            if (match) visible++;
        });
        var noMsg = document.getElementById('noClosedMsg');
        if (noMsg) noMsg.style.display = visible === 0 ? '' : 'none';
    });
}

/* ================================================
   NOTIFICATIONS
================================================ */
var allNotifs = []; var notifCounter = 0;
var notifPanel   = document.getElementById('notifPanel');
var notifPanelBody = document.getElementById('notifPanelBody');
var notifBadge   = document.getElementById('notifBadge');
var notifCountLabel = document.getElementById('notifCountLabel');
var NOTIF_SEEN_STORAGE_KEY = 'company_seen_notification_keys';
var seenNotifKeys = new Set();

function loadSeenNotifKeys(){
    try {
        var raw = localStorage.getItem(NOTIF_SEEN_STORAGE_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e){
        return [];
    }
}
function saveSeenNotifKeys(){
    try {
        var keys = Array.from(seenNotifKeys);
        if (keys.length > 500) keys = keys.slice(keys.length - 500);
        localStorage.setItem(NOTIF_SEEN_STORAGE_KEY, JSON.stringify(keys));
    } catch (e){}
}
function rememberNotifKey(key){
    if (!key) return;
    if (String(key).indexOf('broadcast_admin_') === 0) return;
    if (!seenNotifKeys.has(key)){
        seenNotifKeys.add(key);
        saveSeenNotifKeys();
    }
}
function bootstrapSeenNotifications(seedItems){
    var existing = localStorage.getItem(NOTIF_SEEN_STORAGE_KEY);
    if (existing) return;
    (seedItems || []).forEach(function(n){
        if ((n.kind || 'notification') === 'notification' && n.key) seenNotifKeys.add(n.key);
    });
    saveSeenNotifKeys();
}

function clearNotifNumberOnly(){
    if (notifBadge){ notifBadge.style.display='none'; }
    if (notifCountLabel){ notifCountLabel.style.display='none'; }
}
function getLatestBroadcastId(){
    if (!ADMIN_BROADCASTS.length) return 0;
    return Math.max.apply(null, ADMIN_BROADCASTS.map(function(b){ return Number(b.id || 0); }));
}
function getSeenBroadcastId(){
    return Number(localStorage.getItem('last_seen_admin_broadcast_id') || 0);
}
function isBroadcastUnread(id){
    return Number(id || 0) > getSeenBroadcastId();
}
function hasUnreadBroadcast(){
    var latest = getLatestBroadcastId();
    if (!latest) return false;
    return latest > getSeenBroadcastId();
}
function markBroadcastsRead(){
    var latest = getLatestBroadcastId();
    if (!latest) return;
    localStorage.setItem('last_seen_admin_broadcast_id', String(latest));
    allNotifs.forEach(function(n){
        if (n.kind === 'broadcast') n.read = true;
    });
    renderNotifs();
    updateBroadcastAlert();
}
function toggleNotifPanel(){
    notifPanel.classList.toggle('open');
    if (notifPanel.classList.contains('open')){
        renderNotifs();
        markNotificationsSeen();
        clearNotifNumberOnly();
    }
}
function closeNotifPanel(){ notifPanel.classList.remove('open'); }
function markNotificationsSeen(){
    var changed = false;
    allNotifs.forEach(function(n){
        if (n.kind !== 'notification') return;
        rememberNotifKey(n.key);
        if (!n.read){
            n.read = true;
            changed = true;
        }
    });
    if (changed) renderNotifs();
    else updateBadge();
}
function renderNotifBroadcastFeed(){
    var feed = document.getElementById('notifBroadcastFeed');
    if (!feed) return;
    if (!allNotifs.length){
        feed.innerHTML = '<div class="empty-state" style="padding:2.5rem;"><i class="bi bi-inbox"></i><h5>No Notifications Yet</h5><p>Notifications and admin broadcasts will appear here.</p></div>';
        return;
    }
    var sorted = allNotifs.slice().sort(function(a, b){ return (b.sort_ts || 0) - (a.sort_ts || 0) || b.order - a.order; });
    feed.innerHTML = sorted.map(function(n){
        var kindLabel = n.kind === 'broadcast'
            ? '<span class="feed-kind-label broadcast"><i class="bi bi-megaphone-fill"></i>Broadcast</span>'
            : '<span class="feed-kind-label notification"><i class="bi bi-bell-fill"></i>Notification</span>';
        var headIcon = '<span class="feed-head-icon ' + n.kind + '"><i class="bi ' + (n.kind === 'broadcast' ? 'bi-megaphone-fill' : (n.icon || 'bi-bell-fill')) + '"></i></span>';
        var subject = n.kind === 'broadcast'
            ? '<div class="broadcast-subject">' + escHTML(n.subject || 'Admin Broadcast') + '</div>'
            : '<div class="feed-body" style="font-weight:700; color:#1e3a8a;">Notification Update</div>';
        var meta = '<div class="feed-meta"><span><i class="bi bi-calendar3 me-1"></i>' + escHTML(n.time || 'just now') + '</span>' +
            (n.kind === 'broadcast' ? '<span><i class="bi bi-person-fill me-1"></i>Admin</span>' : '') +
            '</div>';
        var body = n.kind === 'broadcast'
            ? '<div class="broadcast-body">' + escHTML(n.text || '') + '</div>'
            : '<div class="feed-body">' + (n.text || '') + '</div>';
        return '<div class="feed-item ' + n.kind + '">' +
            '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; margin-bottom:0.35rem;">' +
                '<div style="display:flex; align-items:flex-start; gap:0.65rem;">' + headIcon + '<div>' + subject + '</div></div>' + kindLabel +
            '</div>' + meta + body +
        '</div>';
    }).join('');
}
function renderNotifs(){
    if (!allNotifs.length){ notifPanelBody.innerHTML = '<div class="notif-empty"><i class="bi bi-bell-slash"></i>No notifications yet</div>'; return; }
    notifPanelBody.innerHTML = '';
    var sorted = allNotifs.slice().sort(function(a, b){ return (b.sort_ts || 0) - (a.sort_ts || 0) || b.order - a.order; });
    sorted.forEach(function(n){
        var div = document.createElement('div');
        div.className = 'notif-item ' + n.kind + (n.read ? '' : ' unread');
        div.onclick = function(){ markNotifRead(n.id); };
        var contentHtml = '';
        if (n.kind === 'broadcast'){
            contentHtml = '<div class="notif-subject">' + escHTML(n.subject || 'Admin Broadcast') + '</div>' +
                '<div class="notif-text">' + escHTML(n.text || '') + '</div>';
        } else {
            contentHtml = '<div class="notif-text">' + (n.text || '') + '</div>';
        }
        div.innerHTML = '<div class="notif-icon ' + (n.kind === 'broadcast' ? 'broadcast' : n.type) + '"><i class="bi ' + n.icon + '"></i></div>' +
            '<div class="notif-content">' + contentHtml + '<div class="notif-time">' + n.time + '</div></div>' +
            (!n.read ? '<div class="notif-unread-dot ' + n.kind + '"></div>' : '');
        notifPanelBody.appendChild(div);
    });
    renderNotifBroadcastFeed();
    updateBadge();
}
function markNotifRead(id){
    var n = allNotifs.find(function(x){ return x.id===id; });
    if (!n) return;
    n.read = true;
    if (n.kind === 'notification') rememberNotifKey(n.key);
    if (n.kind === 'broadcast') markBroadcastsRead();
    renderNotifs();
}
function markAllRead(){
    allNotifs.forEach(function(n){
        n.read=true;
        if (n.kind === 'notification') rememberNotifKey(n.key);
    });
    markBroadcastsRead();
    renderNotifs();
    updateBadge();
}
function updateBadge(){
    var unread = allNotifs.filter(function(n){ return !n.read && n.kind === 'notification'; }).length;
    if (unread > 0){ notifBadge.textContent = unread; notifBadge.style.display='flex'; notifCountLabel.textContent=unread; notifCountLabel.style.display='inline'; }
    else { notifBadge.style.display='none'; notifCountLabel.style.display='none'; }
    updateBroadcastAlert();
}
function updateBroadcastAlert(){
    var floatPill = document.getElementById('broadcastFloatPill');
    var bellDot = document.getElementById('broadcastBellDot');
    var sidebarDot = document.getElementById('broadcastSidebarDot');
    var panelDot = document.getElementById('broadcastPanelDot');
    var unreadBroadcast = hasUnreadBroadcast();
    if (floatPill) floatPill.style.display = unreadBroadcast ? 'inline-flex' : 'none';
    if (bellDot) bellDot.style.display = unreadBroadcast ? 'block' : 'none';
    if (sidebarDot) sidebarDot.style.display = unreadBroadcast ? 'block' : 'none';
    if (panelDot) panelDot.style.display = unreadBroadcast ? 'block' : 'none';
}
function addNotif(kind, type, icon, text, time, key, meta){
    if (allNotifs.some(function(n){ return n.key === key; })) return false;
    meta = meta || {};
    var isBroadcast = kind === 'broadcast';
    allNotifs.push({
        id: ++notifCounter,
        order: notifCounter,
        kind: isBroadcast ? 'broadcast' : 'notification',
        type: type || 'info',
        icon: icon || 'bi-info-circle',
        subject: meta.subject || '',
        text: text || '',
        time: time || 'just now',
        sort_ts: Number(meta.sort_ts || 0),
        read: isBroadcast ? !isBroadcastUnread(meta.broadcast_id) : seenNotifKeys.has(key),
        key: key,
        broadcast_id: meta.broadcast_id || null
    });
    renderNotifBroadcastFeed();
    updateBadge();
    if (notifPanel.classList.contains('open')) renderNotifs();
    return true;
}
async function pollNotifs(){
    try {
        var res = await fetch('/api/company/notifications', { credentials: 'same-origin' });
        if (!res.ok) return;
        var data = await res.json();
        var items = data.items || data.notifications || [];
        items.forEach(function(n){
            addNotif(n.kind || 'notification', n.type, n.icon, n.text, n.time, n.key, {
                subject: n.subject,
                broadcast_id: n.broadcast_id,
                sort_ts: n.sort_ts
            });
        });
    } catch(e) {}
}
window._companyNotifs = Array.isArray(window.COMPANY_DASHBOARD_DATA?.notificationsSeed) ? window.COMPANY_DASHBOARD_DATA.notificationsSeed : [];
seenNotifKeys = new Set(loadSeenNotifKeys());
bootstrapSeenNotifications(window._companyNotifs);
window._companyNotifs.forEach(function(n){
    addNotif(n.kind || 'notification', n.type, n.icon, n.text, n.time, n.key, {
        subject: n.subject,
        broadcast_id: n.broadcast_id,
        sort_ts: n.sort_ts
    });
});
updateBadge();
setInterval(pollNotifs, 30000);
document.addEventListener('click', function(e){
    var bell = document.querySelector('.notif-bell-btn');
    if (notifPanel.classList.contains('open') && !notifPanel.contains(e.target) && bell && !bell.contains(e.target)) closeNotifPanel();
});

rebuildUpcomingEvents();


/* ================================================
   HELPER
================================================ */
function escHTML(str){ return DashboardUtils.escapeHtml(str); }

/* ================================================
   ANALYTICS CHARTS (lazy init on tab switch)
================================================ */
var chartsInitialized = false;
function initCharts(){
    if (chartsInitialized) return;
    var data = window._analyticsData;
    if (!data) return;
    chartsInitialized = true;
    function createChart(canvas, config){
        var existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        return new Chart(canvas, config);
    }
    setTimeout(function(){
        // Status Donut
        var donutCanvas = document.getElementById('statusDonut');
        if (donutCanvas){
            var total = Object.values(data.statusDist).reduce(function(a,b){ return a+b; }, 0);
            if (total > 0){
                createChart(donutCanvas, {
                    type: 'doughnut',
                    data: {
                        labels: ['Pending / Waiting','Shortlisted','Interview','Placed','Rejected'],
                        datasets: [{ data: [data.statusDist.pending, data.statusDist.shortlisted, data.statusDist.interview, data.statusDist.selected, data.statusDist.rejected], backgroundColor: ['#f59e0b','#eab308','#8b5cf6','#10b981','#ef4444'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }]
                    },
                    options: { responsive:true, maintainAspectRatio:true, cutout:'70%', plugins:{ legend:{display:false}, tooltip:{callbacks:{label:function(ctx){ return ctx.label+': '+ctx.parsed+(total>0?' ('+((ctx.parsed/total)*100).toFixed(1)+'%)':''); }}} } }
                });
            }
        }
        // Drive Status Donut
        var dsCtx = document.getElementById('driveStatusDonut');
        if (dsCtx){
                                    var closed = Number(window.COMPANY_DASHBOARD_DATA?.closedDrivesCount ?? 0);
            createChart(dsCtx, {
                type: 'doughnut',
                data: { labels:['Approved','Pending','Closed'], datasets:[{ data:[data.approvedDrives, data.pendingDrives, closed], backgroundColor:['#10b981','#f59e0b','#6b7280'], borderWidth:3, borderColor:'#fff', hoverOffset:6 }] },
                options: { responsive:true, maintainAspectRatio:true, cutout:'65%', plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){ return ' '+ctx.label+': '+ctx.parsed; }}}} }
            });
        }
        // Success Rate Chart
        var srCanvas = document.getElementById('successRateChart');
        if (srCanvas && data.drives.length > 0){
            var successDrives = data.drives.filter(function(d){ return d.applications > 0; });
            if (successDrives.length){
                var rates = successDrives.map(function(d){ return +((d.selected / d.applications) * 100).toFixed(1); });
                // Keep chart readable with many drives.
                var idealHeight = Math.max(260, successDrives.length * 44);
                srCanvas.height = idealHeight;
                srCanvas.style.height = idealHeight + 'px';
                createChart(srCanvas, {
                    type: 'bar',
                    data: {
                        labels: successDrives.map(function(d){ return d.label; }),
                        datasets: [{ label:'Selection Rate (%)', data: rates, backgroundColor: rates.map(function(r){ return r >= 50 ? 'rgba(16,185,129,0.85)' : r > 0 ? 'rgba(245,158,11,0.85)' : 'rgba(239,68,68,0.85)'; }), borderRadius: 5 }]
                    },
                    options: {
                        indexAxis:'y',
                        responsive:true,
                        maintainAspectRatio:false,
                        resizeDelay: 180,
                        plugins:{
                            legend:{display:false},
                            tooltip:{
                                callbacks:{
                                    title:function(ctx){ return ctx && ctx[0] ? ctx[0].label : ''; },
                                    label:function(ctx){ return ' ' + ctx.parsed.x + '% selection rate'; }
                                }
                            }
                        },
                        scales:{
                            x:{
                                beginAtZero:true,
                                max:100,
                                ticks:{ callback:function(v){ return v + '%'; }, stepSize:10 },
                                grid:{ color:'rgba(0,0,0,0.05)' }
                            },
                            y:{
                                grid:{ display:false },
                                ticks:{ font:{ size:11 }, autoSkip:false }
                            }
                        }
                    }
                });
            }
        }
        // Stacked Drive Bar
        var stackedCanvas = document.getElementById('stackedDriveBar');
        if (stackedCanvas && (data.drivesBreakdown || []).length > 0){
            var breakdown = data.drivesBreakdown || [];
            createChart(stackedCanvas, {
                type: 'bar',
                data: {
                    labels: breakdown.map(function(d){ return d.label; }),
                    datasets: [
                        { label:'Pending',     data: breakdown.map(function(d){ return Math.max(0, d.applications - d.shortlisted - d.interview - d.selected - d.rejected); }), backgroundColor:'rgba(107,114,128,0.7)', borderRadius:4 },
                        { label:'Shortlisted', data: breakdown.map(function(d){ return d.shortlisted; }),  backgroundColor:'rgba(234,179,8,0.85)',  borderRadius:4 },
                        { label:'Interview',   data: breakdown.map(function(d){ return d.interview; }),    backgroundColor:'rgba(139,92,246,0.85)', borderRadius:4 },
                        { label:'Placed',    data: breakdown.map(function(d){ return d.selected; }),     backgroundColor:'rgba(16,185,129,0.85)', borderRadius:4 },
                        { label:'Rejected',    data: breakdown.map(function(d){ return d.rejected; }),     backgroundColor:'rgba(239,68,68,0.7)',   borderRadius:4 }
                    ]
                },
                options: { responsive:true, maintainAspectRatio:false, resizeDelay:180, plugins:{legend:{labels:{boxWidth:12,padding:14,font:{size:11}}},tooltip:{mode:'index',intersect:false}}, scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:11}}},y:{stacked:true,beginAtZero:true,ticks:{stepSize:1,precision:0}}} }
            });
        }
    }, 80);
}

// Auto dismiss flash alerts
DashboardUtils.autoDismissBootstrapAlerts(5000);

if (INITIAL_SECTION){ navigateToSection(INITIAL_SECTION); }
else {
    try {
        var saved = localStorage.getItem('company_dashboard_section');
        if (saved) navigateToSection(saved);
    } catch(e) {}
}

if (document.getElementById('activeViewBtn')){ applyPreferredActiveDriveView(); }
