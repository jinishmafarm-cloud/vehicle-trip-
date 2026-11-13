/* ============================================================
   MAFARM VEHICLE TRIP MANAGEMENT
   GitHub Pages + Firebase Auth + Firestore
   Vehicle Master: manual + Excel/CSV bulk import (50+ vehicles)
   No Cloud Functions required for this version.
============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, query, where, getDocs,
  addDoc, updateDoc, setDoc, deleteDoc, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const firebaseConfig = {
  apiKey: "AIzaSyB36kVpDjxZsqdN7ZWVFSYpsU1rrNFDZgk",
  authDomain: "vehicle-trip-entry-35f69.firebaseapp.com",
  projectId: "vehicle-trip-entry-35f69",
  storageBucket: "vehicle-trip-entry-35f69.firebasestorage.app",
  messagingSenderId: "751996536767",
  appId: "1:751996536767:web:69a3a2e4f4ae4c5ef7430a",
  measurementId: "G-ZBY022XKHX"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let vehicleData = [];
let employeeData = [];
let userData = [];
let tripData = [];
let fuelData = [];
let driverData = [];
let activeTripId = null;
let activeTripData = null;
let vehicleImportRows = [];
let currentReportType = "";
let adminInitialised = false;
let driverInitialised = false;

const COLLECTION = { users: "User", vehicles: "Vehicles", employees: "Employees", trips: "Trips", fuel: "Fuel" };

function val(obj, keys, fallback = "") {
  for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  return fallback;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function profileName(p = currentProfile) { return val(p, ["Name", "name", "employeeName"], "User"); }
function profileRole(p = currentProfile) { return String(val(p, ["Role", "role"], "")).toLowerCase(); }
function profileActive(p) { return val(p, ["Active", "active"], false) === true; }
function isAdmin() { return profileRole() === "admin"; }
function isDriver() { return profileRole() === "driver"; }
function todayISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function toast(message, isError = false) {
  const el = $("toast");
  if (!el) { if (isError) console.error(message); else console.log(message); return; }
  el.textContent = message;
  el.classList.add("show");
  el.style.background = isError ? "#a52b25" : "#075b35";
  clearTimeout(window._mafarmToastTimer);
  window._mafarmToastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}
function message(id, text, error = false) {
  const el = $(id); if (!el) return;
  el.textContent = text;
  el.style.color = error ? "#b42318" : "#08713a";
}
function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (label) button.textContent = busy ? "Please wait…" : label;
}
function normaliseVehicle(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function vehicleNumber(v) { return val(v, ["vehicleNo", "vehicleNumber", "VehicleNo", "registrationNumber"], v.id || ""); }
function vehicleCurrentKm(v) { return Number(val(v, ["currentKm", "lastClosingKm", "initialKm", "InitialKM"], 0)); }
function activeRecord(record) {
  const status = String(val(record, ["status", "Status"], "")).toLowerCase();
  if (status.includes("maintenance") || status === "inactive") return false;
  return val(record, ["active", "Active"], true) !== false;
}
function formatDate(value) {
  if (!value) return "";
  if (value?.toDate) value = value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN");
}
async function readCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- USER ID LOGIN ALIAS ---------------- */
const LOGIN_ALIAS_DOMAIN = "mafarm-login.com";
function loginAliasFromUserId(userId) {
  const safeId = String(userId || "").trim().toLowerCase();
  return `${safeId}@${LOGIN_ALIAS_DOMAIN}`;
}

// Show the generated Firebase Authentication email alias to the Admin
// while creating a profile. This is the account email to create in Firebase Auth.
$("newUserId")?.addEventListener("input", () => {
  const id = $("newUserId").value.trim().toUpperCase();
  const hint = $("newUserAliasHint");
  if (hint) hint.textContent = id
    ? `Create Firebase Authentication account with email: ${loginAliasFromUserId(id)}`
    : "Login alias will be generated from this User ID.";
});

/* ---------------- LOGIN / SESSION ---------------- */
function showRole(role) {
  $("loginPage").style.display = "none";
  $("adminWorkspace").style.display = role === "admin" ? "block" : "none";
  $("driverWorkspace").style.display = role === "driver" ? "block" : "none";
  if (role === "admin") initAdminUI();
  if (role === "driver") initDriverUI();
  if (window.lucide) window.lucide.createIcons();
}

$("mainLoginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const button = $("mainLoginBtn");
  const output = $("mainLoginMessage");
  button.disabled = true;
  output.textContent = "Signing in…";
  try {
    const userId = $("mainIdentity").value.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{2,40}$/.test(userId)) {
      throw new Error("Enter a valid MAFARM User ID.");
    }
    // Firebase Email/Password Auth requires an email internally.
    // MAFARM users enter only their User ID; the matching Auth account
    // must be registered with this generated alias.
    const identity = loginAliasFromUserId(userId);
    const credential = await signInWithEmailAndPassword(auth, identity, $("mainPassword").value);
    const snap = await getDoc(doc(db, COLLECTION.users, credential.user.uid));
    if (!snap.exists()) throw new Error("User profile not found. Check the User document ID against Firebase Authentication UID.");
    const p = snap.data();
    const role = profileRole(p);
    if (!profileActive(p) || !["admin", "driver"].includes(role)) throw new Error("Account inactive or role not permitted. Check Active and Role fields in User profile.");
    currentUser = credential.user;
    currentProfile = p;
    showRole(role);
  } catch (error) {
    console.error("LOGIN ERROR", error);
    output.textContent = ["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(error.code)
      ? "Invalid User ID or password. Check that the Firebase Authentication account uses the MAFARM login alias."
      : (error.message || "Login failed.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    currentUser = null; currentProfile = null;
    $("loginPage").style.display = "grid";
    $("adminWorkspace").style.display = "none";
    $("driverWorkspace").style.display = "none";
    return;
  }
  try {
    const snap = await getDoc(doc(db, COLLECTION.users, user.uid));
    if (!snap.exists()) throw new Error("User profile not found.");
    const p = snap.data();
    const role = profileRole(p);
    if (!profileActive(p) || !["admin", "driver"].includes(role)) throw new Error("Account inactive or role not permitted.");
    currentUser = user; currentProfile = p;
    showRole(role);
  } catch (error) {
    console.error("SESSION ERROR", error);
    await signOut(auth);
  }
});

async function logout() { adminInitialised = false; driverInitialised = false; await signOut(auth); }
window.mafarmLogout = logout;
$("logoutBtn")?.addEventListener("click", logout);

/* ---------------- SHARED SELECTS ---------------- */
function fillSelect(id, records, valueFn, labelFn, firstLabel = "Select") {
  const select = $(id);
  if (!select || select.tagName !== "SELECT") return;
  const old = select.value;
  select.innerHTML = "";
  const first = document.createElement("option");
  first.value = ""; first.textContent = firstLabel;
  select.appendChild(first);
  records.forEach(record => {
    const option = document.createElement("option");
    option.value = String(valueFn(record) ?? "");
    option.textContent = String(labelFn(record) ?? "");
    if (record._km !== undefined) option.dataset.km = String(record._km);
    select.appendChild(option);
  });
  if ([...select.options].some(o => o.value === old)) select.value = old;
}

