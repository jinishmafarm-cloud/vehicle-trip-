
/* ============================================================
   MAFARM VEHICLE TRIP MANAGEMENT
   Complete Updated Application
   Firebase SDK 10.14.1
============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  updateDoc,
  limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


/* ============================================================
   1. FIREBASE CONFIGURATION
============================================================ */

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


/* ============================================================
   2. GLOBAL VARIABLES
============================================================ */

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;

let vehicleData = [];
let employeeData = [];
let driverData = [];

let activeTripId = null;
let dashboardLoading = false;

const COLLECTIONS = {
  trips: "Trips",
  vehicles: "Vehicles",
  employees: "Employees",
  users: "User",
  fuel: "Fuel"
};


/* ============================================================
   3. COMMON FUNCTIONS
============================================================ */

function valueOf(obj, keys, fallback = "") {
  for (const key of keys) {
    if (
      obj &&
      obj[key] !== undefined &&
      obj[key] !== null
    ) {
      return obj[key];
    }
  }

  return fallback;
}

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showMessage(id, message, type = "info") {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.className = "message " + type;
}

function setLoading(button, loading, originalText = "Submit") {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading
    ? "Please wait..."
    : originalText;
}

function getToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset();

  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function getProfileName(profile = currentProfile) {
  return valueOf(
    profile,
    ["Name", "name", "employeeName"],
    "User"
  );
}

function getProfileRole(profile = currentProfile) {
  return String(
    valueOf(profile, ["Role", "role"], "")
  ).toLowerCase();
}

function getProfileEmail(profile = currentProfile) {
  return valueOf(
    profile,
    ["Mail ID", "email", "mailId"],
    ""
  );
}

function isAdmin() {
  return getProfileRole() === "admin";
}

function isDriver() {
  return getProfileRole() === "driver";
}

function isActive(profile) {
  return valueOf(
    profile,
    ["Active", "active"],
    false
  ) === true;
}


/* ============================================================
   4. SCREEN MANAGEMENT
============================================================ */

function showLogin() {
  if ($("loginSection")) $("loginSection").hidden = false;
  if ($("adminWorkspace")) $("adminWorkspace").hidden = true;
  if ($("appPage")) $("appPage").hidden = true;
}

function showAdmin() {
  if ($("loginSection")) $("loginSection").hidden = true;
  if ($("adminWorkspace")) $("adminWorkspace").hidden = false;
  if ($("appPage")) $("appPage").hidden = true;
}

function showDriver() {
  if ($("loginSection")) $("loginSection").hidden = true;
  if ($("adminWorkspace")) $("adminWorkspace").hidden = true;
  if ($("appPage")) $("appPage").hidden = false;
}

function openUserWorkspace() {
  if (!currentUser || !currentProfile) return;

  if (isAdmin()) {
    showAdmin();
    loadAdminDashboard();
  } else if (isDriver()) {
    showDriver();
    loadDriverWorkspace();
  } else {
    signOut(auth);
    showLogin();

    showMessage(
      "mainLoginMessage",
      "Your account role is not authorised.",
      "error"
    );
  }
}


/* ============================================================
   5. FIRESTORE DATA FUNCTIONS
============================================================ */

async function getCollectionData(collectionName) {
  const snapshot = await getDocs(
    collection(db, collectionName)
  );

  return snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));
}


/* ============================================================
   6. LOGIN
============================================================ */

function resolveLoginIdentity(identity) {
  const cleaned = identity.trim();

  if (cleaned === "150884") {
    return "operationhead@mafarm.in";
  }

  return cleaned;
}

