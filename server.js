const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;
const DATA_FILE = path.join(__dirname, "data.json");
const sessions = new Map();

const users = [
  { username: "parent", password: "parent123", role: "applicant" },
  { username: "clerk", password: "clerk123", role: "clerk" },
  { username: "admin", password: "admin123", role: "admin" },
];

const today = new Date().toISOString().slice(0, 10);
const seedApplications = [
  { id: "BT-0001", childName: "Brian Ondieki Nyaboke", dob: "2026-08-14", gender: "Male", birthPlace: "Kisii Teaching & Referral Hospital", parentName: "Grace Nyaboke", parentId: "27845612", parentPhone: "0712345678", submittedBy: "parent", dateSubmitted: today, status: "Under Review" },
  { id: "BT-0002", childName: "Faith Moraa Onsongo", dob: "2026-07-02", gender: "Female", birthPlace: "Nyanchwa Hospital", parentName: "Peter Onsongo", parentId: "30124578", parentPhone: "0723456789", submittedBy: "parent", dateSubmitted: today, status: "Issued" },
];

function readApplications() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedApplications, null, 2));
    return seedApplications;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return seedApplications;
  }
}

function writeApplications(applications) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(applications, null, 2));
}

function send(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function tokenFrom(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function sessionFor(req) {
  return sessions.get(tokenFrom(req)) || null;
}

function requireAuth(req, res) {
  const session = sessionFor(req);
  if (!session) {
    send(res, 401, { error: "Authentication required." });
    return null;
  }
  return session;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function nextId(applications) {
  const highest = applications.reduce((max, app) => {
    const match = /^BT-(\d+)$/i.exec(app.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `BT-${String(highest + 1).padStart(4, "0")}`;
}

async function api(req, res, pathname) {
  if (pathname === "/api/login" && req.method === "POST") {
    const { username, password, role } = await readJson(req);
    const user = users.find((item) => item.username === username && item.password === password && item.role === role);
    if (!user) return send(res, 401, { error: "Invalid username, password or role." });
    const token = crypto.randomBytes(24).toString("hex");
    const session = { username: user.username, role: user.role };
    sessions.set(token, session);
    return send(res, 200, { token, user: session });
  }

  const session = requireAuth(req, res);
  if (!session) return;

  if (pathname === "/api/session" && req.method === "GET") {
    return send(res, 200, { user: session });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    sessions.delete(tokenFrom(req));
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/applications" && req.method === "GET") {
    const applications = readApplications();
    const visible = session.role === "clerk" || session.role === "admin"
      ? applications
      : applications.filter((app) => app.submittedBy === session.username);
    const search = normalize(req.url.split("?q=")[1] ? decodeURIComponent(req.url.split("?q=")[1]) : "");
    const filtered = search
      ? visible.filter((app) => app.id.toLower() === search || app.parentId === search || normalize(app.childName).includes(search))
      : visible;
    return send(res, 200, { applications: filtered });
  }

  if (pathname === "/api/applications" && req.method === "POST") {
    const body = await readJson(req);
    const required = ["childName", "dob", "gender", "birthPlace", "parentName", "parentId", "parentPhone"];
    if (required.some((field) => !String(body[field] || "").trim())) {
      return send(res, 400, { error: "All required application fields must be provided." });
    }

    const applications = readApplications();
    const duplicate = applications.find((app) =>
      normalize(app.childName) === normalize(body.childName) &&
      app.dob === body.dob &&
      String(app.parentId).trim() === String(body.parentId).trim()
    );
    if (duplicate) {
      return send(res, 409, { error: `Duplicate application already exists (${duplicate.id}, status: ${duplicate.status}).` });
    }

    const application = {
      id: nextId(applications),
      childName: body.childName.trim(),
      dob: body.dob,
      gender: body.gender,
      birthPlace: body.birthPlace.trim(),
      parentName: body.parentName.trim(),
      parentId: body.parentId.trim(),
      parentPhone: body.parentPhone.trim(),
      submittedBy: session.username,
      dateSubmitted: new Date().toISOString().slice(0, 10),
      status: "Submitted",
    };
    applications.push(application);
    writeApplications(applications);
    return send(res, 201, { application });
  }

  const statusMatch = /^\/api\/applications\/([^/]+)\/status$/.exec(pathname);
  if (statusMatch && req.method === "PATCH") {
    if (session.role !== "clerk" && session.role !== "admin") return send(res, 403, { error: "Only staff can update application status." });
    const { status } = await readJson(req);
    const statuses = ["Submitted", "Under Review", "Approved", "Issued"];
    if (!statuses.includes(status)) return send(res, 400, { error: "Invalid status." });
    const applications = readApplications();
    const index = applications.findIndex((app) => app.id === decodeURIComponent(statusMatch[1]));
    if (index === -1) return send(res, 404, { error: "Application not found." });
    applications[index].status = status;
    writeApplications(applications);
    return send(res, 200, { application: applications[index] });
  }

  send(res, 404, { error: "API endpoint not found." });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    let relative = url.pathname === "/" ? "birthtrack-login.html" : url.pathname.slice(1);
    relative = path.normalize(relative).replace(/^(\.\.[\\/])+/, "");
    const file = path.join(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    send(res, 500, { error: error.message || "Server error." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BirthTrack is running at http://localhost:${PORT}`);
});