function setupVehicleSearch(inputId, listId, hiddenId, records, labelFn, onSelect) {
  const input = $(inputId);
  const list = $(listId);
  const hidden = $(hiddenId);
  if (!input || !list || !hidden) return;

  const oldValue = hidden.value;
  list.innerHTML = "";
  hidden.value = "";

  records.forEach(record => {
    const option = document.createElement("option");
    option.value = String(labelFn(record));
    list.appendChild(option);
  });

  const previous = records.find(r => String(r.id) === oldValue);
  input.value = previous ? String(labelFn(previous)) : "";

  const findMatch = () => {
    const typed = input.value.trim().toLowerCase();
    if (!typed) return null;
    // Prefer exact match; otherwise accept a unique prefix match.
    const exact = records.find(r => String(labelFn(r)).trim().toLowerCase() === typed);
    if (exact) return exact;
    const candidates = records.filter(r => String(vehicleNumber(r)).replace(/\s+/g, "").toLowerCase()
      .startsWith(typed.replace(/\s+/g, "")));
    if (candidates.length === 1) return candidates[0];
    return records.find(r => String(labelFn(r)).toLowerCase().startsWith(typed)) || null;
  };

  const sync = () => {
    const typed = input.value.trim();
    const match = findMatch();
    hidden.value = match ? String(match.id) : "";
    if (onSelect) onSelect(match || null);
    input.setCustomValidity(typed && !match ? "Choose a registered vehicle from the suggestions." : "");
  };

  input.addEventListener("input", sync);
  input.addEventListener("change", sync);
  input.addEventListener("blur", () => {
    sync();
    if (input.value.trim() && !hidden.value) input.reportValidity();
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      input.value = "";
      hidden.value = "";
      if (onSelect) onSelect(null);
      input.setCustomValidity("");
    }
  });
  sync();
}

function activeVehiclesForAdmin() { return vehicleData.filter(activeRecord); }
function activeEmployees() { return employeeData.filter(activeRecord); }
function populateCommonSelects() {
  const vehicles = activeVehiclesForAdmin().map(v => ({...v, _km: vehicleCurrentKm(v)}));
  const employees = activeEmployees();
  setupVehicleSearch(
    "adminVehicleSearch", "adminVehicleOptions", "adminVehicle",
    vehicles,
    v => `${vehicleNumber(v)} — ${vehicleCurrentKm(v).toLocaleString("en-IN")} KM`,
    v => {
      if ($("adminOpeningKm")) $("adminOpeningKm").value = v ? vehicleCurrentKm(v) : "";
      calculateAdminDistance();
    }
  );
  fillSelect("adminDriverSelect", driverData, d => d.id, d => d.name || d.id, "Select driver");
  fillSelect("adminEmployeeSelect", employees, e => e.id, e => `${val(e,["name","employeeName","Name"],e.id)} (${val(e,["employeeId","Employee ID"],e.id)})`, "Select employee");
  fillSelect("vehicleAssignedDriver", driverData, d => d.id, d => d.name || d.id, "No Driver Assigned");
  fillSelect("fuelVehicleAdmin", vehicles, v => v.id, v => vehicleNumber(v));
  fillSelect("fuelDriverAdmin", driverData, d => d.id, d => d.name || d.id, "Select driver");
}

