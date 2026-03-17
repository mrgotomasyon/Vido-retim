const form = document.getElementById("generatorForm");
const platformSelect = document.getElementById("platform");
const imageInput = document.getElementById("image");
const imagePreview = document.getElementById("imagePreview");
const generateButton = document.getElementById("generateButton");
const statusPhase = document.getElementById("statusPhase");
const statusPercent = document.getElementById("statusPercent");
const statusMessage = document.getElementById("statusMessage");
const progressBar = document.getElementById("progressBar");
const statusLog = document.getElementById("statusLog");
const hookOutput = document.getElementById("hookOutput");
const valueOutput = document.getElementById("valueOutput");
const ctaOutput = document.getElementById("ctaOutput");
const voiceoverOutput = document.getElementById("voiceoverOutput");
const analysisOutput = document.getElementById("analysisOutput");
const scenePlanOutput = document.getElementById("scenePlanOutput");
const commandOutput = document.getElementById("commandOutput");
const videoPreview = document.getElementById("videoPreview");
const videoPlaceholder = document.getElementById("videoPlaceholder");
const downloadLink = document.getElementById("downloadLink");
const voiceLink = document.getElementById("voiceLink");
const recentRenders = document.getElementById("recentRenders");
const brandPills = document.getElementById("brandPills");
const platformCards = [...document.querySelectorAll("[data-platform-card]")];
const kpiPlatformCount = document.getElementById("kpiPlatformCount");
const kpiRecentCount = document.getElementById("kpiRecentCount");

let activePoller = null;

const fallbackPlatforms = [
  { key: "instagram", label: "Instagram Reels", width: 1080, height: 1920, duration: 10 },
  { key: "facebook", label: "Facebook Reels", width: 1080, height: 1920, duration: 10 },
  { key: "linkedin", label: "LinkedIn Video", width: 1080, height: 1920, duration: 10 },
  { key: "x", label: "X Video", width: 1600, height: 900, duration: 10 }
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Istek basarisiz oldu.");
  }

  return payload;
}

function setStatus({ phase, progress, message }) {
  statusPhase.textContent = phase;
  statusPercent.textContent = `${progress}%`;
  progressBar.style.width = `${progress}%`;
  statusMessage.textContent = message;
}

function syncPlatformCards() {
  platformCards.forEach((card) => {
    card.classList.toggle("active", card.dataset.platform === platformSelect.value);
  });
}

function setPlatformOptions(platforms) {
  const currentValue = platformSelect.value || "instagram";
  platformSelect.innerHTML = "";

  platforms.forEach((platform) => {
    const option = document.createElement("option");
    option.value = platform.key;
    option.textContent = `${platform.label} • ${platform.width}x${platform.height} • ${platform.duration}s`;
    platformSelect.append(option);
  });

  const hasCurrentValue = platforms.some((platform) => platform.key === currentValue);
  platformSelect.value = hasCurrentValue ? currentValue : platforms[0]?.key || "instagram";
  syncPlatformCards();
}

function appendLogs(logs) {
  statusLog.innerHTML = "";

  if (!logs || !logs.length) {
    statusLog.innerHTML =
      '<div class="log-item"><strong>Hazir</strong><span>Yeni job bekleniyor.</span></div>';
    return;
  }

  logs
    .slice()
    .reverse()
    .forEach((log) => {
      const item = document.createElement("article");
      item.className = "log-item";

      const title = document.createElement("strong");
      title.textContent = log.phase;

      const text = document.createElement("span");
      text.textContent = `${log.message} • ${new Date(log.timestamp).toLocaleTimeString("tr-TR")}`;

      item.append(title, text);
      statusLog.append(item);
    });
}

