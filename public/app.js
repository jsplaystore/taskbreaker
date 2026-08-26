const $ = (id) => document.getElementById(id);

const els = {
  streakBadge: $('streak-badge'),
  connectGoogleBtn: $('connect-google-btn'),
  importClassroomBtn: $('import-classroom-btn'),
  importCanvasBtn: $('import-canvas-btn'),
  connectStatus: $('connect-status'),
  energyRow: $('energy-row'),
  taskInput: $('task-input'),
  micTaskBtn: $('mic-task-btn'),
  photoInput: $('photo-input'),
  screenshotInput: $('screenshot-input'),
  photoPreviewWrap: $('photo-preview-wrap'),
  photoPreview: $('photo-preview'),
  clearPhotoBtn: $('clear-photo-btn'),
  minutesInput: $('minutes-input'),
  deadlineInput: $('deadline-input'),
  breakdownBtn: $('breakdown-btn'),
  status: $('status'),
  inputPanel: $('input-panel'),
  canvasPicker: $('canvas-picker'),
  canvasList: $('canvas-list'),
  canvasPickerClose: $('canvas-picker-close'),
  stepsPanel: $('steps-panel'),
  taskTitle: $('task-title'),
  stepsContainer: $('steps-container'),
  restartBtn: $('restart-btn'),
  progressBarFill: $('progress-bar-fill'),
  progressLabel: $('progress-label'),
  panicBtn: $('panic-btn'),
  panicView: $('panic-view'),
  syncCalendarBtn: $('sync-calendar-btn'),
  checkinPanel: $('checkin-panel'),
  checkinPrompt: $('checkin-prompt'),
  checkinInput: $('checkin-input'),
  micCheckinBtn: $('mic-checkin-btn'),
  checkinSend: $('checkin-send'),
  checkinResponse: $('checkin-response'),
  intervalSelect: $('interval-select'),
  timerToggle: $('timer-toggle'),
  timerDisplay: $('timer-display'),
};

let state = {
  mode: 'flat', // 'flat' | 'backward'
  task: '',
  steps: [], // flat: {title, minutes, why, done}
  days: [], // backward: {date, label, steps: [{title, minutes, done}]}
  energy: 'medium',
  photoBase64: null,
  photoMime: null,
  googleAccessToken: null,
  googleClientId: null,
  canvasConfigured: false,
  tokenClient: null,
  timerId: null,
  secondsLeft: 0,
  requirePhoto: localStorage.getItem('tb_require_photo') === 'true',
  assignmentContext: null,
  voiceCheckins: localStorage.getItem('tb_voice_checkins') !== 'false',
};

els.taskInput.addEventListener('input', () => {
  state.assignmentContext = null;
});

const requirePhotoToggle = $('require-photo-toggle');
requirePhotoToggle.checked = state.requirePhoto;
requirePhotoToggle.addEventListener('change', () => {
  state.requirePhoto = requirePhotoToggle.checked;
  localStorage.setItem('tb_require_photo', String(state.requirePhoto));
});

const voiceCheckinToggle = $('voice-checkin-toggle');
voiceCheckinToggle.checked = state.voiceCheckins;
voiceCheckinToggle.addEventListener('change', () => {
  state.voiceCheckins = voiceCheckinToggle.checked;
  localStorage.setItem('tb_voice_checkins', String(state.voiceCheckins));
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Streak ----------
function bumpStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const last = localStorage.getItem('tb_last_date');
  let streak = Number(localStorage.getItem('tb_streak') || '0');
  if (last === today) {
    // already counted today
  } else {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    streak = last === yesterday ? streak + 1 : 1;
    localStorage.setItem('tb_last_date', today);
    localStorage.setItem('tb_streak', String(streak));
  }
  els.streakBadge.textContent = `${streak} day streak`;
  els.streakBadge.classList.remove('hidden');
}
(function showExistingStreak() {
  const streak = Number(localStorage.getItem('tb_streak') || '0');
  if (streak > 0) {
    els.streakBadge.textContent = `${streak} day streak`;
    els.streakBadge.classList.remove('hidden');
  }
})();

// ---------- Config / Integrations ----------
const googleModal = $('google-setup-modal');
const canvasModal = $('canvas-setup-modal');
const googleClientIdInput = $('google-client-id-input');
const canvasUrlInput = $('canvas-url-input');
const canvasTokenInput = $('canvas-token-input');

function loadStoredCredentials() {
  state.googleClientId = localStorage.getItem('tb_google_client_id') || null;
  state.canvasUrl = localStorage.getItem('tb_canvas_url') || null;
  state.canvasToken = localStorage.getItem('tb_canvas_token') || null;
}

async function loadServerDefaults() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (!state.googleClientId && cfg.googleClientId) state.googleClientId = cfg.googleClientId;
    if (!state.canvasUrl && cfg.canvasUrl) state.canvasUrl = cfg.canvasUrl;
  } catch {
    // no server defaults available, that's fine, setup modals cover it
  }
}