/* ---------------- ADMIN WORKSPACE ---------------- */
function initAdminUI() {
  if (adminInitialised) { refreshAdminData(); return; }
  adminInitialised = true;

  function go(page) {
    document.querySelectorAll("#adminWorkspace .page").forEach(p => p.classList.remove("active"));
    $("page-" + page)?.classList.add("active");
    document.querySelectorAll("#adminWorkspace .nav-link").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    if (window.innerWidth < 760) $("sidebar")?.classList.remove("open");
    window.scrollTo({top:0, behavior:"smooth"});
  }
  document.querySelectorAll("#adminWorkspace [data-page]").forEach(b => b.addEventListener("click", () => go(b.dataset.page)));
  document.querySelectorAll("#adminWorkspace [data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
  $("menuBtn")?.addEventListener("click", () => $("sidebar")?.classList.toggle("open"));
  if ($("today")) $("today").textContent = new Intl.DateTimeFormat("en-IN", {day:"2-digit",month:"short",year:"numeric"}).format(new Date());
  document.querySelectorAll('#adminWorkspace input[type="date"]').forEach(el => { if (!el.value) el.value = todayISO(); });

  // Admin trip entry

  $("adminClosingKm")?.addEventListener("input", calculateAdminDistance);
  $("addAdminDestination")?.addEventListener("click", () => addAdminDestinationRow());
  $("adminDestinations")?.addEventListener("click", e => {
    if (e.target.classList.contains("remove-dest")) e.target.closest(".destination-line")?.remove();
    renumberAdminDestinations();
  });
  $("adminTripForm")?.addEventListener("submit", saveAdminTrip);

  // Vehicle master and bulk upload
  $("vehicleMasterForm")?.addEventListener("submit", saveVehicle);
  $("downloadVehicleTemplate")?.addEventListener("click", downloadVehicleTemplate);
  $("previewVehicleUpload")?.addEventListener("click", previewVehicleFile);
  $("importVehiclesBtn")?.addEventListener("click", importVehicleFile);
  $("vehicleSearch")?.addEventListener("input", filterVehicleRows);
  $("vehicleStatusFilter")?.addEventListener("change", filterVehicleRows);
  $("refreshVehiclesBtn")?.addEventListener("click", async () => { await refreshAdminData(); toast("Vehicle list refreshed."); });

  // Employee form uses explicit IDs added in index.html
  $("employeeForm")?.addEventListener("submit", saveEmployee);
  $("fuelEntryForm")?.addEventListener("submit", saveAdminFuel);
  $("managedUserForm")?.addEventListener("submit", saveManagedUser);
  $("refreshUsersBtn")?.addEventListener("click", loadUsers);

  document.querySelectorAll("[data-report]").forEach(b => b.addEventListener("click", () => {
    currentReportType = b.dataset.report;
    go("reports");
    if ($("reportTitle")) $("reportTitle").textContent = ({driver:"Driver-wise Report",vehicle:"Vehicle-wise Report",fuel:"Fuel Report",efficiency:"Driver-wise Efficiency"})[currentReportType] || "Report";
    renderReport();
  }));
  $("applyReport")?.addEventListener("click", renderReport);
  $("dashSearch")?.addEventListener("input", filterDashboardTrips);
  $("dashStatus")?.addEventListener("change", filterDashboardTrips);
  $("tripSearch")?.addEventListener("input", filterTripRegister);

  if (window.lucide) window.lucide.createIcons();
  refreshAdminData();
}

function calculateAdminDistance() {
  const opening = Number($("adminOpeningKm")?.value);
  const closing = Number($("adminClosingKm")?.value);
  if ($("adminDistance")) $("adminDistance").value = closing >= opening && opening >= 0 ? (closing - opening) : "";
}
function addAdminDestinationRow() {
  const box = $("adminDestinations"); if (!box) return;
  const row = document.createElement("div"); row.className = "destination-line";
  row.innerHTML = `<span></span><input placeholder="Additional destination"><button type="button" class="remove-dest">×</button>`;
  box.appendChild(row); renumberAdminDestinations();
}
function renumberAdminDestinations() {
  $("adminDestinations")?.querySelectorAll(".destination-line span").forEach((s,i) => s.textContent = String(i+1));
}
async function saveAdminTrip(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const form = e.currentTarget;
  const vehicleId = $("adminVehicle")?.value;
  const driverUid = $("adminDriverSelect")?.value;
  const vehicle = vehicleData.find(v => v.id === vehicleId);
  const driver = driverData.find(d => d.id === driverUid);
  const opening = Number($("adminOpeningKm")?.value);
  const closing = Number($("adminClosingKm")?.value);
  if (!vehicle || !driver) return toast("Select a valid vehicle and driver.", true);
  if (!Number.isFinite(closing) || closing < opening) return toast("Closing KM cannot be less than Opening KM.", true);
  const get = id => form.querySelector(`#${id}`)?.value?.trim() || "";
  const inputs = [...form.querySelectorAll("input")];
  const dateInput = form.querySelector('input[type="date"]');
  const timeInputs = form.querySelectorAll('input[type="time"]');
  const textareas = form.querySelectorAll("textarea");
  const from = $("adminFrom")?.value || "";
  const to = $("adminTo")?.value || "";
  const purpose = $("adminPurpose")?.value || "";
  const destinations = [...($("adminDestinations")?.querySelectorAll("input") || [])].map(x=>x.value.trim()).filter(Boolean);
  try {
    await addDoc(collection(db, COLLECTION.trips), {
      driverUid, driverName: driver.name, vehicleId, vehicleNo: vehicleNumber(vehicle),
      department: $("adminDepartmentSelect")?.value || "", requestedEmployee: $("adminEmployeeSelect")?.value || "",
      tripDate: dateInput?.value || todayISO(), startTime: timeInputs[0]?.value || "", endTime: timeInputs[1]?.value || "",
      from, to, purpose, destinations, openingKm: opening, closingKm: closing, distanceKm: closing-opening,
      remarks: textareas[0]?.value || "", status:"completed", createdBy:currentUser.uid,
      createdAt:serverTimestamp(), completedAt:serverTimestamp()
    });
    await updateDoc(doc(db, COLLECTION.vehicles, vehicle.id), { currentKm: closing, lastTripClosingKm: closing, lastTripDate: dateInput?.value || todayISO(), updatedAt:serverTimestamp(), updatedBy:currentUser.uid });
    form.reset();
    if ($("adminOpeningKm")) $("adminOpeningKm").value = "";
    if ($("adminDistance")) $("adminDistance").value = "";
    await refreshAdminData();
    toast("Completed trip saved and vehicle KM updated.");
  } catch (error) {
    console.error("ADMIN TRIP SAVE ERROR", error);
    toast(error.message || "Trip could not be saved. Check Firestore rules.", true);
  }
}

/* ---------------- VEHICLE MASTER ---------------- */
async function saveVehicle(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const form = e.currentTarget;
  const button = $("saveVehicleBtn") || form.querySelector('button[type="submit"]');
  setBusy(button, true, "Save Vehicle");
  try {
    const vehicleNo = $("vehicleNumber")?.value.trim().toUpperCase();
    const vehicleType = $("vehicleType")?.value.trim();
    const initialKm = Number($("vehicleInitialKm")?.value);
    const driverUid = $("vehicleAssignedDriver")?.value || "";
    const driver = driverData.find(d => d.id === driverUid);
    if (!vehicleNo || !vehicleType) throw new Error("Vehicle number and type are required.");
    if (!Number.isFinite(initialKm) || initialKm < 0) throw new Error("Enter a valid initial KM reading.");
    if (vehicleData.some(v => normaliseVehicle(vehicleNumber(v)) === normaliseVehicle(vehicleNo))) throw new Error("This vehicle number is already registered.");
    const status = $("vehicleStatus")?.value || "Active";
    await addDoc(collection(db, COLLECTION.vehicles), {
      vehicleNo, vehicleType, fuelType: $("vehicleFuelType")?.value || "",
      registrationDate: $("vehicleRegistrationDate")?.value || "",
      department: $("vehicleDepartment")?.value || "Common Pool",
      initialKm, currentKm: initialKm,
      assignedDriverUid: driverUid, assignedDriverName: driver?.name || "",
      status, active: status.toLowerCase() === "active",
      remarks: $("vehicleRemarks")?.value.trim() || "",
      createdAt:serverTimestamp(), createdBy:currentUser.uid
    });
    form.reset();
    message("vehicleMessage", "Vehicle registered successfully.");
    await refreshAdminData();
    toast("Vehicle saved successfully.");
  } catch (error) {
    console.error("VEHICLE SAVE ERROR", error);
    message("vehicleMessage", error.message || "Vehicle registration failed.", true);
  } finally { setBusy(button, false, "Save Vehicle"); }
}
function downloadVehicleTemplate(e) {
  e?.preventDefault();
  const rows = [
    ["Vehicle No","Vehicle Type","Initial KM","Fuel Type","Registration Date","Department","Status","Driver UID","Remarks"],
    ["KL-08-AB-1234","Car",12500,"Diesel","2026-01-15","Operations","Active","","Example row"]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{wch:20},{wch:18},{wch:14},{wch:14},{wch:18},{wch:18},{wch:12},{wch:34},{wch:28}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Vehicles");
  XLSX.writeFile(wb, "MAFARM_Vehicle_Master_Template.xlsx");
}
async function previewVehicleFile() {
  try {
    const file = $("vehicleBulkFile")?.files?.[0];
    if (!file) throw new Error("Choose an Excel or CSV file first.");
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx","xls","csv"].includes(ext)) throw new Error("Only XLSX, XLS and CSV files are supported.");
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, {type:"array"});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, {defval:""});
    if (!raw.length) throw new Error("No vehicle rows found in the first worksheet.");
    vehicleImportRows = raw.map(row => {
      const find = (...names) => {
        const key = Object.keys(row).find(k => names.some(n => k.trim().toLowerCase() === n.toLowerCase()));
        return key === undefined ? "" : row[key];
      };
      return {
        vehicleNo:String(find("Vehicle No","Vehicle Number","vehicleNo","vehicleNumber")).trim().toUpperCase(),
        vehicleType:String(find("Vehicle Type","Type","vehicleType")).trim(),
        initialKm:Number(find("Initial KM","InitialKm","KM","Odometer")),
        fuelType:String(find("Fuel Type","fuelType")).trim(),
        registrationDate:String(find("Registration Date","registrationDate")).trim(),
        department:String(find("Department","Assigned Department","department")).trim() || "Common Pool",
        status:String(find("Status","Vehicle Status","status")).trim() || "Active",
        driverUid:String(find("Driver UID","Driver ID","driverUid")).trim(),
        remarks:String(find("Remarks","remarks")).trim()
      };
    });
    renderVehicleImportPreview();
  } catch (error) {
    console.error("VEHICLE FILE PREVIEW ERROR", error);
    message("vehicleBulkMessage", error.message || "Unable to read file.", true);
    if ($("importVehiclesBtn")) $("importVehiclesBtn").disabled = true;
  }
}
function validateVehicleImportRows() {
  const seen = new Set();
  return vehicleImportRows.map((row,index) => {
    const key = normaliseVehicle(row.vehicleNo);
    let error = "";
    if (!key) error = "Vehicle number missing";
    else if (seen.has(key)) error = "Duplicate in uploaded file";
    else if (vehicleData.some(v => normaliseVehicle(vehicleNumber(v)) === key)) error = "Already registered";
    else if (!row.vehicleType) error = "Vehicle type missing";
    else if (!Number.isFinite(row.initialKm) || row.initialKm < 0) error = "Invalid initial KM";
    else if (row.driverUid && !driverData.some(d => d.id === row.driverUid)) error = "Driver UID not found";
    if (key) seen.add(key);
    return {...row, rowNumber:index+2, error};
  });
}
function renderVehicleImportPreview() {
  const box = $("vehicleUploadPreview"); if (!box) return;
  const rows = validateVehicleImportRows();
  const valid = rows.filter(r => !r.error).length;
  box.innerHTML = `<div class="import-summary"><b>${rows.length}</b> rows · <b>${valid}</b> valid · <b>${rows.length-valid}</b> need correction</div>
    <div class="table-scroll"><table><thead><tr><th>Excel Row</th><th>Vehicle No</th><th>Type</th><th>Initial KM</th><th>Department</th><th>Driver UID</th><th>Validation</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${r.rowNumber}</td><td>${esc(r.vehicleNo)}</td><td>${esc(r.vehicleType)}</td><td>${esc(r.initialKm)}</td><td>${esc(r.department)}</td><td>${esc(r.driverUid || "—")}</td><td class="${r.error?"validation-error":"validation-ok"}">${esc(r.error || "Valid")}</td></tr>`).join("")}</tbody></table></div>`;
  if ($("importVehiclesBtn")) $("importVehiclesBtn").disabled = valid === 0;
  message("vehicleBulkMessage", `${valid} valid vehicle records ready for import.`, valid === 0);
}
async function importVehicleFile() {
  if (!isAdmin()) return;
  const button = $("importVehiclesBtn");
  const rows = validateVehicleImportRows();
  const validRows = rows.filter(r => !r.error);
  if (!validRows.length) return message("vehicleBulkMessage", "No valid records to import.", true);
  button.disabled = true; button.textContent = "Importing…";
  let imported = 0; const errors = [];
  try {
    // Firestore writes are performed sequentially to identify any failed row clearly.
    for (const row of validRows) {
      try {
        const driver = driverData.find(d => d.id === row.driverUid);
        const status = row.status || "Active";
        await addDoc(collection(db, COLLECTION.vehicles), {
          vehicleNo:row.vehicleNo, vehicleType:row.vehicleType,
          initialKm:row.initialKm, currentKm:row.initialKm,
          fuelType:row.fuelType, registrationDate:row.registrationDate,
          department:row.department, status,
          active:status.toLowerCase() === "active",
          assignedDriverUid:row.driverUid || "", assignedDriverName:driver?.name || "",
          remarks:row.remarks, createdAt:serverTimestamp(), createdBy:currentUser.uid
        });
        imported++;
      } catch (error) {
        console.error("Vehicle import row failed", row, error);
        errors.push(`${row.vehicleNo}: ${error.message}`);
      }
    }
    await refreshAdminData();
    message("vehicleBulkMessage", `Import completed: ${imported} saved; ${validRows.length-imported} failed.`, imported === 0);
    if (imported) {
      vehicleImportRows = [];
      if ($("vehicleUploadPreview")) $("vehicleUploadPreview").innerHTML = "";
      if ($("vehicleBulkFile")) $("vehicleBulkFile").value = "";
    }
    if (errors.length) console.error("Bulk import failures", errors);
    toast(`Vehicle import completed. ${imported} records saved.`);
  } finally {
    button.disabled = true; button.textContent = "Import Vehicles";
  }
}
function vehicleStatusLabel(v) {
  const raw = String(val(v, ["status", "Status"], "")).trim();
  if (/maintenance|repair|service/i.test(raw)) return "Under Maintenance";
  if (/inactive/i.test(raw)) return "Inactive";
  return activeRecord(v) ? "Active" : "Inactive";
}
function renderVehicleRegister() {
  const tbody = $("vehicleTableBody"); if (!tbody) return;
  const active = vehicleData.filter(v => vehicleStatusLabel(v) === "Active").length;
  const maintenance = vehicleData.filter(v => vehicleStatusLabel(v) === "Under Maintenance").length;
  const inactive = vehicleData.filter(v => vehicleStatusLabel(v) === "Inactive").length;
  if ($("vehicleTotal")) $("vehicleTotal").textContent = vehicleData.length;
  if ($("vehicleActive")) $("vehicleActive").textContent = active;
  if ($("vehicleInactive")) $("vehicleInactive").textContent = inactive + maintenance;
  tbody.innerHTML = vehicleData.length ? [...vehicleData].sort((a,b)=>vehicleNumber(a).localeCompare(vehicleNumber(b))).map(v => {
    const status = vehicleStatusLabel(v);
    return `<tr data-status="${esc(status)}">
      <td><b>${esc(vehicleNumber(v))}</b></td><td>${esc(val(v,["vehicleType","type"],"—"))}</td>
      <td>${Number(val(v,["initialKm","InitialKM"],0)).toLocaleString("en-IN")}</td>
      <td><b>${vehicleCurrentKm(v).toLocaleString("en-IN")}</b></td>
      <td>${esc(val(v,["assignedDriverName"],"Unassigned") || "Unassigned")}</td>
      <td>${esc(val(v,["department","Department"],"Common Pool"))}</td>
      <td><span class="pill ${status==="Active"?"completed":"progress"}">${esc(status)}</span></td>
      <td><div class="vehicle-actions"><button type="button" class="vehicle-edit-btn" data-vehicle-edit="${esc(v.id)}">Edit</button><button type="button" class="vehicle-delete-btn" data-vehicle-delete="${esc(v.id)}">Delete</button></div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-cell">No vehicles registered yet. Add a vehicle or import an Excel file.</td></tr>`;
  filterVehicleRows();
}
function filterVehicleRows() {
  const q = ($("vehicleSearch")?.value || "").toLowerCase();
  const status = $("vehicleStatusFilter")?.value || "";
  document.querySelectorAll("#vehicleTableBody tr").forEach(row => {
    row.hidden = !row.textContent.toLowerCase().includes(q) || (status && row.dataset.status !== status);
  });
}

