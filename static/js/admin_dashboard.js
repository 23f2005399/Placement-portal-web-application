/* Shared dashboard helpers + Admin dashboard logic */

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
       * Admin Dashboard Script
       * ----------------------
       * Beginner map:
       * 1) Navigation + section switching
       * 2) Table filters and history filters
       * 3) Charts + activity details
       * 4) Broadcast + support ticket actions
       */
      /* ================================================================
         SECTION NAVIGATION
      ================================================================ */
      function navigateToSection(name){
          const validSections=['overview','pending','students','companies','drives','applications','analytics','history','broadcast','support'];
          if(!validSections.includes(name)) name='overview';
          document.querySelectorAll('.content-section').forEach(s=>s.classList.remove('active'));
          const t=document.getElementById(name+'-section');
          if(t)t.classList.add('active');
          document.querySelectorAll('.sidebar-link[data-section]').forEach(l=>l.classList.remove('active'));
          const lk=document.querySelector(`.sidebar-link[data-section="${name}"]`);
          if(lk)lk.classList.add('active');
          if(location.hash!==`#${name}`){
              history.replaceState(null,'',`#${name}`);
          }
          try{sessionStorage.setItem('adminActiveSection',name);}catch(e){}
          closeSidebar();
          window.scrollTo(0,0);
          if(name==='analytics')initAnalyticsCharts();
          if(name==='overview'){setTimeout(initOverviewViz,100);}
          if(name==='pending'){
              let pendingTab='companies';
              try{pendingTab=sessionStorage.getItem('adminPendingTab')||'companies';}catch(e){}
              switchPendingApprovalTab(pendingTab);
          }
          if(name==='broadcast'){loadBroadcastHistory();}
          if(name==='support'){filterTickets();}
          if(name==='history'){
              let historyTab='students';
              try{historyTab=sessionStorage.getItem('adminHistoryTab')||'students';}catch(e){}
              switchHistoryTab(historyTab);
          }
      }
      DashboardUtils.bindSectionLinks('.sidebar-link[data-section]', function(section){
          navigateToSection(section);
      });
      window.addEventListener('hashchange',()=>{
          const section=(location.hash||'#overview').slice(1);
          navigateToSection(section);
      });

      /* ================================================================ SIDEBAR ================================================================ */
      function toggleSidebar(){DashboardUtils.toggleSidebar('sidebar','sidebarOverlay');}
      function closeSidebar(){DashboardUtils.closeSidebar('sidebar','sidebarOverlay');}
      function switchPendingApprovalTab(tab){
          const key=(tab==='drives')?'drives':'companies';
          document.querySelectorAll('.pending-pane').forEach(p=>p.classList.remove('active'));
          document.querySelectorAll('.pending-tab-btn').forEach(b=>b.classList.remove('active'));
          document.getElementById('pending-pane-'+key)?.classList.add('active');
          document.getElementById('ptab-'+key)?.classList.add('active');
          try{sessionStorage.setItem('adminPendingTab',key);}catch(e){}
      }

      /* ================================================================ GLOBAL SEARCH ================================================================ */
      (function(){
          const input=document.getElementById('gsInput');
          const clear=document.getElementById('gsClear');
          const dropdown=document.getElementById('gsDropdown');
          const wrap=document.getElementById('gsWrap');
          const typeSelect=document.getElementById('gsType');
          if(!input)return;

                              const students=(window.ADMIN_DASHBOARD_DATA && window.ADMIN_DASHBOARD_DATA.students) || [];
                              const companies=(window.ADMIN_DASHBOARD_DATA && window.ADMIN_DASHBOARD_DATA.companies) || [];
          const LIMIT=8;
          const expanded={student:false,company:false};

          function hl(text,term){
              if(!term||!text)return String(text||'');
              const re=new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
              return String(text).replace(re,'<mark style="background:rgba(37,99,235,0.13);color:var(--accent);border-radius:3px;padding:0 2px;">$1</mark>');
          }

          function buildItem(ref,id,iconClass,iconName,title,sub,term){
              return `<div class="gs-item" data-ref="${ref}" data-id="${id}"><div class="gs-item-icon ${iconClass}"><i class="bi ${iconName}"></i></div><div class="gs-item-body"><div class="gs-item-title">${hl(title,term)}</div><div class="gs-item-sub">${sub}</div></div><i class="bi bi-arrow-right gs-item-arrow"></i></div>`;
          }

          function render(term){
              const t=term.trim(),tl=t.toLowerCase(),type=typeSelect.value;
              const tnorm=tl.replace(/[^a-z0-9]/g,'');
              const norm=(v)=>(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
              if(!t){hide();return;}
              let total=0,html='';

              if(type==='student'||type==='all'){
                  const all=students.filter(s=>
                      (s.student_id||'').toLowerCase().includes(tl) ||
                      (tnorm && norm(s.student_id).includes(tnorm)) ||
                      String(s.id).includes(tl) ||
                      (s.name||'').toLowerCase().includes(tl) ||
                      (s.email||'').toLowerCase().includes(tl) ||
                      (s.college||'').toLowerCase().includes(tl) ||
                      (s.degree||'').toLowerCase().includes(tl) ||
                      (s.contact||'').toLowerCase().includes(tl) ||
                      (tnorm && norm(s.contact).includes(tnorm))
                  );
                  if(all.length){
                      const shown=expanded.student?all:all.slice(0,LIMIT);
                      html+=`<div class="gs-section-label"><i class="bi bi-people-fill"></i>Students<span style="margin-left:auto;font-size:0.65rem;background:rgba(37,99,235,0.1);color:var(--accent);padding:0.1rem 0.45rem;border-radius:8px;">${all.length}</span></div>`;
                      shown.forEach(s=>{html+=buildItem('student',s.id,'student','bi-person-fill',s.name,`${hl(s.student_id||('#'+s.id),t)}${s.email?' · '+hl(s.email,t):''}${s.contact?' · '+hl(s.contact,t):''}${s.college?' · '+hl(s.college,t):''}${s.degree?' · '+hl(s.degree,t):''}`,t);});
                      if(all.length>LIMIT&&!expanded.student)html+=`<button class="gs-show-more" id="gsExpandStudent">Show all ${all.length} students <i class="bi bi-chevron-down"></i></button>`;
                      total+=all.length;
                  }
              }

              if(type==='company'||type==='all'){
                  const all=companies.filter(c=>String(c.id).includes(tl)||(c.company_id||'').toLowerCase().includes(tl)||(c.company_name||'').toLowerCase().includes(tl)||(c.email||'').toLowerCase().includes(tl)||(c.industry||'').toLowerCase().includes(tl));
                  if(all.length){
                      const shown=expanded.company?all:all.slice(0,LIMIT);
                      html+=`<div class="gs-section-label"><i class="bi bi-building-fill"></i>Companies<span style="margin-left:auto;font-size:0.65rem;background:rgba(245,158,11,0.1);color:var(--warning);padding:0.1rem 0.45rem;border-radius:8px;">${all.length}</span></div>`;
                      shown.forEach(c=>{html+=buildItem('company',c.id,'company','bi-building-fill',c.company_name,`${hl(c.company_id||('#'+c.id),t)}${c.industry?' · '+hl(c.industry,t):''}${c.email?' · '+hl(c.email,t):''}`,t);});
                      if(all.length>LIMIT&&!expanded.company)html+=`<button class="gs-show-more" id="gsExpandCompany">Show all ${all.length} companies <i class="bi bi-chevron-down"></i></button>`;
                      total+=all.length;
                  }
              }

              if(!total)html=`<div class="gs-empty"><i class="bi bi-search"></i>No results for <strong>"${t}"</strong><br><span style="font-size:0.8rem;display:block;margin-top:0.3rem;">Try name, email, ID, industry, or course</span></div>`;

              const header=total>0?`<div class="gs-dropdown-header"><span class="gs-dropdown-query">Results for <strong>"${t}"</strong></span><span class="gs-result-pill">${total} found</span></div>`:'';
              dropdown.innerHTML=header+html;

              const es=document.getElementById('gsExpandStudent');
              if(es)es.addEventListener('click',()=>{expanded.student=true;render(input.value);});
              const ec=document.getElementById('gsExpandCompany');
              if(ec)ec.addEventListener('click',()=>{expanded.company=true;render(input.value);});
              dropdown.querySelectorAll('.gs-item[data-ref][data-id]').forEach(item=>{
                  item.addEventListener('click',()=>{
                      const ref=item.getAttribute('data-ref');
                      const id=item.getAttribute('data-id');
                      if(!ref||!id)return;
                      hide();
                      showActivityDetail(ref,id);
                  });
              });
              show();
          }

          function show(){dropdown.classList.add('visible');}
          function hide(){dropdown.classList.remove('visible');}

          window.clearGS=function(){input.value='';clear.style.display='none';expanded.student=false;expanded.company=false;hide();input.focus();};
          input.addEventListener('input',function(){clear.style.display=this.value?'flex':'none';expanded.student=false;expanded.company=false;render(this.value);});
          input.addEventListener('keydown',e=>{if(e.key==='Escape')clearGS();if(e.key==='Enter'&&input.value.trim())window.location.href=`/admin/dashboard?search=${encodeURIComponent(input.value)}&search_type=${typeSelect.value}`;});
          typeSelect.addEventListener('change',()=>{if(input.value)render(input.value);});
          document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==input&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){e.preventDefault();input.focus();}});
          document.addEventListener('click',e=>{if(!wrap.contains(e.target))hide();});
      })();

      /* ================================================================ TABLE FILTERS ================================================================ */
      document.getElementById('studentSearch')?.addEventListener('input',filterStudents);
      document.getElementById('studentStatusFilter')?.addEventListener('change',filterStudents);
      function normalizeSearchToken(v){
          return (v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      }
      function filterStudents(){
          const term=(document.getElementById('studentSearch')?.value||'').toLowerCase().trim();
          const termNorm=normalizeSearchToken(term);
          const status=(document.getElementById('studentStatusFilter')?.value||'').toLowerCase();
          const rows=document.querySelectorAll('.student-row');let vis=0;
          rows.forEach(r=>{
              const idMatch=(r.dataset.studentId||'').includes(term);
              const nameMatch=(r.dataset.studentName||'').includes(term);
              const emailMatch=(r.dataset.studentEmail||'').includes(term);
              const contactRaw=(r.dataset.studentContact||'');
              const contactMatch=contactRaw.includes(term) || (termNorm && normalizeSearchToken(contactRaw).includes(termNorm));
              const fieldMatch=!term || idMatch || nameMatch || emailMatch || contactMatch;
              const m=fieldMatch && (!status||r.dataset.status===status);
              r.style.display=m?'':'none';
              r.classList.toggle('row-match', !!term && m);
              if(m)vis++;
          });
          document.getElementById('noStudentsMsg').style.display=vis===0?'':'none';
      }

      function filterCompanies(){
          const term=(document.getElementById('companySearch')?.value||'').toLowerCase().trim();
          const approval=(document.getElementById('companyApprovalFilter')?.value||'').toLowerCase();
          const status=(document.getElementById('companyStatusFilter')?.value||'').toLowerCase();
          const rows=document.querySelectorAll('.company-row');let vis=0;
          rows.forEach(r=>{
              const idMatch=(r.dataset.companyId||'').includes(term);
              const nameMatch=(r.dataset.companyName||'').includes(term);
              const industryMatch=(r.dataset.companyIndustry||'').includes(term);
              const fieldMatch=!term || idMatch || nameMatch || industryMatch;
              const m=fieldMatch&&(!approval||r.dataset.approval===approval)&&(!status||r.dataset.status===status);
              r.style.display=m?'':'none';
              r.classList.toggle('row-match', !!term && m);
              if(m)vis++;
          });
          document.getElementById('noCompaniesMsg').style.display=vis===0?'':'none';
      }
      document.getElementById('companySearch')?.addEventListener('input',filterCompanies);
      document.getElementById('companyApprovalFilter')?.addEventListener('change',filterCompanies);
      document.getElementById('companyStatusFilter')?.addEventListener('change',filterCompanies);

      function filterDrives(){
          const term=(document.getElementById('drivesSearch')?.value||'').toLowerCase();
          const status=(document.getElementById('drivesStatusFilter')?.value||'');
          const rows=document.querySelectorAll('.drive-row');let vis=0;
          rows.forEach(r=>{const m=(!term||r.dataset.search.includes(term))&&(!status||r.dataset.status===status);r.style.display=m?'':'none';if(m)vis++;});
          document.getElementById('noDrivesMsg').style.display=vis===0?'':'none';
      }
      document.getElementById('drivesSearch')?.addEventListener('input',filterDrives);
      document.getElementById('drivesStatusFilter')?.addEventListener('change',filterDrives);

      function filterApps(){
          const term=(document.getElementById('appsSearch')?.value||'').toLowerCase();
          const status=(document.getElementById('appsStatusFilter')?.value||'');
          const rows=document.querySelectorAll('.app-row');let vis=0;
          rows.forEach(r=>{const m=(!term||r.dataset.search.includes(term))&&(!status||r.dataset.status===status);r.style.display=m?'':'none';if(m)vis++;});
          document.getElementById('noAppsMsg').style.display=vis===0?'':'none';
      }
      document.getElementById('appsSearch')?.addEventListener('input',filterApps);
      document.getElementById('appsStatusFilter')?.addEventListener('change',filterApps);


      /* ================================================================ HISTORY TABS + FILTERS ================================================================ */
      function switchHistoryTab(name){
          const valid=['students','companies','drives','applications'];
          const safeName=valid.includes(name)?name:'students';
          valid.forEach(n=>{
              document.getElementById(`history-pane-${n}`)?.classList.remove('active');
              document.getElementById(`htab-${n}`)?.classList.remove('active');
          });
          document.getElementById(`history-pane-${safeName}`)?.classList.add('active');
          document.getElementById(`htab-${safeName}`)?.classList.add('active');
          try{sessionStorage.setItem('adminHistoryTab',safeName);}catch(e){}
      }

      function filterHistoryStudents(){
          const term=(document.getElementById('historyStudentsSearch')?.value||'').toLowerCase();
          const status=(document.getElementById('historyStudentsStatus')?.value||'').toLowerCase();
          const dateFrom=(document.getElementById('historyStudentsDateFrom')?.value||'').trim();
          const dateTo=(document.getElementById('historyStudentsDateTo')?.value||'').trim();
          const course=(document.getElementById('historyStudentsCourse')?.value||'').toLowerCase();
          const studyYear=(document.getElementById('historyStudentsStudyYear')?.value||'').toLowerCase();
          const passingYear=(document.getElementById('historyStudentsPassingYear')?.value||'').toLowerCase();
          let vis=0;
          document.querySelectorAll('.hist-student-row').forEach(r=>{
              const rowDate=(r.dataset.date||'').trim();
              const ok=(!term||r.dataset.search.includes(term))
                  &&(!status||r.dataset.status===status)
                  &&(!course||r.dataset.course===course)
                  &&(!studyYear||r.dataset.studyYear===studyYear)
                  &&(!passingYear||r.dataset.passingYear===passingYear)
                  &&(!dateFrom||!rowDate||rowDate>=dateFrom)
                  &&(!dateTo||!rowDate||rowDate<=dateTo);
              r.style.display=ok?'':'none';
              if(ok) vis++;
          });
          const ct=document.getElementById('historyStudentsCount');
          if(ct) ct.textContent=`${vis} shown`;
      }
      function clearHistoryStudentsFilters(){
          ['historyStudentsSearch','historyStudentsStatus','historyStudentsDateFrom','historyStudentsDateTo','historyStudentsCourse','historyStudentsStudyYear','historyStudentsPassingYear'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
          filterHistoryStudents();
      }
      function applyStudentHistoryFilters(){
          filterHistoryStudents();
          bootstrap.Modal.getInstance(document.getElementById('historyStudentFilterModal'))?.hide();
      }

      function filterHistoryCompanies(){
          const term=(document.getElementById('historyCompaniesSearch')?.value||'').toLowerCase();
          const dateFrom=(document.getElementById('historyCompaniesDateFrom')?.value||'').trim();
          const dateTo=(document.getElementById('historyCompaniesDateTo')?.value||'').trim();
          const status=(document.getElementById('historyCompaniesStatus')?.value||'').toLowerCase();
          const industry=(document.getElementById('historyCompaniesIndustry')?.value||'').toLowerCase();
          const minDrives=parseInt((document.getElementById('historyCompaniesMinDrives')?.value||'').trim(),10);
          const maxDrives=parseInt((document.getElementById('historyCompaniesMaxDrives')?.value||'').trim(),10);
          const minDrivesValid=!Number.isNaN(minDrives);
          const maxDrivesValid=!Number.isNaN(maxDrives);
          let vis=0;
          document.querySelectorAll('.hist-company-row').forEach(r=>{
              const drives=parseInt(r.dataset.drives||'0',10);
              const rowDate=(r.dataset.date||'').trim();
              const ok=(!term||r.dataset.search.includes(term))
                  &&(!status||r.dataset.status===status)
                  &&(!industry||r.dataset.industry===industry)
                  &&(!minDrivesValid||drives>=minDrives)
                  &&(!maxDrivesValid||drives<=maxDrives)
                  &&(!dateFrom||!rowDate||rowDate>=dateFrom)
                  &&(!dateTo||!rowDate||rowDate<=dateTo);
              r.style.display=ok?'':'none';
              if(ok) vis++;
          });
          const ct=document.getElementById('historyCompaniesCount');
          if(ct) ct.textContent=`${vis} shown`;
      }
      function applyHistoryCompaniesFilters(){
          filterHistoryCompanies();
          bootstrap.Modal.getInstance(document.getElementById('historyCompanyFilterModal'))?.hide();
      }
      function clearHistoryCompaniesFilters(){
          ['historyCompaniesSearch','historyCompaniesDateFrom','historyCompaniesDateTo','historyCompaniesStatus','historyCompaniesIndustry','historyCompaniesMinDrives','historyCompaniesMaxDrives'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
          filterHistoryCompanies();
      }

      function filterHistoryDrives(){
          const term=(document.getElementById('historyDrivesSearch')?.value||'').toLowerCase();
          const status=(document.getElementById('historyDrivesStatus')?.value||'').toLowerCase();
          const company=(document.getElementById('historyDrivesCompany')?.value||'').toLowerCase();
          const location=(document.getElementById('historyDrivesLocation')?.value||'').toLowerCase();
          const dateFrom=(document.getElementById('historyDrivesDateFrom')?.value||'').trim();
          const dateTo=(document.getElementById('historyDrivesDateTo')?.value||'').trim();
          const minApps=parseInt((document.getElementById('historyDrivesMinApps')?.value||'').trim(),10);
          const maxApps=parseInt((document.getElementById('historyDrivesMaxApps')?.value||'').trim(),10);
          const minAppsValid=!Number.isNaN(minApps);
          const maxAppsValid=!Number.isNaN(maxApps);
          let vis=0;
          document.querySelectorAll('.hist-drive-row').forEach(r=>{
              const apps=parseInt(r.dataset.apps||'0',10);
              const rowDate=(r.dataset.date||'').trim();
              const ok=(!term||r.dataset.search.includes(term))
                  &&(!status||r.dataset.status===status)
                  &&(!company||r.dataset.company===company)
                  &&(!location||r.dataset.location===location)
                  &&(!minAppsValid||apps>=minApps)
                  &&(!maxAppsValid||apps<=maxApps)
                  &&(!dateFrom||!rowDate||rowDate>=dateFrom)
                  &&(!dateTo||!rowDate||rowDate<=dateTo);
              r.style.display=ok?'':'none';
              if(ok) vis++;
          });
          const ct=document.getElementById('historyDrivesCount');
          if(ct) ct.textContent=`${vis} shown`;
      }
      function applyHistoryDrivesFilters(){
          filterHistoryDrives();
          bootstrap.Modal.getInstance(document.getElementById('historyDriveFilterModal'))?.hide();
      }
      function clearHistoryDrivesFilters(){
          ['historyDrivesSearch','historyDrivesStatus','historyDrivesCompany','historyDrivesLocation','historyDrivesDateFrom','historyDrivesDateTo','historyDrivesMinApps','historyDrivesMaxApps'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
          filterHistoryDrives();
      }

      function filterHistoryApps(){
          const term=(document.getElementById('historyAppsSearch')?.value||'').toLowerCase();
          const status=(document.getElementById('historyAppsStatus')?.value||'');
          const dateFrom=(document.getElementById('historyAppsDateFrom')?.value||'').trim();
          const dateTo=(document.getElementById('historyAppsDateTo')?.value||'').trim();
          const drive=(document.getElementById('historyAppsDrive')?.value||'').toLowerCase();
          const company=(document.getElementById('historyAppsCompany')?.value||'').toLowerCase();
          const degree=(document.getElementById('historyAppsDegree')?.value||'').toLowerCase();
          let vis=0;
          document.querySelectorAll('.hist-app-row').forEach(r=>{
              const rowDate=(r.dataset.date||'').trim();
              const ok=(!term||r.dataset.search.includes(term))
                  &&(!status||r.dataset.status===status)
                  &&(!drive||r.dataset.drive===drive)
                  &&(!company||r.dataset.company===company)
                  &&(!degree||r.dataset.degree===degree)
                  &&(!dateFrom||!rowDate||rowDate>=dateFrom)
                  &&(!dateTo||!rowDate||rowDate<=dateTo);
              r.style.display=ok?'':'none';
              if(ok) vis++;
          });
          const ct=document.getElementById('historyAppsCount');
          if(ct) ct.textContent=`${vis} shown`;
      }
      function applyHistoryAppsFilters(){
          filterHistoryApps();
          bootstrap.Modal.getInstance(document.getElementById('historyAppFilterModal'))?.hide();
      }
      function clearHistoryAppsFilters(){
          ['historyAppsSearch','historyAppsStatus','historyAppsDateFrom','historyAppsDateTo','historyAppsDrive','historyAppsCompany','historyAppsDegree'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
          filterHistoryApps();
      }

      function normalizeFilterSelectOptions(selectId){
          const select=document.getElementById(selectId);
          if(!select) return;
          const first=select.options[0];
          const uniq=new Map();
          for(let i=1;i<select.options.length;i++){
              const opt=select.options[i];
              const val=(opt.value||'').trim();
              if(!val) continue;
              const key=val.toLowerCase();
              if(!uniq.has(key)) uniq.set(key,val);
          }
          const sorted=[...uniq.values()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
          select.innerHTML='';
          if(first) select.add(new Option(first.text,first.value));
          sorted.forEach(v=>select.add(new Option(v,v)));
      }

      normalizeFilterSelectOptions('historyStudentsCourse');
      normalizeFilterSelectOptions('historyStudentsStudyYear');
      normalizeFilterSelectOptions('historyStudentsPassingYear');
      normalizeFilterSelectOptions('historyCompaniesIndustry');
      normalizeFilterSelectOptions('historyDrivesCompany');
      normalizeFilterSelectOptions('historyDrivesLocation');
      normalizeFilterSelectOptions('historyAppsDrive');
      normalizeFilterSelectOptions('historyAppsCompany');
      normalizeFilterSelectOptions('historyAppsDegree');

      filterHistoryStudents();
      filterHistoryCompanies();
      filterHistoryDrives();
      filterHistoryApps();

      /* ================================================================ ANALYTICS CHARTS ================================================================ */
      let chartsInit=false;
      function initAnalyticsCharts(){
          if(chartsInit)return;
          const d=window._adminAnalytics;
          if(!d)return;
          chartsInit=true;
          const createChart=(canvas,cfg)=>{
              const existing=Chart.getChart(canvas);
              if(existing) existing.destroy();
              return new Chart(canvas,cfg);
          };
          setTimeout(()=>{
              const total=d.statusDist.applied+d.statusDist.shortlisted+d.statusDist.interview+d.statusDist.selected+d.statusDist.rejected;
              const donutEl=document.getElementById('adminStatusDonut');
              if(donutEl&&total>0){new Chart(donutEl,{type:'doughnut',data:{labels:['Applied','Shortlisted','Interview','Placed','Rejected'],datasets:[{data:[d.statusDist.applied,d.statusDist.shortlisted,d.statusDist.interview,d.statusDist.selected,d.statusDist.rejected],backgroundColor:['#06b6d4','#f59e0b','#8b5cf6','#10b981','#ef4444'],borderWidth:3,borderColor:'#fff',hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:true,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>{const p=total>0?((ctx.parsed/total)*100).toFixed(1):0;return ` ${ctx.label}: ${ctx.parsed} (${p}%)`;}}}}}});}

              const barEl=document.getElementById('adminDriveBar');
              if(barEl&&d.drives.length>0){
                  const driveWrap=document.getElementById('adminDriveBarWrap');
                  if(driveWrap) driveWrap.style.minWidth=Math.max(980, d.drives.length*150)+'px';
                  createChart(barEl,{type:'bar',data:{labels:d.drives.map(x=>x.label),datasets:[{label:'Applications',data:d.drives.map(x=>x.apps),backgroundColor:'rgba(37,99,235,0.82)',borderRadius:6,borderSkipped:false},{label:'Shortlisted',data:d.drives.map(x=>x.shortlisted),backgroundColor:'rgba(245,158,11,0.82)',borderRadius:6,borderSkipped:false},{label:'Interview',data:d.drives.map(x=>x.interview),backgroundColor:'rgba(139,92,246,0.82)',borderRadius:6,borderSkipped:false},{label:'Placed',data:d.drives.map(x=>x.selected),backgroundColor:'rgba(16,185,129,0.82)',borderRadius:6,borderSkipped:false},{label:'Rejected',data:d.drives.map(x=>x.rejected),backgroundColor:'rgba(239,68,68,0.82)',borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,resizeDelay:180,plugins:{legend:{display:true,labels:{boxWidth:12,padding:16,font:{family:'DM Sans',size:12}}},tooltip:{mode:'index',intersect:false}},scales:{x:{grid:{display:false},ticks:{font:{family:'DM Sans',size:11},autoSkip:false,maxRotation:30,minRotation:0}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{font:{family:'DM Sans'},stepSize:1,precision:0}}}}});
              }

              const compEl=document.getElementById('adminCompanyBar');
              if(compEl&&d.companies.length>0){
                  const companyWrap=document.getElementById('adminCompanyBarWrap');
                  if(companyWrap) companyWrap.style.minWidth=Math.max(980, d.companies.length*170)+'px';
                  createChart(compEl,{type:'bar',data:{labels:d.companies.map(x=>x.label),datasets:[{label:'Total Drives',data:d.companies.map(x=>x.drives),backgroundColor:'rgba(245,158,11,0.78)',borderRadius:5},{label:'Placed Students',data:d.companies.map(x=>x.placed),backgroundColor:'rgba(16,185,129,0.78)',borderRadius:5},{label:'Rejected Applications',data:d.companies.map(x=>x.rejected||0),backgroundColor:'rgba(239,68,68,0.78)',borderRadius:5}]},options:{responsive:true,maintainAspectRatio:false,resizeDelay:180,plugins:{legend:{display:true,labels:{boxWidth:12,font:{family:'DM Sans',size:11}}}},scales:{x:{grid:{display:false},ticks:{autoSkip:false,maxRotation:30,minRotation:0,font:{family:'DM Sans',size:11}}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{stepSize:1,precision:0}}}}});
              }

              const monthEl=document.getElementById('placementTrendMonthly');
              const selectedDates=(d.selectedDates||[])
                  .map(v=>new Date(v))
                  .filter(dt=>!Number.isNaN(dt.getTime()));
              const monthlyMap=new Map();
              const now=new Date();
              // Always show a stable monthly timeline so the trend chart remains readable.
              for(let i=11;i>=0;i--){
                  const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
                  const key=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
                  monthlyMap.set(key,0);
              }
              selectedDates.forEach(dt=>{
                  const key=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
                  if(monthlyMap.has(key)) monthlyMap.set(key,(monthlyMap.get(key)||0)+1);
              });
              const monthKeys=[...monthlyMap.keys()];
              const monthLabels=monthKeys.map(k=>{
                  const [yy,mm]=k.split('-');
                  return new Date(Number(yy),Number(mm)-1,1).toLocaleString('en-IN',{month:'short',year:'numeric'});
              });
              const monthValues=monthKeys.map(k=>monthlyMap.get(k)||0);

              if(monthEl){
                  createChart(monthEl,{type:'line',data:{labels:monthLabels,datasets:[{label:'Placed (Monthly)',data:monthValues,borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,0.14)',fill:true,tension:0.35,borderWidth:2.5,pointRadius:3,pointHoverRadius:4,pointBackgroundColor:'#2563eb'}]},options:{responsive:true,maintainAspectRatio:false,resizeDelay:180,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{autoSkip:true,maxRotation:35,minRotation:0,font:{family:'DM Sans',size:11}}},y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{stepSize:1,precision:0}}}}});
              }
          },80);
      }

      /* ================================================================ OVERVIEW VIZ ================================================================ */
      function initOverviewViz(){
          const ringFill=document.getElementById('overviewRingFill');
          const ringPct=document.getElementById('overviewRingPct');
          if(ringFill&&ringPct){
                                          const rate=Number(window.ADMIN_DASHBOARD_DATA?.placementRate ?? 0);
              const circ=2*Math.PI*54;
              const offset=circ-(rate/100)*circ;
              setTimeout(()=>{
                  ringFill.style.strokeDashoffset=offset;
                  let cur=0;const step=rate/60;
                  const tmr=setInterval(()=>{cur=Math.min(cur+step,rate);ringPct.textContent=cur.toFixed(1)+'%';if(cur>=rate)clearInterval(tmr);},16);
              },300);
          }
          const funnel=document.getElementById('overviewFunnel');
          if(funnel){
              const base=parseInt(funnel.dataset.applied)||1;
              const stages=[{id:'fbar-applied',val:parseInt(funnel.dataset.applied)||0,pid:null},{id:'fbar-shortlisted',val:parseInt(funnel.dataset.shortlisted)||0,pid:'fpct-shortlisted'},{id:'fbar-interview',val:parseInt(funnel.dataset.interview)||0,pid:'fpct-interview'},{id:'fbar-selected',val:parseInt(funnel.dataset.selected)||0,pid:'fpct-selected'},{id:'fbar-rejected',val:parseInt(funnel.dataset.rejected)||0,pid:'fpct-rejected'}];
              setTimeout(()=>{stages.forEach(s=>{const b=document.getElementById(s.id);if(b)b.style.width=Math.max((s.val/base)*100,s.val>0?5:0)+'%';if(s.pid){const el=document.getElementById(s.pid);if(el)el.textContent=base>0?((s.val/base)*100).toFixed(0)+'%':'—';}});},200);
          }
          const dsCard=document.getElementById('driveStatusCard');
          if(dsCard){
              const total=parseInt(dsCard.dataset.total)||1;
              [['dsbar-approved',parseInt(dsCard.dataset.approved)||0],['dsbar-pending',parseInt(dsCard.dataset.pending)||0],['dsbar-closed',parseInt(dsCard.dataset.closed)||0],['dsbar-rejected',parseInt(dsCard.dataset.rejected)||0]].forEach(([id,val])=>{const b=document.getElementById(id);if(b)b.style.width=Math.max((val/total)*100,val>0?6:0)+'%';});
          }
      }

      /* ================================================================ ACTIVITY DETAIL ================================================================ */
      function showActivityDetail(ref,id){
          const modal=new bootstrap.Modal(document.getElementById('activityDetailModal'));
          const titleEl=document.getElementById('actDetailTitle');
          const bodyEl=document.getElementById('actDetailBody');
          const renderFromSourceModal=(modalIds)=>{
              for(const modalId of modalIds){
                  const srcModal=document.getElementById(modalId);
                  if(!srcModal) continue;
                  const srcTitle=srcModal.querySelector('.modal-title-custom');
                  const srcBody=srcModal.querySelector('.modal-body');
                  if(!srcBody) continue;
                  titleEl.textContent=(srcTitle?.textContent||'Event Details').trim();
                  bodyEl.innerHTML=srcBody.innerHTML;
                  return true;
              }
              return false;
          };
          titleEl.textContent='Event Details';
          bodyEl.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--grey-400);">Loading event details…</div>`;
          modal.show();
          if(ref==='drive'){
              if(!renderFromSourceModal(['driveDetailModal'+id,'pendingDriveModal'+id])){
                  bodyEl.innerHTML='<p style="color:var(--grey-600);padding:1rem;">Drive details are not available for this event.</p>';
              }
          } else if(ref==='student'){
              if(!renderFromSourceModal(['viewStudentModal'+id])){
                  bodyEl.innerHTML='<p style="color:var(--grey-600);padding:1rem;">Student details are not available for this record.</p>';
              }
          } else if(ref==='company'){
              if(!renderFromSourceModal(['viewCompanyModal'+id,'companyDetailModal'+id])){
                  bodyEl.innerHTML='<p style="color:var(--grey-600);padding:1rem;">Company details are not available for this event.</p>';
              }
          } else if(ref==='app'){
              if(!renderFromSourceModal(['appDetailModal'+id])){
                  bodyEl.innerHTML='<p style="color:var(--grey-600);padding:1rem;">Application details are not available for this event.</p>';
              }
          } else {
              bodyEl.innerHTML='<p style="color:var(--grey-600);padding:1rem;">Details not available for this event type.</p>';
          }
      }

      function showDriveEditDetail(id){
          const srcModal=document.getElementById('editDriveModal'+id);
          if(!srcModal){
              const detailModal=new bootstrap.Modal(document.getElementById('activityDetailModal'));
              document.getElementById('actDetailTitle').textContent='Edit Drive';
              document.getElementById('actDetailBody').innerHTML='<p style="color:var(--grey-600);padding:1rem;">Edit form is not available for this drive.</p>';
              detailModal.show();
              return;
          }

          const existingTemp=document.getElementById('editDriveModalTemp');
          if(existingTemp){
              bootstrap.Modal.getInstance(existingTemp)?.hide();
              existingTemp.remove();
          }

          const tempModal=document.createElement('div');
          tempModal.className='modal fade';
          tempModal.id='editDriveModalTemp';
          tempModal.tabIndex=-1;
          tempModal.innerHTML=srcModal.innerHTML;

          const idSuffix='-ov-'+id;
          tempModal.querySelectorAll('[id]').forEach(el=>{
              const oldId=el.id;
              const newId=oldId+idSuffix;
              tempModal.querySelectorAll(`[for="${oldId}"]`).forEach(lbl=>lbl.setAttribute('for',newId));
              el.id=newId;
          });

          const clonedForm=tempModal.querySelector('form');
          if(clonedForm){
              clonedForm.removeAttribute('onsubmit');
              const errEl=clonedForm.querySelector(`[id="editAudienceError${id}${idSuffix}"]`);
              if(errEl) errEl.id=`editAudienceError${id}-ov`;
              clonedForm.addEventListener('submit',(e)=>{
                  if(!validateAudienceForm(clonedForm,true,`editAudienceError${id}-ov`)){
                      e.preventDefault();
                  }
              });
          }

          document.body.appendChild(tempModal);
          tempModal.addEventListener('hidden.bs.modal',()=>tempModal.remove(),{once:true});
          new bootstrap.Modal(tempModal).show();
      }

      function openDeletedStudentHistoryDetail(btn){
          const modal=new bootstrap.Modal(document.getElementById('activityDetailModal'));
          const titleEl=document.getElementById('actDetailTitle');
          const bodyEl=document.getElementById('actDetailBody');
          if(!btn||!titleEl||!bodyEl)return;
          const studentId=btn.dataset.studentId||'—';
          const name=btn.dataset.name||'—';
          const email=btn.dataset.email||'—';
          const college=btn.dataset.college||'—';
          const course=btn.dataset.course||'—';
          const deletedOn=btn.dataset.deletedOn||'—';
          const deletedBy=btn.dataset.deletedBy||'Admin';
          titleEl.textContent='Deleted Student Record';
          bodyEl.innerHTML=`
              <div style="display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:0.9rem;">
                  <div class="detail-item"><label>Student ID</label><div class="dval">${escapeHTML(studentId)}</div></div>
                  <div class="detail-item"><label>Name</label><div class="dval">${escapeHTML(name)}</div></div>
                  <div class="detail-item"><label>Email</label><div class="dval">${escapeHTML(email)}</div></div>
                  <div class="detail-item"><label>College</label><div class="dval">${escapeHTML(college)}</div></div>
                  <div class="detail-item"><label>Course</label><div class="dval">${escapeHTML(course)}</div></div>
                  <div class="detail-item"><label>Deleted On (IST)</label><div class="dval">${escapeHTML(deletedOn)}</div></div>
                  <div class="detail-item"><label>Deleted By</label><div class="dval">${escapeHTML(deletedBy)}</div></div>
              </div>`;
          modal.show();
      }

      function openDeletedCompanyHistoryDetail(btn){
          const modal=new bootstrap.Modal(document.getElementById('activityDetailModal'));
          const titleEl=document.getElementById('actDetailTitle');
          const bodyEl=document.getElementById('actDetailBody');
          if(!btn||!titleEl||!bodyEl)return;
          const companyId=btn.dataset.companyId||'—';
          const name=btn.dataset.name||'—';
          const email=btn.dataset.email||'—';
          const industry=btn.dataset.industry||'—';
          const approvalStatus=btn.dataset.approvalStatus||'—';
          const deletedOn=btn.dataset.deletedOn||'—';
          const deletedBy=btn.dataset.deletedBy||'Admin';
          titleEl.textContent='Deleted Company Record';
          bodyEl.innerHTML=`
              <div style="display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:0.9rem;">
                  <div class="detail-item"><label>Company ID</label><div class="dval">${escapeHTML(companyId)}</div></div>
                  <div class="detail-item"><label>Company Name</label><div class="dval">${escapeHTML(name)}</div></div>
                  <div class="detail-item"><label>Email</label><div class="dval">${escapeHTML(email)}</div></div>
                  <div class="detail-item"><label>Industry</label><div class="dval">${escapeHTML(industry)}</div></div>
                  <div class="detail-item"><label>Last Approval Status</label><div class="dval">${escapeHTML(approvalStatus)}</div></div>
                  <div class="detail-item"><label>Deleted On (IST)</label><div class="dval">${escapeHTML(deletedOn)}</div></div>
                  <div class="detail-item"><label>Deleted By</label><div class="dval">${escapeHTML(deletedBy)}</div></div>
              </div>`;
          modal.show();
      }

      function openResumePreview(url,title){
          const modalEl=document.getElementById('resumePreviewModal');
          const frame=document.getElementById('resumePreviewFrame');
          const titleEl=document.getElementById('resumePreviewTitle');
          if(!modalEl||!frame||!titleEl){
              alert('Resume preview unavailable.');
              return;
          }
          titleEl.textContent=title||'Resume Preview';
          frame.src=url;
          modalEl.addEventListener('hidden.bs.modal',()=>{frame.src='';},{once:true});
          new bootstrap.Modal(modalEl).show();
      }

      function parseISTSourceDate(raw){
          if(!raw) return null;
          const text=String(raw).trim();
          if(!text) return null;
          if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
              return new Date(`${text}T00:00:00Z`);
          }
          if(/^\d{4}-\d{2}-\d{2}T/.test(text) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(text)){
              return new Date(`${text}Z`);
          }
          return new Date(text);
      }

      function formatRecentActivityDatesIST(){
          const fmt=new Intl.DateTimeFormat('en-IN',{
              timeZone:'Asia/Kolkata',
              day:'2-digit',
              month:'short',
              year:'numeric',
              hour:'2-digit',
              minute:'2-digit',
              hour12:true
          });
          document.querySelectorAll('[data-activity-date]').forEach(el=>{
              const raw=el.getAttribute('data-activity-date');
              if(!raw){el.textContent='Date unavailable';return;}
              const d=parseISTSourceDate(raw);
              if(Number.isNaN(d.getTime())){el.textContent='Date unavailable';return;}
              el.textContent=`${fmt.format(d)} IST`;
          });
      }

      function formatISTElements(){
          const dateFmt=new Intl.DateTimeFormat('en-IN',{
              timeZone:'Asia/Kolkata',
              day:'2-digit',
              month:'short',
              year:'numeric'
          });
          const dateTimeFmt=new Intl.DateTimeFormat('en-IN',{
              timeZone:'Asia/Kolkata',
              day:'2-digit',
              month:'short',
              year:'numeric',
              hour:'2-digit',
              minute:'2-digit',
              hour12:true
          });
          document.querySelectorAll('[data-ist-dt]').forEach(el=>{
              const raw=el.getAttribute('data-ist-dt');
              if(!raw) return;
              const dt=parseISTSourceDate(raw);
              if(Number.isNaN(dt.getTime())) return;
              const mode=el.getAttribute('data-ist-format')||'datetime';
              el.textContent=mode==='date'
                  ? dateFmt.format(dt)
                  : `${dateTimeFmt.format(dt)} IST`;
          });
      }


      /* ================================================================ BROADCAST ================================================================ */
      let currentBroadcastTarget='student';
      let broadcastHistory=[];

      function switchBroadcastTab(target){
          currentBroadcastTarget=target;
          document.querySelectorAll('.btab').forEach(t=>t.classList.remove('active'));
          document.getElementById('btab-'+target)?.classList.add('active');
                              const n=target==='student' ? Number(window.ADMIN_DASHBOARD_DATA?.studentsCount ?? 0) : Number(window.ADMIN_DASHBOARD_DATA?.companiesCount ?? 0);
          document.getElementById('broadcastRecipientCount').textContent=`${n} recipient${n!==1?'s':''}`;
          document.getElementById('previewTarget').textContent=`To: All ${target==='student'?'Students':'Companies'}`;
          updateBroadcastPreview();
      }

      function updateBroadcastPreview(){
          const subj=document.getElementById('broadcastSubject')?.value||'Subject here…';
          const msg=document.getElementById('broadcastMessage')?.value||'Message will appear here…';
          document.getElementById('previewSubject').textContent=subj;
          document.getElementById('previewBody').textContent=msg;
          document.getElementById('bcPreviewSubject').textContent=subj;
          document.getElementById('bcPreviewBody').textContent=msg;
      }

      document.getElementById('broadcastSubject')?.addEventListener('input',updateBroadcastPreview);

      function sendBroadcast(){
          const subj=document.getElementById('broadcastSubject')?.value?.trim();
          const msg=document.getElementById('broadcastMessage')?.value?.trim();
          if(!subj||!msg){alert('Please fill in both subject and message.');return;}
                              const n=currentBroadcastTarget==='student' ? Number(window.ADMIN_DASHBOARD_DATA?.studentsCount ?? 0) : Number(window.ADMIN_DASHBOARD_DATA?.companiesCount ?? 0);
          document.getElementById('bcConfirmTitle').textContent=`Send to All ${currentBroadcastTarget==='student'?'Students':'Companies'}?`;
          document.getElementById('bcConfirmText').textContent=`This message will be sent to ${n} ${currentBroadcastTarget}${n!==1?'s':''}.`;
          document.getElementById('bcPreviewTarget').textContent=`To: All ${currentBroadcastTarget==='student'?'Students':'Companies'}`;
          document.getElementById('bcPreviewSubject').textContent=subj;
          document.getElementById('bcPreviewBody').textContent=msg;
          new bootstrap.Modal(document.getElementById('broadcastConfirmModal')).show();
      }

      function confirmSendBroadcast(){
          const subj=document.getElementById('broadcastSubject')?.value?.trim();
          const msg=document.getElementById('broadcastMessage')?.value?.trim();
          const target=currentBroadcastTarget;
          if(!subj||!msg){alert('Please fill in both subject and message.');return;}
          const modal=document.getElementById('broadcastConfirmModal');
          const sendBtn=modal.querySelector('.btn-c-purple');
          if(sendBtn){sendBtn.disabled=true;sendBtn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Sending…';}
          fetch('/admin/broadcast',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              credentials:'same-origin',
              body:JSON.stringify({target,subject:subj,message:msg})
          })
          .then(async r=>({ok:r.ok,data:await r.json().catch(()=>({}))}))
          .then(({ok,data})=>{
              if(!ok){throw new Error(data.error||'Failed to send broadcast.');}
              bootstrap.Modal.getInstance(modal)?.hide();
              clearBroadcast();
              loadBroadcastHistory();
              const toast=document.createElement('div');
              toast.className='alert alert-success';
              toast.style.cssText='position:fixed;bottom:2rem;right:2rem;z-index:9999;padding:1rem 1.5rem;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.15);';
              toast.innerHTML=`<i class="bi bi-check-circle-fill me-2"></i>Broadcast sent to all ${target}s successfully!`;
              document.body.appendChild(toast);setTimeout(()=>toast.remove(),3500);
          })
          .catch(err=>alert(err.message||'Failed to send broadcast.'))
          .finally(()=>{
              if(sendBtn){sendBtn.disabled=false;sendBtn.innerHTML='<i class="bi bi-send-fill"></i> Send Now';}
          });
      }

      function renderBroadcastHistory(){
          const cont=document.getElementById('broadcastHistory');
          if(!broadcastHistory.length){cont.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--grey-400);font-size:0.875rem;"><i class="bi bi-megaphone" style="font-size:2rem;display:block;margin-bottom:0.5rem;opacity:0.4;"></i>No messages sent yet.</div>';return;}
          cont.innerHTML=broadcastHistory.map(b=>`<div class="bcast-history-item"><div class="bcast-to"><i class="bi bi-${b.target==='student'?'people':'building'}-fill me-1"></i>To: All ${b.target==='student'?'Students':b.target==='company'?'Companies':'Users'} · ${b.time}</div><div class="bcast-msg"><strong>${escapeHTML(b.subj)}</strong><br>${escapeHTML(b.msg)}</div></div>`).join('');
      }

      function loadBroadcastHistory(){
          fetch('/api/admin/broadcast/history',{credentials:'same-origin'})
              .then(r=>r.ok?r.json():[])
              .then(items=>{
                  broadcastHistory=(items||[]).map(b=>({
                      target:b.target,
                      subj:b.subject,
                      msg:b.message,
                      time:b.sent_at
                  }));
                  renderBroadcastHistory();
              })
              .catch(()=>renderBroadcastHistory());
      }

      function clearBroadcast(){
          document.getElementById('broadcastSubject').value='';
          document.getElementById('broadcastMessage').value='';
          document.getElementById('previewSubject').textContent='Subject here…';
          document.getElementById('previewBody').textContent='Message will appear here…';
      }

      function escapeHTML(s){return DashboardUtils.escapeHtml(s||'');}
      let activeTicketType='';

      function setTicketTypeFilter(type){
          activeTicketType=type||'';
          const allBtn=document.getElementById('ticketTypeAllBtn');
          const studentBtn=document.getElementById('ticketTypeStudentBtn');
          const companyBtn=document.getElementById('ticketTypeCompanyBtn');
          allBtn?.classList.toggle('active', activeTicketType==='');
          studentBtn?.classList.toggle('active', activeTicketType==='student');
          companyBtn?.classList.toggle('active', activeTicketType==='company');
          filterTickets();
      }

      function getTicketBadgeClass(status){
          if(status==='Open') return 'warning';
          if(status==='In Progress') return 'interview';
          if(status==='Resolved') return 'selected';
          return 'closed';
      }

      function renderTicketCard(t,showActions){
          const submitterRole=t.submitter_type==='student'?'Student':'Company';
          const submitterCode=escapeHTML(t.submitter_code||'N/A');
          const submitterEmail=escapeHTML(t.submitter_email||'N/A');
          const detailBtn=(t.submitter_id&&Number(t.submitter_id)>0)
              ? `<button class="btn-c btn-c-outline btn-c-sm" onclick="openTicketSubmitterDetails('${t.submitter_type}', ${t.submitter_id})"><i class="bi bi-person-vcard"></i> View Details</button>`
              : `<button class="btn-c btn-c-outline btn-c-sm" disabled title="Details unavailable"><i class="bi bi-person-vcard"></i> View Details</button>`;
          return `
              <div class="ticket-item ${showActions?'open':'closed'}">
                  <div class="ticket-header">
                      <div>
                          <div class="ticket-id">#${t.id} · ${submitterRole} Ticket</div>
                          <div class="ticket-meta">${escapeHTML(t.category||'General')} · ${escapeHTML(t.created_at_full||t.created_at||'')}</div>
                      </div>
                      <span class="badge-pill badge-${getTicketBadgeClass(t.status)}">${escapeHTML(t.status||'Open')}</span>
                  </div>
                  <div class="ticket-grid">
                      <div class="ticket-pane">
                          <div class="ticket-pane-label">Raised By</div>
                          <div class="ticket-submitter-name">${escapeHTML(t.submitter_name||'Unknown')}</div>
                          <div class="ticket-submitter-meta">${submitterRole} ID: ${submitterCode}</div>
                          <div class="ticket-submitter-meta">${submitterEmail}</div>
                          <div style="margin-top:0.55rem;">${detailBtn}</div>
                      </div>
                      <div class="ticket-pane">
                          <div class="ticket-pane-label">Issue</div>
                          <div class="ticket-subject-line">${escapeHTML(t.subject||'No subject')}</div>
                          <div class="ticket-msg-line">${escapeHTML(t.message||'')}</div>
                      </div>
                  </div>
                  ${t.admin_reply?`<div style="margin-top:0.6rem;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:8px;padding:0.7rem 0.85rem;"><div style="font-size:0.72rem;font-weight:700;color:var(--success);text-transform:uppercase;">Admin Reply</div><div style="font-size:0.84rem;color:var(--grey-700);margin-top:0.25rem;">${escapeHTML(t.admin_reply)}</div></div>`:''}
                  ${showActions?`
                  <div class="ticket-actions">
                      <textarea id="ticketReply_${t.id}" class="form-control" rows="2" placeholder="Write reply and mark resolved…" style="max-width:420px;"></textarea>
                      <button class="btn-c btn-c-success btn-c-sm" onclick="sendTicketReply(${t.id})"><i class="bi bi-reply-fill"></i> Reply & Resolve</button>
                      <button class="btn-c btn-c-outline btn-c-sm" onclick="closeTicket(${t.id})"><i class="bi bi-x-circle"></i> Close</button>
                  </div>`:''}
              </div>
          `;
      }

      function renderTickets(filteredItems,allItems){
          const openContainer=document.getElementById('openTicketsContainer');
          const closedContainer=document.getElementById('closedTicketsContainer');
          const totalEl=document.getElementById('totalTicketsCount');
          const openBadge=document.getElementById('openTicketsBadge');

          const shownItems=filteredItems||[];
          const statsItems=allItems||shownItems;
          const openShown=shownItems.filter(t=>t.status==='Open');
          const closedShown=shownItems.filter(t=>t.status!=='Open');

          const openAll=statsItems.filter(t=>t.status==='Open').length;
          const resolvedAll=statsItems.filter(t=>['Resolved','Closed'].includes(t.status)).length;
          const studentAll=statsItems.filter(t=>t.submitter_type==='student').length;
          const companyAll=statsItems.filter(t=>t.submitter_type==='company').length;

          if(totalEl){
              const typeLabel=activeTicketType?` (${activeTicketType==='student'?'Students':'Companies'})`:'';
              totalEl.textContent=`${shownItems.length} ticket${shownItems.length!==1?'s':''}${typeLabel}`;
          }
          if(openBadge){
              if(openAll>0){openBadge.style.display='inline-flex';openBadge.textContent=openAll;}
              else{openBadge.style.display='none';}
          }
          document.getElementById('ticketStatOpen').textContent=openAll;
          document.getElementById('ticketStatResolved').textContent=resolvedAll;
          document.getElementById('ticketStatStudents').textContent=studentAll;
          document.getElementById('ticketStatCompanies').textContent=companyAll;

          if(openContainer){
              openContainer.innerHTML=openShown.length
                  ? openShown.map(t=>renderTicketCard(t,true)).join('')
                  : '<div style="text-align:center;padding:2rem;color:var(--grey-400);"><i class="bi bi-ticket" style="font-size:2.5rem;display:block;margin-bottom:0.75rem;opacity:0.4;"></i><p>No open issues for this filter.</p></div>';
          }
          if(closedContainer){
              closedContainer.innerHTML=closedShown.length
                  ? closedShown.map(t=>renderTicketCard(t,false)).join('')
                  : '<div style="text-align:center;padding:2rem;color:var(--grey-400);"><i class="bi bi-inbox" style="font-size:2.2rem;display:block;margin-bottom:0.75rem;opacity:0.35;"></i><p>No closed/resolved tickets for this filter.</p></div>';
          }
      }

      function filterTickets(){
          const qs=new URLSearchParams();
          if(activeTicketType) qs.set('type',activeTicketType);
          Promise.all([
              fetch('/api/admin/support/tickets?'+qs.toString(),{credentials:'same-origin'}).then(r=>r.ok?r.json():[]),
              fetch('/api/admin/support/tickets',{credentials:'same-origin'}).then(r=>r.ok?r.json():[])
          ])
          .then(([filtered,all])=>renderTickets(filtered||[],all||[]))
          .catch(()=>renderTickets([],[]));
      }

      function sendTicketReply(ticketId){
          const replyEl=document.getElementById('ticketReply_'+ticketId);
          const reply=(replyEl?.value||'').trim();
          if(!reply){alert('Reply cannot be empty.');return;}
          fetch('/api/admin/support/reply/'+ticketId,{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              credentials:'same-origin',
              body:JSON.stringify({reply})
          })
          .then(async r=>({ok:r.ok,data:await r.json().catch(()=>({}))}))
          .then(({ok,data})=>{
              if(!ok)throw new Error(data.error||'Failed to send reply.');
              filterTickets();
          })
          .catch(err=>alert(err.message||'Failed to send reply.'));
      }

      function closeTicket(ticketId){
          fetch('/api/admin/support/close/'+ticketId,{
              method:'POST',
              credentials:'same-origin'
          })
          .then(async r=>({ok:r.ok,data:await r.json().catch(()=>({}))}))
          .then(({ok,data})=>{
              if(!ok)throw new Error(data.error||'Failed to close ticket.');
              filterTickets();
          })
          .catch(err=>alert(err.message||'Failed to close ticket.'));
      }

      function openTicketSubmitterDetails(type,id){
          if(!id){alert('User details not available for this ticket.');return;}
          const modalEl=document.getElementById('ticketUserDetailModal');
          const bodyEl=document.getElementById('ticketUserDetailBody');
          const titleEl=document.getElementById('ticketUserDetailTitle');
          if(!modalEl||!bodyEl||!titleEl){alert('Details modal unavailable.');return;}
          titleEl.textContent=type==='student'?'Student Ticket Details':'Company Ticket Details';
          bodyEl.innerHTML='<div style="text-align:center;padding:2rem;color:var(--grey-400);">Loading details…</div>';
          new bootstrap.Modal(modalEl).show();

          const qs=new URLSearchParams({type,id:String(id)});
          fetch('/api/admin/support/submitter-details?'+qs.toString(),{credentials:'same-origin'})
              .then(async r=>({ok:r.ok,data:await r.json().catch(()=>({}))}))
              .then(({ok,data})=>{
                  if(!ok) throw new Error(data.error||'Unable to load details.');
                  if(data.type==='student'){
                      const p=data.profile||{};
                      const apps=data.applications||[];
                      bodyEl.innerHTML=`
                          <div class="detail-section-title"><i class="bi bi-person-circle"></i> Student Profile</div>
                          <div class="detail-grid">
                              <div class="detail-item"><label>Name</label><div class="dval">${escapeHTML(p.name||'—')}</div></div>
                              <div class="detail-item"><label>Student ID</label><div class="dval">${escapeHTML(p.student_id||'—')}</div></div>
                              <div class="detail-item"><label>Email</label><div class="dval">${escapeHTML(p.email||'—')}</div></div>
                              <div class="detail-item"><label>Contact</label><div class="dval">${escapeHTML(p.contact||'—')}</div></div>
                              <div class="detail-item"><label>College</label><div class="dval">${escapeHTML(p.college||'—')}</div></div>
                              <div class="detail-item"><label>Degree</label><div class="dval">${escapeHTML(p.degree||'—')}</div></div>
                              <div class="detail-item"><label>Branch</label><div class="dval">${escapeHTML(p.branch||'—')}</div></div>
                              <div class="detail-item"><label>Graduation Year</label><div class="dval">${escapeHTML(p.graduation_year||'—')}</div></div>
                              <div class="detail-item"><label>CGPA</label><div class="dval">${p.cgpa!=null?escapeHTML(String(p.cgpa)):'—'}</div></div>
                              <div class="detail-item"><label>Account Status</label><div class="dval">${p.is_active?'Active':'Blacklisted'}</div></div>
                          </div>
                          <div class="detail-section-title"><i class="bi bi-file-earmark-text"></i> Application History</div>
                          ${apps.length?`<div style="max-height:240px;overflow:auto;"><table class="tbl"><thead><tr><th>ID</th><th>Drive</th><th>Company</th><th>Status</th><th>Applied On</th></tr></thead><tbody>${apps.map(a=>`<tr><td>${escapeHTML(a.application_code||('#'+a.id))}</td><td>${escapeHTML(a.drive_title||'—')}</td><td>${escapeHTML(a.company_name||'—')}</td><td>${escapeHTML(a.status||'—')}</td><td>${escapeHTML(a.applied_on||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<p style="color:var(--grey-400);margin:0;">No applications found.</p>'}
                      `;
                  } else {
                      const p=data.profile||{};
                      const drives=data.drives||[];
                      bodyEl.innerHTML=`
                          <div class="detail-section-title"><i class="bi bi-building"></i> Company Profile</div>
                          <div class="detail-grid">
                              <div class="detail-item"><label>Company Name</label><div class="dval">${escapeHTML(p.company_name||'—')}</div></div>
                              <div class="detail-item"><label>Company ID</label><div class="dval">${escapeHTML(p.company_id||'—')}</div></div>
                              <div class="detail-item"><label>Email</label><div class="dval">${escapeHTML(p.email||'—')}</div></div>
                              <div class="detail-item"><label>Industry</label><div class="dval">${escapeHTML(p.industry||'—')}</div></div>
                              <div class="detail-item"><label>HR Contact</label><div class="dval">${escapeHTML(p.hr_contact||'—')}</div></div>
                              <div class="detail-item"><label>Mobile</label><div class="dval">${escapeHTML(p.mobile||'—')}</div></div>
                              <div class="detail-item"><label>Location</label><div class="dval">${escapeHTML(p.location||'—')}</div></div>
                              <div class="detail-item"><label>Company Size</label><div class="dval">${escapeHTML(p.company_size||'—')}</div></div>
                              <div class="detail-item"><label>Approval</label><div class="dval">${escapeHTML(p.approval_status||'—')}</div></div>
                              <div class="detail-item"><label>Account Status</label><div class="dval">${p.is_active?'Active':'Blacklisted'}</div></div>
                          </div>
                          <div class="detail-section-title"><i class="bi bi-briefcase"></i> Drive History</div>
                          ${drives.length?`<div style="max-height:240px;overflow:auto;"><table class="tbl"><thead><tr><th>Drive ID</th><th>Job Title</th><th>Status</th><th>Applications</th><th>Placed</th></tr></thead><tbody>${drives.map(d=>`<tr><td>${escapeHTML(d.drive_id||'—')}</td><td>${escapeHTML(d.job_title||'—')}</td><td>${escapeHTML(d.status||'—')}</td><td>${escapeHTML(String(d.applications||0))}</td><td>${escapeHTML(String(d.selected||0))}</td></tr>`).join('')}</tbody></table></div>`:'<p style="color:var(--grey-400);margin:0;">No drives found.</p>'}
                      `;
                  }
              })
              .catch(err=>{
                  bodyEl.innerHTML=`<div style="color:var(--danger);font-weight:600;">${escapeHTML(err.message||'Unable to load details.')}</div>`;
              });
      }

      function validateAudienceForm(formEl, allowAllBypass, errorId){
          if(!formEl) return true;
          const scope = formEl.closest('.modal-content') || formEl;
          const allowAllChecked = allowAllBypass && !!scope.querySelector('input[name="allow_all_audience"]:checked');
          const fd = new FormData(formEl);
          const degCount = fd.getAll('target_degrees').length + fd.getAll('target_degrees[]').length;
          const yearCount = fd.getAll('target_years').length + fd.getAll('target_years[]').length;
          const errorEl = errorId ? (formEl.querySelector(`[id="${errorId}"]`) || document.getElementById(errorId)) : null;
          if(allowAllChecked || (degCount > 0 && yearCount > 0)){
              if(errorEl) errorEl.style.display = 'none';
              return true;
          }
          if(errorEl){
              errorEl.style.display = 'block';
              errorEl.scrollIntoView({behavior:'smooth', block:'center'});
          }else{
              alert('Please choose at least one degree and one study year.');
          }
          return false;
      }

      /* ================================================================ AUTO DISMISS ALERTS ================================================================ */
      DashboardUtils.autoDismissBootstrapAlerts(5000);

      /* ================================================================ INIT ================================================================ */
      document.addEventListener('DOMContentLoaded',()=>{
          let savedSection='overview';
          try{savedSection=sessionStorage.getItem('adminActiveSection')||'overview';}catch(e){}
          navigateToSection((location.hash||`#${savedSection}`).slice(1));
          document.body.classList.remove('section-init-pending');
          formatISTElements();
          formatRecentActivityDatesIST();
          switchBroadcastTab('student');
          loadBroadcastHistory();
          filterTickets();
                              const n=Number(window.ADMIN_DASHBOARD_DATA?.studentsCount ?? 0);
          document.getElementById('broadcastRecipientCount').textContent=`${n} recipient${n!==1?'s':''}`;
      });
