document.addEventListener('DOMContentLoaded', () => {
  const scene = document.getElementById('scene-3d');
  const gridLayer = document.querySelector('.grid-layer');
  const particlesLayer = document.querySelector('.particles-layer');
  const skylineLayer = document.querySelector('.skyline-layer');
  const hudCard = document.querySelector('.hud-card');

  if (!scene) return;

  document.addEventListener('mousemove', (e) => {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    const offsetX = x - 0.5;
    const offsetY = y - 0.5;

    // Smoother, floating movement for Ethereal theme
    const moveX = offsetX * 40; 
    const moveY = offsetY * 20;

    if (gridLayer) {
      // Gentle tilt
      gridLayer.style.transform = `rotateX(80deg) translate(${-moveX}px, ${-moveY}px)`;
    }

    if (skylineLayer) {
      // Very subtle movement for distant city
      skylineLayer.style.transform = `translate(${-moveX * 0.2}px, ${-moveY * 0.1}px)`;
    }

    const orbs = document.querySelectorAll('.orb');
    orbs.forEach((orb, index) => {
      const depth = index === 0 ? 0.05 : 0.08;
      orb.style.transform = `translate(${offsetX * 100 * (index + 1)}px, ${offsetY * 80 * (index + 1)}px)`;
    });

    if (particlesLayer) {
      particlesLayer.style.transform = `translate(${moveX * 1.5}px, ${moveY * 1.5}px)`;
    }
  });

  document.addEventListener('mouseleave', () => {
    if (gridLayer) {
      gridLayer.style.transform = '';
    }
    if (skylineLayer) {
      skylineLayer.style.transform = '';
    }
    if (particlesLayer) {
      particlesLayer.style.transform = '';
    }
    if (hudCard) {
      hudCard.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg)';
    }
  });
});
