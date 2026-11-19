"use strict";

const BTN_ID = "ytdl-private-inline-btn";
const MENU_ID = "ytdl-private-inline-menu";

function getVideoTitle() {
  const h1 = document.querySelector("ytd-watch-metadata h1 yt-formatted-string");
  if (h1 && h1.textContent) return h1.textContent.trim();
  return document.title.replace(/\s*-\s*YouTube$/i, "");
}

function triggerDownload(mode, quality, btnEl) {
  const url = window.location.href;
  const title = getVideoTitle();

  const labelEl = btnEl.querySelector(".ytdl-btn-label");
  if (labelEl) {
    labelEl.textContent = "กำลังเริ่มดาวน์โหลด...";
  }

  chrome.runtime.sendMessage(
    {
      type: "START_DOWNLOAD",
      url,
      title,
      mode,
      quality
    },
    (res) => {
      if (labelEl) {
        if (res && res.ok) {
          labelEl.textContent = "ส่งเข้าคิวแล้ว ✓";
        } else {
          labelEl.textContent = "เกิดข้อผิดพลาด";
        }
        setTimeout(() => {
          labelEl.textContent = "ดาวน์โหลด";
        }, 2500);
      }
    }
  );
}

function createDownloadButton() {
  const wrapper = document.createElement("div");
  wrapper.id = BTN_ID;
  wrapper.className = "ytdl-inline-wrapper";

  const mainBtn = document.createElement("button");
  mainBtn.type = "button";
  mainBtn.className = "ytdl-inline-btn";
  mainBtn.title = "ดาวน์โหลดวิดีโอนี้ลงเครื่อง (1080p MP4 หรือเลือกความละเอียด)";

  const iconSpan = document.createElement("span");
  iconSpan.className = "ytdl-btn-icon";
  iconSpan.textContent = "⬇";

  const labelSpan = document.createElement("span");
  labelSpan.className = "ytdl-btn-label";
  labelSpan.textContent = "ดาวน์โหลด";

  mainBtn.appendChild(iconSpan);
  mainBtn.appendChild(labelSpan);

  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.className = "ytdl-inline-menu hidden";

  const options = [
    { label: "MP4 4K (2160p)", mode: "mp4", quality: "2160" },
    { label: "MP4 Full HD (1080p)", mode: "mp4", quality: "1080" },
    { label: "MP4 HD (720p)", mode: "mp4", quality: "720" },
    { label: "MP4 480p", mode: "mp4", quality: "480" },
    { label: "MP3 เสียงอย่างเดียว (คุณภาพสูงสุด)", mode: "mp3", quality: "best" }
  ];

  for (const opt of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ytdl-menu-item";
    item.textContent = opt.label;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.add("hidden");
      triggerDownload(opt.mode, opt.quality, mainBtn);
    });
    menu.appendChild(item);
  }

  mainBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    menu.classList.add("hidden");
  });

  wrapper.appendChild(mainBtn);
  wrapper.appendChild(menu);
  return wrapper;
}

function injectButtonIfNeeded() {
  if (!window.location.pathname.startsWith("/watch")) return;
  if (document.getElementById(BTN_ID)) return;

  const targetContainer =
    document.querySelector("ytd-watch-metadata #top-level-buttons-computed") ||
    document.querySelector("ytd-watch-metadata #actions-inner #menu #top-level-buttons-computed") ||
    document.querySelector("#above-the-fold #top-level-buttons-computed");

  if (targetContainer) {
    const btn = createDownloadButton();
    targetContainer.prepend(btn);
  }
}

// Listen for YouTube SPA navigations and DOM updates
window.addEventListener("yt-navigate-finish", () => {
  setTimeout(injectButtonIfNeeded, 600);
});

const observer = new MutationObserver(() => {
  if (window.location.pathname.startsWith("/watch") && !document.getElementById(BTN_ID)) {
    injectButtonIfNeeded();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

injectButtonIfNeeded();
