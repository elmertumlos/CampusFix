package online.buildcurious.campusfix;

import android.content.Context;
import android.webkit.CookieManager;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

final class DeviceRegistration {
    private static final java.util.concurrent.Executor EXECUTOR = Executors.newSingleThreadExecutor();
    private static String lastToken;
    private static String lastSession;

    private DeviceRegistration() {}

    static void sync(Context context) {
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(true);
        messaging.getToken().addOnSuccessListener(token -> register(context, token));
    }

    static void register(Context context, String token) {
        Context app = context.getApplicationContext();
        String session = CookieManager.getInstance().getCookie(DashboardActivity.ORIGIN + "/staff");
        if (session == null || !session.contains("campusfix_staff=")) return;
        EXECUTOR.execute(() -> {
            if (token.equals(lastToken) && session.equals(lastSession)) return;
            var preferences = app.getSharedPreferences("campusfix_push", Context.MODE_PRIVATE);
            String installation = preferences.getString("installation", null);
            if (installation == null) {
                installation = UUID.randomUUID().toString().replace("-", "");
                preferences.edit().putString("installation", installation).apply();
            }
            try {
                var payload = new JSONObject().put("installation", installation).put("token", token);
                if (upload(session, payload)) {
                    lastToken = token;
                    lastSession = session;
                }
            } catch (IOException | org.json.JSONException ignored) {
                // Registration retries when the dashboard is active again.
            }
        });
    }

    private static boolean upload(String session, JSONObject payload) throws IOException {
        var url = new URL(DashboardActivity.ORIGIN + "/api/staff/push-devices");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Origin", DashboardActivity.ORIGIN);
            connection.setRequestProperty("Cookie", session);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (var output = connection.getOutputStream()) {
                output.write(bytes);
            }
            return connection.getResponseCode() == 200;
        } finally {
            connection.disconnect();
        }
    }
}
