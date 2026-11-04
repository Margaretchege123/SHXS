const STATUSES = ["Submitted", "Under Review", "Approved", "Issued"];
let currentApps = [];

function getToken() {
  return sessionStorage.getItem("bt_token");
}

async function api(requestPath, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;

  const response = await fetch(requestPath, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function statusPill(status) {
  const className = status.toLowerCase().replace(/\s+/g, "-");
  return `<span class="status-pill ${className}">${escapeHtml(status)}</span>`;
}

function initLoginPage() {
  const form = document.getElementById("loginForm");
  if (!form) return;
  if (getToken()) {
    window.location.href = "birthtrack-dashboard.html";
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const credentials = {
      role: document.getElementById("role").value,
      username: document.getElementById("username").value.trim(),
      password: document.getElementById("password").value,
    };
    const errorElement = document.getElementById("loginError");
    try {
      const result = await api("/api/login", { method: "POST", body: JSON.stringify(credentials) });
      sessionStorage.setItem("bt_token", result.token);
      window.location.href = "birthtrack-dashboard.html";
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
}

async function initDashboard() {
  const wrapper = document.querySelector(".dash-wrapper");
  if (!wrapper) return;

  const session = getToken() ? (await api("/api/session").catch(() => null))?.user : null;
  if (!session) {
    sessionStorage.removeItem("bt_token");
    window.location.href = "birthtrack-login.html";
    return;
  }

  const isStaff = session.role === "clerk" || session.role === "admin";
  const roleLabels = {
    applicant: "Applicant (Parent)",
    clerk: "Registration Clerk",
    admin: "System Administrator",
  };
  document.getElementById("roleBadge").textContent = roleLabels[session.role];
  document.getElementById("applicationsTitle").textContent = isStaff ? "all applications" : "my applications";
  if (!isStaff) document.getElementById("actionHeader").style.display = "none";

  async function loadApps(search = "") {
    const query = search ? `?q=${encodeURIComponent(search)}` : "";
    currentApps = (await api(`/api/applications${query}`)).applications;
    return currentApps;
  }

  function renderOverview(applications = currentApps) {
    const count = (status) => applications.filter((application) => application.status === status).length;
    document.getElementById("countSubmitted").textContent = count("Submitted");
    document.getElementById("countReview").textContent = count("Under Review");
    document.getElementById("countApproved").textContent = count("Approved");
    document.getElementById("countIssued").textContent = count("Issued");

    const body = document.getElementById("recentBody");
    body.innerHTML = applications.length ? "" : '<tr class="empty-row"><td colspan="4">No applications yet.</td></tr>';
    applications.slice().reverse().slice(0, 5).forEach((application) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(application.id)}</td><td>${escapeHtml(application.childName)}</td><td>${escapeHtml(application.dateSubmitted)}</td><td>${statusPill(application.status)}</td>`;
      body.appendChild(row);
    });
  }

  function renderApplications(applications = currentApps) {
    const body = document.getElementById("applicationsBody");
    body.innerHTML = "";
    const columns = isStaff ? 6 : 5;
    if (!applications.length) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${columns}">No applications found.</td></tr>`;
      return;
    }
    applications.forEach((application) => {
      const index = STATUSES.indexOf(application.status);
      const nextStatus = STATUSES[index + 1];
      const action = isStaff
        ? `<td class="actions">${nextStatus ? `<button class="link-btn" data-id="${escapeHtml(application.id)}" data-next="${nextStatus}">mark ${nextStatus.toLowerCase()}</button>` : '<span class="text-muted">complete</span>'}</td>`
        : "";
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(application.id)}</td><td>${escapeHtml(application.childName)}</td><td>${escapeHtml(application.parentId)}</td><td>${escapeHtml(application.dateSubmitted)}</td><td>${statusPill(application.status)}</td>${action}`;
      body.appendChild(row);
    });
  }

  const panels = document.querySelectorAll(".panel");
  const navButtons = document.querySelectorAll(".nav-btn");
  async function refreshPanel(name) {
    try {
      await loadApps();
      if (name === "overview") renderOverview();
      if (name === "applications") renderApplications();
    } catch (error) {
      alert(error.message);
    }
  }
  function showPanel(name) {
    panels.forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
    navButtons.forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
    refreshPanel(name);
  }
  navButtons.forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
  document.querySelectorAll("[data-goto]").forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.goto)));

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    sessionStorage.removeItem("bt_token");
    window.location.href = "birthtrack-login.html";
  });

  document.getElementById("applicationsBody").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-next]");
    if (!button) return;
    try {
      await api(`/api/applications/${encodeURIComponent(button.dataset.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.next }),
      });
      await loadApps();
      renderApplications();
      renderOverview();
    } catch (error) {
      alert(error.message);
    }
  });

  const applicationForm = document.getElementById("appForm");
  const duplicateWarning = document.getElementById("duplicateWarning");
  applicationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    duplicateWarning.classList.remove("active");
    const payload = {
      childName: document.getElementById("childName").value,
      dob: document.getElementById("childDob").value,
      gender: document.getElementById("childGender").value,
      birthPlace: document.getElementById("birthPlace").value,
      parentName: document.getElementById("parentName").value,
      parentId: document.getElementById("parentId").value,
      parentPhone: document.getElementById("parentPhone").value,
    };
    try {
      await api("/api/applications", { method: "POST", body: JSON.stringify(payload) });
      applicationForm.reset();
      alert("Application submitted successfully.");
      showPanel("applications");
    } catch (error) {
      duplicateWarning.textContent = error.message;
      duplicateWarning.classList.add("active");
    }
  });

  async function runSearch() {
    const term = document.getElementById("searchInput").value.trim();
    const body = document.getElementById("searchBody");
    body.innerHTML = "";
    if (!term) {
      body.innerHTML = '<tr class="empty-row"><td colspan="4">Enter a search term above.</td></tr>';
      return;
    }
    try {
      const applications = await loadApps(term);
      if (!applications.length) {
        body.innerHTML = '<tr class="empty-row"><td colspan="4">No matching record found.</td></tr>';
        return;
      }
      applications.forEach((application) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${escapeHtml(application.id)}</td><td>${escapeHtml(application.childName)}</td><td>${escapeHtml(application.parentId)}</td><td>${statusPill(application.status)}</td>`;
        body.appendChild(row);
      });
    } catch (error) {
      body.innerHTML = `<tr class="empty-row"><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    }
  }
  document.getElementById("searchBtn").addEventListener("click", runSearch);
  document.getElementById("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });

  await refreshPanel("overview");
}

document.addEventListener("DOMContentLoaded", () => {
  initLoginPage();
  initDashboard();
});
