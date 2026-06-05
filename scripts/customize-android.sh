#!/bin/bash
# customize-android.sh - Clean WebView with pull-refresh, progress bar, offline support, splash
# Usage: ./customize-android.sh <android_project_dir> <package_name> <app_name> <url> [orientation] [branding]

set -e
ANDROID_DIR="$1"
PACKAGE="$2"
APP_NAME="$3"
URL="$4"
ORIENTATION="${5:-default}"
BRANDING="${6:-true}"

echo "=== Customizing Android Project ==="
echo "Dir: $ANDROID_DIR, Package: $PACKAGE, App: $APP_NAME, URL: $URL"

PACKAGE_PATH=$(echo "$PACKAGE" | tr '.' '/')
cd "$ANDROID_DIR"

# ============================================================
# 1. Splash
# ============================================================
echo "[1/4] Splash..."
mkdir -p app/src/main/res/drawable app/src/main/res/values
cat > app/src/main/res/drawable/splash_background.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@android:color/white"/>
</layer-list>
EOF
cat > app/src/main/res/values/splash.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.Splash" parent="Theme.AppCompat.Light.NoActionBar">
        <item name="android:windowBackground">@drawable/splash_background</item>
        <item name="android:windowFullscreen">true</item>
    </style>
</resources>
EOF

# ============================================================
# 2. MainActivity.java - Clean WebView only
# ============================================================
echo "[2/4] MainActivity.java..."
MAIN_ACTIVITY="app/src/main/java/$PACKAGE_PATH/MainActivity.java"
mkdir -p "$(dirname "$MAIN_ACTIVITY")"

cat > "$MAIN_ACTIVITY" << JAVAEOF
package $PACKAGE;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private TextView offlineMessage;
    private String currentUrl = "$URL";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        offlineMessage = findViewById(R.id.offlineMessage);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setMixedContentMode(0);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setSupportZoom(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.getSettings().setSafeBrowsingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
                offlineMessage.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                currentUrl = url;
            }
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!isOnline()) {
                    offlineMessage.setVisibility(View.VISIBLE);
                    webView.setVisibility(View.GONE);
                }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception ignored) {}
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
            }
        });

        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, url.substring(url.lastIndexOf("/") + 1));
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) dm.enqueue(request);
            Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show();
        });

        loadUrl();
    }

    private void loadUrl() {
        // Check if opened from notification with a specific URL
        String notifUrl = getIntent().getStringExtra("url");
        if (notifUrl != null && !notifUrl.isEmpty()) {
            currentUrl = notifUrl;
        }
        if (isOnline()) {
            webView.loadUrl(currentUrl);
            webView.setVisibility(View.VISIBLE);
            offlineMessage.setVisibility(View.GONE);
        } else {
            offlineMessage.setVisibility(View.VISIBLE);
            webView.setVisibility(View.GONE);
        }
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                    nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        }
        return true;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
JAVAEOF

# ============================================================
# 3. Layout XML - Clean, no bottom bar
# ============================================================
echo "[3/4] Layout..."
mkdir -p app/src/main/res/layout
cat > app/src/main/res/layout/activity_main.xml << 'LAYOUTEOF'
<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <ProgressBar
        android:id="@+id/progressBar"
        style="?android:attr/progressBarStyleHorizontal"
        android:layout_width="match_parent"
        android:layout_height="3dp"
        android:layout_alignParentTop="true"
        android:max="100"
        android:progress="0"
        android:visibility="gone" />

    <TextView
        android:id="@+id/offlineMessage"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:gravity="center"
        android:padding="32dp"
        android:text="No internet connection\nPlease check your connection"
        android:textAlignment="center"
        android:textColor="#666"
        android:textSize="18sp"
        android:visibility="gone" />

    <androidx.swiperefreshlayout.widget.SwipeRefreshLayout
        android:id="@+id/swipeRefresh"
        android:layout_width="match_parent"
        android:layout_height="match_parent">

        <WebView
            android:id="@+id/webView"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />

    </androidx.swiperefreshlayout.widget.SwipeRefreshLayout>