/* ---------------- ADMIN DATA / TABLES ---------------- */
async function refreshAdminData() {
  if (!currentUser || !isAdmin()) return;
  const names = [COLLECTION.trips,COLLECTION.vehicles,COLLECTION.employees,COLLECTION.users,COLLECTION.fuel];
  const results = {};
  for (const name of names) {
    try { results[name] = await readCollection(name); console.log("SUCCESS:",name,results[name].length,"records"); }
    catch (error) { results[name] = []; console.error("FAILED COLLECTION:",name,error.code,error.message); }
  }
  tripData = results.Trips; vehicleData = results.Vehicles; employeeData = results.Employees; userData = results.User; fuelData = results.Fuel;
  driverData = userData.filter(u => String(val(u,["Role","role"],"")).toLowerCase() === "driver" && activeRecord(u)).map(u => ({...u,name:val(u,["Name","name","employeeName"],"Driver")}));
  populateCommonSelects();
  renderVehicleRegister(); renderEmployeeTable(); renderDriverTable(); renderUserTable(); renderTripTables(); renderFuelTable(); updateDashboardKpis();
}

async function saveManagedUser(event) {
  event.preventDefault();
  if (!currentUser || !isAdmin()) return message("managedUserMessage", "Only an administrator can add user profiles.", true);
  const uid = $("newUserUid")?.value.trim();
  const userId = $("newUserId")?.value.trim();
  const name = $("newUserName")?.value.trim();
  const role = $("newUserRole")?.value;
  const email = $("newUserEmail")?.value.trim().toLowerCase();
  const department = $("newUserDepartment")?.value || "";
  if (!uid || !userId || !name || !role || !email) return message("managedUserMessage", "Please complete all required fields.", true);
  const button = $("createManagedUserBtn");
  setBusy(button, true, "Save Employee Profile");
  try {
    const profileRef = doc(db, COLLECTION.users, uid);
    const existing = await getDoc(profileRef);
    if (existing.exists()) throw new Error("A User profile already exists for this Authentication UID.");
    const profile = {
      "Name": name,
      "User ID": userId,
      "Mail ID": email,
      "Login Alias": loginAliasFromUserId(userId),
      "Role": role,
      "Department": department,
      "Active": true,
      "Mobile": $("newUserMobile")?.value.trim() || "",
      "Driver ID": $("newUserDriverId")?.value.trim() || "",
      "Assigned Vehicle": $("newUserVehicle")?.value.trim().toUpperCase() || "",
      "Auth UID": uid,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      updatedAt: serverTimestamp()
    };
    await setDoc(profileRef, profile);
    message("managedUserMessage", "Employee profile saved successfully. The employee can now sign in with the Firebase Authentication email and password.");
    $("managedUserForm").reset();
    await refreshAdminData();
  } catch (error) {
    console.error("User profile save failed:", error);
    message("managedUserMessage", error.message || "Could not save employee profile. Check Firestore rules and the Authentication UID.", true);
  } finally {
    setBusy(button, false, "Save Employee Profile");
  }
}