$("mainLoginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const identity = $("mainIdentity")?.value.trim();
  const password = $("mainPassword")?.value;

  if (!identity || !password) {
    showMessage(
      "mainLoginMessage",
      "Enter User ID / Email and Password.",
      "error"
    );
    return;
  }

  const button = $("mainLoginBtn");
  setLoading(button, true, "Login");

  try {
    const email = resolveLoginIdentity(identity);

    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const profileSnap = await getDoc(
      doc(db, "User", credential.user.uid)
    );

    if (!profileSnap.exists()) {
      await signOut(auth);

      throw new Error(
        "User profile not found. Check the Authentication UID and User document."
      );
    }

    const profile = profileSnap.data();

    if (!isActive(profile)) {
      await signOut(auth);
      throw new Error("Your account is inactive.");
    }

    currentUser = credential.user;
    currentProfile = profile;

    openUserWorkspace();

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    showMessage(
      "mainLoginMessage",
      error.message || "Login failed.",
      "error"
    );

  } finally {
    setLoading(button, false, "Login");
  }
});


/* ============================================================
   7. AUTHENTICATION SESSION
============================================================ */

onAuthStateChanged(auth, async user => {
  if (!user) {
    currentUser = null;
    currentProfile = null;
    activeTripId = null;

    showLogin();
    return;
  }

  try {
    const profileSnap = await getDoc(
      doc(db, "User", user.uid)
    );

    if (!profileSnap.exists()) {
      await signOut(auth);
      showLogin();
      return;
    }

    const profile = profileSnap.data();

    if (!isActive(profile)) {
      await signOut(auth);
      showLogin();
      return;
    }

    currentUser = user;
    currentProfile = profile;

    openUserWorkspace();

  } catch (error) {
    console.error("AUTH SESSION ERROR:", error);
    showLogin();
  }
});


/* ============================================================
   8. LOGOUT
============================================================ */

async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("LOGOUT ERROR:", error);
    alert("Unable to logout. Please try again.");
  }
}

$("adminLogoutBtn")?.addEventListener("click", logoutUser);
$("logoutBtn")?.addEventListener("click", logoutUser);


/* ============================================================
   9. ADMIN NAVIGATION
============================================================ */

function openAdminPage(pageName) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const selectedPage = $("page-" + pageName);

  if (selectedPage) {
    selectedPage.classList.add("active");
  }

  document.querySelectorAll(".nav-link[data-page]").forEach(link => {
    link.classList.toggle(
      "active",
      link.dataset.page === pageName
    );
  });

  $("sidebar")?.classList.remove("open");
}

document.querySelectorAll(".nav-link[data-page]").forEach(link => {
  link.addEventListener("click", () => {
    openAdminPage(link.dataset.page);
  });
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => {
    openAdminPage(button.dataset.go);
  });
});

$("menuToggle")?.addEventListener("click", () => {
  $("sidebar")?.classList.toggle("open");
});


/* ============================================================
   10. SAFE DROPDOWN FUNCTION
============================================================ */

function populateSelect(
  id,
  items,
  valueKey,
  labelKey,
  placeholder
) {
  const select = $(id);

  if (!select || select.tagName !== "SELECT") {
    console.warn(
      "Dropdown missing or not a SELECT element:",
      id
    );
    return;
  }

  if (!Array.isArray(items)) {
    console.warn("Dropdown data is not an array:", id, items);
    items = [];
  }

  const oldValue = select.value;

  select.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = placeholder;

  select.appendChild(defaultOption);

  items.forEach(item => {
    const value = valueOf(item, [valueKey], item.id);

    const label = valueOf(
      item,
      [labelKey, "Name", "name", "employeeName"],
      value
    );

    const option = document.createElement("option");

    option.value = String(value ?? "");
    option.textContent = String(label ?? "");

    select.appendChild(option);
  });

  const options = Array.from(select.querySelectorAll("option"));

  if (options.some(option => option.value === oldValue)) {
    select.value = oldValue;
  }
}


/* ============================================================
   11. DASHBOARD LOADING
============================================================ */

