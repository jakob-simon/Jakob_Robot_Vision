/* werkfluss – Start: Simulation aufbauen (inkl. Vorrechnen bis Mo 08:40), dann App starten. */
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
