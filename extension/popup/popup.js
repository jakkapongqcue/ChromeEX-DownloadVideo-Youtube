"use strict";

const hostBadge = document.getElementById("hostBadge");
const setupBanner = document.getElementById("setupBanner");
const setupMessage = document.getElementById("setupMessage");
const notYoutubeState = document.getElementById("notYoutubeState");
const videoLoadedState = document.getElementById("videoLoadedState");
const videoThumb = document.getElementById("videoThumb");
const videoTitle = document.getElementById("videoTitle");
const videoSub = document.getElementById("videoSub");
const modeSelect = document.getElementById("modeSelect");
const qualityRow = document.getElementById("qualityRow");
const qualitySelect = document.getElementById("qualitySelect");
const downloadBtn = document.getElementById("downloadBtn");
const jobsList = document.getElementById("jobsList");
const openFolderBtn = document.getElementById("openFolderBtn");
const clearJobsBtn = document.getElementById("clearJobsBtn");
const versionText = document.getElementById("versionText");
const updateYtdlpBtn = document.getElementById("updateYtdlpBtn");

let currentVideoUrl = null;
let currentVideoTitle = "YouTube Video";
let hostReady = false;

function isYouTubeVideoUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(u.hostname)) {
      return false;
    }
    return (u.pathname === "/watch" && u.searchParams.has("v")) || u.pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

function getVideoIdFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.pathname.startsWith("/shorts/")) {
      return u.pathname.replace("/shorts/", "").split("/")[0];
    }
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

async function checkHostStatus() {
  const res = await chrome.runtime.sendMessage({ type: "PING_HOST" });
  if (res && res.ok) {
    hostReady = true;
    hostBadge.textContent = "พร้อมใช้งาน";
    hostBadge.className = "badge badge-ok";
    setupBanner.classList.add("hidden");
    if (res.version) {
      versionText.textContent = `yt-dlp ${res.version} (ถอดรหัสในเครื่อง)`;
    }
    if (currentVideoUrl) {
      downloadBtn.disabled = false;
    }
  } else {
    hostReady = false;
    hostBadge.textContent = "ยังไม่พร้อม";
    hostBadge.className = "badge badge-err";
    setupBanner.classList.remove("hidden");
    setupMessage.textContent =
      (res && res.error) ||
      "ยังไม่ได้ติดตั้ง Native Host หรือ yt-dlp/ffmpeg กรุณารัน installer\\install.ps1";
    downloadBtn.disabled = true;
  }
}

async function initCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];

  if (!tab || !tab.url || !isYouTubeVideoUrl(tab.url)) {
    notYoutubeState.classList.remove("hidden");
    videoLoadedState.classList.add("hidden");
    return;
  }

  notYoutubeState.classList.add("hidden");
  videoLoadedState.classList.remove("hidden");

  currentVideoUrl = tab.url;
  currentVideoTitle = (tab.title || "YouTube Video").replace(/\s*-\s*YouTube$/i, "");
  videoTitle.textContent = currentVideoTitle;

  const vid = getVideoIdFromUrl(tab.url);
  if (vid) {
    videoThumb.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
  }
  videoSub.textContent = "กำลังตรวจสอบความละเอียดที่รองรับ...";

  // Fetch accurate metadata & available resolutions from yt-dlp
  const infoRes = await chrome.runtime.sendMessage({
    type: "FETCH_INFO",
    url: currentVideoUrl
  });

  if (infoRes && infoRes.ok && infoRes.info) {
    const info = infoRes.info;
    currentVideoTitle = info.title || currentVideoTitle;
    videoTitle.textContent = currentVideoTitle;
    if (info.thumbnail) {
      videoThumb.src = info.thumbnail;
    }
    const mins = info.duration ? `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, "0")}` : "";
    videoSub.textContent = [info.uploader, mins].filter(Boolean).join(" • ");

    if (Array.isArray(info.resolutions) && info.resolutions.length > 0) {
      const labels = {
        2160: "4K (2160p)",
        1440: "2K (1440p)",
        1080: "Full HD (1080p)",
        720: "HD (720p)",
        480: "SD (480p)",
        360: "360p"
      };
      qualitySelect.innerHTML = "";
      for (const h of info.resolutions) {
        const opt = document.createElement("option");
        opt.value = String(h);
        opt.textContent = labels[h] || `${h}p`;
        if (h === 1080) opt.selected = true;
        qualitySelect.appendChild(opt);
      }
    }
  } else {
    videoSub.textContent = "พร้อมดาวน์โหลด";
  }
}

