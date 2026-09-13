'use strict';

/* ==========================================================================
   1. STORAGE LAYER
   ========================================================================== */
const STORAGE_KEY = 'medidorapp_readings_v1';

const Storage = {
  getAll(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(err){
      console.error('Error leyendo LocalStorage:', err);
      return [];
    }
  },
  saveAll(readings){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
      return true;
    }catch(err){
      console.error('Error guardando en LocalStorage:', err);
      Toast.show('No se pudo guardar. Almacenamiento lleno o bloqueado.', true);
      return false;
    }
  },
  add(reading){
    const all = this.getAll();
    all.push(reading);
    all.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    this.saveAll(all);
    return all;
  },
  remove(id){
    const all = this.getAll().filter(r => r.id !== id);
    this.saveAll(all);
    return all;
  }
};

/* ==========================================================================
   2. UTILITIES
   ========================================================================== */
const METER_META = {
  luz:  { label: 'Luz',  icon: 'fa-bolt',    unit: 'kWh' },
  agua: { label: 'Agua', icon: 'fa-droplet', unit: 'm³'  },
  gas:  { label: 'Gas',  icon: 'fa-fire',    unit: 'm³'  },
  otro: { label: 'Otro', icon: 'fa-gauge',   unit: 'u.'  }
};

function uid(){
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function formatDate(iso){
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) +
         ' · ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatNumber(n){
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

const Toast = {
  el: null,
  timer: null,
  show(message, isError = false){
    if (!this.el) this.el = document.getElementById('toast');
    this.el.innerHTML = `<i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i><span>${message}</span>`;
    this.el.classList.toggle('error', isError);
    this.el.classList.remove('hidden');
    requestAnimationFrame(() => this.el.classList.add('show'));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.classList.remove('show');
      setTimeout(() => this.el.classList.add('hidden'), 250);
    }, 2800);
  }
};

/* ==========================================================================
   3. NAVIGATION (bottom nav + views)
   ========================================================================== */
const Nav = {
  init(){
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.goTo(btn.dataset.view));
    });
  },
  goTo(viewName){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });

    if (viewName === 'historial') History.render();
    if (viewName === 'estadisticas') Stats.render();
  }
};

/* ==========================================================================
   4. MANUAL FORM
   ========================================================================== */
const ManualForm = {
  els: {},
  init(){
    this.els.form = document.getElementById('formManual');
    this.els.type = document.getElementById('meterType');
    this.els.value = document.getElementById('readingValue');
    this.els.unit = document.getElementById('readingUnit');
    this.els.date = document.getElementById('readingDate');
    this.els.time = document.getElementById('readingTime');
    this.els.notes = document.getElementById('readingNotes');

    this.setDefaultDateTime();
    this.syncUnit();

    this.els.type.addEventListener('change', () => this.syncUnit());
    this.els.form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Mode switch (manual / OCR)
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });
  },
  switchMode(mode){
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('formManual').classList.toggle('hidden', mode !== 'manual');
    document.getElementById('ocrPanel').classList.toggle('hidden', mode !== 'ocr');
  },
  setDefaultDateTime(){
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    this.els.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    this.els.time.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  },
  syncUnit(){
    const meta = METER_META[this.els.type.value];
    if (meta) this.els.unit.value = meta.unit;
  },
  handleSubmit(e){
    e.preventDefault();

    const value = parseFloat(this.els.value.value);
    if (isNaN(value)){
      Toast.show('Ingresa un valor numérico válido.', true);
      return;
    }

    const datetime = `${this.els.date.value}T${this.els.time.value || '00:00'}:00`;
    const reading = {
      id: uid(),
      type: this.els.type.value,
      value: value,
      unit: this.els.unit.value.trim() || METER_META[this.els.type.value].unit,
      datetime: datetime,
      notes: this.els.notes.value.trim(),
      createdAt: new Date().toISOString()
    };

    Storage.add(reading);
    Toast.show('Lectura guardada correctamente.');
    this.resetForm();
  },
  resetForm(){
    this.els.value.value = '';
    this.els.notes.value = '';
    this.setDefaultDateTime();
  },
  fillFromOcr(value){
    this.switchMode('manual');
    this.els.value.value = value;
    this.els.value.focus();
  }
};

