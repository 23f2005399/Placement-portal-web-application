'use strict';

let verifiedIdentifier = '';
let currentStep = 1;

/* ─── UTILS ─── */
function togglePwd(inputId, iconId) {
    const inp = document.getElementById(inputId), ico = document.getElementById(iconId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    ico.classList.toggle('bi-eye'); ico.classList.toggle('bi-eye-slash');
}

function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }
function isValidStudentId(v) { return /^PLAX\d{2}S\d{3,}$/i.test(v.trim()); }
function isValidLookup(v) {
    const lookupType = document.getElementById('lookupType').value;
    if (lookupType === 'id') return isValidStudentId(v);
    return isValidEmail(v);
}

/* ─── HEADER UPDATE ─── */
function updateHeader(step) {
    const icons  = ['bi-shield-lock', 'bi-person-check', 'bi-key-fill'];
    const titles = ['Reset Your Password', 'Verify Your Identity', 'Set New Password'];
    const subs   = ['Verify your identity to regain access', 'One more step — confirm it\'s really you', 'Almost there! Create your new password'];
    document.getElementById('headerIconI').className = `bi ${icons[step-1]}`;
    document.getElementById('headerTitle').textContent = titles[step-1];
    document.getElementById('headerSub').textContent   = subs[step-1];

    // Stepper dots
    for (let i = 1; i <= 3; i++) {
        const dot  = document.getElementById(`dot${i}`);
        const line = document.getElementById(`line${i}`);
        dot.classList.remove('active','done');
        if (line) line.classList.remove('done');
        if (i < step) {
            dot.classList.add('done');
            dot.innerHTML = '<i class="bi bi-check-lg" style="font-size:0.8rem;"></i>';
            if (line) line.classList.add('done');
        } else if (i === step) {
            dot.classList.add('active');
        }
    }
}

/* ─── STEP 1: EMAIL ─── */
const emailEl = document.getElementById('emailInput');
emailEl.addEventListener('input', function () {
    const v = this.value.trim();
    const msg = document.getElementById('emailMsg');
    if (!v) { msg.textContent=''; this.classList.remove('is-valid','is-invalid'); toggleStep1Btn(); return; }
    if (isValidLookup(v)) {
        this.classList.add('is-valid'); this.classList.remove('is-invalid');
        msg.className='field-msg ok';
        msg.textContent = document.getElementById('lookupType').value === 'id'
            ? '✓ Valid Student ID'
            : '✓ Valid email address';
    } else {
        this.classList.add('is-invalid'); this.classList.remove('is-valid');
        msg.className='field-msg err';
        msg.textContent = document.getElementById('lookupType').value === 'id'
            ? '✗ Enter a valid Student ID (e.g. PLAX26S001)'
            : '✗ Enter a valid email address';
    }
    toggleStep1Btn();
});

function toggleStep1Btn() {
    document.getElementById('step1Btn').disabled = !isValidLookup(emailEl.value.trim());
}

function setLookupType(type) {
    document.getElementById('lookupType').value = type;
    const emailBtn = document.getElementById('byEmailBtn');
    const idBtn    = document.getElementById('byIdBtn');
    const icon     = document.getElementById('lookupIcon');
    const input    = document.getElementById('emailInput');

    if (type === 'email') {
        emailBtn.style.cssText = 'flex:1;padding:0.45rem;border-radius:8px;border:1.5px solid var(--accent);background:rgba(37,99,235,0.08);color:var(--accent);font-weight:600;font-size:0.82rem;cursor:pointer;';
        idBtn.style.cssText    = 'flex:1;padding:0.45rem;border-radius:8px;border:1.5px solid var(--grey-200);background:var(--white);color:var(--grey-700);font-weight:600;font-size:0.82rem;cursor:pointer;';
        icon.innerHTML = '<i class="bi bi-envelope"></i>';
        input.placeholder = 'your.email@example.com';
    } else {
        idBtn.style.cssText    = 'flex:1;padding:0.45rem;border-radius:8px;border:1.5px solid var(--accent);background:rgba(37,99,235,0.08);color:var(--accent);font-weight:600;font-size:0.82rem;cursor:pointer;';
        emailBtn.style.cssText = 'flex:1;padding:0.45rem;border-radius:8px;border:1.5px solid var(--grey-200);background:var(--white);color:var(--grey-700);font-weight:600;font-size:0.82rem;cursor:pointer;';
        icon.innerHTML = '<i class="bi bi-fingerprint"></i>';
        input.placeholder = 'e.g. PLAX26S0001';
    }
    input.dispatchEvent(new Event('input'));
    toggleStep1Btn();
}

// Update goStep2() to pass the typed value correctly
function goStep2() {
    const identifier = document.getElementById('emailInput').value.trim();
    if (!isValidLookup(identifier)) return;
    verifiedIdentifier = identifier;
    document.getElementById('hiddenEmail').value = identifier;
    showStep(2);
}