async function loadAdminDashboard() {
  if (dashboardLoading) return;

  dashboardLoading = true;

  console.log("MAFARM Dashboard loading started.");

  const results = {
    Trips: [],
    Vehicles: [],
    Employees: [],
    User: [],
    Fuel: []
  };

  const failedCollections = [];

  try {
    for (const name of Object.values(COLLECTIONS)) {
      try {
        results[name] = await getCollectionData(name);

        console.log(
          "SUCCESS:",
          name,
          results[name].length,
          "records"
        );

      } catch (error) {
        failedCollections.push(name);

        console.error("FAILED COLLECTION:", name);
        console.error("Firebase error code:", error.code);
        console.error("Firebase error message:", error.message);
      }
    }

    vehicleData = results.Vehicles;
    employeeData = results.Employees;

    // Support both capitalised and lowercase profile fields.
    driverData = results.User
      .filter(user =>
        String(
          valueOf(user, ["Role", "role"], "")
        ).toLowerCase() === "driver"
      )
      .map(user => ({
        ...user,
        name: valueOf(
          user,
          ["Name", "name", "employeeName"],
          ""
        ),
        role: valueOf(user, ["Role", "role"], ""),
        email: valueOf(
          user,
          ["Mail ID", "email", "mailId"],
          ""
        )
      }));

    updateDashboard(
      results.Trips,
      results.Vehicles,
      results.Employees,
      results.Fuel
    );

    renderLatestTrips(results.Trips);
    renderTripRegister(results.Trips);
    renderVehicles(results.Vehicles);
    renderEmployees(results.Employees);
    renderManagedUsers(results.User);

    populateAdminDropdowns();

    if (failedCollections.length) {
      alert(
        "Dashboard loaded partially.\n\n" +
        "Failed collections: " +
        failedCollections.join(", ") +
        "\n\nOpen browser Console for details."
      );
    } else {
      console.log("All dashboard collections loaded successfully.");
    }

  } catch (error) {
    console.error("DASHBOARD ERROR:", error);
    alert("Dashboard loading error: " + error.message);

  } finally {
    dashboardLoading = false;
  }
}


/* ============================================================
   12. DASHBOARD COUNTS
============================================================ */

function updateDashboard(trips, vehicles, employees, fuel) {
  const today = getToday();

  const todayTrips = trips.filter(
    trip => trip.tripDate === today
  );

  const activeTrips = trips.filter(
    trip => String(trip.status || "").toLowerCase() === "active"
  );

  const totalFuel = fuel.reduce(
    (sum, item) =>
      sum + Number(
        valueOf(item, ["litres", "fuelLitres"], 0)
      ),
    0
  );

  if ($("totalTrips")) {
    $("totalTrips").textContent = trips.length;
  }

  if ($("todayTrips")) {
    $("todayTrips").textContent = todayTrips.length;
  }

  if ($("activeTrips")) {
    $("activeTrips").textContent = activeTrips.length;
  }

  if ($("totalVehicles")) {
    $("totalVehicles").textContent = vehicles.length;
  }

  if ($("totalEmployees")) {
    $("totalEmployees").textContent = employees.length;
  }

  if ($("totalFuel")) {
    $("totalFuel").textContent = totalFuel.toFixed(2);
  }
}


/* ============================================================
   13. LATEST TRIPS
============================================================ */

function renderLatestTrips(trips) {
  const tbody = $("latestTrips");
  if (!tbody) return;

  const latest = [...trips].reverse().slice(0, 10);

  tbody.innerHTML = latest.map(trip => `
    <tr>
      <td>${safe(trip.tripDate)}</td>
      <td>${safe(trip.driverName)}</td>
      <td>${safe(trip.vehicleNo)}</td>
      <td>${safe(trip.purpose)}</td>
      <td>${safe(trip.status)}</td>
    </tr>
  `).join("");
}


/* ============================================================
   14. TRIP REGISTER
============================================================ */

