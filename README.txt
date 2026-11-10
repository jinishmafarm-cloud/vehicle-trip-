MAFARM Vehicle Trip Management — Three-file GitHub frontend
Files: index.html, style.css, app.js
Firebase project: vehicle-trip-entry-35f69

Upload these three files to the ROOT of your GitHub Pages repository.
The app.js imports Firebase SDK modules from Google's CDN and initializes
Firebase Authentication, Cloud Firestore, Firebase Storage, and Functions.

IMPORTANT:
1. The Firebase Auth account must exist and have a User/{Auth UID} profile.
2. Initial Admin profile provisioning and secure user creation require the
   Cloud Functions backend from the separate Firebase integration package.
3. Driver trip completion calls the completeDriverTrip Cloud Function.
4. Review/deploy Firestore and Storage security rules before production.
5. Admin master-data forms, reporting and bulk upload are not all wired to
   Firestore yet; this frontend is not a complete production backend.
