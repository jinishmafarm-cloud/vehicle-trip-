
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
  limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

// ========================================
// FIREBASE CONFIGURATION
// ========================================

const firebaseConfig = {
  apiKey: "AIzaSyB36kVpDjxZsqdN7ZWVFSYpsU1rrNFDZgk",
  authDomain: "vehicle-trip-entry-35f69.firebaseapp.com",
  projectId: "vehicle-trip-entry-35f69",
  storageBucket: "vehicle-trip-entry-35f69.firebasestorage.app",
  messagingSenderId: "751996536767",
  appId: "1:751996536767:web:69a3a2e4f4ae4c5ef7430a",
  measurementId: "G-ZBY022XKHX"
};

// Initialize Firebase services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

const $ = id => document.getElementById(id);

window.mafarmLogout = () => signOut(auth);

// ========================================
// LOGIN AND ROLE MANAGEMENT
// ========================================

function showRole(role) {
  $("loginPage").style.display = "none";

  $("adminWorkspace").style.display =
    role === "admin" ? "block" : "none";

  $("driverWorkspace").style.display =
    role === "driver" ? "block" : "none";

  if (role === "admin") {
    if (window.lucide) lucide.createIcons();
    initAdminUI();
  } else {
    initDriverUI();
  }
}

$("mainLoginForm").addEventListener("submit", async e => {
  e.preventDefault();

  const button = $("mainLoginBtn");
  const message = $("mainLoginMessage");

  button.disabled = true;
  message.textContent = "Signing in...";

  try {
    let identity = $("mainIdentity").value.trim();

    if (identity === "150884") {
      identity = "operationhead@mafarm.in";
    }

    const credential = await signInWithEmailAndPassword(
      auth,
      identity,
      $("mainPassword").value
    );

    const userDoc = await getDoc(
      doc(db, "User", credential.user.uid)
    );

    if (!userDoc.exists()) {
      throw new Error(
        "Account profile not found. Contact the administrator."
      );
    }

    const profile = userDoc.data();

    const role = String(
      profile.role || profile.Role || ""
    ).toLowerCase();

    if (
      profile.active === false ||
      profile.Active === false ||
      !["admin", "driver"].includes(role)
    ) {
      throw new Error("Account inactive or role not permitted.");
    }

    showRole(role);

  } catch (error) {
    message.textContent =
      error.code === "auth/invalid-credential"
        ? "Invalid User ID/email or password."
        : error.message;

  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

// Restore existing Firebase login
onAuthStateChanged(auth, async user => {
  if (!user) {
    $("loginPage").style.display = "grid";
    $("adminWorkspace").style.display = "none";
    $("driverWorkspace").style.display = "none";
    return;
  }

  try {
    const userDoc = await getDoc(
      doc(db, "User", user.uid)
    );

    if (!userDoc.exists()) {
      throw new Error("Profile not found");
    }

    const profile = userDoc.data();

    const role = String(
      profile.role || profile.Role || ""
    ).toLowerCase();

    if (
      profile.active === false ||
      profile.Active === false ||
      !["admin", "driver"].includes(role)
    ) {
      throw new Error("Access denied");
    }

    showRole(role);

  } catch (error) {
    console.error(error);
    await signOut(auth);
  }
});

// ========================================
// ADMIN DASHBOARD
// ========================================

function initAdminUI() {

  if (window._mafarmAdminInitialized) return;
  window._mafarmAdminInitialized = true;

  function toast(message) {
    const element = $("toast");

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(window._toast);

    window._toast = setTimeout(() => {
      element.classList.remove("show");
    }, 2600);
  }

  function go(page) {

    document.querySelectorAll(".page").forEach(element => {
      element.classList.remove("active");
    });

    $("page-" + page)?.classList.add("active");

    document.querySelectorAll(".nav-link").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    });

    if (innerWidth < 760) {
      $("sidebar").classList.remove("open");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      go(button.dataset.page);
    });
  });

  document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => {
      go(button.dataset.go);
    });
  });

  $("menuBtn").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
  });

  $("today").textContent = new Intl.DateTimeFormat(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  ).format(new Date());

  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (!input.value) {
      input.value = new Date().toISOString().slice(0, 10);
    }
  });

  // Admin vehicle KM preview
  $("adminVehicle").addEventListener("change", event => {
    $("adminOpeningKm").value =
      event.target.selectedOptions[0]?.dataset.km || "";

    calcDistance();
  });

  $("adminClosingKm").addEventListener("input", calcDistance);

  function calcDistance() {
    const opening = Number($("adminOpeningKm").value);
    const closing = Number($("adminClosingKm").value);

    $("adminDistance").value =
      opening && closing >= opening
        ? closing - opening
        : "";

    if (opening && closing && closing < opening) {
      $("adminDistance").value =
        "Closing KM must be ≥ opening KM";
    }
  }

  // Additional destinations
  $("addAdminDestination").addEventListener("click", () => {

    const box = $("adminDestinations");

    const row = document.createElement("div");

    row.className = "destination-line";

    row.innerHTML = `
      <span>${box.children.length + 1}</span>
      <input placeholder="Additional destination">
      <button type="button" class="remove-dest">×</button>
    `;

    box.appendChild(row);
  });

  $("adminDestinations").addEventListener("click", event => {

    if (event.target.classList.contains("remove-dest")) {

      event.target.closest(".destination-line").remove();

      [...$("adminDestinations").children].forEach((row, index) => {
        row.querySelector("span").textContent = index + 1;
      });
    }
  });

  // Admin trip entry - currently preview only
  $("adminTripForm").addEventListener("submit", event => {

    event.preventDefault();

    if (!$("adminOpeningKm").value) {
      return toast("Select a vehicle to load Opening KM.");
    }

    const closing = Number($("adminClosingKm").value);
    const opening = Number($("adminOpeningKm").value);

    if (closing < opening) {
      return toast("Closing KM cannot be less than Opening KM.");
    }

    toast("Trip validated. Firebase saving is not yet connected.");

    event.target.reset();

    $("adminOpeningKm").value = "";
    $("adminDistance").value = "";
  });

  // Master forms - currently preview only
  [
    "driverForm",
    "employeeForm",
    "vehicleMasterForm",
    "fuelEntryForm"
  ].forEach(id => {

    const form = $(id);

    if (!form) return;

    form.addEventListener("submit", event => {
      event.preventDefault();

      toast("Preview only. This form is not yet connected to Firestore.");

      event.target.reset();
    });
  });

  // Bulk upload preview
  document.querySelectorAll("[data-file]").forEach(input => {

    input.addEventListener("change", () => {

      if (input.files[0]) {

        $(input.dataset.file).textContent =
          input.files[0].name;

        toast("File selected. Import is not enabled yet.");
      }
    });
  });

  document.querySelectorAll("[data-template]").forEach(button => {
    button.addEventListener("click", () => {
      toast("Template download is not enabled yet.");
    });
  });

  // Report shortcuts
  document.querySelectorAll("[data-report]").forEach(button => {

    button.addEventListener("click", () => {

      go("reports");

      $("reportTitle").textContent = ({
        driver: "Driver-wise Report",
        vehicle: "Vehicle-wise Report",
        fuel: "Fuel Report",
        efficiency: "Driver-wise Efficiency"
      })[button.dataset.report];
    });
  });

  $("applyReport").addEventListener("click", () => {
    toast("Report filters selected. Firestore reporting is pending.");
  });

  // Dashboard search
  $("dashSearch").addEventListener("input", filterDash);
  $("dashStatus").addEventListener("change", filterDash);

  function filterDash() {

    const search = $("dashSearch").value.toLowerCase();
    const status = $("dashStatus").value;

    [...$("latestTrips").rows].forEach(row => {

      const matchesText =
        row.textContent.toLowerCase().includes(search);

      const matchesStatus =
        !status || row.textContent.includes(status);

      row.style.display =
        matchesText && matchesStatus ? "" : "none";
    });
  }

  // Trip register search
  $("tripSearch").addEventListener("input", event => {

    [...$("tripRegisterBody").rows].forEach(row => {

      row.style.display =
        row.textContent.toLowerCase().includes(
          event.target.value.toLowerCase()
        ) ? "" : "none";
    });
  });

  if (window.lucide) {
    lucide.createIcons();
  }
}

