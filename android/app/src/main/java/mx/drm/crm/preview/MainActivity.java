package mx.drm.crm.preview;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Arrays;

/** Test Android shell. All CRM authentication and authorization remain on the server. */
public final class MainActivity extends Activity {
    private static final String HOST = "lightblue-reindeer-349968.hostingersite.com";
    private static final String HOME = "https://" + HOST + "/inbox";
    private static final int FILE_REQUEST = 10, AUDIO_REQUEST = 11;
    private WebView web;
    private PushBridge push;
    private View offline;
    private ProgressBar progress;
    private ValueCallback<Uri[]> chooser;
    private PermissionRequest audio;
    private String retryUrl = HOME;

    static boolean isCrm(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && HOST.equalsIgnoreCase(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getUserInfo() == null;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16,17,20));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams progressLayout = new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP);
        root.addView(progress, progressLayout);
        LinearLayout error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setGravity(Gravity.CENTER);
        error.setPadding(dp(28),dp(28),dp(28),dp(28));
        error.setBackgroundColor(Color.rgb(16,17,20));
        TextView title = new TextView(this);
        title.setText("DRM CRM"); title.setTextSize(28); title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER); error.addView(title);
        TextView detail = new TextView(this);
        detail.setText("No se pudo abrir el CRM.\nRevisa tu conexión y vuelve a intentar.");
        detail.setTextSize(16); detail.setTextColor(Color.LTGRAY); detail.setGravity(Gravity.CENTER);
        detail.setPadding(0,dp(20),0,dp(20)); error.addView(detail);
        Button retry = new Button(this); retry.setText("Volver a intentar");
        retry.setOnClickListener(v -> { offline.setVisibility(View.GONE); web.loadUrl(retryUrl); });
        error.addView(retry); offline = error; offline.setVisibility(View.GONE);
        root.addView(error, new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);

        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only user-selected content:// attachments.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isCrm(request.getUrl())) return false;
                if (request.isForMainFrame()) openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (isCrm(Uri.parse(url))) retryUrl = url;
                offline.setVisibility(View.GONE); progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE); CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showOffline();
            }
            // SSL errors keep WebView's default cancel behavior; no bypass.
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!isCrm(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return false;
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                Intent select = new Intent(Intent.ACTION_GET_CONTENT);
                select.addCategory(Intent.CATEGORY_OPENABLE);
                select.setType("*/*");
                ArrayList<String> mime = new ArrayList<>();
                for (String type : params.getAcceptTypes()) if (type != null && type.contains("/")) mime.add(type);
                if (!mime.isEmpty()) select.putExtra(Intent.EXTRA_MIME_TYPES, mime.toArray(new String[0]));
                select.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(Intent.createChooser(select,"Adjuntar archivo"),FILE_REQUEST); }
                catch (ActivityNotFoundException e) { chooser.onReceiveValue(null); chooser = null; }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!isCrm(request.getOrigin()) || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.deny(); return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else if (audio == null) {
                        audio = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},AUDIO_REQUEST);
                    } else request.deny();
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (audio == request) audio = null;
            }
        });
        web.setDownloadListener((url,userAgent,disposition,mime,size) -> {
            Uri uri = Uri.parse(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                Toast.makeText(this,"Abre la versión web para descargar este archivo.",Toast.LENGTH_LONG).show(); return;
            }
            // External files use the system browser without transferring CRM cookies.
            if (!isCrm(uri)) { openExternal(uri); return; }
            try {
                DownloadManager.Request request = new DownloadManager.Request(uri);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie",cookies);
                request.addRequestHeader("User-Agent",userAgent);
                request.setTitle(URLUtil.guessFileName(url,disposition,mime));
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this,"Descargando archivo…",Toast.LENGTH_SHORT).show();
            } catch (RuntimeException e) { Toast.makeText(this,"No se pudo descargar el archivo.",Toast.LENGTH_LONG).show(); }
        });
        // Cookie sessions persist, while page contents are always fetched again.
        push = new PushBridge(this, web);
        web.loadUrl(notificationUrl(getIntent()));
    }

    private String notificationUrl(Intent intent) {
        String conversation = intent.getStringExtra("conversation_id");
        String binding = intent.getStringExtra("push_binding");
        if (PushBridge.enabled(this) && conversation != null && conversation.matches("[a-fA-F0-9\\-]{36}")
            && binding != null && binding.equals(PushBridge.prefs(this).getString("binding","")))
            return HOME + "?c=" + Uri.encode(conversation);
        return HOME;
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent); web.loadUrl(notificationUrl(intent));
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void showOffline() { progress.setVisibility(View.GONE); offline.setVisibility(View.VISIBLE); }
    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!("https".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this,"No hay una aplicación para abrir este enlace.",Toast.LENGTH_SHORT).show(); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if (requestCode != FILE_REQUEST || chooser == null) return;
        Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode,data);
        ArrayList<Uri> safe = new ArrayList<>();
        if (results != null) for (Uri uri : results) if (uri != null && "content".equals(uri.getScheme())) safe.add(uri);
        chooser.onReceiveValue(safe.isEmpty() ? null : safe.toArray(new Uri[0])); chooser = null;
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code,permissions,results);
        if (push != null) push.onPermissionResult(code);
        if (code == AUDIO_REQUEST && audio != null) {
            PermissionRequest pending = audio; audio = null;
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && isCrm(Uri.parse(web.getUrl())))
                pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pending.deny();
        }
    }
    @Override public void onBackPressed() {
        if (web.canGoBack()) { offline.setVisibility(View.GONE); web.goBack(); }
        else super.onBackPressed();
    }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            if (web.getUrl() != null && isCrm(Uri.parse(web.getUrl())))
                web.evaluateJavascript("window.dispatchEvent(new Event('drm-native-resume'));",null);
        }
    }
    @Override protected void onDestroy() {
        if (chooser != null) { chooser.onReceiveValue(null); chooser = null; }
        if (audio != null) { audio.deny(); audio = null; }
        web.destroy(); super.onDestroy();
    }
}