function renderJobs(jobsObj) {
  const list = Object.values(jobsObj || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  jobsList.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-queue";
    empty.textContent = "ยังไม่มีรายการดาวน์โหลด";
    jobsList.appendChild(empty);
    return;
  }

  for (const job of list) {
    const item = document.createElement("div");
    item.className = "job-item";

    const top = document.createElement("div");
    top.className = "job-top";

    const titleEl = document.createElement("div");
    titleEl.className = "job-title";
    titleEl.textContent = job.title || job.url;

    const tagEl = document.createElement("span");
    tagEl.className = "job-tag";
    tagEl.textContent = job.mode === "mp3" ? "MP3" : `${job.quality || 1080}p MP4`;

    top.appendChild(titleEl);
    top.appendChild(tagEl);

    const barWrap = document.createElement("div");
    barWrap.className = "progress-bar-wrap";

    const barFill = document.createElement("div");
    barFill.className = "progress-bar-fill" + (job.status === "completed" ? " done" : "");
    barFill.style.width = `${Math.min(100, Math.max(0, job.percent || 0))}%`;
    barWrap.appendChild(barFill);

    const meta = document.createElement("div");
    meta.className = "job-meta";

    const statusText = document.createElement("span");
    if (job.status === "error") {
      statusText.style.color = "#fca5a5";
      statusText.textContent = job.error || "เกิดข้อผิดพลาด";
    } else {
      const parts = [job.stage || ""];
      if (job.status === "downloading" && job.speed) parts.push(job.speed);
      if (job.status === "downloading" && job.eta) parts.push(`เหลือ ${job.eta}`);
      statusText.textContent = parts.filter(Boolean).join(" • ");
    }

    meta.appendChild(statusText);

    if (job.status === "starting" || job.status === "downloading" || job.status === "processing") {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn-link";
      cancelBtn.style.color = "#f87171";
      cancelBtn.textContent = "ยกเลิก";
      cancelBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "CANCEL_DOWNLOAD", jobId: job.jobId });
      });
      meta.appendChild(cancelBtn);
    }

    item.appendChild(top);
    item.appendChild(barWrap);
    item.appendChild(meta);
    jobsList.appendChild(item);
  }
}

modeSelect.addEventListener("change", () => {
  if (modeSelect.value === "mp3") {
    qualityRow.classList.add("hidden");
  } else {
    qualityRow.classList.remove("hidden");
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!currentVideoUrl || !hostReady) return;
  downloadBtn.disabled = true;
  downloadBtn.textContent = "กำลังส่งคำสั่ง...";

  await chrome.runtime.sendMessage({
    type: "START_DOWNLOAD",
    url: currentVideoUrl,
    title: currentVideoTitle,
    mode: modeSelect.value,
    quality: qualitySelect.value
  });

  setTimeout(() => {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "⬇ ดาวน์โหลดลงเครื่อง";
  }, 700);
});

openFolderBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_FOLDER" });
});

clearJobsBtn.addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "CLEAR_FINISHED_JOBS" });
  if (res && res.jobs) renderJobs(res.jobs);
});

updateYtdlpBtn.addEventListener("click", async () => {
  updateYtdlpBtn.disabled = true;
  updateYtdlpBtn.textContent = "กำลังอัปเดต...";
  const res = await chrome.runtime.sendMessage({ type: "UPDATE_YTDLP" });
  updateYtdlpBtn.disabled = false;
  updateYtdlpBtn.textContent = "อัปเดต yt-dlp";
  if (res && res.ok) {
    checkHostStatus();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "JOBS_UPDATED") {
    renderJobs(msg.jobs);
  }
});

(async function bootstrap() {
  const jobsRes = await chrome.runtime.sendMessage({ type: "GET_JOBS" });
  if (jobsRes && jobsRes.jobs) renderJobs(jobsRes.jobs);
  await checkHostStatus();
  await initCurrentTab();
  if (hostReady && currentVideoUrl) {
    downloadBtn.disabled = false;
  }
})();
