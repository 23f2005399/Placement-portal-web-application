// Navbar scroll effect
window.addEventListener('scroll', function () {
  const navbar = document.querySelector('.custom-navbar');
  if (!navbar) return;
  if (window.scrollY > 50) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      const offsetTop = target.offsetTop - 80;
      window.scrollTo({
        top: offsetTop,
        behavior: 'smooth',
      });
    }
  });
});

// Role tab switching
const roleTabs = document.querySelectorAll('.role-tab');
const workflowContents = document.querySelectorAll('.workflow-content');

roleTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    roleTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    workflowContents.forEach((content) => content.classList.remove('active'));
    const role = tab.getAttribute('data-role');
    const workflow = document.querySelector(`[data-workflow="${role}"]`);
    if (workflow) workflow.classList.add('active');
  });
});

// FAQ accordion
const faqItems = document.querySelectorAll('.faq-item');
faqItems.forEach((item) => {
  const question = item.querySelector('.faq-question');
  if (!question) return;
  question.addEventListener('click', () => {
    faqItems.forEach((otherItem) => {
      if (otherItem !== item) {
        otherItem.classList.remove('active');
      }
    });
    item.classList.toggle('active');
  });
});
