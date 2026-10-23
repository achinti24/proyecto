// Ilustración de la portada: San Gil de noche (iglesia de dos torres, casas, ceibas del Gallineral y el río Fonce).
// SVG en línea para no hacer peticiones extra. Las ventanas se encienden una sola vez al cargar.

const ventanas = [
  // [x, y, ancho, alto, retraso en ms]
  [652, 236, 10, 16, 300], [778, 236, 10, 16, 420], [714, 262, 14, 24, 540],
  [652, 290, 10, 16, 660], [778, 290, 10, 16, 780],
  [452, 300, 9, 11, 500], [478, 300, 9, 11, 900], [542, 312, 9, 11, 700],
  [880, 300, 9, 11, 600], [906, 300, 9, 11, 1000], [972, 312, 9, 11, 820],
  [1040, 296, 9, 11, 950], [1066, 296, 9, 11, 1100], [366, 314, 9, 11, 1050],
];

const estrellas = [
  [120, 60], [260, 120], [340, 40], [480, 90], [560, 30], [700, 70], [860, 40], [930, 110],
  [1010, 60], [1300, 50], [1380, 130], [1250, 170], [200, 180], [1100, 140], [40, 130],
];

export const escena = `
<svg class="escena" viewBox="0 0 1440 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <g class="estrellas" fill="var(--hueso)">
    ${estrellas.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.2 : 1.8}" opacity="${i % 2 ? .45 : .8}"/>`).join('')}
  </g>
  <!-- luna saliendo entre los cerros, detrás de la iglesia -->
  <g class="luna">
    <circle cx="720" cy="200" r="92" fill="var(--hueso)" opacity=".05"/>
    <circle cx="720" cy="200" r="62" fill="var(--hueso)" opacity=".08"/>
    <circle cx="720" cy="200" r="46" fill="var(--hueso)"/>
    <circle cx="704" cy="188" r="7" fill="#e3d8c4"/><circle cx="738" cy="212" r="5" fill="#e3d8c4"/>
  </g>
  <!-- montañas de Santander -->
  <path d="M0 250 L120 190 L230 236 L360 170 L470 226 L600 180 L760 240 L900 176 L1040 228 L1190 168 L1320 222 L1440 186 V420 H0Z" fill="#2a2139"/>
  <path d="M0 300 L140 258 L300 292 L420 262 L560 300 L700 270 L860 304 L1000 268 L1160 300 L1300 266 L1440 296 V420 H0Z" fill="#30263f"/>
  <!-- ceibas con musgo (Parque El Gallineral) -->
  <g fill="#1b1424">
    <path d="M150 330 V268 M150 286 L118 262 M150 278 L184 254" stroke="#1b1424" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="150" cy="246" rx="70" ry="30"/>
    <path d="M110 256 v26 M128 262 v34 M170 260 v30 M190 254 v22" stroke="#4a5a3c" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <path d="M1300 336 V280 M1300 296 L1272 276" stroke="#1b1424" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="1300" cy="266" rx="56" ry="24"/>
    <path d="M1272 274 v24 M1322 272 v28" stroke="#4a5a3c" stroke-width="2" stroke-linecap="round" opacity=".7"/>
  </g>
  <!-- casas -->
  <g fill="#1b1424">
    <path d="M340 340 V306 L372 286 L404 306 V340Z"/>
    <path d="M430 340 V292 L470 268 L510 292 V340Z"/><path d="M520 340 V304 L552 284 L584 304 V340Z"/>
    <path d="M860 340 V292 L896 270 L932 292 V340Z"/><path d="M950 340 V304 L980 284 L1010 304 V340Z"/>
    <path d="M1020 340 V286 L1056 264 L1092 286 V340Z"/>
  </g>
  <!-- iglesia de dos torres -->
  <g fill="#17111f">
    <path d="M630 340 V220 L657 176 L684 220 V340Z"/>
    <path d="M756 340 V220 L783 176 L810 220 V340Z"/>
    <path d="M684 340 V250 L720 214 L756 250 V340Z"/>
    <path d="M657 176 V158 M650 165 H664 M783 176 V158 M776 165 H790" stroke="#17111f" stroke-width="3"/>
    <path d="M708 340 V312 a12 12 0 0 1 24 0 V340Z" fill="#0f0b15"/>
  </g>
  <g class="ventanas" fill="var(--calabaza)">
    ${ventanas.map(([x, y, w, h, d]) => `<rect class="win" x="${x}" y="${y}" width="${w}" height="${h}" rx="${w > 12 ? 7 : 1.5}" style="--d:${d}ms"/>`).join('')}
  </g>
  <!-- río Fonce -->
  <path d="M0 352 C220 338 420 366 720 350 S1220 338 1440 354 V420 H0Z" fill="#271e35"/>
  <path d="M90 372 h70 M300 384 h110 M620 370 h80 M900 388 h120 M1180 374 h90" stroke="var(--niebla)" stroke-width="2" stroke-linecap="round" opacity=".25"/>
  <path d="M0 400 C300 392 600 410 900 398 S1300 394 1440 402 V420 H0Z" fill="var(--noche)"/>
</svg>`;

// Iconos de categoría (trazo de 24 px)
const p = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONOS_CATEGORIA = {
  cultura: p('<path d="M3 4h10v6a5 5 0 0 1-10 0z"/><path d="M6 8h.01M10 8h.01M6 12c1.2.9 2.8.9 4 0"/><path d="M14 9h7v5a4.5 4.5 0 0 1-7.6 3.2"/><path d="M16.5 12h.01M19 12h.01"/>'),
  tecnologia: p('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20M10 9l-2 2 2 2M14 9l2 2-2 2"/>'),
  educacion: p('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>'),
  comunidad: p('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.8 5 5.8"/>'),
  deportes: p('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
  networking: p('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  emprendimiento: p('<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>'),
  otra: p('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>'),
};