function goStep1() { showStep(1); }

/* ─── STEP 2: DOB + DIGITS ─── */
// Digit box auto-advance
const digitIds = ['d1','d2','d3','d4'];
digitIds.forEach((id, idx) => {
    const box = document.getElementById(id);
    box.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g,'').slice(-1);
        if (this.value) {
            this.classList.add('filled');
            if (idx < 3) document.getElementById(digitIds[idx+1]).focus();
        } else {
            this.classList.remove('filled');
        }
        validateStep2();
    });
    box.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !this.value && idx > 0) {
            document.getElementById(digitIds[idx-1]).focus();
        }
    });
    box.addEventListener('paste', function (e) {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,4);
        paste.split('').forEach((ch, i) => {
            if (i < 4) {
                const b = document.getElementById(digitIds[i]);
                b.value = ch; b.classList.add('filled');
            }
        });
        validateStep2();
        document.getElementById(digitIds[Math.min(paste.length-1, 3)]).focus();
    });
});

document.getElementById('dobInput').addEventListener('change', validateStep2);

function getDigits() { return digitIds.map(id => document.getElementById(id).value).join(''); }

function validateStep2() {
    const dob    = document.getElementById('dobInput').value;
    const digits = getDigits();
    document.getElementById('step2Btn').disabled = !(dob && digits.length === 4);
}

function submitVerify() {
    // Validate visually, then move to step 3 — actual validation happens on form submit server-side
    const dob    = document.getElementById('dobInput').value;
    const digits = getDigits();

    if (!dob || digits.length !== 4) return;

    // Store for hidden fields
    document.getElementById('hiddenEmail').value   = verifiedIdentifier;
    document.getElementById('hiddenDob').value     = dob;
    document.getElementById('hiddenMobile4').value = digits;

    showStep(3);
}

/* ─── STEP 3: PASSWORD ─── */
document.getElementById('newPassword').addEventListener('input', function () {
    const p = this.value; let s = 0;
    if (p.length >= 8) s += 25;
    if (p.match(/[a-z]/) && p.match(/[A-Z]/)) s += 25;
    if (p.match(/[0-9]/)) s += 25;
    if (p.match(/[^a-zA-Z0-9]/)) s += 25;
    const fill = document.getElementById('strengthFill'), txt = document.getElementById('strengthText');
    fill.style.width = s + '%';
    const lvl = {
        0:   ['transparent',    'var(--grey-400)', 'Choose a strong password'],
        25:  ['var(--danger)',  'var(--danger)',   'Weak — add more variety'],
        50:  ['var(--warning)', 'var(--warning)',  'Fair — could be stronger'],
        75:  ['var(--accent)',  'var(--accent)',   'Good password'],
        100: ['var(--success)', 'var(--success)',  'Strong password!']
    };
    const e = lvl[s] || lvl[100];
    fill.style.background = e[0]; txt.style.color = e[1]; txt.textContent = e[2];
    checkPwdMatch();
    validateStep3();
});

document.getElementById('confirmPassword').addEventListener('input', function () { checkPwdMatch(); validateStep3(); });

function checkPwdMatch() {
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    const msg = document.getElementById('pwdMatchMsg');
    if (!p2) { msg.textContent=''; return; }
    if (p1 === p2) { msg.className='field-msg ok'; msg.textContent='✓ Passwords match'; }
    else           { msg.className='field-msg err'; msg.textContent='✗ Passwords do not match'; }
}

function validateStep3() {
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    document.getElementById('step3Btn').disabled = !(p1.length >= 8 && p1 === p2);
}

/* ─── SHOW STEP ─── */
function showStep(n) {
    currentStep = n;
    for (let i = 1; i <= 3; i++) {
        document.getElementById(`step${i}`).classList.remove('active');
    }
    document.getElementById(`step${n}`).classList.add('active');
    updateHeader(n);
}

/* ─── FORM SUBMIT ─── */
document.getElementById('resetForm').addEventListener('submit', function (e) {
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    if (!p1 || p1 !== p2 || p1.length < 8) { e.preventDefault(); return; }
    // Populate hidden password field
    document.getElementById('hiddenPassword').value = p1;
    document.getElementById('submitTxt').classList.add('d-none');
    document.getElementById('submitSpin').classList.remove('d-none');
    document.getElementById('step3Btn').disabled = true;
});

/* ─── AUTO DISMISS ALERTS ─── */
document.querySelectorAll('.alert').forEach(a => {
    setTimeout(() => { a.style.opacity='0'; a.style.transition='opacity 0.3s'; setTimeout(()=>a.remove(),300); }, 5000);
});

// Init
updateHeader(1);
