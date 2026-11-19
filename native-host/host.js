#!/usr/bin/env node
"use strict";

/**
 * Hardened Native Messaging Host for YouTube Video Downloader Extension
 * - Zero npm dependencies (100% Node.js built-ins)
 * - Uses child_process.spawn with shell: false
 * - Enforces strict URL domain/protocol whitelist
 * - Enforces format ID whitelist
 * - Locks output directory to ~/Downloads/YouTube (no arbitrary path writes)
 * - Disables remote components, browser cookies, and post-exec hooks
 */

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const BIN_DIR = path.join(__dirname, "bin");
const YTDLP_PATH = path.join(BIN_DIR, "yt-dlp.exe");
const FFMPEG_PATH = path.join(BIN_DIR, "ffmpeg.exe");
const DOWNLOAD_DIR = path.join(os.homedir(), "Downloads", "YouTube");

// Active child processes keyed by job id
const activeProcesses = new Map();

// Ensure download directory exists
function ensureDownloadDir() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
}

/**
 * Send a JSON message to Chrome via stdout (4-byte UInt32LE length prefix)
 */
function sendMessage(msg) {
  try {
    const json = JSON.stringify(msg);
    const body = Buffer.from(json, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([header, body]));
  } catch (err) {
    // Ignore serialization errors
  }
}

/**
 * Validate and normalize a YouTube URL.
 * Rejects non-HTTPS, non-YouTube domains, or malformed URLs.
 */
function validateYouTubeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 512) {
    throw new Error("URL ไม่ถูกต้อง");
  }
  if (rawUrl.trim().startsWith("-")) {
    throw new Error("ไม่อนุญาต URL ที่ขึ้นต้นด้วยเครื่องหมายขีด (-)");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("รูปแบบ URL ไม่ถูกต้อง");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("อนุญาตเฉพาะโปรโตคอล HTTPS เท่านั้น");
  }

  const allowedHosts = new Set([
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be"
  ]);

  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("อนุญาตเฉพาะลิงก์จาก YouTube เท่านั้น");
  }

  // Strip potentially unexpected hash/credentials and construct clean URL
  if (parsed.hostname.toLowerCase() === "youtu.be") {
    const videoId = parsed.pathname.slice(1).split("/")[0];
    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      throw new Error("รหัสวิดีโอ YouTube ไม่ถูกต้อง");
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (parsed.pathname.startsWith("/shorts/")) {
    const shortsId = parsed.pathname.replace("/shorts/", "").split("/")[0];
    if (!/^[a-zA-Z0-9_-]{6,20}$/.test(shortsId)) {
      throw new Error("รหัสวิดีโอ Shorts ไม่ถูกต้อง");
    }
    return `https://www.youtube.com/shorts/${shortsId}`;
  }

  const v = parsed.searchParams.get("v");
  if (!v || !/^[a-zA-Z0-9_-]{6,20}$/.test(v)) {
    throw new Error("ไม่พบรหัสวิดีโอ (v=...) ที่ถูกต้องใน URL");
  }

  return `https://www.youtube.com/watch?v=${v}`;
}

/**
 * Validate format selector against strict whitelist
 */
function validateFormatSelector(quality, mode) {
  if (mode === "mp3") {
    return "bestaudio/best";
  }

  const allowedQualities = {
    best: "bv*+ba/b",
    "2160": "bv*[height<=2160]+ba/b[height<=2160]/b",
    "1440": "bv*[height<=1440]+ba/b[height<=1440]/b",
    "1080": "bv*[height<=1080]+ba/b[height<=1080]/b",
    "720": "bv*[height<=720]+ba/b[height<=720]/b",
    "480": "bv*[height<=480]+ba/b[height<=480]/b",
    "360": "bv*[height<=360]+ba/b[height<=360]/b"
  };

  if (quality && allowedQualities[quality]) {
    return allowedQualities[quality];
  }

  // Or specific numeric/alphanumeric format ID from info (e.g. "137+140" or "22")
  if (typeof quality === "string" && /^[0-9]{1,5}(\+[0-9]{1,5})?$/.test(quality)) {
    return quality;
  }

  return allowedQualities["1080"];
}

function checkBinaries() {
  const ytdlpExists = fs.existsSync(YTDLP_PATH);
  const ffmpegExists = fs.existsSync(FFMPEG_PATH);
  return {
    ytdlpExists,
    ffmpegExists,
    ready: ytdlpExists && ffmpegExists,
    downloadDir: DOWNLOAD_DIR
  };
}

/**
 * Handle 'ping' action
 */
