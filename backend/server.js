const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS allow
app.use(cors());
app.use(express.json());

// Upload folder ensure
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Multer config – max 10 MB per file
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// In-memory store
// id -> { path, originalName, createdAt, expiresAt, timeout }
const files = new Map();

// ⏱ 5 minute (milliseconds)
const FILE_LIFETIME_MS = 5 * 60 * 1000;

function deleteFile(id) {
  const info = files.get(id);
  if (!info) return;

  try {
    fs.unlink(info.path, () => {});
  } catch (err) {
    console.error("Delete error:", err);
  }

  if (info.timeout) clearTimeout(info.timeout);
  files.delete(id);
}

// Health / status
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Server Active",
    uptimeSeconds: process.uptime()
  });
});

// Upload multiple files
app.post("/upload", upload.array("files", 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No files uploaded" });
  }

  const now = Date.now();
  const uploaded = [];

  for (const f of req.files) {
    const id = uuidv4();
    const expiresAt = now + FILE_LIFETIME_MS;

    const timeout = setTimeout(() => deleteFile(id), FILE_LIFETIME_MS + 2000);

    files.set(id, {
      id,
      path: f.path,
      originalName: f.originalname,
      createdAt: now,
      expiresAt,
      timeout
    });

    uploaded.push({
      id,
      originalName: f.originalname,
      expiresAt
    });
  }

  res.json({ success: true, files: uploaded });
});

// List active files
app.get("/files", (req, res) => {
  const now = Date.now();
  const list = [];

  for (const [id, info] of files.entries()) {
    if (info.expiresAt <= now) {
      deleteFile(id);
      continue;
    }

    list.push({
      id,
      originalName: info.originalName,
      remainingMs: info.expiresAt - now
    });
  }

  res.json({ success: true, files: list });
});

// Manual delete before auto-expire
app.delete("/files/:id", (req, res) => {
  const id = req.params.id;
  const info = files.get(id);
  if (!info) {
    return res
      .status(404)
      .json({ success: false, message: "File not found" });
  }

  deleteFile(id);
  return res.json({ success: true, message: "File deleted" });
});

// Download file
app.get("/download/:id", (req, res) => {
  const id = req.params.id;
  const info = files.get(id);

  if (!info) {
    return res.status(410).send("File expired or not found");
  }

  if (info.expiresAt <= Date.now()) {
    deleteFile(id);
    return res.status(410).send("File expired");
  }

  res.download(info.path, info.originalName);
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
