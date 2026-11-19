# YouTube Video Downloader (Private Local Extension)

Chrome Extension (Manifest V3) สำหรับดาวน์โหลดวิดีโอและเสียงจาก YouTube แบบใช้ส่วนตัว โดยทำงานและถอดรหัสในเครื่อง 100% ผ่าน Native Messaging + `yt-dlp` + `ffmpeg`

## โครงสร้างโปรเจกต์

- `extension/` — ไฟล์ Chrome Extension (Manifest V3)
  - `manifest.json` — ล็อก Extension ID คงที่ (`odglcnnipefendfpdekkfikfllnolonf`) และขอสิทธิ์เฉพาะ `https://www.youtube.com/*`
  - `background.js` — Service Worker จัดการคิวดาวน์โหลดและเชื่อมกับ Native Host
  - `popup/` — หน้าต่างเลือกความละเอียด (4K/2K/1080p/720p/480p/360p หรือ MP3) และแถบสถานะการดาวน์โหลด
  - `content/` — ปุ่ม **⬇ ดาวน์โหลด** บนหน้าวิดีโอ YouTube โดยตรง
- `native-host/` — โปรแกรมฝั่งเครื่อง (เขียนด้วย Node.js มาตรฐาน 100% ไม่มี npm dependencies)
  - `host.js` — ตรวจสอบความถูกต้องของ URL/Format, ป้องกัน Command/Argument Injection และล็อกโฟลเดอร์ปลายทางไว้ที่ `Downloads\YouTube`
  - `com.ytdl.host.json` — อนุญาตเฉพาะ Extension ID `odglcnnipefendfpdekkfikfllnolonf`
  - `bin/` — เก็บ `yt-dlp.exe` และ `ffmpeg.exe` (ที่ผ่านการตรวจ SHA-256 แล้ว)
- `installer/`
  - `install.ps1` — ดาวน์โหลด `yt-dlp.exe` + `ffmpeg.exe` ตรวจค่า SHA-256 และลงทะเบียน Registry
  - `uninstall.ps1` — ถอนการลงทะเบียน Registry

## วิธีเปิดใช้งานใน Google Chrome

1. รันสคริปต์ติดตั้ง (หากยังไม่ได้รัน):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\installer\install.ps1
   ```
2. เปิด Chrome แล้วไปที่ `chrome://extensions`
3. เปิดสวิตช์ **โหมดนักพัฒนาซอฟต์แวร์ (Developer mode)** ที่มุมขวาบน
4. กดปุ่ม **โหลดส่วนขยายที่ยังไม่ได้แพ็ก (Load unpacked)**
5. เลือกโฟลเดอร์ `extension` ในโปรเจกต์นี้
6. เปิดหน้าวิดีโอ YouTube แล้วกดปุ่ม **⬇ ดาวน์โหลด** ใต้วิดีโอ หรือกดที่ไอคอน Extension ด้านบนขวา
