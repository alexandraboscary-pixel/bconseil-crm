/* B.Conseil — injects a mobile top bar + off-canvas drawer toggle.
   Inert on desktop (the .m-topbar / .nav-scrim are display:none above 820px). */
(function(){
  function init(){
    var app=document.querySelector('.app');
    if(!app || document.querySelector('.m-topbar')) return;

    var bar=document.createElement('div');
    bar.className='m-topbar';
    bar.innerHTML='<button class="burger" type="button" aria-label="Ouvrir le menu" aria-expanded="false">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M3 12h18"></path><path d="M3 18h18"></path></svg></button>'
      +'<img class="mt-logo" src="assets/bconseil-logo.png" alt="B.Conseil">';

    var scrim=document.createElement('div');
    scrim.className='nav-scrim';

    app.insertBefore(bar, app.firstChild);
    document.body.appendChild(scrim);

    var burger=bar.querySelector('.burger');
    function close(){ document.body.classList.remove('nav-open'); burger.setAttribute('aria-expanded','false'); }
    function toggle(){
      var open=document.body.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open?'true':'false');
    }
    burger.addEventListener('click', toggle);
    scrim.addEventListener('click', close);
    document.querySelectorAll('.sidebar .nav a').forEach(function(a){ a.addEventListener('click', close); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });
    window.addEventListener('resize', function(){ if(window.innerWidth>820) close(); });
  }
  if(document.readyState!=='loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