function renderImagePreview(file) {
  if (!file) {
    imagePreview.innerHTML = "<p>Yuklenen gorsel burada onizlenecek.</p>";
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  imagePreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = objectUrl;
  img.alt = file.name;
  imagePreview.append(img);
}

function updateDownloadState(result) {
  if (!result) {
    downloadLink.href = "#";
    voiceLink.href = "#";
    downloadLink.classList.add("disabled-link");
    voiceLink.classList.add("disabled-link");
    return;
  }

  downloadLink.href = result.outputs.downloadUrl;
  downloadLink.download = "";
  voiceLink.href = result.outputs.voiceUrl;
  voiceLink.download = "";
  downloadLink.classList.remove("disabled-link");
  voiceLink.classList.remove("disabled-link");
}

function renderAnalysis(analysis) {
  analysisOutput.innerHTML = "";
  const entries = [
    ["Icerik ozeti", analysis.contentLead || "-"],
    ["Anahtar kelimeler", (analysis.keywords || []).join(", ") || "-"],
    ["Tespit edilen metrikler", (analysis.detectedMetrics || []).join(", ") || "-"],
    ["Guclendirme acisi", analysis.strengthenedAngle || "-"]
  ];

  entries.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "analysis-item";

    const title = document.createElement("strong");
    title.textContent = label;

    const body = document.createElement("span");
    body.textContent = value;

    card.append(title, body);
    analysisOutput.append(card);
  });
}

function renderScenePlan(scenePlan) {
  scenePlanOutput.innerHTML = "";

  scenePlan.forEach((scene) => {
    const item = document.createElement("article");
    item.className = "scene-item";

    const title = document.createElement("strong");
    title.textContent = `${scene.purpose} • ${scene.start}s - ${scene.end}s`;

    const overlay = document.createElement("div");
    overlay.textContent = `Overlay: ${scene.overlay}`;

    const narration = document.createElement("div");
    narration.textContent = `Seslendirme: ${scene.narration}`;

    item.append(title, overlay, narration);
    scenePlanOutput.append(item);
  });
}

function renderResult(result) {
  const campaign = result.campaign;
  hookOutput.textContent = campaign.hook;
  valueOutput.textContent = campaign.valueProposition;
  ctaOutput.textContent = campaign.cta;
  voiceoverOutput.textContent = campaign.voiceoverText;
  commandOutput.textContent = result.renderEngine.command;

  renderAnalysis(campaign.analysis);
  renderScenePlan(campaign.scenePlan);

  videoPreview.src = result.outputs.videoUrl;
  videoPreview.load();
  videoPlaceholder.style.display = "none";

  updateDownloadState(result);
}

function resetResultView() {
  hookOutput.textContent = "Henuz uretilmedi.";
  valueOutput.textContent = "Henuz uretilmedi.";
  ctaOutput.textContent = "Henuz uretilmedi.";
  voiceoverOutput.textContent = "Henuz uretilmedi.";
  analysisOutput.innerHTML = "";
  scenePlanOutput.innerHTML = "";
  commandOutput.textContent = "Henuz uretilmedi.";
  videoPreview.removeAttribute("src");
  videoPreview.load();
  videoPlaceholder.style.display = "grid";
  updateDownloadState(null);
}

async function loadPlatforms() {
  setPlatformOptions(fallbackPlatforms);
  kpiPlatformCount.textContent = String(fallbackPlatforms.length);

  try {
    const payload = await fetchJson("/api/platforms");
    setPlatformOptions(payload.platforms);

    brandPills.innerHTML = "";
    payload.brand.channels.forEach((channel) => {
      const pill = document.createElement("span");
      pill.textContent = channel;
      brandPills.append(pill);
    });

    kpiPlatformCount.textContent = String(payload.platforms.length);
    return payload;
  } catch (error) {
    setStatus({
      phase: "Baglanti Uyarisi",
      progress: 0,
      message:
        "Platform listesi fallback modunda yuklendi. Sayfayi file:// yerine http://localhost:3000 uzerinden acin."
    });
    return null;
  }
}

