(function () {
  function initPasswordToggle() {
    var toggle = document.querySelector('.password-toggle');
    var pwd = document.getElementById('pwd');
    var icon = document.getElementById('icon');
    if (!toggle || !pwd || !icon) return;

    toggle.addEventListener('click', function () {
      pwd.type = pwd.type === 'password' ? 'text' : 'password';
      icon.classList.toggle('bi-eye');
      icon.classList.toggle('bi-eye-slash');
    });
  }

  function initSubmitSpinner() {
    var form = document.getElementById('loginForm');
    var btn = document.getElementById('btn');
    var txt = document.getElementById('txt');
    var spin = document.getElementById('spin');
    if (!form || !btn || !txt || !spin) return;

    form.addEventListener('submit', function () {
      btn.disabled = true;
      txt.classList.add('d-none');
      spin.classList.remove('d-none');
    });
  }

  function initAlertAutoDismiss() {
    document.querySelectorAll('.alert').forEach(function (alertEl) {
      setTimeout(function () {
        alertEl.style.opacity = '0';
        alertEl.style.transition = 'opacity 0.3s';
        setTimeout(function () { alertEl.remove(); }, 300);
      }, 5000);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initPasswordToggle();
    initSubmitSpinner();
    initAlertAutoDismiss();
  });
})();
