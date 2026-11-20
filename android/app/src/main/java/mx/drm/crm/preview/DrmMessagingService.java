package mx.drm.crm.preview;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class DrmMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        // A token refresh must never silently re-enable a logged-out installation.
        if (!PushBridge.prefs(this).getBoolean("opt_in",false))
            com.google.firebase.messaging.FirebaseMessaging.getInstance().deleteToken();
        // Active registrations obtain this new token on foreground/resume sync.
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        // Data-only messages are deliberately gated locally, including offline logout.
        if (!PushBridge.enabled(this) || (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) return;
        String conversation = message.getData().get("conversation_id");
        String id = message.getData().get("message_id");
        if (conversation == null || id == null || !conversation.matches("[a-fA-F0-9\\-]{36}") || !id.matches("[a-fA-F0-9\\-]{36}")) return;
        SharedPreferences prefs = PushBridge.prefs(this);
        String binding = message.getData().get("binding");
        // Drop queued notifications from a previous account on this phone.
        if (binding == null || !binding.equals(prefs.getString("binding",""))) return;
        if (prefs.getBoolean("seen_" + id,false)) return;
        // Bound the small local dedup set; notifications contain no message text/name.
        if (prefs.getAll().size() > 150) {
            SharedPreferences.Editor editor = prefs.edit();
            for (String key : prefs.getAll().keySet()) if (key.startsWith("seen_")) editor.remove(key);
            editor.apply();
        }
        prefs.edit().putBoolean("seen_" + id,true).apply();
        PushBridge.channel(this);
        Intent intent = new Intent(this,MainActivity.class).putExtra("conversation_id",conversation)
            .putExtra("push_binding",binding).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this,PushBridge.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_message).setContentTitle("DRM CRM")
            .setContentText("Tienes un mensaje nuevo. Abre el CRM para verlo.")
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_MESSAGE).build();
        getSystemService(NotificationManager.class).notify(id,0,notification);
    }
    // Token rotations are rebound with the authenticated session on the next
    // foreground/focus sync. No session token or server key is stored here.
}