LAYOUTEOF
  if [ "$BRANDING" = "true" ]; then
    echo '    <TextView' >> app/src/main/res/layout/activity_main.xml
    echo '        android:id="@+id/branding"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:layout_width="match_parent"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:layout_height="wrap_content"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:layout_alignParentBottom="true"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:gravity="center"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:padding="2dp"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:text="Powered by WebToAPK"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:textColor="#888"' >> app/src/main/res/layout/activity_main.xml
    echo '        android:textSize="10sp" />' >> app/src/main/res/layout/activity_main.xml
  fi
  echo '</RelativeLayout>' >> app/src/main/res/layout/activity_main.xml

# ============================================================
# 4. Manifest + Gradle deps
# ============================================================
echo "[4/5] Manifest + Gradle..."

MANIFEST="app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
    if ! grep -q "ACCESS_NETWORK_STATE" "$MANIFEST"; then
        sed -i '/android.permission.INTERNET/a\    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>' "$MANIFEST"
    fi
    if ! grep -q "usesCleartextTraffic" "$MANIFEST"; then
        sed -i 's|android:allowBackup="true"|android:usesCleartextTraffic="true" android:allowBackup="true"|' "$MANIFEST"
    fi
    if ! grep -q "AppTheme.Splash" "$MANIFEST"; then
        sed -i '0,/android:name="'"$PACKAGE"'\.MainActivity"/s|android:theme="@style/AppTheme.NoActionBarLaunch"|android:theme="@style/AppTheme.Splash"|' "$MANIFEST"
    fi
    # Set screen orientation
    if [ "$ORIENTATION" = "portrait" ]; then
        sed -i '0,/android:name="'"$PACKAGE"'\.MainActivity"/a\        android:screenOrientation="portrait"' "$MANIFEST"
    elif [ "$ORIENTATION" = "landscape" ]; then
        sed -i '0,/android:name="'"$PACKAGE"'\.MainActivity"/a\        android:screenOrientation="landscape"' "$MANIFEST"
    fi
fi

BUILD_GRADLE="app/build.gradle"
echo "" >> "$BUILD_GRADLE"
echo "dependencies {" >> "$BUILD_GRADLE"
echo "    implementation 'androidx.appcompat:appcompat:1.6.1'" >> "$BUILD_GRADLE"
echo "    implementation 'androidx.swiperefreshlayout:swiperefreshlayout:1.1.0'" >> "$BUILD_GRADLE"
echo "}" >> "$BUILD_GRADLE"

echo "=== Customization Complete! ==="

# ============================================================
# 5. Firebase Cloud Messaging (FCM)
# ============================================================
echo "[5/5] Firebase FCM..."

# Check if google-services.json exists (copied by workflow)
FCM_FILE="app/google-services.json"
if [ -f "$FCM_FILE" ]; then
    echo "  google-services.json found. Adding Firebase..."

    # Create NotificationService
    cat > "app/src/main/java/$PACKAGE_PATH/NotificationService.java" << NOTIFEOF
package $PACKAGE;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class NotificationService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "webapk_notifications";
    private static final String CHANNEL_NAME = "App Notifications";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // Token can be sent to server if needed
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        createNotificationChannel();

        String title = message.getNotification() != null ? message.getNotification().getTitle() : "$APP_NAME";
        String body = message.getNotification() != null ? message.getNotification().getBody() : "";
        String clickUrl = message.getData().get("url");

        Intent intent;
        if (clickUrl != null && !clickUrl.isEmpty()) {
            intent = new Intent(this, MainActivity.class);
            intent.putExtra("url", clickUrl);
        } else {
            intent = new Intent(this, MainActivity.class);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify((int) System.currentTimeMillis(), builder.build());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
NOTIFEOF

    # Register service in manifest
    sed -i '/<\/application>/i\        <service android:name="'"$PACKAGE"'.NotificationService" android:exported="false">\n            <intent-filter>\n                <action android:name="com.google.firebase.MESSAGING_EVENT" />\n            </intent-filter>\n        </service>' "$MANIFEST"

    # Add FCM + Firebase deps to build.gradle
    echo "" >> "$BUILD_GRADLE"
    echo "dependencies {" >> "$BUILD_GRADLE"
    echo "    implementation platform('com.google.firebase:firebase-bom:32.7.0')" >> "$BUILD_GRADLE"
    echo "    implementation 'com.google.firebase:firebase-messaging'" >> "$BUILD_GRADLE"
    echo "}" >> "$BUILD_GRADLE"

    echo "  Firebase FCM added successfully!"
else
    echo "  Skipping Firebase (google-services.json not found)"
fi