loadStoredCredentials();
loadServerDefaults();

const originHint = $('origin-hint-1');
if (originHint) originHint.textContent = window.location.origin;

function openModal(modal) {
  modal.classList.remove('hidden');
}
function closeModal(modal) {
  modal.classList.add('hidden');
}

function initGoogleTokenClient() {
  if (!window.google || !state.googleClientId) return null;
  return google.accounts.oauth2.initTokenClient({
    client_id: state.googleClientId,
    scope:
      'https://www.googleapis.com/auth/calendar.events ' +
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly ' +
      'https://www.googleapis.com/auth/classroom.courses.readonly',
    callback: (resp) => {
      if (resp.error) {
        els.connectStatus.textContent = 'Google auth failed: ' + resp.error;
        return;
      }
      state.googleAccessToken = resp.access_token;
      els.connectStatus.textContent = 'Google connected.';
      els.importClassroomBtn.classList.remove('hidden');
      els.syncCalendarBtn.classList.remove('hidden');
    },
  });
}

function connectGoogle() {
  if (!state.googleClientId) {
    openModal(googleModal);
    return;
  }
  state.tokenClient = initGoogleTokenClient();
  state.tokenClient?.requestAccessToken();
}

els.connectGoogleBtn.addEventListener('click', connectGoogle);
$('edit-google-setup-btn').addEventListener('click', () => {
  googleClientIdInput.value = state.googleClientId || '';
  openModal(googleModal);
});
$('google-setup-cancel').addEventListener('click', () => closeModal(googleModal));
$('google-setup-save').addEventListener('click', () => {
  const value = googleClientIdInput.value.trim();
  if (!value) return;
  state.googleClientId = value;
  localStorage.setItem('tb_google_client_id', value);
  closeModal(googleModal);
  connectGoogle();
});