/* ==========================================================================
   5. OCR FLOW: Upload -> Crop (Cropper.js) -> Tesseract -> Verify -> Fill form
   ========================================================================== */
const OcrFlow = {
  cropper: null,
  els: {},

  init(){
    this.els.dropzone = document.getElementById('ocrDropzone');
    this.els.inputFile = document.getElementById('inputFile');
    this.els.inputCamera = document.getElementById('inputCamera');
    this.els.errorBox = document.getElementById('ocrError');
    this.els.errorText = document.getElementById('ocrErrorText');

    this.els.cropModal = document.getElementById('cropModal');
    this.els.cropImage = document.getElementById('cropImage');
    this.els.confirmCrop = document.getElementById('confirmCrop');
    this.els.cancelCrop = document.getElementById('cancelCrop');
    this.els.closeCropModal = document.getElementById('closeCropModal');

    this.els.ocrModal = document.getElementById('ocrModal');
    this.els.ocrStatusText = document.getElementById('ocrStatusText');
    this.els.ocrProgressFill = document.getElementById('ocrProgressFill');

    this.els.resultModal = document.getElementById('ocrResultModal');
    this.els.resultValue = document.getElementById('ocrResultValue');
    this.els.useOcrValue = document.getElementById('useOcrValue');
    this.els.closeResultModal = document.getElementById('closeResultModal');

    this.bindEvents();
  },

  bindEvents(){
    this.els.inputFile.addEventListener('change', (e) => this.handleFile(e.target.files[0]));
    this.els.inputCamera.addEventListener('change', (e) => this.handleFile(e.target.files[0]));

    // Drag & drop
    ['dragover', 'dragenter'].forEach(evt =>
      this.els.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        this.els.dropzone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      this.els.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        this.els.dropzone.classList.remove('dragover');
      })
    );
    this.els.dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) this.handleFile(file);
    });

    this.els.confirmCrop.addEventListener('click', () => this.runOcr());
    this.els.cancelCrop.addEventListener('click', () => this.closeCropModal());
    this.els.closeCropModal.addEventListener('click', () => this.closeCropModal());

    this.els.useOcrValue.addEventListener('click', () => {
      const val = parseFloat(this.els.resultValue.value);
      if (isNaN(val)){
        Toast.show('Ingresa un número válido.', true);
        return;
      }
      this.els.resultModal.classList.add('hidden');
      ManualForm.fillFromOcr(val);
    });
    this.els.closeResultModal.addEventListener('click', () => this.els.resultModal.classList.add('hidden'));
  },

  hideError(){ this.els.errorBox.classList.add('hidden'); },
  showError(msg){
    this.els.errorText.textContent = msg;
    this.els.errorBox.classList.remove('hidden');
  },

  handleFile(file){
    this.hideError();
    if (!file){ return; }
    if (!file.type.startsWith('image/')){
      this.showError('El archivo seleccionado no es una imagen válida.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => this.openCropModal(e.target.result);
    reader.onerror = () => this.showError('No se pudo leer el archivo de imagen.');
    reader.readAsDataURL(file);

    // reset inputs so selecting the same file again re-triggers change
    this.els.inputFile.value = '';
    this.els.inputCamera.value = '';
  },

  openCropModal(dataUrl){
    this.els.cropImage.src = dataUrl;
    this.els.cropModal.classList.remove('hidden');

    // Cropper must init after the image is rendered
    this.els.cropImage.onload = () => {
      if (this.cropper) this.cropper.destroy();
      this.cropper = new Cropper(this.els.cropImage, {
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.6,
        background: false,
        responsive: true,
        guides: true,
        movable: true,
        zoomable: true,
        scalable: false,
      });
    };
  },

  closeCropModal(){
    if (this.cropper){
      this.cropper.destroy();
      this.cropper = null;
    }
    this.els.cropModal.classList.add('hidden');
  },

  runOcr(){
    if (!this.cropper){
      this.showError('No hay una imagen recortada para procesar.');
      return;
    }

    const canvas = this.cropper.getCroppedCanvas({
      width: 600,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    if (!canvas){
      this.showError('No se pudo generar el recorte. Intenta seleccionar otra área.');
      return;
    }

    this.closeCropModal();
    this.els.ocrModal.classList.remove('hidden');
    this.els.ocrStatusText.textContent = 'Analizando imagen…';
    this.els.ocrProgressFill.style.width = '0%';

    canvas.toBlob((blob) => {
      if (!blob){
        this.els.ocrModal.classList.add('hidden');
        this.showError('No se pudo procesar el recorte de la imagen.');
        return;
      }
      this.processWithTesseract(blob);
    }, 'image/png');
  },

  async processWithTesseract(blob){
    try{
      const result = await Tesseract.recognize(blob, 'eng', {
        logger: (m) => {
          if (m.status && typeof m.progress === 'number'){
            const pct = Math.round(m.progress * 100);
            this.els.ocrProgressFill.style.width = pct + '%';
            const statusMap = {
              'loading tesseract core': 'Cargando motor OCR…',
              'initializing tesseract': 'Inicializando…',
              'loading language traineddata': 'Cargando idioma…',
              'initializing api': 'Preparando análisis…',
              'recognizing text': 'Reconociendo dígitos…'
            };
            this.els.ocrStatusText.textContent = statusMap[m.status] || 'Procesando…';
          }
        },
        tessedit_char_whitelist: '0123456789.,'
      });

      this.els.ocrModal.classList.add('hidden');

      const rawText = (result && result.data && result.data.text) ? result.data.text : '';
      const numericValue = this.extractNumber(rawText);

      if (numericValue === null){
        this.showError('No se detectaron dígitos claros. Intenta recortar de nuevo con mejor luz y encuadre.');
        return;
      }

      this.els.resultValue.value = numericValue;
      this.els.resultModal.classList.remove('hidden');

    }catch(err){
      console.error('Error de Tesseract:', err);
      this.els.ocrModal.classList.add('hidden');
      this.showError('Ocurrió un error durante el reconocimiento óptico. Intenta nuevamente.');
    }
  },

  extractNumber(text){
    if (!text) return null;
    // Keep digits, dots and commas; normalize comma to dot; strip everything else
    const cleaned = text.replace(/[^\d.,]/g, '').trim();
    if (!cleaned) return null;

    // Take the longest contiguous numeric token found
    const tokens = cleaned.match(/[\d.,]+/g);
    if (!tokens || !tokens.length) return null;

    let best = tokens.sort((a, b) => b.length - a.length)[0];
    best = best.replace(/,/g, '.');

    // Collapse multiple dots (keep the last as decimal separator)
    const parts = best.split('.');
    if (parts.length > 2){
      best = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    }

    const num = parseFloat(best);
    return isNaN(num) ? null : num;
  }
};

/* ==========================================================================
   5B. DEMO DATA (simulación en tiempo real, sin backend)
   ========================================================================== */
const DemoData = {
  init(){
    const btn = document.getElementById('btnDemo');
    if (btn) btn.addEventListener('click', () => this.confirmAndSeed());
  },

  confirmAndSeed(){
    const proceed = confirm(
      'Esto agregará ~24 lecturas simuladas (Luz, Agua y Gas) de los últimos 6 meses ' +
      'a tu historial actual en localStorage, para que veas el guardado, el historial ' +
      'y las gráficas funcionando en tiempo real.\n\n¿Continuar?'
    );
    if (proceed) this.seed();
  },

  seed(){
    const readings = this.generate();
    const existing = Storage.getAll();
    const merged = existing.concat(readings);
    merged.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    Storage.saveAll(merged);

    Toast.show(`Se cargaron ${readings.length} lecturas de demostración.`);

    // Refresca cualquier vista visible en este momento
    History.render();
    Stats.render();
  },

  generate(){
    const now = new Date();
    const readings = [];

    // Punto de partida base para cada tipo de medidor + su incremento mensual aproximado
    const series = {
      luz:  { start: 1200,  monthlyStep: () => 90 + Math.random() * 30, unit: 'kWh' },
      agua: { start: 340,   monthlyStep: () => 6 + Math.random() * 3,   unit: 'm³'  },
      gas:  { start: 78,    monthlyStep: () => 4 + Math.random() * 2,   unit: 'm³'  }
    };

    Object.keys(series).forEach(type => {
      let value = series[type].start;

      // 6 meses hacia atrás, una lectura por mes, día 3 de cada mes aprox.
      for (let m = 6; m >= 0; m--){
        const d = new Date(now.getFullYear(), now.getMonth() - m, 3, 9, 15, 0);
        if (m !== 6){
          value += series[type].monthlyStep();
        }
        readings.push({
          id: uid(),
          type: type,
          value: Math.round(value * 100) / 100,
          unit: series[type].unit,
          datetime: d.toISOString().slice(0, 19),
          notes: m === 0 ? 'Lectura simulada más reciente' : '',
          createdAt: new Date().toISOString()
        });
      }
    });

    return readings;
  }
};

/* ==========================================================================
   6. HISTORY
   ========================================================================== */
const History = {
  els: {},
  init(){
    this.els.list = document.getElementById('historyList');
    this.els.empty = document.getElementById('historyEmpty');
    this.els.filter = document.getElementById('filterType');
    this.els.exportBtn = document.getElementById('btnExport');

    this.els.filter.addEventListener('change', () => this.render());
    this.els.exportBtn.addEventListener('click', () => this.exportData());
  },

  render(){
    const filterVal = this.els.filter.value;
    const all = Storage.getAll().slice().sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    const filtered = filterVal === 'todos' ? all : all.filter(r => r.type === filterVal);

    this.els.list.innerHTML = '';

    if (!filtered.length){
      this.els.empty.classList.remove('hidden');
      return;
    }
    this.els.empty.classList.add('hidden');

    // For diff calculation, compare against previous reading of the SAME type, chronologically
    const chronological = Storage.getAll().slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    filtered.forEach(reading => {
      const sameTypeChrono = chronological.filter(r => r.type === reading.type);
      const idx = sameTypeChrono.findIndex(r => r.id === reading.id);
      const prev = idx > 0 ? sameTypeChrono[idx - 1] : null;
      const diff = prev ? (reading.value - prev.value) : null;

      this.els.list.appendChild(this.buildItem(reading, diff));
    });
  },

  buildItem(reading, diff){
    const meta = METER_META[reading.type] || METER_META.otro;
    const li = document.createElement('li');
    li.className = 'history-item';

    let diffHtml = '<span class="history-diff neutral">Primera lectura</span>';
    if (diff !== null){
      const cls = diff >= 0 ? 'up' : 'neutral';
      const sign = diff >= 0 ? '+' : '';
      diffHtml = `<span class="history-diff ${cls}">${sign}${formatNumber(diff)} ${reading.unit}</span>`;
    }

    li.innerHTML = `
      <div class="history-icon ${reading.type}"><i class="fa-solid ${meta.icon}"></i></div>
      <div class="history-body">
        <div class="history-top">
          <span class="history-value">${formatNumber(reading.value)} ${reading.unit}</span>
          <span class="history-date">${formatDate(reading.datetime)}</span>
        </div>
        <div class="history-meta">
          <span class="history-notes">${reading.notes ? reading.notes : meta.label}</span>
          ${diffHtml}
        </div>
      </div>
      <button class="history-delete" title="Eliminar registro" data-id="${reading.id}">
        <i class="fa-solid fa-trash"></i>
      </button>
    `;

    li.querySelector('.history-delete').addEventListener('click', () => this.deleteReading(reading.id));
    return li;
  },

  deleteReading(id){
    Storage.remove(id);
    Toast.show('Registro eliminado.');
    this.render();
  },

  exportData(){
    const all = Storage.getAll();
    if (!all.length){
      Toast.show('No hay datos para exportar.', true);
      return;
    }
    this.showExportChoice(all);
  },

  showExportChoice(data){
    // Simple native confirm-based choice to keep it dependency-free
    const wantsCsv = confirm('Pulsa "Aceptar" para exportar como CSV, o "Cancelar" para exportar como JSON.');
    if (wantsCsv){
      this.downloadCsv(data);
    }else{
      this.downloadJson(data);
    }
  },

  downloadJson(data){
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this.triggerDownload(blob, `medidorapp_export_${Date.now()}.json`);
  },

  downloadCsv(data){
    const headers = ['id', 'type', 'value', 'unit', 'datetime', 'notes'];
    const rows = data.map(r => headers.map(h => {
      const val = (r[h] ?? '').toString().replace(/"/g, '""');
      return `"${val}"`;
    }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    this.triggerDownload(blob, `medidorapp_export_${Date.now()}.csv`);
  },

  triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Toast.show('Exportación generada.');
  }
};

/* ==========================================================================
   7. STATS + CHART
   ========================================================================== */
const Stats = {
  chart: null,
  els: {},

  init(){
    this.els.last = document.getElementById('statLast');
    this.els.lastMeta = document.getElementById('statLastMeta');
    this.els.avg = document.getElementById('statAvg');
    this.els.avgMeta = document.getElementById('statAvgMeta');
    this.els.chartType = document.getElementById('chartType');
    this.els.canvas = document.getElementById('consumptionChart');
    this.els.chartEmpty = document.getElementById('chartEmpty');

    this.els.chartType.addEventListener('change', () => this.renderChart());
  },

  render(){
    this.renderSummary();
    this.renderChart();
  },

  renderSummary(){
    const all = Storage.getAll().slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    if (!all.length){
      this.els.last.textContent = '—';
      this.els.lastMeta.textContent = 'Sin datos';
      this.els.avg.textContent = '—';
      this.els.avgMeta.textContent = 'Sin datos';
      return;
    }

    const lastReading = all[all.length - 1];
    const meta = METER_META[lastReading.type] || METER_META.otro;
    this.els.last.textContent = `${formatNumber(lastReading.value)} ${lastReading.unit}`;
    this.els.lastMeta.textContent = `${meta.label} · ${formatDate(lastReading.datetime)}`;

    // Average monthly consumption: aggregate diffs within the current month, across all types averaged by type then summed conceptually.
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

    let totalDiff = 0;
    let countDiff = 0;

    Object.keys(METER_META).forEach(type => {
      const typeReadings = all.filter(r => r.type === type);
      for (let i = 1; i < typeReadings.length; i++){
        const d = new Date(typeReadings[i].datetime);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (key === currentMonthKey){
          const diff = typeReadings[i].value - typeReadings[i - 1].value;
          if (diff >= 0){
            totalDiff += diff;
            countDiff++;
          }
        }
      }
    });

    if (countDiff > 0){
      this.els.avg.textContent = formatNumber(totalDiff / countDiff);
      this.els.avgMeta.textContent = 'Promedio de incrementos este mes';
    }else{
      this.els.avg.textContent = '—';
      this.els.avgMeta.textContent = 'Sin suficientes datos este mes';
    }
  },

  renderChart(){
    const type = this.els.chartType.value;
    const all = Storage.getAll()
      .filter(r => r.type === type)
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    if (this.chart){
      this.chart.destroy();
      this.chart = null;
    }

    if (all.length < 2){
      this.els.canvas.classList.add('hidden');
      this.els.chartEmpty.classList.remove('hidden');
      return;
    }

    this.els.canvas.classList.remove('hidden');
    this.els.chartEmpty.classList.add('hidden');

    const labels = all.map(r => {
      const d = new Date(r.datetime);
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    });
    const values = all.map(r => r.value);

    const ctx = this.els.canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(0,230,118,0.35)');
    gradient.addColorStop(1, 'rgba(0,230,118,0)');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${METER_META[type].label} (${METER_META[type].unit})`,
          data: values,
          borderColor: '#00E676',
          backgroundColor: gradient,
          borderWidth: 2.5,
          pointBackgroundColor: '#00E5FF',
          pointBorderColor: '#00121',
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E1E24',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#F2F2F5',
            bodyColor: '#9A9AA5',
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#6B6B76', font: { size: 10.5 } }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#6B6B76', font: { size: 10.5 } }
          }
        }
      }
    });
  }
};

/* ==========================================================================
   8. INIT
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  Nav.init();
  ManualForm.init();
  OcrFlow.init();
  History.init();
  Stats.init();
  DemoData.init();

  History.render();
});