function renderTripRegister(trips) {
  const tbody = $("tripRegisterBody");
  if (!tbody) return;

  tbody.innerHTML = [...trips].reverse().map(trip => `
    <tr>
      <td>${safe(trip.tripDate)}</td>
      <td>${safe(trip.driverName)}</td>
      <td>${safe(trip.vehicleNo)}</td>
      <td>${safe(trip.openingKm)}</td>
      <td>${safe(trip.closingKm ?? "-")}</td>
      <td>${safe(trip.distanceKm ?? "-")}</td>
      <td>${safe(trip.status)}</td>
    </tr>
  `).join("");
}


/* ============================================================
   15. VEHICLE MANAGEMENT
============================================================ */

function renderVehicles(vehicles) {
  const tbody = $("vehicleTableBody");
  if (!tbody) return;

  tbody.innerHTML = vehicles.map(vehicle => `
    <tr>
      <td>${safe(valueOf(
        vehicle,
        ["vehicleNo", "vehicleNumber", "VehicleNo", "registrationNumber"],
        vehicle.id
      ))}</td>
      <td>${safe(valueOf(
        vehicle,
        ["vehicleType", "type", "Type"],
        "-"
      ))}</td>
      <td>${safe(valueOf(
        vehicle,
        ["currentKm", "lastClosingKm", "initialKm", "InitialKM"],
        0
      ))}</td>
      <td>${valueOf(vehicle, ["active", "Active"], true) === false
        ? "Inactive" : "Active"}</td>
    </tr>
  `).join("");
}