els.importClassroomBtn.addEventListener('click', async () => {
  if (!state.googleAccessToken) return;
  els.connectStatus.textContent = 'Loading Classroom assignments...';
  try {
    const coursesRes = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
      headers: { Authorization: `Bearer ${state.googleAccessToken}` },
    });
    const coursesData = await coursesRes.json();
    const items = [];
    for (const course of coursesData.courses || []) {
      const workRes = await fetch(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork?courseWorkStates=PUBLISHED`,
        { headers: { Authorization: `Bearer ${state.googleAccessToken}` } }
      );
      const workData = await workRes.json();
      for (const w of workData.courseWork || []) {
        let dueAt = null;
        if (w.dueDate) {
          const { year, month, day } = w.dueDate;
          dueAt = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        items.push({ course: course.name, name: w.title, dueAt, url: w.alternateLink, description: w.description || '' });
      }
    }
    els.connectStatus.textContent = '';
    showPickerList(items, 'classroom');
  } catch (err) {
    els.connectStatus.textContent = 'Could not load Classroom assignments: ' + err.message;
  }
});

function importCanvas() {
  if (!state.canvasUrl || !state.canvasToken) {
    canvasUrlInput.value = state.canvasUrl || '';
    canvasTokenInput.value = '';
    openModal(canvasModal);
    return;
  }
  fetchCanvasAssignments();
}

async function fetchCanvasAssignments() {
  els.connectStatus.textContent = 'Loading Canvas assignments...';
  try {
    const res = await fetch('/api/canvas/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvasUrl: state.canvasUrl, canvasToken: state.canvasToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    els.connectStatus.textContent = '';
    showPickerList(
      (data.assignments || []).map((a) => ({
        course: a.course,
        name: a.name,
        dueAt: a.dueAt?.slice(0, 10),
        url: a.url,
        description: a.description || '',
      })),
      'canvas'
    );
  } catch (err) {
    els.connectStatus.textContent = 'Canvas import failed: ' + err.message;
  }
}

els.importCanvasBtn.addEventListener('click', importCanvas);
$('edit-canvas-setup-btn').addEventListener('click', () => {
  canvasUrlInput.value = state.canvasUrl || '';
  canvasTokenInput.value = state.canvasToken || '';
  openModal(canvasModal);
});
$('canvas-setup-cancel').addEventListener('click', () => closeModal(canvasModal));
$('canvas-setup-save').addEventListener('click', () => {
  const url = canvasUrlInput.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = canvasTokenInput.value.trim();
  if (!url || !token) return;
  state.canvasUrl = url;
  state.canvasToken = token;
  localStorage.setItem('tb_canvas_url', url);
  localStorage.setItem('tb_canvas_token', token);
  closeModal(canvasModal);
  fetchCanvasAssignments();
});

function showPickerList(items, source) {
  if (!items.length) {
    els.connectStatus.textContent = `No upcoming ${source} assignments found.`;
    return;
  }
  els.canvasList.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    const hasDetails = item.description && item.description.trim().length > 0;
    li.innerHTML = `<div>${escapeHtml(item.name)}</div><div class="assignment-meta">${escapeHtml(item.course)}${item.dueAt ? ' · due ' + item.dueAt : ''}${hasDetails ? ' · has description' : ''}</div>`;
    li.addEventListener('click', () => {
      els.taskInput.value = `${item.course}: ${item.name}`;
      if (item.dueAt) els.deadlineInput.value = item.dueAt;
      state.assignmentContext = hasDetails ? item.description.trim() : null;
      els.canvasPicker.classList.add('hidden');
      els.status.textContent = hasDetails
        ? 'Assignment description loaded. It will shape the steps below.'
        : '';
    });
    els.canvasList.appendChild(li);
  });
  els.canvasPicker.classList.remove('hidden');
  els.canvasPicker.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.canvasPickerClose.addEventListener('click', () => els.canvasPicker.classList.add('hidden'));

// ---------- Energy ----------
els.energyRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.energy-btn');
  if (!btn) return;
  document.querySelectorAll('.energy-btn').forEach((b) => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.energy = btn.dataset.energy;
});

// ---------- Voice input ----------
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

function wireMic(button, targetInput, { onResult } = {}) {
  if (!SpeechRecognitionCtor) {
    button.disabled = true;
    button.title = 'Voice input not supported in this browser (try Chrome/Edge)';
    return { supported: false, start: () => {} };
  }
  let recognizing = false;
  let recognition;
  function start() {
    if (recognizing) return;
    recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onstart = () => {
      recognizing = true;
      button.classList.add('recording');
    };
    recognition.onend = () => {
      recognizing = false;
      button.classList.remove('recording');
    };
    recognition.onerror = () => {
      recognizing = false;
      button.classList.remove('recording');
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join(' ');
      targetInput.value = (targetInput.value ? targetInput.value + ' ' : '') + transcript;
      if (onResult) onResult(transcript);
    };
    recognition.start();
  }
  button.addEventListener('click', () => {
    if (recognizing) recognition.stop();
    else start();
  });
  return { supported: true, start };
}
wireMic(els.micTaskBtn, els.taskInput);
const checkinMic = wireMic(els.micCheckinBtn, els.checkinInput, {
  onResult: () => sendCheckin(),
});

// ---------- Text to speech ----------
let availableVoices = [];
const voiceSelect = $('tts-voice-select');

function refreshVoiceList() {
  try {
    if (!window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') return;
    availableVoices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    if (!availableVoices.length) return;

    const savedName = localStorage.getItem('tb_tts_voice');
    const preferredPatterns = [/natural/i, /neural/i, /online/i, /premium/i, /aria/i, /jenny/i, /guy/i, /samantha/i, /google us english/i];
    let best = availableVoices.find((v) => v.name === savedName);
    if (!best) {
      for (const pattern of preferredPatterns) {
        best = availableVoices.find((v) => pattern.test(v.name));
        if (best) break;
      }
    }
    if (!best) best = availableVoices.find((v) => v.lang === 'en-US') || availableVoices[0];

    voiceSelect.innerHTML = availableVoices
      .map((v) => `<option value="${escapeHtml(v.name)}" ${v.name === best.name ? 'selected' : ''}>${escapeHtml(v.name)}</option>`)
      .join('');
  } catch (err) {
    console.error('Voice list unavailable:', err);
  }
}

if (window.speechSynthesis) {
  refreshVoiceList();
  try {
    window.speechSynthesis.onvoiceschanged = refreshVoiceList;
  } catch {
    // some browsers don't support this event, voice list just won't auto-refresh
  }
}

voiceSelect.addEventListener('change', () => {
  localStorage.setItem('tb_tts_voice', voiceSelect.value);
});

function speak(text, onEnd) {
  if (!window.speechSynthesis) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const chosenVoice = availableVoices.find((v) => v.name === voiceSelect.value);
  if (chosenVoice) utterance.voice = chosenVoice;
  utterance.rate = 0.98;
  utterance.pitch = 1.03;
  if (onEnd) utterance.onend = onEnd;
  window.speechSynthesis.speak(utterance);
}

// ---------- Photo upload ----------
// Downscale before sending: keeps requests well under hosting body-size limits
// (e.g. Vercel's ~4.5MB cap) and reduces image tokens against the vision model's rate limit.
function fileToResizedImage(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

els.photoInput.addEventListener('change', async () => {
  const file = els.photoInput.files[0];
  if (!file) return;
  const { base64, mimeType } = await fileToResizedImage(file);
  state.photoBase64 = base64;
  state.photoMime = mimeType;
  els.photoPreview.src = `data:${mimeType};base64,${base64}`;
  els.photoPreviewWrap.classList.remove('hidden');
});

els.clearPhotoBtn.addEventListener('click', () => {
  state.photoBase64 = null;
  state.photoMime = null;
  els.photoInput.value = '';
  els.photoPreviewWrap.classList.add('hidden');
});

els.screenshotInput.addEventListener('change', async () => {
  const file = els.screenshotInput.files[0];
  if (!file) return;
  els.status.textContent = 'Reading screenshot…';
  try {
    const { base64, mimeType } = await fileToResizedImage(file, 1600, 0.85);
    const res = await fetch('/api/extract-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.task) els.taskInput.value = data.task;
    if (data.deadline) els.deadlineInput.value = data.deadline;
    els.status.textContent = `Got it (confidence: ${data.confidence || 'n/a'}).`;
  } catch (err) {
    els.status.textContent = 'Could not read screenshot: ' + err.message;
  } finally {
    els.screenshotInput.value = '';
  }
});

// ---------- Breakdown ----------
els.breakdownBtn.addEventListener('click', async () => {
  const task = els.taskInput.value.trim();
  const deadline = els.deadlineInput.value;
  if (!task && !state.photoBase64) {
    els.status.textContent = 'Type a task, speak one, or upload a photo first.';
    return;
  }
  const minutes = Number(els.minutesInput.value) || undefined;
  els.breakdownBtn.disabled = true;
  els.status.textContent = 'Breaking it down…';
  try {
    let data;
    if (deadline) {
      state.mode = 'backward';
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/backward-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task || 'the task', deadline, today, energy: state.energy, context: state.assignmentContext || undefined }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
      state.days = data.days.map((d) => ({ ...d, steps: d.steps.map((s) => ({ ...s, done: false })) }));
    } else if (state.photoBase64) {
      state.mode = 'flat';
      const res = await fetch('/api/breakdown-from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: task || undefined,
          imageBase64: state.photoBase64,
          mimeType: state.photoMime,
          minutesAvailable: minutes,
          energy: state.energy,
        }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
      state.steps = data.steps.map((s) => ({ ...s, done: false }));
      if (data.sceneNotes) els.status.textContent = data.sceneNotes;
    } else {
      state.mode = 'flat';
      const res = await fetch('/api/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, minutesAvailable: minutes, energy: state.energy, context: state.assignmentContext || undefined }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
      state.steps = data.steps.map((s) => ({ ...s, done: false }));
    }
    state.task = task || 'the task';
    if (!data.sceneNotes) els.status.textContent = '';
    els.inputPanel.classList.add('hidden');
    els.stepsPanel.classList.remove('hidden');
    els.checkinPanel.classList.remove('hidden');
    if (state.googleAccessToken) els.syncCalendarBtn.classList.remove('hidden');
    bumpStreak();
    render();
  } catch (err) {
    els.status.textContent = 'Something went wrong: ' + err.message;
  } finally {
    els.breakdownBtn.disabled = false;
  }
});

// ---------- Rendering ----------
function allStepsFlat() {
  return state.mode === 'backward' ? state.days.flatMap((d) => d.steps) : state.steps;
}

function currentStep() {
  return allStepsFlat().find((s) => !s.done) || null;
}

function updateProgress() {
  const all = allStepsFlat();
  const done = all.filter((s) => s.done).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  els.progressBarFill.style.width = pct + '%';
  els.progressLabel.textContent = `${done} / ${all.length} done`;
  if (all.length && done === all.length) {
    fireConfetti(true);
  }
}

function fireConfetti(big) {
  if (typeof confetti !== 'function') return;
  confetti({
    particleCount: big ? 220 : 60,
    spread: big ? 100 : 55,
    origin: { y: 0.6 },
    colors: ['#a8502c', '#4c7a52', '#a2751f', '#96412c'],
  });
}

function stepItemHtml(step, globalIndex, isCurrent) {
  const locked = state.requirePhoto && !step.done;
  return `
    <div class="step-item ${step.done ? 'done' : ''} ${isCurrent ? 'current' : ''}" data-index="${globalIndex}">
      <input type="checkbox" data-index="${globalIndex}" ${step.done ? 'checked' : ''} ${locked ? 'disabled' : ''} />
      <div class="step-body">
        <div class="step-title">${escapeHtml(step.title)}</div>
        <div class="step-meta">~${step.minutes} min${step.why ? ' · ' + escapeHtml(step.why) : ''}</div>
        <button class="verify-photo-btn" data-verify-index="${globalIndex}">Verify with photo</button>
        ${locked ? '<div class="verify-required-note">A photo is required to check this off</div>' : ''}
        <div class="verify-result hidden" data-verify-result="${globalIndex}"></div>
        <input type="file" accept="image/*" class="visually-hidden" data-verify-file="${globalIndex}" />
      </div>
    </div>`;
}

function render() {
  els.taskTitle.textContent = state.task;
  els.stepsContainer.innerHTML = '';
  const active = currentStep();
  const all = allStepsFlat();

  if (state.mode === 'backward') {
    let idx = 0;
    state.days.forEach((day) => {
      const group = document.createElement('div');
      group.className = 'day-group';
      const stepsHtml = day.steps
        .map((s) => {
          const html = stepItemHtml(s, idx, s === active);
          idx++;
          return html;
        })
        .join('');
      group.innerHTML = `<div class="day-group-label">${escapeHtml(day.label)} (${day.date})</div><div class="day-steps">${stepsHtml}</div>`;
      els.stepsContainer.appendChild(group);
    });
  } else {
    els.stepsContainer.innerHTML = state.steps.map((s, i) => stepItemHtml(s, i, s === active)).join('');
  }

  updateProgress();
}

function setStepDone(globalIndex, done) {
  const all = allStepsFlat();
  const step = all[globalIndex];
  if (!step) return;
  step.done = done;
  if (done) fireConfetti(false);
  render();
}

els.stepsContainer.addEventListener('change', (e) => {
  if (e.target.matches('input[type=checkbox]')) {
    setStepDone(Number(e.target.dataset.index), e.target.checked);
  }
});

els.stepsContainer.addEventListener('click', (e) => {
  const verifyBtn = e.target.closest('[data-verify-index]');
  if (verifyBtn) {
    const idx = verifyBtn.dataset.verifyIndex;
    els.stepsContainer.querySelector(`[data-verify-file="${idx}"]`).click();
  }
});

els.stepsContainer.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-verify-file]')) return;
  const idx = Number(e.target.dataset.verifyFile);
  const file = e.target.files[0];
  if (!file) return;
  const step = allStepsFlat()[idx];
  const resultEl = els.stepsContainer.querySelector(`[data-verify-result="${idx}"]`);
  resultEl.classList.remove('hidden');
  resultEl.textContent = 'Checking photo…';
  try {
    const { base64, mimeType } = await fileToResizedImage(file);
    const res = await fetch('/api/verify-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepTitle: step.title, imageBase64: base64, mimeType }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    resultEl.textContent = data.message;
    resultEl.className = 'verify-result ' + (data.confirmed ? 'confirmed' : 'unsure');
    if (data.confirmed && !step.done) {
      setStepDone(idx, true);
      document.querySelector(`.step-item[data-index="${idx}"] input[type=checkbox]`)?.setAttribute('checked', 'checked');
    }
  } catch (err) {
    resultEl.textContent = 'Could not verify: ' + err.message;
    resultEl.className = 'verify-result unsure';
  } finally {
    e.target.value = '';
  }
});

// ---------- Panic button ----------
els.panicBtn.addEventListener('click', async () => {
  const remaining = allStepsFlat().filter((s) => !s.done);
  if (!remaining.length) return;
  els.panicView.classList.remove('hidden');
  els.panicView.textContent = 'Thinking of the smallest possible next step…';
  try {
    const res = await fetch('/api/panic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: state.task, remainingSteps: remaining.map((s) => s.title) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    els.panicView.innerHTML = `Just do this: <br>"${escapeHtml(data.title)}" <span style="font-weight:400">(~${data.minutes} min)</span><br><button id="panic-done-btn" style="margin-top:0.8rem">Got it, close this</button>`;
    document.getElementById('panic-done-btn').addEventListener('click', () => els.panicView.classList.add('hidden'));
  } catch (err) {
    els.panicView.textContent = 'Could not simplify further: ' + err.message;
  }
});

// ---------- Google Calendar sync ----------
els.syncCalendarBtn.addEventListener('click', async () => {
  if (!state.googleAccessToken) return;
  els.syncCalendarBtn.disabled = true;
  els.syncCalendarBtn.textContent = 'Adding to calendar…';
  try {
    if (state.mode === 'backward') {
      for (const day of state.days) {
        let hour = 16;
        for (const step of day.steps) {
          await createCalendarEvent(step.title, day.date, hour, step.minutes);
          hour += 1;
        }
      }
    } else {
      const now = new Date();
      let cursor = new Date(now.getTime() + 5 * 60000);
      for (const step of state.steps) {
        await createCalendarEvent(step.title, cursor.toISOString().slice(0, 10), cursor.getHours(), step.minutes, cursor);
        cursor = new Date(cursor.getTime() + (step.minutes + 5) * 60000);
      }
    }
    els.syncCalendarBtn.textContent = 'Added to Google Calendar';
  } catch (err) {
    els.syncCalendarBtn.textContent = 'Failed: ' + err.message;
  } finally {
    setTimeout(() => {
      els.syncCalendarBtn.disabled = false;
      els.syncCalendarBtn.textContent = 'Add steps to Google Calendar';
    }, 3000);
  }
});

async function createCalendarEvent(title, dateStr, hour, minutes, exactStart) {
  const start = exactStart ? new Date(exactStart) : new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
  const end = new Date(start.getTime() + minutes * 60000);
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.googleAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: `TaskBreaker: ${title}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    }),
  });
  if (!res.ok) throw new Error((await res.json()).error?.message || 'calendar insert failed');
}

