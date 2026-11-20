package mx.drm.crm.preview;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.messaging.FirebaseMessaging;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.UUID;
import org.json.JSONObject;

// commit() deliberately persists the local receive gate before acknowledging logout.
@android.annotation.SuppressLint("ApplySharedPref")
final class PushBridge {
    static final String ORIGIN = "https://lightblue-reindeer-349968.hostingersite.com";
    static final String CHANNEL = "drm_messages";
    static final int REQUEST_PERMISSION = 12;
    private final Activity activity;
    private final SharedPreferences prefs;
    private String pendingId;
    private JavaScriptReplyProxy pendingProxy;
    private int generation = 0;

    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("drm_push",Context.MODE_PRIVATE); }
    static boolean enabled(Context context) {
        SharedPreferences p = prefs(context);
        return p.getBoolean("opt_in",false) && p.getBoolean("bound",false);
    }
    static void channel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL,"Mensajes de DRM CRM",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Avisos de nuevos mensajes asignados y de la bandeja sin asignar");
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    PushBridge(Activity activity, WebView view) {
        this.activity = activity; prefs = prefs(activity); channel(activity);
        if (!prefs.contains("installation")) {
            byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
            StringBuilder secret = new StringBuilder();
            for (byte b : bytes) secret.append(String.format("%02x",b & 255));
            prefs.edit().putString("installation",UUID.randomUUID().toString()).putString("secret",secret.toString()).commit();
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view,"DrmPush",Collections.singleton(ORIGIN), (web,message,origin,isMainFrame,proxy) -> {
                if (!isMainFrame || !MainActivity.isCrm(origin)) return;
                String id = "";
                try {
                    String raw = message.getData();
                    if (raw == null || raw.length() > 2048) return;
                    JSONObject request = new JSONObject(raw);
                    id = request.getString("id");
                    if (id.length() > 64) return;
                    switch (request.getString("action")) {
                        case "disable":
                            generation++;
                            prefs.edit().putBoolean("opt_in",false).putBoolean("bound",false).remove("binding").commit();
                            activity.getSystemService(NotificationManager.class).cancelAll();
                            FirebaseMessaging.getInstance().setAutoInitEnabled(false);
                            FirebaseMessaging.getInstance().deleteToken();
                            reply(id,proxy,null,null); break;
                        case "get":
                            if (enabled(activity) && permission()) token(id,proxy);
                            else reply(id,proxy,null,null);
                            break;
                        case "enable":
                            if (pendingProxy != null) { reply(id,proxy,null,"Ya hay una solicitud de permiso abierta."); break; }
                            if (Build.VERSION.SDK_INT >= 33 && !permission()) {
                                pendingId = id; pendingProxy = proxy;
                                activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},REQUEST_PERMISSION);
                            } else enable(id,proxy);
                            break;
                        case "bound":
                            String binding = request.optString("binding","");
                            if (!prefs.getBoolean("opt_in",false) || !binding.matches("[a-fA-F0-9\\-]{36}:[a-fA-F0-9\\-]{36}")) {
                                reply(id,proxy,null,"Activa primero los avisos de este teléfono."); break;
                            }
                            prefs.edit().putBoolean("bound",true).putString("binding",binding).commit();
                            reply(id,proxy,null,null); break;
                        default: reply(id,proxy,null,"Solicitud de notificaciones no válida.");
                    }
                } catch (Exception e) { reply(id,proxy,null,"No se pudo completar la solicitud de notificaciones."); }
            });
        }
    }
    boolean permission() {
        return (Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && activity.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    private void enable(String id, JavaScriptReplyProxy proxy) {
        if (!permission()) { reply(id,proxy,null,"Permite las notificaciones de DRM CRM en los ajustes de Android."); return; }
        generation++;
        prefs.edit().putBoolean("opt_in",true).commit();
        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        token(id,proxy);
    }
    private void token(String id, JavaScriptReplyProxy proxy) {
        final int currentGeneration = generation;
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(activity, task -> {
            if (generation != currentGeneration) { reply(id,proxy,null,"La solicitud se canceló."); return; }
            if (task.isSuccessful()) reply(id,proxy,task.getResult(),null);
            else reply(id,proxy,null,"No se pudo conectar con Firebase. Revisa internet y Google Play Services.");
        });
    }
    void onPermissionResult(int code) {
        if (code != REQUEST_PERMISSION || pendingProxy == null) return;
        JavaScriptReplyProxy proxy = pendingProxy; String id = pendingId;
        pendingProxy = null; pendingId = null;
        enable(id,proxy);
    }
    private void reply(String id, JavaScriptReplyProxy proxy, String token, String error) {
        try {
            JSONObject data = new JSONObject();
            data.put("id",id).put("enabled",enabled(activity) && permission()).put("permission",permission())
                .put("installationId",prefs.getString("installation","")).put("secret",prefs.getString("secret",""))
                .put("binding",prefs.getString("binding",""));
            if (token != null) data.put("token",token);
            if (error != null) data.put("error",error);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) proxy.postMessage(data.toString());
        } catch (Exception ignored) { /* Page may have navigated away. No secrets are logged. */ }
    }
}