// ========================================
// DRIVER WORKSPACE
// ========================================

function initDriverUI() {

  if (window._mafarmDriverInitialized) return;
  window._mafarmDriverInitialized = true;

  let profile = null;
  let activeTripId = null;
  let activeTrip = null;
  let vehicles = [];

  const user = auth.currentUser;

  if (!user) return;

  // Load Driver Profile
  (async () => {

    const userDoc = await getDoc(
      doc(db, "User", user.uid)
    );

    if (!userDoc.exists()) {
      throw new Error("User profile not found");
    }

    profile = userDoc.data();

    const role = String(
      profile.role || profile.Role || ""
    ).toLowerCase();

    if (role !== "driver") {
      throw new Error("This workspace is for Drivers only.");
    }

    if (
      profile.active === false ||
      profile.Active === false
    ) {
      throw new Error("Account inactive.");
    }

    $("driverName").value =
      profile.name ||
      profile.employeeName ||
      profile.Name ||
      user.email;

    $("fuelDriver").value = $("driverName").value;

    $("loggedUser").textContent = $("driverName").value;

    $("appPage").classList.remove("hidden");

    await loadVehicles();

    await loadActiveTrip(user.uid);

  })().catch(async error => {

    alert(error.message);

    await signOut(auth);
  });

  // Driver logout
  $("logoutBtn").addEventListener("click", () => {
    signOut(auth);
  });

  // Load active vehicles
  async function loadVehicles() {

    let snapshot;

    try {

      const activeQuery = query(
        collection(db, "Vehicles"),
        where("active", "==", true)
      );

      snapshot = await getDocs(activeQuery);

    } catch (error) {

      snapshot = await getDocs(
        collection(db, "Vehicles")
      );
    }

    vehicles = snapshot.docs
      .map(document => ({
        id: document.id,
        ...document.data()
      }))
      .filter(vehicle =>
        vehicle.active !== false &&
        vehicle.Active !== false
      );

    const options =
      '<option value="">Select vehicle</option>' +
      vehicles.map(vehicle => {

        const number =
          vehicle.vehicleNo ||
          vehicle.vehicleNumber ||
          vehicle.VehicleNo ||
          vehicle.id;

        return `
          <option value="${esc(number)}">
            ${esc(number)}
          </option>
        `;

      }).join("");

    $("vehicle").innerHTML = options;
    $("fuelVehicle").innerHTML = options;
  }

  // Automatic opening KM
  $("vehicle").addEventListener("change", () => {

    const vehicle = vehicles.find(item => {

      const number =
        item.vehicleNo ||
        item.vehicleNumber ||
        item.VehicleNo ||
        item.id;

      return number === $("vehicle").value;
    });

    $("openingKm").value = vehicle
      ? Number(
          vehicle.currentKm ??
          vehicle.lastClosingKm ??
          vehicle.initialKm ??
          vehicle.InitialKM ??
          0
        )
      : "";
  });

  // Load active trip
  async function loadActiveTrip(uid) {

    const activeQuery = query(
      collection(db, "Trips"),
      where("driverUid", "==", uid),
      where("status", "==", "active"),
      limit(1)
    );

    const snapshot = await getDocs(activeQuery);

    if (snapshot.empty) return;

    const tripDoc = snapshot.docs[0];

    activeTripId = tripDoc.id;
    activeTrip = tripDoc.data();

    $("tripForm").classList.add("hidden");
    $("activeTrip").classList.remove("hidden");

    $("tripNumber").textContent = tripDoc.id;

    $("activeSummary").textContent =
      `${activeTrip.vehicleNo} · Opening KM ${activeTrip.openingKm}`;
  }

  // Start Trip
  $("tripForm").addEventListener("submit", async event => {

    event.preventDefault();

    try {

      const destinations = [
        ...$("destinationList").querySelectorAll("input")
      ]
        .map(input => input.value.trim())
        .filter(Boolean);

      const vehicleNumber = $("vehicle").value;
      const openingKm = Number($("openingKm").value);

      if (!vehicleNumber || !openingKm) {
        throw new Error("Select a vehicle with a valid current KM.");
      }

      const vehicle = vehicles.find(item => {

        const number =
          item.vehicleNo ||
          item.vehicleNumber ||
          item.VehicleNo ||
          item.id;

        return number === vehicleNumber;
      });

      const trip = await addDoc(
        collection(db, "Trips"),
        {
          driverUid: auth.currentUser.uid,
          driverName: $("driverName").value,
          vehicleNo: vehicleNumber,
          vehicleId: vehicle?.id || null,
          openingKm,
          department: $("department").value,
          requestedEmployee:
            $("requestedEmployee").value === "manual"
              ? $("manualEmployee").value
              : $("requestedEmployee").value,
          purpose: $("purpose").value,
          tripDate: $("tripDate").value,
          startTime: $("startTime").value,
          destinations,
          status: "active",
          createdAt: serverTimestamp()
        }
      );

      activeTripId = trip.id;

      activeTrip = {
        vehicleNo: vehicleNumber,
        openingKm,
        destinations
      };

      $("tripNumber").textContent = trip.id;

      $("activeSummary").textContent =
        `${vehicleNumber} · Opening KM ${openingKm}`;

      $("tripForm").classList.add("hidden");
      $("activeTrip").classList.remove("hidden");

      alert("Trip started successfully.");

    } catch (error) {

      alert(error.message);
    }
  });

  // End Trip - requires deployed Cloud Function
  $("endTripForm").addEventListener("submit", async event => {

    event.preventDefault();

    try {

      if (!activeTripId) {
        throw new Error("No active trip found.");
      }

      const closingKm = Number($("closingKm").value);
      const openingKm = Number(activeTrip.openingKm);

      if (closingKm < openingKm) {
        throw new Error("Closing KM cannot be below opening KM.");
      }

      const additionalDestinations = [
        ...$("closingDestinationList").querySelectorAll("input")
      ]
        .map(input => input.value.trim())
        .filter(Boolean);

      const completeTrip = httpsCallable(
        functions,
        "completeDriverTrip"
      );

      await completeTrip({
        tripId: activeTripId,
        closingKm,
        endTime: $("endTime").value,
        remarks: $("remarks").value,
        additionalDestinations
      });

      alert("Trip completed successfully. Vehicle KM updated.");

      activeTripId = null;
      activeTrip = null;

      $("activeTrip").classList.add("hidden");
      $("tripForm").classList.remove("hidden");

      event.target.reset();

    } catch (error) {

      alert(error.message);
    }
  });

  // Fuel Entry
  $("fuelForm").addEventListener("submit", async event => {

    event.preventDefault();

    try {

      await addDoc(
        collection(db, "Fuel"),
        {
          driverUid: auth.currentUser.uid,
          driverName: $("fuelDriver").value,
          vehicleNo: $("fuelVehicle").value,
          date: $("fuelDate").value,
          litres: Number($("fuelLitres").value),
          amount: Number($("fuelAmount").value),
          odometerKm: Number($("fuelKm").value),
          remarks: $("fuelRemarks").value,
          createdAt: serverTimestamp()
        }
      );

      $("fuelMessage").textContent =
        "Fuel entry saved successfully.";

      event.target.reset();

    } catch (error) {

      $("fuelMessage").textContent =
        "Unable to save fuel entry: " + error.message;
    }
  });

  // Driver navigation
  document.querySelectorAll(".nav").forEach(button => {

    button.addEventListener("click", () => {

      document.querySelectorAll(".nav").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      document.querySelectorAll(".view").forEach(view => {
        view.classList.add("hidden");
      });

      $(button.dataset.view).classList.remove("hidden");

      $("welcomeTitle").textContent =
        button.dataset.view === "fuelView"
          ? "Fuel Entry"
          : "Trip Entry";
    });
  });

  // HTML escape helper
  function esc(value) {

    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
    );
  }
}

console.log(
  "MAFARM Vehicle Trip System initialized:",
  app.options.projectId
);