// ---------- Restart ----------
els.restartBtn.addEventListener('click', () => {
  stopTimer();
  state.task = '';
  state.steps = [];
  state.days = [];
  state.mode = 'flat';
  state.photoBase64 = null;
  state.photoMime = null;
  state.assignmentContext = null;
  els.taskInput.value = '';
  els.minutesInput.value = '';
  els.deadlineInput.value = '';
  els.checkinInput.value = '';
  els.checkinResponse.classList.add('hidden');
  els.photoPreviewWrap.classList.add('hidden');
  els.photoInput.value = '';
  els.panicView.classList.add('hidden');
  els.stepsPanel.classList.add('hidden');
  els.checkinPanel.classList.add('hidden');
  els.inputPanel.classList.remove('hidden');
});

// ---------- Check-in ----------
async function sendCheckin() {
  const reply = els.checkinInput.value.trim();
  const step = currentStep();
  if (!reply) return;
  if (!step) {
    els.checkinResponse.classList.remove('hidden');
    els.checkinResponse.textContent = 'All steps are already done!';
    els.checkinResponse.className = 'checkin-response done';
    return;
  }
  els.checkinSend.disabled = true;
  els.checkinResponse.classList.remove('hidden');
  els.checkinResponse.className = 'checkin-response';
  els.checkinResponse.textContent = 'Thinking…';
  try {
    const res = await fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: state.task, currentStep: step.title, userReply: reply }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    els.checkinResponse.textContent = data.message;
    els.checkinResponse.className = 'checkin-response ' + (data.signal || 'on_track');
    if (data.signal === 'done') {
      if (state.requirePhoto) {
        els.checkinResponse.textContent += ' Take a verification photo on that step to check it off.';
      } else {
        const all = allStepsFlat();
        const globalIndex = all.indexOf(step);
        setStepDone(globalIndex, true);
      }
    }
    if (state.voiceCheckins) speak(els.checkinResponse.textContent);
  } catch (err) {
    els.checkinResponse.textContent = 'Something went wrong: ' + err.message;
  } finally {
    els.checkinSend.disabled = false;
    els.checkinInput.value = '';
  }
}

