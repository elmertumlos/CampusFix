package online.buildcurious.campusfix;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Process;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import com.google.firebase.FirebaseApp;

import java.io.File;
import java.io.IOException;

public final class DashboardActivity extends Activity {
    static final String HOST = "campusfix.buildcurious.online";
    static final String ORIGIN = "https://" + HOST;
    static final String EXTRA_REPORT = "report";
    private static final int NOTIFICATION_PERMISSION = 1;
    private static final int PHOTO_PICKER = 2;
    private static final int NAVY = Color.rgb(17, 24, 115);
    private WebView dashboard;
    private ProgressBar progress;
    private View offline;
    private Uri pendingReport;
    private Uri lastPage = Uri.parse(ORIGIN + "/staff");
    private ValueCallback<Uri[]> photoCallback;
    private File pendingCameraPhoto;
    private File selectedCameraPhoto;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        ReportMessagingService.createChannel(this);
        configureWindow();
        if (state != null) {
            String report = state.getString(EXTRA_REPORT);
            if (report != null) pendingReport = reportUri(report);
        }
        acceptReportIntent(getIntent());
        if (state == null || dashboard.restoreState(state) == null) {
            dashboard.loadUrl((pendingReport == null ? lastPage : pendingReport).toString());
        }
    }

    private void configureWindow() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(NAVY);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                var padding = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
                return insets;
            });
        } else {
            getWindow().setStatusBarColor(NAVY);
            getWindow().setNavigationBarColor(NAVY);
        }

        dashboard = new WebView(this);
        dashboard.setBackgroundColor(Color.WHITE);
        dashboard.getSettings().setJavaScriptEnabled(true);
        dashboard.getSettings().setDomStorageEnabled(true);
        dashboard.getSettings().setAllowFileAccess(false);
        dashboard.getSettings().setAllowContentAccess(true);
        dashboard.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        dashboard.getSettings().setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(dashboard, false);
        dashboard.setWebViewClient(new StaffWebViewClient());
        dashboard.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (view.getUrl() == null || !staffPage(Uri.parse(view.getUrl()))
                    || params.getMode() != FileChooserParams.MODE_OPEN
                    || !java.util.Arrays.asList(params.getAcceptTypes()).contains("image/*")) return false;
                chooseReportPhoto(callback);
                return true;
            }
        });
        dashboard.setDownloadListener((url, agent, disposition, mime, length) -> downloadReport(Uri.parse(url), agent));
        root.addView(dashboard, new FrameLayout.LayoutParams(-1, -1));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(4), Gravity.TOP));
        offline = createOfflineView();
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        offline.setVisibility(View.GONE);
        setContentView(root);
    }

    private View createOfflineView() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setPadding(dp(24), dp(24), dp(24), dp(24));
        content.setBackgroundColor(Color.rgb(243, 245, 251));
        TextView message = new TextView(this);
        message.setText(R.string.dashboard_unavailable);
        message.setTextSize(17);
        message.setTextColor(NAVY);
        message.setGravity(Gravity.CENTER);
        content.addView(message);
        Button tryAgain = new Button(this);
        tryAgain.setText(R.string.retry);
        tryAgain.setOnClickListener(view -> dashboard.loadUrl((pendingReport == null ? lastPage : pendingReport).toString()));
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-2, -2);
        button.topMargin = dp(14);
        content.addView(tryAgain, button);
        return content;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        acceptReportIntent(intent);
        if (pendingReport != null) dashboard.loadUrl(pendingReport.toString());
    }

    private void acceptReportIntent(Intent intent) {
        String report = intent.getStringExtra(EXTRA_REPORT);
        intent.removeExtra(EXTRA_REPORT);
        if (report != null) pendingReport = reportUri(report);
    }

    private static Uri reportUri(String report) {
        if (!report.matches("[1-9][0-9]{0,15}")) return null;
        return Uri.parse(ORIGIN + "/staff").buildUpon().appendQueryParameter("report", report).build();
    }

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static boolean staffPage(Uri uri) {
        String path = uri.getPath();
        return trusted(uri) && ("/staff".equals(path) || "/staff/settings".equals(path) || "/staff/qr".equals(path));
    }

    private void chooseReportPhoto(ValueCallback<Uri[]> callback) {
        if (photoCallback != null) {
            callback.onReceiveValue(null);
            return;
        }
        photoCallback = callback;
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
        Intent chooser = Intent.createChooser(pick, getString(R.string.choose_report_photo));
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (camera.resolveActivity(getPackageManager()) != null) {
            File directory = new File(getCacheDir(), "report-photos");
            try {
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Photo cache unavailable");
                pendingCameraPhoto = File.createTempFile("photo-", ".jpg", directory);
                Uri uri = cameraPhotoUri(pendingCameraPhoto);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, uri);
                camera.setClipData(ClipData.newRawUri("photo", uri));
                camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            } catch (IOException ignored) {
                // The document picker remains available when capture storage is unavailable.
            }
        }
        try {
            startActivityForResult(chooser, PHOTO_PICKER);
        } catch (ActivityNotFoundException ignored) {
            completePhotoPicker(null, false);
            Toast.makeText(this, R.string.photo_picker_unavailable, Toast.LENGTH_SHORT).show();
        }
    }

    private Uri cameraPhotoUri(File file) {
        return FileProvider.getUriForFile(this, getPackageName() + ".reportphotos", file);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PHOTO_PICKER || photoCallback == null) return;
        if (result == RESULT_OK && pendingCameraPhoto != null && pendingCameraPhoto.length() > 0) {
            Uri photo = cameraPhotoUri(pendingCameraPhoto);
            revokeUriPermission(photo, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            completePhotoPicker(photo, true);
            return;
        }
        Uri photo = result == RESULT_OK && data != null ? data.getData() : null;
        if (photo != null && (!"content".equals(photo.getScheme())
            || checkUriPermission(photo, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED)) {
            photo = null;
        }
        completePhotoPicker(photo, false);
    }

    private void completePhotoPicker(Uri photo, boolean cameraUsed) {
        if (photo != null && selectedCameraPhoto != null) {
            selectedCameraPhoto.delete();
            selectedCameraPhoto = null;
        }
        if (cameraUsed) selectedCameraPhoto = pendingCameraPhoto;
        else if (pendingCameraPhoto != null) pendingCameraPhoto.delete();
        pendingCameraPhoto = null;
        photoCallback.onReceiveValue(photo == null ? null : new Uri[]{photo});
        photoCallback = null;
    }

    private final class StaffWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return !trusted(request.getUrl());
            Uri uri = request.getUrl();
            String path = uri.getPath();
            if (staffPage(uri) || (trusted(uri) && ("/staff/login".equals(path) || "/api/staff/reports.csv".equals(path)))) return false;
            if ("https".equals(uri.getScheme())) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    Toast.makeText(DashboardActivity.this, R.string.dashboard_unavailable, Toast.LENGTH_SHORT).show();
                }
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            offline.setVisibility(View.GONE);
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
            Uri page = Uri.parse(url);
            if (!staffPage(page) || offline.getVisibility() == View.VISIBLE) return;
            lastPage = page;
            if (pendingReport != null && !pendingReport.equals(page)) {
                view.loadUrl(pendingReport.toString());
                return;
            }
            pendingReport = null;
            connectNotifications();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                progress.setVisibility(View.GONE);
                offline.setVisibility(View.VISIBLE);
            }
        }
    }

    private void connectNotifications() {
        if (FirebaseApp.getApps(this).isEmpty()) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            var state = getSharedPreferences("notification_prompt", MODE_PRIVATE);
            if (!state.getBoolean("shown", false)) {
                state.edit().putBoolean("shown", true).apply();
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
            }
            return;
        }
        if (getSystemService(NotificationManager.class).areNotificationsEnabled()) DeviceRegistration.sync(this);
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFICATION_PERMISSION && results.length != 0 && results[0] == PackageManager.PERMISSION_GRANTED) connectNotifications();
    }

    private void downloadReport(Uri uri, String agent) {
        if (!trusted(uri) || !"/api/staff/reports.csv".equals(uri.getPath())) return;
        DownloadManager.Request download = new DownloadManager.Request(uri);
        String cookies = CookieManager.getInstance().getCookie(ORIGIN + "/staff");
        if (cookies == null) return;
        download.addRequestHeader("Cookie", cookies).addRequestHeader("User-Agent", agent);
        download.setTitle("CampusFix reports").setMimeType("text/csv");
        download.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        download.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "campusfix-reports-" + System.currentTimeMillis() + ".csv");
        getSystemService(DownloadManager.class).enqueue(download);
    }

    private int dp(int size) {
        return Math.round(size * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (dashboard != null && dashboard.getUrl() != null && staffPage(Uri.parse(dashboard.getUrl()))) connectNotifications();
    }

    @Override
    public void onSaveInstanceState(Bundle state) {
        dashboard.saveState(state);
        if (pendingReport != null) state.putString(EXTRA_REPORT, pendingReport.getQueryParameter("report"));
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (dashboard.canGoBack()) dashboard.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (photoCallback != null) completePhotoPicker(null, false);
        if (selectedCameraPhoto != null) selectedCameraPhoto.delete();
        ((ViewGroup) dashboard.getParent()).removeView(dashboard);
        dashboard.destroy();
        super.onDestroy();
    }
}
