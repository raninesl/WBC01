// Frontend Transition Manager
document.addEventListener('DOMContentLoaded', () => {
  // 1. Wrap body content if not already wrapped (to apply transform properly)
  // We need a wrapper to be the "face" of the cube
  if (!document.querySelector('.cube-wrapper')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cube-wrapper';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.transformStyle = 'preserve-3d';
    
    // Move all body children into wrapper
    while (document.body.firstChild) {
      wrapper.appendChild(document.body.firstChild);
    }
    document.body.appendChild(wrapper);
  }

  // 2. Apply Entry Animation
  const wrapper = document.querySelector('.cube-wrapper');
  
  // Check if we came from a "Back" action (stored in sessionStorage)
  const isBack = sessionStorage.getItem('isBackNavigation') === 'true';
  sessionStorage.removeItem('isBackNavigation'); // Reset

  wrapper.style.transformOrigin = '50% 50% -50vw';
  
  if (isBack) {
    wrapper.classList.add('page-enter-back');
  } else {
    wrapper.classList.add('page-enter');
  }
});

// 3. Global Navigation Function
window.transitionTo = function(url, isBack = false) {
  const wrapper = document.querySelector('.cube-wrapper');
  if (!wrapper) {
    window.location.href = url;
    return;
  }

  // Set flag for next page
  if (isBack) {
    sessionStorage.setItem('isBackNavigation', 'true');
    wrapper.classList.add('page-exit-back');
  } else {
    sessionStorage.setItem('isBackNavigation', 'false');
    wrapper.classList.add('page-exit');
  }

  // Wait for animation to finish then navigate
  setTimeout(() => {
    window.location.href = url;
  }, 800); // Matches --cube-duration in css
};

// 4. Helper to hook existing links (optional, for simple <a> tags)
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (link && link.href && link.target !== '_blank' && !link.href.startsWith('javascript:')) {
    const url = new URL(link.href);
    if (url.origin === window.location.origin) {
      e.preventDefault();
      // Simple heuristic: "Back" or "Retour" in text implies back navigation
      const isBack = link.textContent.toLowerCase().includes('retour') || link.textContent.includes('←');
      window.transitionTo(link.href, isBack);
    }
  }
});