els.checkinSend.addEventListener('click', sendCheckin);
els.checkinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCheckin();
});

// ---------- Timer ----------
function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  els.timerToggle.textContent = 'Start timer';
  els.timerDisplay.textContent = '';
}

function startTimer() {
  const minutes = Number(els.intervalSelect.value);
  state.secondsLeft = minutes * 60;
  updateTimerDisplay();
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  state.timerId = setInterval(() => {
    state.secondsLeft -= 1;
    updateTimerDisplay();
    if (state.secondsLeft <= 0) {
      state.secondsLeft = minutes * 60;
      promptCheckin();
    }
  }, 1000);
  els.timerToggle.textContent = 'Stop timer';
}

function updateTimerDisplay() {
  const m = Math.floor(state.secondsLeft / 60);
  const s = state.secondsLeft % 60;
  els.timerDisplay.textContent = `${m}:${String(s).padStart(2, '0')} until next check-in`;
}

function promptCheckin() {
  const question = 'Check-in time. What are you working on right now?';
  els.checkinInput.focus();
  els.checkinPrompt.textContent = question;
  els.checkinPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (window.Notification && Notification.permission === 'granted') {
    new Notification('TaskBreaker check-in', { body: 'What are you working on right now?' });
  }
  if (state.voiceCheckins) {
    speak(question, () => checkinMic.start());
  }
}

els.timerToggle.addEventListener('click', () => {
  if (state.timerId) stopTimer();
  else startTimer();
});
