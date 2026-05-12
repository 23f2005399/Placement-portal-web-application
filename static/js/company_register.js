'use strict';
let emailAvailability = 'unknown';
let emailCheckTimer = null;
let emailCheckSeq = 0;
let mobileAvailability = 'unknown';
let mobileCheckTimer = null;
let mobileCheckSeq = 0;

/* ─── COMPANY ID GENERATION ─── */
// Format: PLAXYYCxxx — e.g. PLAX26C001
// We generate a unique ID client-side using current year + timestamp-based counter.
// The backend will confirm uniqueness and use this value; if collision, backend regenerates.

let companyIdGenerated = '';



function copyCompanyId() {
    const id = document.getElementById('displayCompanyId').textContent;
    navigator.clipboard.writeText(id).then(() => {
        const btn = document.getElementById('copyIdBtn');
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="bi bi-clipboard"></i> Copy ID';
            btn.classList.remove('copied');
        }, 2000);
    });
}

/* ─── UTILS ─── */
function togglePwd(inputId, iconId) {
    const inp = document.getElementById(inputId), ico = document.getElementById(iconId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    ico.classList.toggle('bi-eye'); ico.classList.toggle('bi-eye-slash');
}

function setMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'field-msg' + (type ? ' ' + type : '');
}

/* ─── EMAIL VALIDATION ─── */
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }
const hrEmailEl = document.getElementById('hrEmail');
const hrMobileEl = document.getElementById('hrMobile');

hrEmailEl.addEventListener('input', function () {
    const v = this.value.trim();
    emailAvailability = 'unknown';
    if (emailCheckTimer) clearTimeout(emailCheckTimer);
    if (!v) { setMsg('emailMsg','',''); validateStep2(); return; }
    if (isValidEmail(v)) {
        setMsg('emailMsg','Checking email availability...','');
        emailAvailability = 'checking';
        const requestId = ++emailCheckSeq;
        emailCheckTimer = setTimeout(() => checkCompanyEmailAvailability(v, requestId), 300);
    } else {
        setMsg('emailMsg','✗ Enter a valid email (e.g. hr@company.com)','err');
    }
    validateStep2();
});

hrEmailEl.addEventListener('blur', function () {
    const v = this.value.trim();
    if (!isValidEmail(v)) return;
    const requestId = ++emailCheckSeq;
    checkCompanyEmailAvailability(v, requestId);
});