async function loadUsers() { await refreshAdminData(); toast("User list refreshed."); }
function renderUserTable() {
  const body = $("managedUsersBody"); if (!body) return;
  body.innerHTML = userData.length ? userData.map(u=>`<tr><td>${esc(val(u,["User ID","userId"],""))}</td><td>${esc(val(u,["Name","name","employeeName"],""))}</td><td>${esc(val(u,["Mail ID","email","mailId"],""))}</td><td>${esc(val(u,["Role","role"],""))}</td><td>${activeRecord(u)?"Active":"Inactive"}</td><td><button type="button" class="row-delete-btn" data-delete-kind="driver" data-delete-id="${esc(u.id)}">Delete</button></td></tr>`).join("") : `<tr><td colspan="6">No user records found.</td></tr>`;
}
function renderEmployeeTable() {
  const body = $("employeeTableBody"); if (!body) return;
  body.innerHTML = employeeData.length ? employeeData.map(e=>`<tr><td>${esc(val(e,["employeeId","Employee ID"],e.id))}</td><td>${esc(val(e,["name","Name","employeeName"],""))}</td><td>${esc(val(e,["department","Department"],""))}</td><td>${activeRecord(e)?"Active":"Inactive"}</td><td><button type="button" class="row-delete-btn" data-delete-kind="employee" data-delete-id="${esc(e.id)}">Delete</button></td></tr>`).join("") : `<tr><td colspan="5">No employee records found.</td></tr>`;
}
function renderDriverTable() {
  const body = $("driverTableBody"); if (!body) return;
  body.innerHTML = driverData.length ? driverData.map(d=>`<tr><td>${esc(val(d,["Driver ID","driverId","User ID","userId"],d.id))}</td><td>${esc(d.name)}</td><td>${esc(val(d,["Mobile","mobile","mobileNumber"],""))}</td><td>Active</td><td><button type="button" class="row-delete-btn" data-delete-kind="driver" data-delete-id="${esc(d.id)}">Delete</button></td></tr>`).join("") : `<tr><td colspan="5">No driver profiles found.</td></tr>`;
}

function tripDestinationText(trip) {
  const parts = [];
  const add = value => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === "object") {
      const textValue = value.name || value.place || value.location || value.destination || value.address;
      if (textValue) parts.push(String(textValue).trim());
    } else if (value !== undefined && value !== null && String(value).trim()) {
      parts.push(String(value).trim());
    }
  };
  // Driver trip start destinations and destinations added at completion
  // are stored in different fields in this application.
  add(trip.destinations);
  add(trip.additionalDestinations);
  add(trip.destination);
  add(trip.to);
  return [...new Set(parts.filter(Boolean))].join(", ");
}

function requestedEmployeeDisplay(value) {
  const id = String(value ?? "");
  const matched = employeeData.find(e =>
    e.id === id ||
    String(val(e, ["employeeId", "Employee ID", "User ID", "userId"], "")) === id
  );
  return matched ? String(val(matched, ["name", "Name", "employeeName"], id)) : id;
}

function exportTripRegisterExcel() {
  if (!isAdmin()) return toast("Only Admin can export the trip register.", true);
  const rows = [...tripData]
    .sort((a,b) => String(a.tripDate || "").localeCompare(String(b.tripDate || "")))
    .map(t => ({
      "Trip ID": t.id,
      "Date": t.tripDate || "",
      "Vehicle": t.vehicleNo || "",
      "Driver": t.driverName || "",
      "Department": t.department || "",
      "From": t.from || "",
      "Additional Places / Destination": tripDestinationText(t),
      "Purpose": t.purpose || "",
      "Requested Employee": (() => {
        const requestedId = String(t.requestedEmployee || "");
        const matched = employeeData.find(e =>
          e.id === requestedId ||
          String(val(e, ["employeeId", "Employee ID", "User ID", "userId"], "")) === requestedId
        );
        return matched
          ? String(val(matched, ["name", "Name", "employeeName"], requestedId))
          : requestedId;
      })(),
      "Start Time": t.startTime || "",
      "End Time": t.endTime || "",
      "Opening KM": t.openingKm ?? "",
      "Closing KM": t.closingKm ?? "",
      "Distance KM": t.distanceKm ?? "",
      "Status": t.status || "",
      "Remarks": t.remarks || ""
    }));
  if (!rows.length) return toast("No trip records available to export.", true);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = Object.keys(rows[0]).map(key => ({
    wch: Math.max(14, Math.min(34, key.length + 5))
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Trip Register");
  XLSX.writeFile(workbook, `MAFARM_Trip_Register_${todayISO()}.xlsx`);
  toast("Trip Register Excel downloaded.");
}

function renderTripTables() {
  const sorted = [...tripData].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const latest = $("latestTrips");
  if (latest) latest.innerHTML = sorted.slice(0,12).map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.tripDate||"")}</td><td>${esc(t.vehicleNo||"")}</td><td>${esc(t.driverName||"")}</td><td>${esc(t.from||"")}</td><td>${esc(tripDestinationText(t))}</td><td>${esc(t.openingKm??"")}</td><td>${esc(t.closingKm??"—")}</td><td>${esc(t.distanceKm??"—")}</td><td><span class="pill ${t.status==="completed"?"completed":"progress"}">${esc(t.status||"")}</span></td></tr>`).join("") || `<tr><td colspan="10">No trip records found.</td></tr>`;
  const body = $("tripRegisterBody");
  if (body) body.innerHTML = sorted.map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.tripDate||"")}</td><td>${esc(t.vehicleNo||"")}</td><td>${esc(t.driverName||"")}</td><td>${esc(t.department||"")}</td><td>${esc(t.from||"")}</td><td>${esc(tripDestinationText(t))}</td><td>${esc(t.openingKm??"")}</td><td>${esc(t.closingKm??"—")}</td><td>${esc(t.distanceKm??"—")}</td><td>${esc(t.status||"")}</td><td><button type="button" class="row-delete-btn" data-delete-kind="trip" data-delete-id="${esc(t.id)}">Delete</button></td></tr>`).join("") || `<tr><td colspan="12">No trip records found.</td></tr>`;
}
function renderFuelTable() {
  const sortedFuel = [...fuelData].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const recentBody = $("fuelRecentBody");
  if (recentBody) recentBody.innerHTML = sortedFuel.slice(0,8).map(f=>`<tr><td>${esc(f.fuelDate||f.date||"")}</td><td>${esc(f.vehicleNo||"")}</td><td>${esc(f.km??f.odometerKm??"")}</td><td>${esc(f.litres??"")}</td><td>${esc(f.amount??"")}</td></tr>`).join("") || `<tr><td colspan="5">No fuel entries found.</td></tr>`;
  const body = $("fuelRegisterBody"); if (!body) return;
  body.innerHTML = sortedFuel.map((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).map(f=>`<tr><td>${esc(f.fuelDate||f.date||"")}</td><td>${esc(f.vehicleNo||"")}</td><td>${esc(f.driverName||"")}</td><td>${esc(f.km??f.odometerKm??"")}</td><td>${esc(f.litres??"")}</td><td>${esc(f.amount??"")}</td><td>${esc(f.station||"")}</td><td>${esc(f.billNo||"")}</td></tr>`).join("") || `<tr><td colspan="8">No fuel records found.</td></tr>`;
}
function updateDashboardKpis() {
  const today = todayISO();
  const todayTrips = tripData.filter(t => String(t.tripDate || "").slice(0,10) === today);
  const todayFuel = fuelData.filter(f => String(f.fuelDate || f.date || "").slice(0,10) === today);
  const activeVehicles = vehicleData.filter(activeRecord);
  const activeDrivers = driverData.filter(activeRecord);
  const activeEmployees = employeeData.filter(activeRecord);
  const maintenanceVehicles = vehicleData.filter(v => {
    const status = String(val(v, ["status","Status","availability","Availability"], "")).toLowerCase();
    return status.includes("maintenance") || status.includes("repair") || status.includes("service");
  });

  const kmToday = todayTrips.reduce((sum,t) => sum + Number(t.distanceKm || (Number(t.closingKm)-Number(t.openingKm)) || 0), 0);
  const litresToday = todayFuel.reduce((sum,f) => sum + Number(f.litres || f.quantity || 0), 0);
  const efficiency = litresToday > 0 ? kmToday / litresToday : 0;

  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  set("kpiTrips", todayTrips.length);
  set("kpiKmToday", kmToday.toLocaleString("en-IN", {maximumFractionDigits:1}));
  set("kpiFuelToday", litresToday.toFixed(2));
  set("kpiEfficiency", efficiency.toFixed(2));
  set("kpiActiveVehicles", activeVehicles.length);
  set("kpiActiveDrivers", activeDrivers.length);

  set("snapTripsProgress", tripData.filter(t => String(t.status || "").toLowerCase() === "active").length);
  set("snapFuelToday", todayFuel.length);
  set("snapEmployees", activeEmployees.length);
  set("snapMaintenance", maintenanceVehicles.length);

  const active = $("availabilityActive");
  const maintenance = $("availabilityMaintenance");
  const idle = $("availabilityIdle");
  if (active) active.textContent = activeVehicles.length - maintenanceVehicles.length;
  if (maintenance) maintenance.textContent = maintenanceVehicles.length;
  if (idle) idle.textContent = vehicleData.filter(v => activeRecord(v) && !maintenanceVehicles.includes(v)).length;
}

function filterDashboardTrips() {
  const q = ($("dashSearch")?.value||"").toLowerCase(); const status = ($("dashStatus")?.value||"").toLowerCase();
  document.querySelectorAll("#latestTrips tr").forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(q)||(status&&!row.textContent.toLowerCase().includes(status));});
}
function filterTripRegister() {
  const q = ($("tripSearch")?.value||"").toLowerCase();
  document.querySelectorAll("#tripRegisterBody tr").forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(q));
}

