const $ = id => document.getElementById(id);

let audioContext, buffer, source, analyser;
let driveNode, dryGain, wetGain, masterGain;
let bassFilter, midFilter, trebleFilter;
let toneOscillator;
let playing = false;
let animationId = null;

function makeCurve(amount) {
  const curve = new Float32Array(44100);
  const norm = Math.tanh(amount);

  for (let i = 0; i < curve.length; i++) {
    const x = i * 2 / curve.length - 1;
    curve[i] = Math.tanh(amount * x) / norm;
  }
  return curve;
}

async function initAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended")
      await audioContext.resume();
    return;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioCtx();

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;

  driveNode = audioContext.createWaveShaper();
  driveNode.oversample = "4x";

  dryGain = audioContext.createGain();
  wetGain = audioContext.createGain();
  masterGain = audioContext.createGain();

  bassFilter = audioContext.createBiquadFilter();
  bassFilter.type = "lowshelf";
  bassFilter.frequency.value = 250;

  midFilter = audioContext.createBiquadFilter();
  midFilter.type = "peaking";
  midFilter.frequency.value = 1000;

  trebleFilter = audioContext.createBiquadFilter();
  trebleFilter.type = "highshelf";
  trebleFilter.frequency.value = 4000;

  dryGain.connect(masterGain);
  driveNode.connect(wetGain);
  wetGain.connect(masterGain);
  masterGain.connect(bassFilter);
  bassFilter.connect(midFilter);
  midFilter.connect(trebleFilter);
  trebleFilter.connect(analyser);
  analyser.connect(audioContext.destination);

  updateSettings();
}

function updateSettings() {
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const mix = Number($("mix").value) / 100;

  driveNode.curve = makeCurve(Number($("drive").value));
  dryGain.gain.setTargetAtTime(1 - mix, now, .015);
  wetGain.gain.setTargetAtTime(mix, now, .015);

  masterGain.gain.setTargetAtTime(
    Number($("volume").value) / 100, now, .015
  );

  bassFilter.gain.setTargetAtTime(
    Number($("bass").value), now, .015
  );
  midFilter.gain.setTargetAtTime(
    Number($("mid").value), now, .015
  );
  trebleFilter.gain.setTargetAtTime(
    Number($("treble").value), now, .015
  );
}

function updateLabels() {
  $("driveValue").textContent = Number($("drive").value).toFixed(1);
  $("mixValue").textContent = $("mix").value + "%";
  $("volumeValue").textContent = $("volume").value + "%";
  $("bassValue").textContent = $("bass").value + " dB";
  $("midValue").textContent = $("mid").value + " dB";
  $("trebleValue").textContent = $("treble").value + " dB";
}

["drive", "mix", "volume", "bass", "mid", "treble"]
.forEach(id => {
  $(id).addEventListener("input", () => {
    updateLabels();
    updateSettings();
  });
});

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { ctx, width: rect.width, height: rect.height };
}

function drawBuffer() {
  const { ctx, width, height } = setupCanvas($("waveCanvas"));
  const data = buffer.getChannelData(0);
  const middle = height / 2;
  const step = Math.max(1, Math.floor(data.length / width));

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#55e6bd";
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const start = x * step;
    let min = 1, max = -1;

    for (let j = start; j < Math.min(start + step, data.length); j++) {
      min = Math.min(min, data[j]);
      max = Math.max(max, data[j]);
    }

    ctx.moveTo(x, middle - max * middle * .9);
    ctx.lineTo(x, middle - min * middle * .9);
  }

  ctx.stroke();
}

function drawLiveWave() {
  const { ctx, width, height } = setupCanvas($("liveCanvas"));
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#55e6bd";
  ctx.lineWidth = 2;
  ctx.beginPath();

  const slice = width / data.length;

  for (let i = 0; i < data.length; i++) {
    const x = i * slice;
    const y = data[i] / 255 * height;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
}

function drawSpectrum() {
  const { ctx, width, height } = setupCanvas($("spectrumCanvas"));
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);

  ctx.clearRect(0, 0, width, height);

  const bars = 80;
  const step = Math.floor(data.length / bars);
  const barWidth = width / bars;

  for (let i = 0; i < bars; i++) {
    const value = data[i * step] / 255;
    const barHeight = value * height;

    ctx.fillStyle = `hsl(${155 + value * 65},85%,55%)`;
    ctx.fillRect(
      i * barWidth + 1,
      height - barHeight,
      Math.max(1, barWidth - 2),
      barHeight
    );
  }
}

function animate() {
  if (!playing) return;

  drawLiveWave();
  drawSpectrum();
  animationId = requestAnimationFrame(animate);
}

function stopPlayback() {
  if (source) {
    try { source.stop(); } catch (_) {}
    source.disconnect();
    source = null;
  }

  playing = false;
  cancelAnimationFrame(animationId);
  animationId = null;
  $("playBtn").textContent = "▶ Reproducir";
}

