'use strict';
let skillsArray = [];
let emailAvailability = 'unknown';
let emailCheckTimer = null;
let emailCheckSeq = 0;
let mobileAvailability = 'unknown';
let mobileCheckTimer = null;
let mobileCheckSeq = 0;

/* ─────────── UTILS ─────────── */
function togglePwd(inputId, iconId) {
    const inp = document.getElementById(inputId), ico = document.getElementById(iconId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    ico.classList.toggle('bi-eye'); ico.classList.toggle('bi-eye-slash');
}

function setMsg(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'field-msg' + (type ? ' ' + type : '');
}

/* ─────────── EMAIL VALIDATION ─────────── */
function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

const emailEl = document.getElementById('studentEmail');

emailEl.addEventListener('input', function () {
    const v = this.value.trim();
    emailAvailability = 'unknown';
    if (emailCheckTimer) clearTimeout(emailCheckTimer);
    if (!v) { setMsg('emailMsg','',''); this.classList.remove('is-valid','is-invalid'); validateStep1(); return; }
    if (isValidEmail(v)) {
        this.classList.replace('is-invalid','is-valid') || this.classList.add('is-valid');
        this.classList.remove('is-invalid');
        setMsg('emailMsg','Checking email availability...','');
        emailAvailability = 'checking';
        const requestId = ++emailCheckSeq;
        emailCheckTimer = setTimeout(() => checkEmailAvailability(v, requestId), 300);
    } else {
        this.classList.replace('is-valid','is-invalid') || this.classList.add('is-invalid');
        this.classList.remove('is-valid');
        setMsg('emailMsg','✗ Enter a valid email (e.g. john@gmail.com)','err');
    }
    validateStep1();
});

emailEl.addEventListener('blur', function () {
    const v = this.value.trim();
    if (!isValidEmail(v)) return;
    const requestId = ++emailCheckSeq;
    checkEmailAvailability(v, requestId);
});

async function checkEmailAvailability(email, requestId) {
    try {
        const res = await fetch(`/api/student/email-exists?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (requestId !== emailCheckSeq) return;
        if (!data.valid) {
            emailAvailability = 'unknown';
            setMsg('emailMsg', 'Enter a valid email address', 'err');
            emailEl.classList.add('is-invalid');
            emailEl.classList.remove('is-valid');
        } else if (data.exists) {
            emailAvailability = 'taken';
            setMsg('emailMsg', '✗ Email already registered', 'err');
            emailEl.classList.add('is-invalid');
            emailEl.classList.remove('is-valid');
        } else {
            emailAvailability = 'available';
            setMsg('emailMsg', '✓ Email available', 'ok');
            emailEl.classList.add('is-valid');
            emailEl.classList.remove('is-invalid');
        }
    } catch (err) {
        if (requestId !== emailCheckSeq) return;
        emailAvailability = 'unknown';
        setMsg('emailMsg', 'Could not verify email right now', 'err');
    }
    validateStep1();
}

/* ─────────── MOBILE VALIDATION ─────────── */
function isValidMobile(v) { return /^[6-9]\d{9}$/.test(v); }

const mobileEl = document.getElementById('studentContact');

mobileEl.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 10);
    const v = this.value;
    mobileAvailability = 'unknown';
    if (mobileCheckTimer) clearTimeout(mobileCheckTimer);
    if (!v) { setMsg('mobileMsg','',''); this.classList.remove('is-valid','is-invalid'); validateStep1(); return; }
    if (isValidMobile(v)) {
        this.classList.add('is-valid'); this.classList.remove('is-invalid');
        setMsg('mobileMsg','Checking mobile availability...','');
        mobileAvailability = 'checking';
        const requestId = ++mobileCheckSeq;
        mobileCheckTimer = setTimeout(() => checkMobileAvailability(v, requestId), 300);
    } else {
        this.classList.add('is-invalid'); this.classList.remove('is-valid');
        const remaining = 10 - v.length;
        setMsg('mobileMsg', remaining > 0 ? `${remaining} more digit(s) needed` : '✗ Must start with 6, 7, 8 or 9', 'err');
    }
    validateStep1();
});

mobileEl.addEventListener('blur', function () {
    const v = this.value.trim();
    if (!isValidMobile(v)) return;
    const requestId = ++mobileCheckSeq;
    checkMobileAvailability(v, requestId);
});

async function checkMobileAvailability(mobile, requestId) {
    try {
        const res = await fetch(`/api/student/contact-exists?contact=${encodeURIComponent(mobile)}`);
        const data = await res.json();
        if (requestId !== mobileCheckSeq) return;
        if (!data.valid) {
            mobileAvailability = 'unknown';
            setMsg('mobileMsg', 'Enter a valid mobile number', 'err');
            mobileEl.classList.add('is-invalid');
            mobileEl.classList.remove('is-valid');
        } else if (data.exists) {
            mobileAvailability = 'taken';
            setMsg('mobileMsg', '✗ Mobile number already registered', 'err');
            mobileEl.classList.add('is-invalid');
            mobileEl.classList.remove('is-valid');
        } else {
            mobileAvailability = 'available';
            setMsg('mobileMsg', '✓ Mobile number available', 'ok');
            mobileEl.classList.add('is-valid');
            mobileEl.classList.remove('is-invalid');
        }
    } catch (err) {
        if (requestId !== mobileCheckSeq) return;
        mobileAvailability = 'unknown';
        setMsg('mobileMsg', 'Could not verify mobile right now', 'err');
    }
    validateStep1();
}

/* ─────────── PASSWORD STRENGTH ─────────── */
document.getElementById('studentPassword').addEventListener('input', function () {
    const p = this.value; let s = 0;
    if (p.length >= 8)                              s += 25;
    if (p.match(/[a-z]/) && p.match(/[A-Z]/))      s += 25;
    if (p.match(/[0-9]/))                           s += 25;
    if (p.match(/[^a-zA-Z0-9]/))                   s += 25;
    const fill = document.getElementById('strengthFill'), txt = document.getElementById('strengthText');
    fill.style.width = s + '%';
    const lvl = {
        0:   ['transparent',     'var(--grey-400)', 'Choose a strong password'],
        25:  ['var(--danger)',   'var(--danger)',   'Weak password'],
        50:  ['var(--warning)',  'var(--warning)',  'Fair password'],
        75:  ['var(--accent)',   'var(--accent)',   'Good password'],
        100: ['var(--success)',  'var(--success)',  'Strong password!']
    };
    const e = lvl[s] || lvl[100];
    fill.style.background = e[0]; txt.style.color = e[1]; txt.textContent = e[2];
    checkPwdMatch(); validateStep1();
});

/* ─────────── CONFIRM PASSWORD ─────────── */
document.getElementById('confirmPassword').addEventListener('input', function () { checkPwdMatch(); validateStep1(); });

function checkPwdMatch() {
    const p1 = document.getElementById('studentPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    if (!p2) { setMsg('pwdMatchMsg','',''); return; }
    p1 === p2 ? setMsg('pwdMatchMsg','✓ Passwords match','ok') : setMsg('pwdMatchMsg','✗ Passwords do not match','err');
}

/* ─────────── SKILLS ─────────── */
document.getElementById('skillsInput').addEventListener('keypress', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const s = this.value.trim();
    if (s && !skillsArray.includes(s)) { skillsArray.push(s); renderSkills(); this.value = ''; }
});

function renderSkills() {
    const c = document.getElementById('skillsTags'); c.innerHTML = '';
    skillsArray.forEach((s, i) => {
        const t = document.createElement('div'); t.className = 'skill-tag';
        t.innerHTML = `${s}<span class="remove-skill" onclick="removeSkill(${i})"><i class="bi bi-x-lg" style="font-size:.7rem;"></i></span>`;
        c.appendChild(t);
    });
    document.getElementById('skillsHidden').value = skillsArray.join(',');
}

function removeSkill(i) { skillsArray.splice(i, 1); renderSkills(); }

/* ─────────── FILE UPLOAD ─────────── */
document.getElementById('resumeInput').addEventListener('change', function () {
    const f = this.files[0];
    if (f) {
        if (f.size > 2 * 1024 * 1024) { alert('File must be under 2MB'); this.value = ''; return; }
        document.getElementById('fileUploadLabel').classList.add('has-file');
        document.getElementById('fileUploadIcon').innerHTML = '<i class="bi bi-file-earmark-check-fill"></i>';
        document.getElementById('fileUploadText').textContent = f.name;
    } else {
        document.getElementById('fileUploadLabel').classList.remove('has-file');
        document.getElementById('fileUploadIcon').innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i>';
        document.getElementById('fileUploadText').textContent = 'Click to upload PDF';
    }
    validateStep3();
});

/* ─────────── STEP VALIDATION ─────────── */
function validateStep1() {
    const ok = document.getElementById('studentName').value.trim()
        && document.getElementById('studentDOB').value
        && isValidEmail(document.getElementById('studentEmail').value)
        && emailAvailability !== 'taken'
        && emailAvailability !== 'checking'
        && isValidMobile(document.getElementById('studentContact').value)
        && mobileAvailability !== 'taken'
        && mobileAvailability !== 'checking'
        && document.getElementById('studentPassword').value.length >= 8
        && document.getElementById('studentPassword').value === document.getElementById('confirmPassword').value;
    document.getElementById('nextBtn1').disabled = !ok;
}

function validateStep2() {
    const ok = document.getElementById('studentCollege').value.trim()
        && document.getElementById('studentDegree').value
        && document.getElementById('studentBranch').value.trim()
        && document.getElementById('studentYearOfStudy').value
        && document.getElementById('studentCGPA').value.trim()
        && document.getElementById('tenthPercent').value.trim()
        && document.getElementById('twelfthPercent').value.trim();
    document.getElementById('nextBtn2').disabled = !ok;
}

function validateStep3() {
    document.getElementById('nextBtn3').disabled = !document.getElementById('resumeInput').files.length;
}

/* attach listeners */
['studentName','studentDOB'].forEach(id => document.getElementById(id).addEventListener('input', validateStep1));
['studentCollege','studentBranch','studentCGPA','tenthPercent','twelfthPercent'].forEach(id =>
    document.getElementById(id).addEventListener('input', validateStep2));
['studentDegree','studentYearOfStudy'].forEach(id =>
    document.getElementById(id).addEventListener('change', validateStep2));

/* ─────────── STEP NAVIGATION ─────────── */
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
    const icons = ['bi-person-fill','bi-book-fill','bi-file-earmark-person-fill','bi-check-circle-fill'];
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

/* ─────────── REVIEW POPULATION ─────────── */
function copyStudentId() {
    const id = document.getElementById('displayStudentId').textContent;
    navigator.clipboard.writeText(id).then(() => {
        const btn = document.getElementById('copyStudentIdBtn');
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerHTML = '<i class="bi bi-clipboard"></i> Copy ID';
            btn.classList.remove('copied');
        }, 2000);
    });
}

function populateReview() {
    const g = id => document.getElementById(id)?.value || '-';

    // 🔥 Fetch Student ID from backend
    fetch("/generate-student-id")
        .then(response => response.json())
        .then(data => {
            document.getElementById('displayStudentId').textContent = data.student_id;
        })
        .catch(error => {
            console.error("Error fetching student ID:", error);
            document.getElementById('displayStudentId').textContent = "Error";
        });

    document.getElementById('reviewName').textContent     = g('studentName');
    document.getElementById('reviewDOB').textContent      = g('studentDOB');
    document.getElementById('reviewEmail').textContent    = g('studentEmail');
    document.getElementById('reviewContact').textContent  = g('studentContact');
    document.getElementById('reviewCollege').textContent  = g('studentCollege');
    document.getElementById('reviewDegree').textContent   = g('studentDegree');
    document.getElementById('reviewBranch').textContent   = g('studentBranch');
    document.getElementById('reviewYear').textContent     = g('studentYearOfStudy');
    document.getElementById('reviewCGPA').textContent     = g('studentCGPA');
    document.getElementById('reviewTenth').textContent    = g('tenthPercent');
    document.getElementById('reviewTwelfth').textContent  = g('twelfthPercent');
    document.getElementById('reviewLinkedin').textContent = g('studentLinkedin') || 'Not provided';
    document.getElementById('reviewGithub').textContent   = g('studentGithub')   || 'Not provided';
    document.getElementById('reviewBio').textContent      = g('studentBio')      || 'Not provided';
    const rf = document.getElementById('resumeInput').files[0];
    document.getElementById('resumeFileName').textContent = rf ? rf.name : 'No file uploaded';
    document.getElementById('reviewSkills').innerHTML = skillsArray.length
        ? skillsArray.map(s => `<span class="badge" style="background:linear-gradient(135deg,var(--accent),var(--sky));margin:.2rem;">${s}</span>`).join('')
        : '<span style="color:var(--grey-400)">No skills added</span>';
}
/* ─────────── SUBMIT ─────────── */
document.getElementById('registrationForm').addEventListener('submit', function (e) {
    e.preventDefault();
    document.getElementById('submitText').classList.add('d-none');
    document.getElementById('submitSpinner').classList.remove('d-none');
    document.getElementById('submitBtn').disabled = true;
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    setTimeout(() => this.submit(), 1500);
});

document.addEventListener('DOMContentLoaded', () => { validateStep1(); validateStep2(); validateStep3(); });