/* ---------------- EMPLOYEE MASTER ---------------- */
async function saveEmployee(e) {
  e.preventDefault(); if (!isAdmin()) return;
  const form=e.currentTarget; const fields=form.querySelectorAll("input,select");
  const employeeId=fields[0]?.value.trim(); const name=fields[1]?.value.trim(); const department=fields[2]?.value||"";
  if (!employeeId||!name||!department) return toast("Enter Employee ID, name and department.",true);
  if (employeeData.some(x=>String(val(x,["employeeId","Employee ID"],"")).toLowerCase()===employeeId.toLowerCase())) return toast("Employee ID already exists.",true);
  try {
    await addDoc(collection(db,COLLECTION.employees),{employeeId,name,department,designation:fields[3]?.value||"",mobile:fields[4]?.value||"",email:fields[5]?.value||"",active:(fields[6]?.value||"Active")==="Active",createdAt:serverTimestamp(),createdBy:currentUser.uid});
    form.reset(); await refreshAdminData(); toast("Employee saved successfully.");
  } catch(error) { console.error(error); toast(error.message||"Employee save failed.",true); }
}

/* ---------------- ADMIN FUEL ENTRY ---------------- */
async function saveAdminFuel(e) {
  e.preventDefault(); if (!isAdmin()) return;
  const form=e.currentTarget; const selects=form.querySelectorAll("select"); const dates=form.querySelectorAll('input[type="date"]'); const numbers=form.querySelectorAll('input[type="number"]');
  const vehicleId=selects[0]?.value||""; const driverUid=selects[1]?.value||"";
  const vehicle=vehicleData.find(v=>v.id===vehicleId); const driver=driverData.find(d=>d.id===driverUid);
  const date=dates[0]?.value||todayISO(); const km=Number(numbers[0]?.value); const litres=Number(numbers[1]?.value); const amount=Number(numbers[2]?.value);
  if (!vehicle||!driver||!litres||litres<=0||!Number.isFinite(km)||km<0||amount<0) return toast("Complete all required fuel details.",true);
  try {
    await addDoc(collection(db,COLLECTION.fuel),{vehicleId,vehicleNo:vehicleNumber(vehicle),driverUid,driverName:driver.name,fuelDate:date,fuelTime:form.querySelector('input[type="time"]')?.value||"",km,litres,amount,rate:litres?amount/litres:0,station:form.querySelectorAll('input')[4]?.value||"",billNo:form.querySelectorAll('input')[5]?.value||"",remarks:form.querySelector("textarea")?.value||"",enteredBy:currentUser.uid,createdAt:serverTimestamp()});
    form.reset(); await refreshAdminData(); toast("Fuel entry saved.");
  } catch(error) { console.error(error); toast(error.message||"Fuel entry failed.",true); }
}

