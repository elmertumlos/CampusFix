package online.buildcurious.campusfix;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class ReportMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL = "maintenance_reports";

    static void createChannel(Context context) {
        var channel = new NotificationChannel(CHANNEL, context.getString(R.string.notification_channel), NotificationManager.IMPORTANCE_HIGH);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onNewToken(String token) {
        new Handler(Looper.getMainLooper()).post(() -> DeviceRegistration.register(getApplicationContext(), token));
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        String report = message.getData().get("reportId");
        if (!"new_report".equals(message.getData().get("type")) || report == null || !report.matches("[1-9][0-9]{0,15}")) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        createChannel(this);
        var intent = new Intent(this, DashboardActivity.class)
            .setData(android.net.Uri.parse("campusfix://report/" + report))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(DashboardActivity.EXTRA_REPORT, report);
        PendingIntent open = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_body))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build();
        getSystemService(NotificationManager.class).notify(report, 1, notification);
    }
}
