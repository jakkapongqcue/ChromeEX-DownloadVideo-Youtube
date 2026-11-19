"use strict";

const HOST_NAME = "com.ytdl.host";

let nativePort = null;
const pendingCallbacks = new Map();
let reqCounter = 1;

// Active and recent download jobs mirrored in chrome.storage.session
let jobsState = {};

async function loadState() {
  try {
    const res = await chrome.storage.session.get(["jobsState"]);
    if (res && res.jobsState) {
      jobsState = res.jobsState;
    }
  } catch {}
}
loadState();

async function saveState() {
  try {
    await chrome.storage.session.set({ jobsState });
  } catch {}
  broadcastToViews({ type: "JOBS_UPDATED", jobs: jobsState });
}

function broadcastToViews(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function getNativePort() {
  if (nativePort) return nativePort;

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (err) {
    nativePort = null;
    throw err;
  }

  nativePort.onMessage.addListener((msg) => {
    handleNativeMessage(msg);
  });

  nativePort.onDisconnect.addListener(() => {
    const lastErr = chrome.runtime.lastError
      ? chrome.runtime.lastError.message
      : "การเชื่อมต่อกับ Native Host ถูกตัด";
    nativePort = null;

    for (const [id, cb] of pendingCallbacks.entries()) {
      cb({ ok: false, error: lastErr });
      pendingCallbacks.delete(id);
    }
  });

  return nativePort;
}

function sendToNative(payload) {
  return new Promise((resolve) => {
    const id = `req_${Date.now()}_${reqCounter++}`;
    let port;
    try {
      port = getNativePort();
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }

    pendingCallbacks.set(id, resolve);
    port.postMessage({ ...payload, id });

    // Timeout for one-shot requests like ping/info/update
    if (payload.action !== "download") {
      setTimeout(() => {
        if (pendingCallbacks.has(id)) {
          pendingCallbacks.delete(id);
          resolve({ ok: false, error: "หมดเวลารอการตอบกลับจาก Native Host" });
        }
      }, 45000);
    }
  });
}

function handleNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  // One-shot request/response callbacks
  if (msg.id && pendingCallbacks.has(msg.id)) {
    const cb = pendingCallbacks.get(msg.id);
    pendingCallbacks.delete(msg.id);
    cb(msg);
  }

  // Streaming download job updates
  if (msg.jobId) {
    const job = jobsState[msg.jobId] || { jobId: msg.jobId };

    if (msg.type === "download_started") {
      job.status = "downloading";
      job.percent = 0;
      job.stage = "เริ่มต้นดาวน์โหลด...";
      job.downloadDir = msg.downloadDir;
      jobsState[msg.jobId] = job;
      saveState();
    } else if (msg.type === "download_progress") {
      job.status = "downloading";
      job.percent = msg.percent;
      job.totalSize = msg.totalSize;
      job.speed = msg.speed;
      job.eta = msg.eta;
      job.stage = `กำลังดาวน์โหลด ${msg.percent.toFixed(1)}%`;
      jobsState[msg.jobId] = job;
      saveState();
    } else if (msg.type === "download_postprocess") {
      job.status = "processing";
      job.percent = 100;
      job.stage = msg.stage;
      jobsState[msg.jobId] = job;
      saveState();
    } else if (msg.type === "download_complete") {
      job.status = "completed";
      job.percent = 100;
      job.filePath = msg.filePath;
      job.stage = "ดาวน์โหลดเสร็จสมบูรณ์";
      job.completedAt = Date.now();
      jobsState[msg.jobId] = job;
      saveState();

      chrome.notifications.create(`done_${msg.jobId}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "ดาวน์โหลดเสร็จสมบูรณ์",
        message: job.title
          ? `${job.title} (${job.mode === "mp3" ? "MP3" : job.quality + "p MP4"})`
          : msg.filePath
      });
    } else if (msg.type === "download_error") {
      job.status = "error";
      job.error = msg.error;
      job.stage = "เกิดข้อผิดพลาด";
      jobsState[msg.jobId] = job;
      saveState();
    } else if (msg.type === "download_cancelled") {
      job.status = "cancelled";
      job.stage = "ยกเลิกแล้ว";
      jobsState[msg.jobId] = job;
      saveState();
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "PING_HOST") {
    sendToNative({ action: "ping" }).then(sendResponse);
    return true;
  }

  if (message.type === "FETCH_INFO") {
    sendToNative({ action: "info", url: message.url }).then(sendResponse);
    return true;
  }

  if (message.type === "START_DOWNLOAD") {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    jobsState[jobId] = {
      jobId,
      url: message.url,
      title: message.title || "YouTube Video",
      mode: message.mode || "mp4",
      quality: message.quality || "1080",
      status: "starting",
      percent: 0,
      stage: "กำลังเตรียมดาวน์โหลด...",
      createdAt: Date.now()
    };
    saveState();

    try {
      const port = getNativePort();
      port.postMessage({
        action: "download",
        jobId,
        url: message.url,
        mode: message.mode || "mp4",
        quality: message.quality || "1080"
      });
      sendResponse({ ok: true, jobId });
    } catch (err) {
      jobsState[jobId].status = "error";
      jobsState[jobId].error = err.message;
      saveState();
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  }

  if (message.type === "CANCEL_DOWNLOAD") {
    sendToNative({ action: "cancel", jobId: message.jobId }).then(sendResponse);
    return true;
  }

  if (message.type === "GET_JOBS") {
    sendResponse({ ok: true, jobs: jobsState });
    return false;
  }

  if (message.type === "CLEAR_FINISHED_JOBS") {
    const next = {};
    for (const [k, v] of Object.entries(jobsState)) {
      if (v.status === "starting" || v.status === "downloading" || v.status === "processing") {
        next[k] = v;
      }
    }
    jobsState = next;
    saveState();
    sendResponse({ ok: true, jobs: jobsState });
    return false;
  }

  if (message.type === "OPEN_FOLDER") {
    sendToNative({ action: "open_folder" }).then(sendResponse);
    return true;
  }

  if (message.type === "UPDATE_YTDLP") {
    sendToNative({ action: "update" }).then(sendResponse);
    return true;
  }

  return false;
});
