// Dictado por voz para las notas (fallas, cierre, trabajo del taller). Usa el reconocimiento de voz del teléfono:
// Chrome en Android y Safari en iPhone. En la mayoría de los teléfonos necesita señal; sin señal el botón no aparece.
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let activo = null;   // { rec, btn, el }

export const hayVoz = () => !!Rec;

// Botón de micrófono para el campo con ese id. Va al lado del campo, dentro del mismo bloque.
export const botonVoz = id => Rec ? `<button type="button" class="btn sm ghost voz" data-act="dictar" data-target="${id}" aria-label="Dictar por voz" title="Dictar por voz">
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/></svg>
  <span>Dictar</span></button>` : '';

function terminar() {
  if (!activo) return;
  const { btn } = activo; activo = null;
  if (btn && btn.isConnected) { btn.classList.remove('escuchando'); btn.querySelector('span').textContent = 'Dictar'; }
}

export function dictar(btn, aviso) {
  if (activo) { const a = activo; a.rec.stop(); terminar(); if (a.btn === btn) return; }
  if (!navigator.onLine) return aviso('Sin señal el dictado no funciona en la mayoría de los teléfonos. Escribí la nota.');
  const el = document.getElementById(btn.dataset.target); if (!el) return;
  const rec = new Rec();
  rec.lang = 'es-AR'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
  activo = { rec, btn, el };
  btn.classList.add('escuchando'); btn.querySelector('span').textContent = 'Escuchando… tocá para terminar';
  rec.onresult = ev => {
    let t = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) t += ev.results[i][0].transcript;
    t = t.trim(); if (!t) return;
    const prev = el.value.trim(), max = +el.getAttribute('maxlength') || 1000;
    el.value = (prev ? prev + (/[.!?]$/.test(prev) ? ' ' : '. ') : '') + t.charAt(0).toUpperCase() + t.slice(1);
    el.value = el.value.slice(0, max);
    el.dispatchEvent(new Event('input', { bubbles: true }));   // así se guarda como si se hubiera escrito
  };
  rec.onerror = ev => {
    terminar();
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') aviso('Para dictar, permití el uso del micrófono en el navegador.');
    else if (ev.error === 'network') aviso('El dictado necesita señal. Escribí la nota.');
    else if (ev.error !== 'no-speech' && ev.error !== 'aborted') aviso('No se pudo usar el dictado. Escribí la nota.');
  };
  rec.onend = terminar;
  try { rec.start(); } catch { terminar(); }
}
