/* werkfluss – Start: Startbildschirm zeichnen lassen, Simulation aufbauen (inkl. Vorrechnen bis Mo 08:40),
   dann App starten. */
(function () {
  const WF = window.WF;
  function boot() {
    try {
      if (WF.sim && WF.sim.init) WF.sim.init(WF.profile);
    } catch (e) {
      console.error('[boot] Simulation konnte nicht starten', e);
    }
    WF.app.start();
  }
  // Erst einen Frame zeichnen (Startbildschirm), dann das synchrone Vorrechnen starten
  const later = () => requestAnimationFrame(() => setTimeout(boot, 20));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later);
  else later();
})();
