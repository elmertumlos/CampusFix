# Deployment and Android builds

[Back to the CampusFix README](../README.md)

## Cloudflare deployment

CampusFix uses the `production` environment in [`wrangler.jsonc`](../wrangler.jsonc). The current production hostname is [campusfix.buildcurious.online](https://campusfix.buildcurious.online). The production Worker has its own D1 database and a scheduled task that retries pending push deliveries.

### Set up a new deployment

The source package uses example production values for the Cloudflare account, hostname, database ID, and Turnstile site key. Replace these with the settings for your deployment before running remote commands.

1. Install dependencies with `npm.cmd ci` and sign in with `npx.cmd wrangler login`. On macOS or Linux, use `npm` and `npx`.
2. Create a D1 database with `npx.cmd wrangler d1 create your-campusfix-database --no-update-config`. Update the production database name and ID in `wrangler.jsonc`, keeping the binding name `DB`. [Cloudflare D1 setup](https://developers.cloudflare.com/d1/get-started/)
3. Set the Cloudflare account ID, Worker name, and custom domain in `env.production`. Use a domain in an active Cloudflare zone in that account. [Cloudflare custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
4. Create a Turnstile widget for the production hostname. Set its site key as the `TURNSTILE_SITE_KEY` variable in `env.production.vars`. [Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/)
5. Prepare the production secrets below. Apply the D1 migrations, then deploy the Worker.

| Worker secret | Value |
| --- | --- |
| `STAFF_USERNAME` | Initial production staff username |
| `STAFF_PASSWORD` | Strong, unique initial production staff password |
| `TURNSTILE_SECRET_KEY` | Secret key for the production Turnstile widget |
| `FIREBASE_SERVICE_ACCOUNT` | Contents of the Firebase push sender's service-account JSON, supplied as a string |

For a first deployment, use a private JSON file that maps each secret name to its string value. A filename such as `.env.deploy.json` matches the repository's ignore rules. Keep that file and the original service-account key in private storage. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

```powershell
npx.cmd wrangler d1 migrations apply DB --env production --remote
npx.cmd wrangler deploy --env production --secrets-file .env.deploy.json
```

For later deployments with the secrets already stored in Cloudflare, run the same migration command and use `npx.cmd wrangler deploy --env production`. If staff credentials have been changed in **Settings**, sign in with the credentials saved there. For local Turnstile testing on loopback, put both [Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in `.dev.vars`.

## Firebase and Android

1. In your Firebase project, register an Android app with package name `online.buildcurious.campusfix`. Download its `google-services.json` to `android/app/`. For a separate app with a different package name, register that name in Firebase and update the Gradle `applicationId` to match. [Firebase Android setup](https://firebase.google.com/docs/android/setup)
2. Enable the Firebase Cloud Messaging API. Use a dedicated service account with the [Firebase Cloud Messaging API Admin role](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging) for the Worker. Supply its credential JSON as the Worker secret `FIREBASE_SERVICE_ACCOUNT`. [FCM HTTP v1 setup](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
3. If you deploy to a different hostname, update the app's `HOST` in [`DashboardActivity.java`](../android/app/src/main/java/online/buildcurious/campusfix/DashboardActivity.java). The app uses that HTTPS hostname for both the dashboard and device registration.

### Build and sign the APK

Open `android/` in Android Studio, install SDK platform `android-37.0` to match the current Gradle configuration, and use Android Studio's bundled JDK. From the repository root in PowerShell, build the release variant with the Gradle wrapper.

```powershell
.\android\gradlew.bat -p android :app:assembleRelease
```

The unsigned APK is generated under `android/app/build/outputs/apk/release/`. Use Android Studio's **Generate Signed Bundle / APK** flow and choose **APK**, or use the Android SDK build tools to align and sign it. Use the same signing key for updates and keep a private backup of the key and password. [Android app signing](https://developer.android.com/studio/publish/app-signing)

To verify a release, first check its APK signature. Then install it on an Android device with Google Play services, sign in, and allow notifications. Put the app in the background, submit a test report through the deployed form, and check that the alert opens the matching report. [Firebase Android messaging](https://firebase.google.com/docs/cloud-messaging/android/get-started)

## Prepare the source for GitHub

- Review staged files before the first push. Keep `.dev.vars`, deployment secret files, local D1 data, Firebase service-account keys, and APK signing material in private storage.
- The checked-in `wrangler.jsonc` uses example production values. Configure your Cloudflare environment and add your own Firebase client configuration as described above.
- Attach the signed `CampusFix-1.2.0.apk` to GitHub Release `v1.2.0` when publishing it. Keep APKs and other build outputs out of source commits.
- The 1.2.0 build uses package `online.buildcurious.campusfix` and Android version code `3`. Its signature matches the previous release, and the package includes Firebase Messaging. Confirm live push delivery on an Android device before distributing the APK to staff.

### First push

For a new GitHub repository, create it empty and run these commands from the prepared source folder. Replace the author fields and repository URL with your own values. The source is staged on the `main` branch.

```powershell
git status --short
git config --local user.name "Your name"
git config --local user.email "your-git-email@example.com"
git commit -m "Add CampusFix source and documentation"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```