async function playAudio() {
  if (!buffer) {
    $("status").textContent = "Carga un audio primero.";
    return;
  }

  await initAudio();
  stopPlayback();

  source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(dryGain);
  source.connect(driveNode);

  const current = source;
  playing = true;

  source.onended = () => {
    if (source === current) {
      source = null;
      playing = false;
      cancelAnimationFrame(animationId);
      $("playBtn").textContent = "▶ Reproducir";
    }
  };

  source.start();
  $("playBtn").textContent = "⏸ Reproduciendo";
  $("status").textContent = "Reproduciendo audio procesado.";
  animate();
}

$("fileInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  stopPlayback();
  $("status").textContent = "Cargando audio...";
  $("fileName").textContent = file.name;

  try {
    await initAudio();
    buffer = await audioContext.decodeAudioData(
      await file.arrayBuffer()
    );

    drawBuffer();
    $("status").textContent =
      "Audio cargado: " + buffer.duration.toFixed(2) + " segundos.";
  } catch (error) {
    buffer = null;
    $("status").textContent = "Error: " + error.message;
  }
});

$("playBtn").addEventListener("click", () => {
  playAudio().catch(error => {
    $("status").textContent = "Error: " + error.message;
  });
});

$("stopBtn").addEventListener("click", stopPlayback);

$("toneBtn").addEventListener("click", async () => {
  await initAudio();

  if (toneOscillator) {
    try { toneOscillator.stop(); } catch (_) {}
  }

  toneOscillator = audioContext.createOscillator();
  toneOscillator.type = $("toneType").value;

  const frequency = Math.max(
    20,
    Math.min(20000, Number($("toneFrequency").value) || 440)
  );

  toneOscillator.frequency.value = frequency;
  toneOscillator.connect(dryGain);
  toneOscillator.connect(driveNode);
  toneOscillator.start();

  $("status").textContent = "Tono: " + frequency + " Hz.";
});

$("toneStopBtn").addEventListener("click", () => {
  if (toneOscillator) {
    try { toneOscillator.stop(); } catch (_) {}
    toneOscillator.disconnect();
    toneOscillator = null;
  }
});

async function renderProcessedAudio() {
  if (!buffer) throw new Error("Carga un audio primero.");

  const Offline = window.OfflineAudioContext ||
                  window.webkitOfflineAudioContext;

  const ctx = new Offline(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeCurve(Number($("drive").value));
  shaper.oversample = "4x";

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const master = ctx.createGain();

  const bass = ctx.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 250;
  bass.gain.value = Number($("bass").value);

  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.gain.value = Number($("mid").value);

  const treble = ctx.createBiquadFilter();
  treble.type = "highshelf";
  treble.frequency.value = 4000;
  treble.gain.value = Number($("treble").value);

  const mix = Number($("mix").value) / 100;
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;
  master.gain.value = Number($("volume").value) / 100;

  src.connect(dry);
  src.connect(shaper);
  shaper.connect(wet);
  dry.connect(master);
  wet.connect(master);
  master.connect(bass);
  bass.connect(mid);
  mid.connect(treble);
  treble.connect(ctx.destination);

  src.start();
  return await ctx.startRendering();
}

function toInt16(data) {
  const result = new Int16Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    result[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return result;
}

$("exportBtn").addEventListener("click", async () => {
  const btn = $("exportBtn");

  if (!buffer) {
    $("exportStatus").textContent = "Carga un audio primero.";
    return;
  }

  if (typeof lamejs === "undefined") {
    $("exportStatus").textContent = "No se pudo cargar LAME.js.";
    return;
  }

  btn.disabled = true;
  $("exportStatus").textContent = "Procesando...";

  try {
    const rendered = await renderProcessedAudio();
    const channels = Math.min(2, rendered.numberOfChannels);

    const encoder = new lamejs.Mp3Encoder(
      channels,
      rendered.sampleRate,
      192
    );

    const left = toInt16(rendered.getChannelData(0));
    const right = channels === 2
      ? toInt16(rendered.getChannelData(1))
      : null;

    const chunks = [];
    const size = 1152;

    for (let i = 0; i < left.length; i += size) {
      const l = left.subarray(i, i + size);
      const r = right ? right.subarray(i, i + size) : undefined;

      const encoded = channels === 2
        ? encoder.encodeBuffer(l, r)
        : encoder.encodeBuffer(l);

      if (encoded.length) chunks.push(new Uint8Array(encoded));
    }

    const finalChunk = encoder.flush();
    if (finalChunk.length) chunks.push(new Uint8Array(finalChunk));

    const blob = new Blob(chunks, { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "WaveLab-processed.mp3";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $("exportStatus").textContent = "¡MP3 exportado!";
  } catch (error) {
    $("exportStatus").textContent = "Error: " + error.message;
  } finally {
    btn.disabled = false;
  }
});

updateLabels();

window.addEventListener("resize", () => {
  if (buffer) drawBuffer();
});