$("vehicleMasterForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isAdmin()) return;

  const button = event.submitter;
  setLoading(button, true, "Save Vehicle");

  try {
    const vehicleNo = $("vehicleNumber")?.value.trim();
    const vehicleType = $("vehicleType")?.value.trim();
    const initialKm = Number($("vehicleInitialKm")?.value || 0);

    if (!vehicleNo) {
      throw new Error("Enter vehicle number.");
    }

    await addDoc(collection(db, "Vehicles"), {
      vehicleNo,
      vehicleType,
      initialKm,
      currentKm: initialKm,
      active: true,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    alert("Vehicle saved successfully.");

    event.target.reset();

    vehicleData = await getCollectionData("Vehicles");

    renderVehicles(vehicleData);
    populateAdminDropdowns();

  } catch (error) {
    console.error("VEHICLE SAVE ERROR:", error);
    alert(error.message || "Vehicle saving failed.");

  } finally {
    setLoading(button, false, "Save Vehicle");
  }
});


/* ============================================================
   16. EMPLOYEE MANAGEMENT
============================================================ */

function renderEmployees(employees) {
  const tbody = $("employeeTableBody");
  if (!tbody) return;

  tbody.innerHTML = employees.map(employee => `
    <tr>
      <td>${safe(valueOf(
        employee,
        ["employeeId", "Employee ID"],
        employee.id
      ))}</td>
      <td>${safe(valueOf(
        employee,
        ["name", "employeeName", "Name"],
        "-"
      ))}</td>
      <td>${safe(valueOf(
        employee,
        ["department", "Department"],
        "-"
      ))}</td>
    </tr>
  `).join("");
}

$("employeeForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isAdmin()) return;

  const button = event.submitter;
  setLoading(button, true, "Save Employee");

  try {
    const employeeId = $("employeeId")?.value.trim();
    const name = $("employeeName")?.value.trim();
    const department = $("employeeDepartment")?.value.trim();

    if (!employeeId || !name) {
      throw new Error("Enter Employee ID and Name.");
    }

    await addDoc(collection(db, "Employees"), {
      employeeId,
      name,
      department,
      active: true,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    alert("Employee saved successfully.");

    event.target.reset();

    employeeData = await getCollectionData("Employees");

    renderEmployees(employeeData);
    populateAdminDropdowns();

  } catch (error) {
    console.error("EMPLOYEE SAVE ERROR:", error);
    alert(error.message || "Employee saving failed.");

  } finally {
    setLoading(button, false, "Save Employee");
  }
});


/* ============================================================
   17. ADMIN DROPDOWNS
============================================================ */

function populateAdminDropdowns() {
  const activeVehicles = vehicleData.filter(vehicle =>
    valueOf(vehicle, ["active", "Active"], true) !== false
  );

  const activeEmployees = employeeData.filter(employee =>
    valueOf(employee, ["active", "Active"], true) !== false
  );

  populateSelect(
    "adminVehicle",
    activeVehicles,
    "vehicleNo",
    "vehicleNo",
    "Select Vehicle"
  );

  populateSelect(
    "adminDriverSelect",
    driverData,
    "id",
    "name",
    "Select Driver"
  );

  populateSelect(
    "adminEmployeeSelect",
    activeEmployees,
    "employeeId",
    "name",
    "Select Employee"
  );

  populateSelect(
    "vehicle",
    activeVehicles,
    "vehicleNo",
    "vehicleNo",
    "Select Vehicle"
  );

  populateSelect(
    "requestedEmployee",
    activeEmployees,
    "employeeId",
    "name",
    "Select Employee"
  );

  populateSelect(
    "fuelVehicle",
    activeVehicles,
    "vehicleNo",
    "vehicleNo",
    "Select Vehicle"
  );

  populateSelect(
    "fuelDriver",
    driverData,
    "id",
    "name",
    "Select Driver"
  );
}


/* ============================================================
   18. ADMIN TRIP ENTRY
============================================================ */

$("adminTripForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isAdmin()) return;

  const button = event.submitter;
  setLoading(button, true, "Save Trip");

  try {
    const driverUid = $("adminDriverSelect")?.value;
    const vehicleNo = $("adminVehicle")?.value;

    const openingKm = Number($("adminOpeningKm")?.value);
    const closingKm = Number($("adminClosingKm")?.value);

    if (!driverUid || !vehicleNo) {
      throw new Error("Select driver and vehicle.");
    }

    if (
      !Number.isFinite(openingKm) ||
      !Number.isFinite(closingKm) ||
      closingKm < openingKm
    ) {
      throw new Error("Enter valid opening and closing kilometres.");
    }

    const driver = driverData.find(
      item => item.id === driverUid
    );

    await addDoc(collection(db, "Trips"), {
      driverUid,

      driverName: valueOf(
        driver,
        ["name", "Name", "employeeName"],
        ""
      ),

      vehicleNo,

      tripDate: $("adminTripDate")?.value || getToday(),
      startTime: $("adminStartTime")?.value || "",
      endTime: $("adminEndTime")?.value || "",

      from: $("adminFrom")?.value || "",
      to: $("adminTo")?.value || "",

      openingKm,
      closingKm,
      distanceKm: closingKm - openingKm,

      purpose: $("adminPurpose")?.value || "",

      status: "completed",

      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      completedAt: serverTimestamp()
    });

    alert("Trip entry saved successfully.");

    event.target.reset();

    await loadAdminDashboard();

  } catch (error) {
    console.error("ADMIN TRIP ERROR:", error);
    alert(error.message || "Trip saving failed.");

  } finally {
    setLoading(button, false, "Save Trip");
  }
});


/* ============================================================
   19. DRIVER WORKSPACE
============================================================ */

async function loadDriverWorkspace() {
  const name = getProfileName();

  if ($("loggedUser")) {
    $("loggedUser").textContent = name;
  }

  if ($("driverName")) {
    $("driverName").value = name;
  }

  if ($("tripDate")) {
    $("tripDate").value = getToday();
  }

  if ($("fuelDate")) {
    $("fuelDate").value = getToday();
  }

  await loadDriverData();
  await checkActiveTrip();
}

async function loadDriverData() {
  try {
    const results = await Promise.all([
      getCollectionData("Vehicles"),
      getCollectionData("Employees")
    ]);

    vehicleData = results[0];
    employeeData = results[1];

    populateAdminDropdowns();

  } catch (error) {
    console.error("DRIVER DATA ERROR:", error);
  }
}


/* ============================================================
   20. DRIVER NAVIGATION
============================================================ */

document.querySelectorAll(".nav[data-view]").forEach(button => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;

    document.querySelectorAll(".driver-view").forEach(section => {
      section.classList.remove("active");
    });

    $(view)?.classList.add("active");

    document.querySelectorAll(".nav[data-view]").forEach(item => {
      item.classList.toggle("active", item === button);
    });
  });
});