function renderRecent(renders) {
  recentRenders.innerHTML = "";

  if (!renders.length) {
    recentRenders.innerHTML =
      "<article class=\"recent-item\"><small>ARSIV</small><h3>Henuz render yok</h3><p>Ilk videoyu urettiginizde burada listelenir.</p></article>";
    return;
  }

  renders.forEach((item) => {
    const card = document.createElement("article");
    card.className = "recent-item";

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.platform;

    const title = document.createElement("h3");
    title.textContent = item.outputs.videoUrl.split("/").pop();

    const meta = document.createElement("p");
    meta.textContent = `${item.resolution} • ${item.duration}s • ${new Date(item.createdAt).toLocaleString("tr-TR")}`;

    const links = document.createElement("div");
    links.className = "recent-links";

    const preview = document.createElement("a");
    preview.href = item.outputs.videoUrl;
    preview.textContent = "Preview";
    preview.target = "_blank";
    preview.rel = "noreferrer";

    const manifest = document.createElement("a");
    manifest.href = item.outputs.manifestUrl;
    manifest.textContent = "Manifest";
    manifest.target = "_blank";
    manifest.rel = "noreferrer";

    links.append(preview, manifest);
    card.append(badge, title, meta, links);
    recentRenders.append(card);
  });
}

async function loadRecentRenders() {
  try {
    const payload = await fetchJson("/api/renders");
    renderRecent(payload.renders || []);
    kpiRecentCount.textContent = String((payload.renders || []).length);
    return payload;
  } catch {
    renderRecent([]);
    kpiRecentCount.textContent = "0";
    return null;
  }
}

function stopPolling() {
  if (activePoller) {
    clearInterval(activePoller);
    activePoller = null;
  }
}

async function pollJob(jobId) {
  stopPolling();

  const tick = async () => {
    try {
      const job = await fetchJson(`/api/jobs/${jobId}`);
      setStatus({
        phase: job.phase,
        progress: job.progress,
        message: job.error || job.logs[job.logs.length - 1]?.message || "Uretim suruyor."
      });
      appendLogs(job.logs);

      if (job.status === "completed") {
        stopPolling();
        generateButton.disabled = false;
        generateButton.textContent = "Video uret";
        renderResult(job.result);
        await loadRecentRenders();
      }

      if (job.status === "failed") {
        stopPolling();
        generateButton.disabled = false;
        generateButton.textContent = "Video uret";
      }
    } catch (error) {
      stopPolling();
      generateButton.disabled = false;
      generateButton.textContent = "Video uret";
      setStatus({
        phase: "Hata",
        progress: 100,
        message: error.message
      });
    }
  };

  await tick();
  activePoller = setInterval(tick, 1400);
}

imageInput.addEventListener("change", () => {
  const [file] = imageInput.files;
  renderImagePreview(file);
});

platformCards.forEach((card) => {
  card.addEventListener("click", () => {
    platformSelect.value = card.dataset.platform;
    syncPlatformCards();
  });
});

platformSelect.addEventListener("change", syncPlatformCards);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetResultView();
  stopPolling();

  const formData = new FormData(form);

  generateButton.disabled = true;
  generateButton.textContent = "Uretim baslatildi";
  setStatus({
    phase: "Istek alindi",
    progress: 8,
    message: "Dosya yukleniyor ve job olusturuluyor."
  });
  appendLogs([
    {
      phase: "accepted",
      message: "Istek gonderildi.",
      timestamp: new Date().toISOString()
    }
  ]);

  try {
    const payload = await fetchJson("/api/generate", {
      method: "POST",
      body: formData
    });

    await pollJob(payload.jobId);
  } catch (error) {
    generateButton.disabled = false;
    generateButton.textContent = "Video uret";
    setStatus({
      phase: "Hata",
      progress: 100,
      message: error.message
    });
  }
});

Promise.allSettled([loadPlatforms(), loadRecentRenders()]).then((results) => {
  const platformsReady = results[0].status === "fulfilled" && results[0].value;

  if (platformsReady) {
    setStatus({
      phase: "Hazir",
      progress: 0,
      message: "Gorsel ve icerik bekleniyor."
    });
  }

  appendLogs([]);
});