/* ---------------- REPORTS ---------------- */
function renderReport() {
  const box=document.querySelector(".report-result .empty-report"); if (!box) return;
  const from=document.querySelector(".report-filters input[type=date]")?.value||"";
  const to=document.querySelectorAll(".report-filters input[type=date]")[1]?.value||"";
  let trips=tripData.filter(t=>(!from||t.tripDate>=from)&&(!to||t.tripDate<=to));
  let title="Report Preview", rows=[];
  if (currentReportType==="driver") { title="Driver-wise Report"; rows=trips.map(t=>({Driver:t.driverName,Vehicle:t.vehicleNo,Date:t.tripDate,KM:t.distanceKm||0,Status:t.status})); }
  else if (currentReportType==="vehicle") { title="Vehicle-wise Report"; rows=trips.map(t=>({Vehicle:t.vehicleNo,Date:t.tripDate,Driver:t.driverName,OpeningKM:t.openingKm,ClosingKM:t.closingKm,Distance:t.distanceKm})); }
  else if (currentReportType==="fuel") { title="Fuel Report"; rows=fuelData.filter(f=>(!from||(f.fuelDate||f.date)>=from)&&(!to||(f.fuelDate||f.date)<=to)).map(f=>({Date:f.fuelDate||f.date,Vehicle:f.vehicleNo,Driver:f.driverName,Litres:f.litres,Amount:f.amount,KM:f.km??f.odometerKm})); }
  else if (currentReportType==="efficiency") { title="Driver-wise Efficiency"; rows=trips.map(t=>({Driver:t.driverName,Vehicle:t.vehicleNo,DistanceKM:t.distanceKm||0})); }
  if ($("reportTitle")) $("reportTitle").textContent=title;
  if (!currentReportType) { box.innerHTML="<i data-lucide=\"chart-no-axes-combined\"></i><b>Select a report above</b><small>Choose a report to view Firestore data.</small>"; return; }
  box.innerHTML=rows.length?`<div class="table-scroll"><table><thead><tr>${Object.keys(rows[0]).map(k=>`<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${Object.values(r).map(v=>`<td>${esc(v??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div><button type="button" class="btn light" id="exportReportBtn">Export Excel</button>`:`<b>No records found for this report.</b>`;
  $("exportReportBtn")?.addEventListener("click",()=>{const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Report");XLSX.writeFile(wb,`${currentReportType}_report.xlsx`);});
}

/* ---------------- DRIVER WORKSPACE ---------------- */
async function initDriverUI() {
  if (driverInitialised) return;
  driverInitialised = true;
  const user=auth.currentUser;
  if (!user) return;
  try {
    const profileSnap=await getDoc(doc(db,COLLECTION.users,user.uid));
    if (!profileSnap.exists()) throw new Error("Driver profile not found.");
    currentProfile=profileSnap.data(); currentUser=user;
    if (!isDriver()||!profileActive(currentProfile)) throw new Error("Driver access is inactive or not permitted.");
    const name=profileName();
    if ($("driverName")) $("driverName").value=name;
    if ($("fuelDriver")) $("fuelDriver").value=name;
    if ($("loggedUser")) $("loggedUser").textContent=name;
    $("appPage")?.classList.remove("hidden");
    document.querySelectorAll('#driverWorkspace input[type="date"]').forEach(x=>{if(!x.value)x.value=todayISO();});
    await loadDriverLists();
    await loadActiveTrip();
    bindDriverEvents();
  } catch(error) { console.error("DRIVER INIT ERROR",error); alert(error.message); await signOut(auth); }
}
async function loadDriverLists() {
  vehicleData=await readCollection(COLLECTION.vehicles);
  employeeData=await readCollection(COLLECTION.employees);
  // Drivers see assigned vehicles plus vehicles not assigned to another driver.
  const allowed=vehicleData.filter(v=>activeRecord(v)&&(!val(v,["assignedDriverUid"],"")||v.assignedDriverUid===currentUser.uid));
  setupVehicleSearch("driverVehicleSearch","driverVehicleOptions","vehicle",allowed,v=>vehicleNumber(v),v=>{
    if ($("openingKm")) $("openingKm").value = v ? vehicleCurrentKm(v) : "";
  });
  fillSelect("fuelVehicle",allowed,v=>v.id,v=>vehicleNumber(v));
  fillSelect("requestedEmployee",employeeData.filter(activeRecord),e=>e.id,e=>`${val(e,["name","Name","employeeName"],e.id)} (${val(e,["employeeId"],e.id)})`,"Select employee");
}
async function loadActiveTrip() {
  const q=query(collection(db,COLLECTION.trips),where("driverUid","==",currentUser.uid),where("status","==","active"),limit(1));
  const snap=await getDocs(q);
  if (snap.empty) { activeTripId=null; activeTripData=null; $("activeTrip")?.classList.add("hidden"); $("tripForm")?.classList.remove("hidden"); return; }
  const d=snap.docs[0]; activeTripId=d.id; activeTripData={id:d.id,...d.data()};
  $("tripForm")?.classList.add("hidden"); $("activeTrip")?.classList.remove("hidden");
  if ($("tripNumber")) $("tripNumber").textContent=d.id;
  if ($("activeSummary")) $("activeSummary").innerHTML=`<div class="summary-item"><small>Vehicle</small><strong>${esc(activeTripData.vehicleNo)}</strong></div><div class="summary-item"><small>From</small><strong>${esc(activeTripData.from||"")}</strong></div><div class="summary-item"><small>Opening KM</small><strong>${esc(activeTripData.openingKm)}</strong></div><div class="summary-item"><small>Destination</small><strong>${esc((activeTripData.destinations||[]).join(", "))}</strong></div>`;
}
function bindDriverEvents() {

  $("requestedEmployee")?.addEventListener("change",()=>{
    const manual=$("requestedEmployee").value==="manual";
    $("manualEmployeeWrap")?.classList.toggle("hidden",!manual);
    if ($("manualEmployee")) $("manualEmployee").required=manual;
  });
  $("addDestination")?.addEventListener("click",()=>addDriverDestination("destinationList"));
  $("addClosingDestination")?.addEventListener("click",()=>addDriverDestination("closingDestinationList"));
  ["destinationList","closingDestinationList"].forEach(id=>$(id)?.addEventListener("click",e=>{if(e.target.classList.contains("remove-destination"))e.target.closest(".destination-row")?.remove();renumberDriverDestinations(id);}));
  $("tripForm")?.addEventListener("submit",startDriverTrip);
  $("endTripForm")?.addEventListener("submit",completeDriverTrip);
  $("fuelForm")?.addEventListener("submit",saveDriverFuel);
  document.querySelectorAll("#driverWorkspace .nav[data-view]").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll("#driverWorkspace .nav").forEach(x=>x.classList.toggle("active",x===b));
    document.querySelectorAll("#driverWorkspace .view").forEach(x=>x.classList.add("hidden"));
    $(b.dataset.view)?.classList.remove("hidden");
    if ($("welcomeTitle")) $("welcomeTitle").textContent=b.dataset.view==="fuelView"?"Fuel Entry":"Trip Entry";
  }));
}
function addDriverDestination(containerId) {
  const box=$(containerId); if(!box)return;
  const row=document.createElement("div"); row.className="destination-row";
  const number=document.createElement("span");number.className="destination-number";number.textContent=String(box.children.length+1);
  const input=document.createElement("input");input.placeholder="Enter destination";input.required=containerId==="destinationList";
  const remove=document.createElement("button");remove.type="button";remove.className="remove-destination";remove.textContent="×";
  row.append(number,input,remove);box.appendChild(row);
}
function renumberDriverDestinations(id){$(id)?.querySelectorAll(".destination-number").forEach((x,i)=>x.textContent=String(i+1));}
function getDriverDestinations(id){return [...($(id)?.querySelectorAll("input")||[])].map(x=>x.value.trim()).filter(Boolean);}
async function startDriverTrip(e) {
  e.preventDefault(); if(!isDriver())return;
  try {
    const vehicle=vehicleData.find(v=>v.id===$("vehicle").value);
    const opening=Number($("openingKm").value);
    const destinations=getDriverDestinations("destinationList");
    const from=$("driverFrom")?.value.trim() || "";
    if(!from)throw new Error("Enter the starting location.");
    if(!vehicle)throw new Error("Select an authorised vehicle.");
    if(!Number.isFinite(opening)||opening<0)throw new Error("Vehicle current KM is not valid.");
    if(!destinations.length)throw new Error("Enter at least one destination.");
    const activeQ=query(collection(db,COLLECTION.trips),where("driverUid","==",currentUser.uid),where("status","==","active"),limit(1));
    const existing=await getDocs(activeQ); if(!existing.empty)throw new Error("You already have an active trip.");
    const requested=$("requestedEmployee").value==="manual"?$("manualEmployee").value.trim():$("requestedEmployee").value;
    const ref=await addDoc(collection(db,COLLECTION.trips),{
      driverUid:currentUser.uid,driverName:profileName(),vehicleId:vehicle.id,vehicleNo:vehicleNumber(vehicle),openingKm:opening,
      department:$("department").value,requestedEmployee:requested,purpose:$("purpose").value.trim(),tripDate:$("tripDate").value||todayISO(),
      from,startTime:$("startTime").value,destinations,status:"active",createdAt:serverTimestamp()
    });
    activeTripId=ref.id; activeTripData={id:ref.id,vehicleId:vehicle.id,vehicleNo:vehicleNumber(vehicle),from,openingKm:opening,destinations};
    await loadActiveTrip(); toast("Trip started successfully.");
  } catch(error) { console.error("START TRIP ERROR",error); alert(error.message||"Unable to start trip. Check Firestore rules."); }
}
async function completeDriverTrip(e) {
  e.preventDefault(); if(!activeTripId||!activeTripData)return alert("No active trip found.");
  const closing=Number($("closingKm").value); const opening=Number(activeTripData.openingKm);
  if(!Number.isFinite(closing)||closing<opening)return alert("Closing KM cannot be less than Opening KM.");
  try {
    const tripRef=doc(db,COLLECTION.trips,activeTripId);
    await updateDoc(tripRef,{
      closingKm:closing,endTime:$("endTime").value,remarks:$("remarks").value||"",
      additionalDestinations:getDriverDestinations("closingDestinationList"),distanceKm:closing-opening,
      status:"completed",completedAt:serverTimestamp()
    });
    // Trip completion is saved first. Vehicle KM is a separate protected update.
    const vehicle=vehicleData.find(v=>v.id===activeTripData.vehicleId||normaliseVehicle(vehicleNumber(v))===normaliseVehicle(activeTripData.vehicleNo));
    let kmUpdated=false;
    if(vehicle && vehicle.assignedDriverUid===currentUser.uid) {
      try {
        await updateDoc(doc(db,COLLECTION.vehicles,vehicle.id),{currentKm:closing,lastClosingKm:closing,lastTripDate:todayISO(),updatedAt:serverTimestamp()});
        kmUpdated=true;
      } catch(kmError) {
        console.error("TRIP SAVED BUT VEHICLE KM UPDATE FAILED",kmError);
      }
    }
    activeTripId=null;activeTripData=null;
    $("endTripForm")?.reset();if($("closingDestinationList"))$("closingDestinationList").innerHTML="";
    await loadDriverLists();await loadActiveTrip();
    alert(kmUpdated?"Trip completed. Vehicle current KM updated.":"Trip was completed and saved. Vehicle current KM was not updated; ask the administrator to reconcile it or check Vehicle update rules.");
  } catch(error) { console.error("COMPLETE TRIP ERROR",error); alert(error.message||"Unable to complete trip. Check Firestore rules."); }
}
async function saveDriverFuel(e) {
  e.preventDefault();
  try {
    const vehicle=vehicleData.find(v=>v.id===$("fuelVehicle").value);
    const litres=Number($("fuelLitres").value),amount=Number($("fuelAmount").value),km=Number($("fuelKm").value);
    if(!vehicle||litres<=0||amount<0||km<0)throw new Error("Enter valid vehicle, litres, amount and KM.");
    await addDoc(collection(db,COLLECTION.fuel),{
      driverUid:currentUser.uid,driverName:profileName(),vehicleId:vehicle.id,vehicleNo:vehicleNumber(vehicle),
      fuelDate:$("fuelDate").value||todayISO(),litres,amount,km,remarks:$("fuelRemarks").value||"",createdAt:serverTimestamp()
    });
    message("fuelMessage","Fuel entry saved successfully.");e.currentTarget.reset();if($("fuelDate"))$("fuelDate").value=todayISO();
  } catch(error) { console.error("DRIVER FUEL ERROR",error);message("fuelMessage",error.message||"Fuel entry failed.",true); }
}

/* ---------------- STARTUP ---------------- */
console.log("MAFARM Vehicle Trip Management loaded.");

/* ---------------- ADMIN DELETE ACTIONS ---------------- */
async function deleteManagedRecord(kind, id) {
  if (!isAdmin()) return toast("Only Admin can delete records.", true);
  const config = {
    employee: { collection: COLLECTION.employees, label: "employee" },
    driver: { collection: COLLECTION.users, label: "driver user profile" },
    trip: { collection: COLLECTION.trips, label: "trip" }
  }[kind];
  if (!config || !id) return;
  const warning = kind === "trip"
    ? "Delete this trip permanently? This will NOT automatically reverse the vehicle current KM."
    : kind === "driver"
      ? "Delete this driver's Firestore User profile? Their Firebase Authentication account will remain and they will no longer pass the active profile check."
      : "Delete this employee record permanently?";
  if (!window.confirm(warning)) return;
  try {
    await deleteDoc(doc(db, config.collection, id));
    toast(`${config.label} deleted successfully.`);
    await refreshAdminData();
  } catch (error) {
    console.error("Delete failed:", error);
    toast(`Could not delete ${config.label}. Check Firestore rules and permissions.`, true);
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-delete-kind][data-delete-id]");
  if (!button) return;
  deleteManagedRecord(button.dataset.deleteKind, button.dataset.deleteId);
});