/* ============================================================
   21. DESTINATION MANAGEMENT
============================================================ */

function addDestinationRow(
  containerId,
  placeholder = "Enter destination"
) {
  const container = $(containerId);
  if (!container) return;

  const row = document.createElement("div");
  row.className = "destination-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.required = true;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";

  remove.addEventListener("click", () => row.remove());

  row.append(input, remove);
  container.appendChild(row);
}

$("addDestination")?.addEventListener("click", () => {
  addDestinationRow("destinationList");
});

$("addClosingDestination")?.addEventListener("click", () => {
  addDestinationRow("closingDestinationList");
});

function getDestinations(containerId) {
  const container = $(containerId);
  if (!container) return [];

  return Array.from(
    container.querySelectorAll("input")
  )
    .map(input => input.value.trim())
    .filter(Boolean);
}


/* ============================================================
   22. START DRIVER TRIP
============================================================ */

$("tripForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isDriver()) return;

  const button = event.submitter;
  setLoading(button, true, "Start Trip");

  try {
    const vehicleNo = $("vehicle")?.value;
    const openingKm = Number($("openingKm")?.value);

    const destinations = getDestinations("destinationList");

    if (!vehicleNo) {
      throw new Error("Select a vehicle.");
    }

    if (!Number.isFinite(openingKm) || openingKm < 0) {
      throw new Error("Enter a valid opening KM.");
    }

    if (!destinations.length) {
      throw new Error("Enter at least one destination.");
    }

    const activeQuery = query(
      collection(db, "Trips"),
      where("driverUid", "==", currentUser.uid),
      where("status", "==", "active"),
      limit(1)
    );

    const existing = await getDocs(activeQuery);

    if (!existing.empty) {
      throw new Error(
        "You already have an active trip. Complete it first."
      );
    }

    const tripRef = await addDoc(
      collection(db, "Trips"),
      {
        driverUid: currentUser.uid,
        driverName: getProfileName(),

        vehicleNo,
        openingKm,

        department: $("department")?.value || "",
        requestedEmployee: $("requestedEmployee")?.value || "",
        manualEmployee: $("manualEmployee")?.value || "",

        tripDate: $("tripDate")?.value || getToday(),
        startTime: $("startTime")?.value || "",
        purpose: $("purpose")?.value || "",

        destinations,

        status: "active",

        createdAt: serverTimestamp()
      }
    );

    activeTripId = tripRef.id;

    alert("Trip started successfully.");

    event.target.reset();

    if ($("driverName")) {
      $("driverName").value = getProfileName();
    }

    if ($("tripDate")) {
      $("tripDate").value = getToday();
    }

    if ($("destinationList")) {
      $("destinationList").innerHTML = "";
    }

    await checkActiveTrip();

  } catch (error) {
    console.error("START TRIP ERROR:", error);
    alert(error.message || "Unable to start trip.");

  } finally {
    setLoading(button, false, "Start Trip");
  }
});


/* ============================================================
   23. CHECK ACTIVE TRIP
============================================================ */

async function checkActiveTrip() {
  try {
    const activeQuery = query(
      collection(db, "Trips"),
      where("driverUid", "==", currentUser.uid),
      where("status", "==", "active"),
      limit(1)
    );

    const snapshot = await getDocs(activeQuery);
    const activeBox = $("activeTrip");

    if (snapshot.empty) {
      activeTripId = null;

      if (activeBox) {
        activeBox.hidden = true;
      }

      return;
    }

    const tripDoc = snapshot.docs[0];
    const trip = tripDoc.data();

    activeTripId = tripDoc.id;

    if (activeBox) {
      activeBox.hidden = false;
    }

    if ($("tripNumber")) {
      $("tripNumber").textContent = tripDoc.id;
    }

    if ($("activeSummary")) {
      $("activeSummary").textContent =
        `${trip.vehicleNo || ""} | Opening KM: ${trip.openingKm || 0} | ` +
        `Destinations: ${(trip.destinations || []).join(", ")}`;
    }

  } catch (error) {
    console.error("ACTIVE TRIP ERROR:", error);
  }
}