async function checkCompanyEmailAvailability(email, requestId) {
    try {
        const res = await fetch(`/api/company/email-exists?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (requestId !== emailCheckSeq) return;
        if (!data.valid) {
            emailAvailability = 'unknown';
            setMsg('emailMsg', 'Enter a valid email address', 'err');
        } else if (data.exists) {
            emailAvailability = 'taken';
            setMsg('emailMsg', '✗ Email already registered', 'err');
        } else {
            emailAvailability = 'available';
            setMsg('emailMsg', '✓ Email available', 'ok');
        }
    } catch (err) {
        if (requestId !== emailCheckSeq) return;
        emailAvailability = 'unknown';
        setMsg('emailMsg', 'Could not verify email right now', 'err');
    }
    validateStep2();
}

/* ─── MOBILE VALIDATION ─── */
function isValidMobile(v) { return /^[6-9]\d{9}$/.test(v); }

hrMobileEl.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 10);
    const v = this.value;
    mobileAvailability = 'unknown';
    if (mobileCheckTimer) clearTimeout(mobileCheckTimer);
    if (!v) { setMsg('mobileMsg','',''); validateStep2(); return; }
    if (isValidMobile(v)) {
        setMsg('mobileMsg','Checking mobile availability...','');
        mobileAvailability = 'checking';
        const requestId = ++mobileCheckSeq;
        mobileCheckTimer = setTimeout(() => checkCompanyMobileAvailability(v, requestId), 300);
    } else {
        const remaining = 10 - v.length;
        setMsg('mobileMsg', remaining > 0 ? `${remaining} more digit(s) needed` : '✗ Must start with 6, 7, 8 or 9', 'err');
    }
    validateStep2();
});

hrMobileEl.addEventListener('blur', function () {
    const v = this.value.trim();
    if (!isValidMobile(v)) return;
    const requestId = ++mobileCheckSeq;
    checkCompanyMobileAvailability(v, requestId);
});

async function checkCompanyMobileAvailability(mobile, requestId) {
    try {
        const res = await fetch(`/api/company/mobile-exists?mobile=${encodeURIComponent(mobile)}`);
        const data = await res.json();
        if (requestId !== mobileCheckSeq) return;
        if (!data.valid) {
            mobileAvailability = 'unknown';
            setMsg('mobileMsg', 'Enter a valid mobile number', 'err');
        } else if (data.exists) {
            mobileAvailability = 'taken';
            setMsg('mobileMsg', '✗ Mobile number already registered', 'err');
        } else {
            mobileAvailability = 'available';
            setMsg('mobileMsg', '✓ Mobile number available', 'ok');
        }
    } catch (err) {
        if (requestId !== mobileCheckSeq) return;
        mobileAvailability = 'unknown';
        setMsg('mobileMsg', 'Could not verify mobile right now', 'err');
    }
    validateStep2();
}

/* ─── PASSWORD STRENGTH ─── */
document.getElementById('companyPassword').addEventListener('input', function () {
    const p = this.value; let s = 0;
    if (p.length >= 8) s += 25;
    if (p.match(/[a-z]/) && p.match(/[A-Z]/)) s += 25;
    if (p.match(/[0-9]/)) s += 25;
    if (p.match(/[^a-zA-Z0-9]/)) s += 25;
    const fill = document.getElementById('strengthFill'), txt = document.getElementById('strengthText');
    fill.style.width = s + '%';
    const lvl = {
        0:   ['transparent',    'var(--grey-400)', 'Choose a strong password'],
        25:  ['var(--danger)',  'var(--danger)',   'Weak password'],
        50:  ['var(--warning)', 'var(--warning)',  'Fair password'],
        75:  ['var(--accent)',  'var(--accent)',   'Good password'],
        100: ['var(--success)', 'var(--success)',  'Strong password!']
    };
    const e = lvl[s] || lvl[100];
    fill.style.background = e[0]; txt.style.color = e[1]; txt.textContent = e[2];
    checkPwdMatch(); validateStep3();
});

document.getElementById('confirmPassword').addEventListener('input', function () { checkPwdMatch(); validateStep3(); });

function checkPwdMatch() {
    const p1 = document.getElementById('companyPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    if (!p2) { setMsg('pwdMatchMsg','',''); return; }
    p1 === p2 ? setMsg('pwdMatchMsg','✓ Passwords match','ok') : setMsg('pwdMatchMsg','✗ Passwords do not match','err');
}

/* ─── INDUSTRY OTHER ─── */
document.querySelectorAll('input[name="industry"]').forEach(radio => {
    radio.addEventListener('change', function () {
        document.getElementById('other-industry-input').style.display = this.value === 'Other' ? 'block' : 'none';
        validateStep1();
    });
});

/* ─── STEP VALIDATION ─── */
function validateStep1() {
    const name = document.getElementById('companyName').value.trim();
    const industry = document.querySelector('input[name="industry"]:checked');
    const size = document.getElementById('companySize').value;
    const location = document.getElementById('companyLocation').value.trim();
    const website = document.getElementById('companyWebsite').value.trim();
    document.getElementById('nextBtn1').disabled = !(name && industry && size && location && website);
}

function validateStep2() {
    const hrName = document.getElementById('hrName').value.trim();
    const email  = document.getElementById('hrEmail').value.trim();
    const mobile = document.getElementById('hrMobile').value.trim();
    document.getElementById('nextBtn2').disabled = !(
        hrName
        && isValidEmail(email)
        && emailAvailability !== 'taken'
        && emailAvailability !== 'checking'
        && isValidMobile(mobile)
        && mobileAvailability !== 'taken'
        && mobileAvailability !== 'checking'
    );
}

function validateStep3() {
    const p1 = document.getElementById('companyPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    document.getElementById('nextBtn3').disabled = !(p1.length >= 8 && p1 === p2);
}

/* attach listeners */
document.getElementById('companyName').addEventListener('input', validateStep1);
document.getElementById('companySize').addEventListener('change', validateStep1);
document.getElementById('companyLocation').addEventListener('input', validateStep1);
document.getElementById('companyWebsite').addEventListener('input', validateStep1);
['hrName'].forEach(id => document.getElementById(id).addEventListener('input', validateStep2));

/* ─── STEP NAVIGATION ─── */
const icons = ['bi-building','bi-person-badge','bi-lock-fill','bi-check-circle-fill'];

function nextStep(step) {
    document.querySelectorAll('.form-step').forEach(e => e.classList.remove('active'));
    document.querySelector(`.form-step[data-step="${step}"]`).classList.add('active');
    updateStepper(step);
    document.querySelectorAll('.benefit-card').forEach(c => c.classList.remove('active'));
    const bc = document.querySelector(`.benefit-card[data-step="${step}"]`);
    if (bc) bc.classList.add('active');
    if (step === 4) populateReview();
    document.querySelector('.right-panel').scrollTop = 0;
}

function prevStep(step) { nextStep(step); }

function updateStepper(step) {
    document.querySelectorAll('.step-item').forEach((item, i) => {
        const n = i + 1;
        const circle = item.querySelector('.step-circle');
        const label  = item.querySelector('.step-label');
        const line   = item.querySelector('.step-line');
        circle.classList.remove('active','done'); label.classList.remove('active','done');
        if (n < step) {
            circle.innerHTML = '<i class="bi bi-check-lg"></i>'; circle.classList.add('done'); label.classList.add('done');
            if (line) line.classList.add('done');
        } else if (n === step) {
            circle.innerHTML = `<i class="bi ${icons[i]}"></i>`; circle.classList.add('active'); label.classList.add('active');
            if (line) line.classList.remove('done');
        } else {
            circle.innerHTML = `<i class="bi ${icons[i]}"></i>`;
            if (line) line.classList.remove('done');
        }
    });
}
function populateReview() {
    const g = id => document.getElementById(id)?.value || '-';

    // 🔥 CALL BACKEND TO GET REAL ID
    fetch("/generate-company-id")
        .then(response => response.json())
        .then(data => {
            document.getElementById('displayCompanyId').textContent = data.company_id;
        })
        .catch(error => {
            console.error("Error fetching company ID:", error);
            document.getElementById('displayCompanyId').textContent = "Error";
        });

    document.getElementById('reviewCompanyName').textContent = g('companyName');

    const industryEl = document.querySelector('input[name="industry"]:checked');
    let industryVal = industryEl ? industryEl.value : '-';
    if (industryVal === 'Other') {
        const oth = document.querySelector('input[name="industry_other"]');
        industryVal = oth?.value?.trim() || 'Other';
    }
    document.getElementById('reviewIndustry').textContent = industryVal;

    document.getElementById('reviewCompanySize').textContent =
        document.getElementById('companySize').value || 'Not specified';

    document.getElementById('reviewLocation').textContent =
        document.getElementById('companyLocation').value || 'Not provided';

    document.getElementById('reviewWebsite').textContent =
        g('companyWebsite') || 'Not provided';

    document.getElementById('reviewHRName').textContent = g('hrName');
    document.getElementById('reviewDesignation').textContent =
        g('hrDesignation') || 'Not provided';

    document.getElementById('reviewEmail').textContent = g('hrEmail');
    document.getElementById('reviewMobile').textContent = g('hrMobile');
}

/* ─── SUBMIT ─── */
document.getElementById('registrationForm').addEventListener('submit', function (e) {
    e.preventDefault();
    // Ensure company_id is set before submit
    document.getElementById('submitText').classList.add('d-none');
    document.getElementById('submitSpinner').classList.remove('d-none');
    document.getElementById('submitBtn').disabled = true;
    setTimeout(() => this.submit(), 1000);
});

document.addEventListener('DOMContentLoaded', () => { validateStep1(); validateStep2(); validateStep3(); });