document.addEventListener("click", event => {
  if (event.target.closest("#exportTripRegisterBtn")) {
    exportTripRegisterExcel();
  }
});


/* ---------------- VEHICLE EDIT / STATUS / DELETE ---------------- */
async function editVehicleRecord(vehicleId) {
  if (!isAdmin()) return toast("Only Admin can edit vehicles.", true);
  const v = vehicleData.find(item => item.id === vehicleId);
  if (!v) return toast("Vehicle record not found. Refresh and try again.", true);

  const oldInitial = Number(val(v, ["initialKm", "InitialKM"], 0));
  const initialInput = window.prompt(`Update initial KM for ${vehicleNumber(v)}:`, String(oldInitial));
  if (initialInput === null) return;
  const initialKm = Number(initialInput);
  if (!Number.isFinite(initialKm) || initialKm < 0) return toast("Enter a valid non-negative initial KM.", true);

  const currentStatus = vehicleStatusLabel(v);
  const statusInput = window.prompt(
    `Enter vehicle status exactly as one of: Active, Under Maintenance, Inactive`,
    currentStatus
  );
  if (statusInput === null) return;
  const statusMap = {
    "active": "Active",
    "under maintenance": "Under Maintenance",
    "maintenance": "Under Maintenance",
    "inactive": "Inactive"
  };
  const status = statusMap[statusInput.trim().toLowerCase()];
  if (!status) return toast("Invalid status. Use Active, Under Maintenance or Inactive.", true);

  try {
    await updateDoc(doc(db, COLLECTION.vehicles, vehicleId), {
      initialKm,
      status,
      active: status === "Active",
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    });
    toast("Vehicle initial KM and status updated.");
    await refreshAdminData();
  } catch (error) {
    console.error("VEHICLE UPDATE ERROR", error);
    toast("Could not update vehicle. Check Firestore update permissions.", true);
  }
}

async function deleteVehicleRecord(vehicleId) {
  if (!isAdmin()) return toast("Only Admin can delete vehicles.", true);
  const v = vehicleData.find(item => item.id === vehicleId);
  if (!v) return toast("Vehicle record not found. Refresh and try again.", true);
  const linkedTrips = tripData.filter(t => t.vehicleId === vehicleId || normaliseVehicle(t.vehicleNo) === normaliseVehicle(vehicleNumber(v)));
  const warning = `Permanently delete vehicle ${vehicleNumber(v)}? ${linkedTrips.length} trip record(s) reference this vehicle. Those trip records will NOT be deleted.`;
  if (!window.confirm(warning)) return;
  try {
    await deleteDoc(doc(db, COLLECTION.vehicles, vehicleId));
    toast("Vehicle deleted. Historical trip records were retained.");
    await refreshAdminData();
  } catch (error) {
    console.error("VEHICLE DELETE ERROR", error);
    toast("Could not delete vehicle. Check Firestore delete permissions.", true);
  }
}

document.addEventListener("click", event => {
  const edit = event.target.closest("[data-vehicle-edit]");
  if (edit) return editVehicleRecord(edit.dataset.vehicleEdit);
  const del = event.target.closest("[data-vehicle-delete]");
  if (del) return deleteVehicleRecord(del.dataset.vehicleDelete);
});