/* ============================================================
   24. COMPLETE DRIVER TRIP
============================================================ */

$("endTripForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isDriver() || !activeTripId) {
    alert("No active trip found.");
    return;
  }

  const button = event.submitter;
  setLoading(button, true, "Complete Trip");

  try {
    const closingKm = Number($("closingKm")?.value);
    const endTime = $("endTime")?.value || "";
    const remarks = $("remarks")?.value || "";

    const tripRef = doc(db, "Trips", activeTripId);
    const tripSnap = await getDoc(tripRef);

    if (!tripSnap.exists()) {
      throw new Error("Trip record not found.");
    }

    const trip = tripSnap.data();

    if (
      !Number.isFinite(closingKm) ||
      closingKm < Number(trip.openingKm)
    ) {
      throw new Error(
        "Closing KM cannot be less than Opening KM."
      );
    }

    const additionalDestinations =
      getDestinations("closingDestinationList");

    await updateDoc(tripRef, {
      closingKm,
      endTime,
      remarks,
      additionalDestinations,

      distanceKm: closingKm - Number(trip.openingKm),

      status: "completed",
      completedAt: serverTimestamp()
    });

    alert("Trip completed successfully.");

    activeTripId = null;

    event.target.reset();

    if ($("closingDestinationList")) {
      $("closingDestinationList").innerHTML = "";
    }

    await checkActiveTrip();

  } catch (error) {
    console.error("COMPLETE TRIP ERROR:", error);
    alert(error.message || "Unable to complete trip.");

  } finally {
    setLoading(button, false, "Complete Trip");
  }
});


/* ============================================================
   25. DRIVER FUEL ENTRY
============================================================ */

$("fuelForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isDriver()) return;

  const button = event.submitter;
  setLoading(button, true, "Save Fuel");

  try {
    const litres = Number($("fuelLitres")?.value);
    const amount = Number($("fuelAmount")?.value);
    const km = Number($("fuelKm")?.value);

    if (
      !Number.isFinite(litres) ||
      !Number.isFinite(amount) ||
      !Number.isFinite(km) ||
      litres <= 0 ||
      amount < 0 ||
      km < 0
    ) {
      throw new Error("Enter valid fuel details.");
    }

    await addDoc(collection(db, "Fuel"), {
      driverUid: currentUser.uid,
      driverName: getProfileName(),

      vehicleNo: $("fuelVehicle")?.value || "",
      fuelDate: $("fuelDate")?.value || getToday(),

      litres,
      amount,
      km,

      remarks: $("fuelRemarks")?.value || "",

      createdAt: serverTimestamp()
    });

    showMessage(
      "fuelMessage",
      "Fuel entry saved successfully.",
      "success"
    );

    event.target.reset();

    if ($("fuelDate")) {
      $("fuelDate").value = getToday();
    }

  } catch (error) {
    console.error("DRIVER FUEL ERROR:", error);

    showMessage(
      "fuelMessage",
      error.message || "Fuel entry failed.",
      "error"
    );

  } finally {
    setLoading(button, false, "Save Fuel");
  }
});


/* ============================================================
   26. ADMIN FUEL ENTRY
============================================================ */