function handlePing(req) {
  const status = checkBinaries();
  if (!status.ytdlpExists) {
    sendMessage({
      id: req.id,
      type: "ping_result",
      ok: false,
      ...status,
      error: "ไม่พบไฟล์ yt-dlp.exe ใน native-host/bin กรุณารันสคริปต์ install.ps1"
    });
    return;
  }

  const child = spawn(YTDLP_PATH, ["--version"], {
    shell: false,
    windowsHide: true
  });

  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.on("close", (code) => {
    sendMessage({
      id: req.id,
      type: "ping_result",
      ok: code === 0 && status.ready,
      version: out.trim(),
      ...status
    });
  });
  child.on("error", (err) => {
    sendMessage({
      id: req.id,
      type: "ping_result",
      ok: false,
      error: err.message,
      ...status
    });
  });
}

/**
 * Handle 'info' action: fetch video metadata & available resolutions
 */
function handleInfo(req) {
  let cleanUrl;
  try {
    cleanUrl = validateYouTubeUrl(req.url);
  } catch (err) {
    sendMessage({ id: req.id, type: "info_result", ok: false, error: err.message });
    return;
  }

  const status = checkBinaries();
  if (!status.ytdlpExists) {
    sendMessage({
      id: req.id,
      type: "info_result",
      ok: false,
      error: "ยังไม่ได้ติดตั้ง yt-dlp.exe กรุณารัน installer/install.ps1"
    });
    return;
  }

  const args = [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--no-exec",
    "--js-runtimes",
    `node:${process.execPath}`,
    "--",
    cleanUrl
  ];

  const child = spawn(YTDLP_PATH, args, {
    shell: false,
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.on("close", (code) => {
    if (code !== 0) {
      sendMessage({
        id: req.id,
        type: "info_result",
        ok: false,
        error: stderr.trim() || `yt-dlp exited with code ${code}`
      });
      return;
    }

    try {
      const data = JSON.parse(stdout);
      const heights = new Set();
      if (Array.isArray(data.formats)) {
        for (const f of data.formats) {
          if (f.vcodec && f.vcodec !== "none" && typeof f.height === "number") {
            if ([2160, 1440, 1080, 720, 480, 360].includes(f.height)) {
              heights.add(f.height);
            }
          }
        }
      }

      const sortedHeights = Array.from(heights).sort((a, b) => b - a);

      sendMessage({
        id: req.id,
        type: "info_result",
        ok: true,
        info: {
          videoId: data.id,
          title: data.title || "YouTube Video",
          uploader: data.uploader || data.channel || "",
          duration: data.duration || 0,
          thumbnail: data.thumbnail || "",
          resolutions: sortedHeights.length > 0 ? sortedHeights : [1080, 720, 480, 360],
          cleanUrl
        }
      });
    } catch (err) {
      sendMessage({
        id: req.id,
        type: "info_result",
        ok: false,
        error: "ไม่สามารถอ่านข้อมูลวิดีโอได้: " + err.message
      });
    }
  });
}

/**
 * Handle 'download' action: stream progress back to extension
 */
function handleDownload(req) {
  const jobId = String(req.jobId || req.id || Date.now());
  let cleanUrl;
  try {
    cleanUrl = validateYouTubeUrl(req.url);
  } catch (err) {
    sendMessage({
      id: req.id,
      jobId,
      type: "download_error",
      error: err.message
    });
    return;
  }

  const status = checkBinaries();
  if (!status.ready) {
    sendMessage({
      id: req.id,
      jobId,
      type: "download_error",
      error: "ไม่พบ yt-dlp.exe หรือ ffmpeg.exe กรุณารันสคริปต์ installer/install.ps1"
    });
    return;
  }

  ensureDownloadDir();

  const mode = req.mode === "mp3" ? "mp3" : "mp4";
  const formatSelector = validateFormatSelector(req.quality, mode);

  // Safe output template inside locked DOWNLOAD_DIR
  const outputTemplate = path.join(DOWNLOAD_DIR, "%(title).120B [%(id)s].%(ext)s");

  const args = [
    "--newline",
    "--no-playlist",
    "--no-exec",
    "--windows-filenames",
    "--ffmpeg-location",
    BIN_DIR,
    "--js-runtimes",
    `node:${process.execPath}`,
    "-f",
    formatSelector,
    "-o",
    outputTemplate
  ];

  if (mode === "mp3") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    args.push("--merge-output-format", "mp4");
  }

  // End of options delimiter so cleanUrl is never treated as a flag
  args.push("--", cleanUrl);

  const child = spawn(YTDLP_PATH, args, {
    shell: false,
    windowsHide: true
  });

  activeProcesses.set(jobId, child);

  sendMessage({
    jobId,
    type: "download_started",
    url: cleanUrl,
    mode,
    quality: req.quality || "1080",
    downloadDir: DOWNLOAD_DIR
  });

  let stderrBuf = "";
  let finalFilePath = "";

  child.stdout.on("data", (chunk) => {
    const lines = chunk.toString("utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;

      // Capture destination or merger path
      const destMatch =
        line.match(/^\[Merger\] Merging formats into "(.+)"/) ||
        line.match(/^\[ExtractAudio\] Destination: (.+)$/) ||
        line.match(/^\[download\] Destination: (.+)$/) ||
        line.match(/^\[download\] (.+) has already been downloaded/);

      if (destMatch && destMatch[1]) {
        finalFilePath = destMatch[1].replace(/^"|"$/g, "");
      }

      // Parse progress percentage, speed, and ETA
      const progMatch = line.match(
        /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([^\s]+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/
      );
      if (progMatch) {
        sendMessage({
          jobId,
          type: "download_progress",
          percent: parseFloat(progMatch[1]),
          totalSize: progMatch[2] || "",
          speed: progMatch[3] || "",
          eta: progMatch[4] || ""
        });
      } else if (line.startsWith("[Merger]") || line.startsWith("[ExtractAudio]")) {
        sendMessage({
          jobId,
          type: "download_postprocess",
          stage: mode === "mp3" ? "กำลังแปลงไฟล์เป็น MP3..." : "กำลังรวมภาพและเสียง (ffmpeg)..."
        });
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf8");
  });

  child.on("close", (code) => {
    activeProcesses.delete(jobId);

    if (child._cancelled) {
      sendMessage({
        jobId,
        type: "download_cancelled"
      });
      return;
    }

    if (code === 0) {
      sendMessage({
        jobId,
        type: "download_complete",
        filePath: finalFilePath || DOWNLOAD_DIR,
        downloadDir: DOWNLOAD_DIR
      });
    } else {
      sendMessage({
        jobId,
        type: "download_error",
        error: stderrBuf.trim() || `ดาวน์โหลดไม่สำเร็จ (รหัส ${code})`
      });
    }
  });

  child.on("error", (err) => {
    activeProcesses.delete(jobId);
    sendMessage({
      jobId,
      type: "download_error",
      error: err.message
    });
  });
}

/**
 * Handle 'cancel' action
 */
function handleCancel(req) {
  const jobId = String(req.jobId || "");
  const child = activeProcesses.get(jobId);
  if (child) {
    child._cancelled = true;
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
        shell: false,
        windowsHide: true
      });
    } catch {
      child.kill();
    }
    activeProcesses.delete(jobId);
    sendMessage({ id: req.id, jobId, type: "download_cancelled" });
  } else {
    sendMessage({ id: req.id, jobId, type: "cancel_result", ok: false });
  }
}

/**
 * Handle 'open_folder' action: opens the locked DOWNLOAD_DIR in Windows Explorer
 */
function handleOpenFolder(req) {
  ensureDownloadDir();
  spawn("explorer.exe", [DOWNLOAD_DIR], {
    shell: false,
    windowsHide: false
  });
  sendMessage({ id: req.id, type: "open_folder_result", ok: true, downloadDir: DOWNLOAD_DIR });
}

/**
 * Handle 'update' action: user-triggered yt-dlp update (`yt-dlp -U`)
 */
function handleUpdate(req) {
  const status = checkBinaries();
  if (!status.ytdlpExists) {
    sendMessage({
      id: req.id,
      type: "update_result",
      ok: false,
      error: "ไม่พบ yt-dlp.exe กรุณารัน installer/install.ps1 ก่อน"
    });
    return;
  }

  const child = spawn(YTDLP_PATH, ["-U"], {
    shell: false,
    windowsHide: true
  });

  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("close", (code) => {
    sendMessage({
      id: req.id,
      type: "update_result",
      ok: code === 0,
      output: (out + "\n" + err).trim()
    });
  });
}

/**
 * Dispatch incoming message from Chrome extension
 */
function onMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  switch (msg.action) {
    case "ping":
      handlePing(msg);
      break;
    case "info":
      handleInfo(msg);
      break;
    case "download":
      handleDownload(msg);
      break;
    case "cancel":
      handleCancel(msg);
      break;
    case "open_folder":
      handleOpenFolder(msg);
      break;
    case "update":
      handleUpdate(msg);
      break;
    default:
      sendMessage({ id: msg.id, type: "error", error: "คำสั่งไม่รู้จัก" });
  }
}

// Native Messaging stdin parser (4-byte length prefix followed by UTF-8 JSON)
let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    // Guard against excessively large messages (> 1MB)
    if (msgLen > 1024 * 1024) {
      process.exit(1);
    }
    if (inputBuffer.length < 4 + msgLen) {
      break;
    }

    const msgBytes = inputBuffer.subarray(4, 4 + msgLen);
    inputBuffer = inputBuffer.subarray(4 + msgLen);

    try {
      const parsed = JSON.parse(msgBytes.toString("utf8"));
      onMessage(parsed);
    } catch {
      // Ignore malformed JSON frames
    }
  }
});

process.stdin.on("end", () => {
  for (const [, child] of activeProcesses) {
    try {
      child.kill();
    } catch {}
  }
  process.exit(0);
});
