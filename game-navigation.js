(() => {
  const buttons = [...document.querySelectorAll('[data-site-view]')];
  function showView() {
    const game = location.hash === '#game';
    document.querySelector('.intro').hidden = game;
    document.querySelector('.songbook').hidden = game;
    document.querySelector('#game-section').hidden = !game;
    buttons.forEach(button => {
      const active = (button.dataset.siteView === 'game') === game;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const frame = document.querySelector('#game-frame');
    if (game && !frame.getAttribute('src')) frame.src = frame.dataset.src;
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    location.hash = button.dataset.siteView === 'game' ? 'game' : 'songs';
  }));
  window.addEventListener('hashchange', showView);
  window.addEventListener('message', event => {
    const frame = document.querySelector('#game-frame');
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'jeongwa-game-height') return;
    const height = event.data.height;
    if (Number.isFinite(height) && height > 0 && height < 10000) frame.style.height = `${height + 2}px`;
  });
  showView();
})();