$("fuelEntryForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isAdmin()) return;

  const button = event.submitter;
  setLoading(button, true, "Save Fuel");

  try {
    const litres = Number($("adminFuelLitres")?.value);
    const amount = Number($("adminFuelAmount")?.value);

    if (
      !Number.isFinite(litres) ||
      !Number.isFinite(amount) ||
      litres <= 0 ||
      amount < 0
    ) {
      throw new Error("Enter valid fuel quantity and amount.");
    }

    await addDoc(collection(db, "Fuel"), {
      vehicleNo: $("adminFuelVehicle")?.value || "",
      fuelDate: $("adminFuelDate")?.value || getToday(),

      litres,
      amount,

      enteredBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    alert("Fuel entry saved successfully.");

    event.target.reset();

    if ($("adminFuelDate")) {
      $("adminFuelDate").value = getToday();
    }

    await loadAdminDashboard();

  } catch (error) {
    console.error("ADMIN FUEL ERROR:", error);
    alert(error.message || "Fuel entry failed.");

  } finally {
    setLoading(button, false, "Save Fuel");
  }
});


/* ============================================================
   27. USER MANAGEMENT
============================================================ */

function renderManagedUsers(users) {
  const tbody = $("managedUsersBody");
  if (!tbody) return;

  tbody.innerHTML = users.map(user => `
    <tr>
      <td>${safe(valueOf(
        user,
        ["User ID", "userId"],
        "-"
      ))}</td>

      <td>${safe(valueOf(
        user,
        ["Name", "name", "employeeName"],
        "-"
      ))}</td>

      <td>${safe(valueOf(
        user,
        ["Mail ID", "email", "mailId"],
        "-"
      ))}</td>

      <td>${safe(valueOf(
        user,
        ["Role", "role"],
        "-"
      ))}</td>

      <td>${isActive(user) ? "Active" : "Inactive"}</td>
    </tr>
  `).join("");
}

async function loadManagedUsers() {
  try {
    const users = await getCollectionData("User");
    renderManagedUsers(users);

  } catch (error) {
    console.error("USER LIST ERROR:", error);

    showMessage(
      "managedUserMessage",
      "Unable to load user profiles.",
      "error"
    );
  }
}

$("refreshUsersBtn")?.addEventListener(
  "click",
  loadManagedUsers
);

$("managedUserForm")?.addEventListener("submit", event => {
  event.preventDefault();

  showMessage(
    "managedUserMessage",
    "Create the account in Firebase Authentication first. Then add the matching User profile using the exact Authentication UID. This form cannot create Auth accounts on the Spark plan.",
    "error"
  );
});


/* ============================================================
   28. REPORT FILTER
============================================================ */

$("applyReport")?.addEventListener("click", async () => {
  try {
    const from = $("reportFrom")?.value;
    const to = $("reportTo")?.value;

    const trips = await getCollectionData("Trips");

    const filtered = trips.filter(trip => {
      const date = trip.tripDate || "";

      if (from && date < from) return false;
      if (to && date > to) return false;

      return true;
    });

    renderTripRegister(filtered);

    if ($("reportTitle")) {
      $("reportTitle").textContent =
        `Trip Report: ${from || "All"} to ${to || "All"}`;
    }

  } catch (error) {
    console.error("REPORT ERROR:", error);
    alert("Unable to generate report.");
  }
});


/* ============================================================
   29. TRIP SEARCH
============================================================ */

$("tripSearch")?.addEventListener("input", event => {
  const search = event.target.value.toLowerCase();

  document.querySelectorAll("#tripRegisterBody tr").forEach(row => {
    row.hidden = !row.textContent
      .toLowerCase()
      .includes(search);
  });
});


/* ============================================================
   30. PRINT REPORT
============================================================ */

$("printReport")?.addEventListener("click", () => {
  window.print();
});


/* ============================================================
   31. INITIAL DATE VALUES
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  if ($("tripDate")) {
    $("tripDate").value = getToday();
  }

  if ($("fuelDate")) {
    $("fuelDate").value = getToday();
  }

  if ($("adminTripDate")) {
    $("adminTripDate").value = getToday();
  }

  if ($("adminFuelDate")) {
    $("adminFuelDate").value = getToday();
  }
});


console.log(
  "MAFARM Vehicle Trip Management JavaScript loaded successfully."
);
