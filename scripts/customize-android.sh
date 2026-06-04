#!/bin/bash
# customize-android.sh - Add navigation, bottom menu, splash, offline, pull-refresh, progress bar, bookmarks, settings
# Usage: ./customize-android.sh <android_project_dir> <package_name> <app_name> <url>

set -e
ANDROID_DIR="$1"
PACKAGE="$2"
APP_NAME="$3"
URL="$4"

echo "=== Customizing Android Project ==="
echo "Dir: $ANDROID_DIR, Package: $PACKAGE, App: $APP_NAME, URL: $URL"

PACKAGE_PATH=$(echo "$PACKAGE" | tr '.' '/')
cd "$ANDROID_DIR"

# ============================================================
# 1. Splash Screen - create drawable & style
# ============================================================
echo "[1/5] Splash Screen..."
mkdir -p app/src/main/res/drawable app/src/main/res/values app/src/main/res/values-night
cat > app/src/main/res/drawable/splash_background.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@android:color/white"/>
</layer-list>
EOF

# Splash style
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
# 2. MainActivity.java - Full featured WebView wrapper
# ============================================================
echo "[2/5] MainActivity.java..."
MAIN_ACTIVITY="app/src/main/java/$PACKAGE_PATH/MainActivity.java"
mkdir -p "$(dirname "$MAIN_ACTIVITY")"

cat > "$MAIN_ACTIVITY" << ACTIVITYEOF
package $PACKAGE;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private TextView offlineMessage;
    private ImageButton btnBack, btnForward, btnRefresh, btnShare, btnHome, btnBookmarks, btnSettings;
    private String currentUrl = "$URL";
    private final String homeUrl = "$URL";
    private SharedPreferences prefs;
    private static final String PREFS_NAME = "webapk_prefs";
    private static final String BOOKMARKS_KEY = "bookmarks";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setTheme(getResources().getIdentifier("Theme.AppCompat.Light.NoActionBar", "style", getPackageName()));
        super.onCreate(savedInstanceState);
        setContentView(getResources().getIdentifier("activity_main", "layout", getPackageName()));
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        offlineMessage = findViewById(R.id.offlineMessage);
        btnBack = findViewById(R.id.btnBack);
        btnForward = findViewById(R.id.btnForward);
        btnRefresh = findViewById(R.id.btnRefresh);
        btnShare = findViewById(R.id.btnShare);
        btnHome = findViewById(R.id.btnHome);
        btnBookmarks = findViewById(R.id.btnBookmarks);
        btnSettings = findViewById(R.id.btnSettings);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setMixedContentMode(0);
        webView.getSettings().setLoadWithOverviewView(true);
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
                updateNavButtons();
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                currentUrl = url;
                updateNavButtons();
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

        // Navigation buttons
        btnBack.setOnClickListener(v -> { if (webView.canGoBack()) webView.goBack(); });
        btnForward.setOnClickListener(v -> { if (webView.canGoForward()) webView.goForward(); });
        btnRefresh.setOnClickListener(v -> webView.reload());
        btnShare.setOnClickListener(v -> {
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_TEXT, currentUrl);
            startActivity(Intent.createChooser(share, "Share via"));
        });
        btnHome.setOnClickListener(v -> webView.loadUrl(homeUrl));

        // Bookmarks button (tap = show dialog, long-press = add current page)
        btnBookmarks.setOnClickListener(v -> showBookmarksDialog());
        btnBookmarks.setOnLongClickListener(v -> { addBookmark(); return true; });

        // Settings button
        btnSettings.setOnClickListener(v -> showSettingsDialog());

        loadUrl();
    }

    private void loadUrl() {
        if (isOnline()) {
            webView.loadUrl(currentUrl);
            webView.setVisibility(View.VISIBLE);
            offlineMessage.setVisibility(View.GONE);
        } else {
            offlineMessage.setVisibility(View.VISIBLE);
            webView.setVisibility(View.GONE);
        }
    }

    private void updateNavButtons() {
        btnBack.setAlpha(webView.canGoBack() ? 1.0f : 0.3f);
        btnForward.setAlpha(webView.canGoForward() ? 1.0f : 0.3f);
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

    // ========= Bookmarks =========
    private Set<String> getBookmarks() {
        return prefs.getStringSet(BOOKMARKS_KEY, new HashSet<>());
    }

    private void saveBookmarks(Set<String> bookmarks) {
        prefs.edit().putStringSet(BOOKMARKS_KEY, bookmarks).apply();
    }

    private void showBookmarksDialog() {
        Set<String> saved = getBookmarks();
        List<String> list = new ArrayList<>(saved);
        if (list.isEmpty()) {
            Toast.makeText(this, "No bookmarks yet. Long-press the bookmark icon to add current page.", Toast.LENGTH_LONG).show();
            return;
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, list);
        new AlertDialog.Builder(this)
                .setTitle("Bookmarks")
                .setAdapter(adapter, (dialog, which) -> {
                    String url = list.get(which);
                    webView.loadUrl(url);
                })
                .setPositiveButton("Close", null)
                .show();
    }

    private void addBookmark() {
        Set<String> bookmarks = getBookmarks();
        if (bookmarks.contains(currentUrl)) {
            Toast.makeText(this, "Already bookmarked!", Toast.LENGTH_SHORT).show();
            return;
        }
        bookmarks.add(currentUrl);
        saveBookmarks(bookmarks);
        Toast.makeText(this, "Bookmark added!", Toast.LENGTH_SHORT).show();
    }

    // ========= Settings =========
    private void showSettingsDialog() {
        String[] items = {"Clear Cache", "Clear Bookmarks", "About"};
        new AlertDialog.Builder(this)
                .setTitle("Settings")
                .setItems(items, (dialog, which) -> {
                    switch (which) {
                        case 0:
                            webView.clearCache(true);
                            webView.clearHistory();
                            Toast.makeText(this, "Cache cleared!", Toast.LENGTH_SHORT).show();
                            break;
                        case 1:
                            saveBookmarks(new HashSet<>());
                            Toast.makeText(this, "Bookmarks cleared!", Toast.LENGTH_SHORT).show();
                            break;
                        case 2:
                            new AlertDialog.Builder(this)
                                    .setTitle("About")
                                    .setMessage("$APP_NAME\\n\\nPowered by WebView\\n" + getPackageName())
                                    .setPositiveButton("OK", null)
                                    .show();
                            break;
                    }
                })
                .show();
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
ACTIVITYEOF

# ============================================================
# 3. activity_main.xml - Layout with 7 bottom buttons
# ============================================================
echo "[3/5] Layout XML..."
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
        android:text="No internet connection\nPlease check your connection and try again"
        android:textAlignment="center"
        android:textColor="#666"
        android:textSize="18sp"
        android:visibility="gone" />

    <androidx.swiperefreshlayout.widget.SwipeRefreshLayout
        android:id="@+id/swipeRefresh"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:layout_above="@+id/bottomBar">

        <WebView
            android:id="@+id/webView"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />

    </androidx.swiperefreshlayout.widget.SwipeRefreshLayout>

    <LinearLayout
        android:id="@+id/bottomBar"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_alignParentBottom="true"
        android:background="#FFFFFF"
        android:gravity="center"
        android:orientation="horizontal"
        android:elevation="8dp">

        <ImageButton
            android:id="@+id/btnBack"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_back"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Back" />

        <ImageButton
            android:id="@+id/btnForward"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_forward"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Forward" />

        <ImageButton
            android:id="@+id/btnRefresh"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_refresh"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Refresh" />

        <ImageButton
            android:id="@+id/btnShare"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_share"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Share" />

        <ImageButton
            android:id="@+id/btnHome"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_home"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Home" />

        <ImageButton
            android:id="@+id/btnBookmarks"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_bookmark"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Bookmarks"
            android:longClickable="true" />

        <ImageButton
            android:id="@+id/btnSettings"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:src="@drawable/ic_settings"
            android:scaleType="center"
            android:background="?attr/selectableItemBackgroundBorderless"
            android:contentDescription="Settings" />

    </LinearLayout>

</RelativeLayout>
LAYOUTEOF

# ============================================================
# 4. Vector Drawables (7 icons)
# ============================================================
echo "[4/5] Navigation icons..."
mkdir -p app/src/main/res/drawable

cat > app/src/main/res/drawable/ic_back.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M20,11H7.83l5.59,-5.59L12,4l-8,8 8,8 1.41,-1.41L7.83,13H20v-2z"/>
</vector>
EOF

cat > app/src/main/res/drawable/ic_forward.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M12,4l-1.41,1.41L16.17,11H4v2h12.17l-5.58,5.59L12,20l8,-8z"/>
</vector>
EOF

cat > app/src/main/res/drawable/ic_refresh.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M17.65,6.35C16.2,4.9 14.21,4 12,4c-4.42,0 -7.99,3.58 -7.99,8s3.57,8 7.99,8c3.73,0 6.84,-2.55 7.73,-6h-2.08c-0.82,2.33 -3.04,4 -5.65,4 -3.31,0 -6,-2.69 -6,-6s2.69,-6 6,-6c1.66,0 3.14,0.69 4.22,1.78L13,11h7V4l-2.35,2.35z"/>
</vector>
EOF

cat > app/src/main/res/drawable/ic_share.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M18,16.08c-0.76,0 -1.44,0.3 -1.96,0.77L8.91,12.7c0.05,-0.23 0.09,-0.46 0.09,-0.7s-0.04,-0.47 -0.09,-0.7l7.05,-4.11c0.54,0.5 1.25,0.81 2.04,0.81 1.66,0 3,-1.34 3,-3s-1.34,-3 -3,-3 -3,1.34 -3,3c0,0.24 0.04,0.47 0.09,0.7L8.04,9.81C7.5,9.31 6.79,9 6,9c-1.66,0 -3,1.34 -3,3s1.34,3 3,3c0.79,0 1.5,-0.31 2.04,-0.81l7.12,4.16c-0.05,0.21 -0.08,0.43 -0.08,0.65 0,1.61 1.31,2.92 2.92,2.92 1.61,0 2.92,-1.31 2.92,-2.92s-1.31,-2.92 -2.92,-2.92z"/>
</vector>
EOF

cat > app/src/main/res/drawable/ic_home.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z"/>
</vector>
EOF

cat > app/src/main/res/drawable/ic_bookmark.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M17,3H7c-1.1,0 -1.99,0.9 -1.99,2L5,21l7,-3 7,3V5c0,-1.1 -0.9,-2 -2,-2z"/>
</vector>
EOF

cat > app/src/main/res/drawable/ic_settings.xml << 'EOF'
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#444" android:pathData="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"/>
</vector>
EOF

# ============================================================
# 5. Manifest, Gradle, Splash theme
# ============================================================
echo "[5/5] AndroidManifest + Gradle + Theme..."

# Update AndroidManifest
MANIFEST="app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
    sed -i 's|<activity|<activity android:theme="@style/AppTheme.Splash"|' "$MANIFEST"
    # Add permissions if not present
    if ! grep -q "ACCESS_NETWORK_STATE" "$MANIFEST"; then
        sed -i 's|<application|<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/><application|' "$MANIFEST"
    fi
    # Enable cleartext
    sed -i 's|<application|<application android:usesCleartextTraffic="true"|' "$MANIFEST"
fi

# Add AppCompat + SwipeRefreshLayout dependency
BUILD_GRADLE="app/build.gradle"
if [ -f "$BUILD_GRADLE" ]; then
    if ! grep -q "androidx.appcompat" "$BUILD_GRADLE"; then
        sed -i 's|implementation fileTree|implementation "androidx.appcompat:appcompat:1.6.1"\n    implementation "androidx.swiperefreshlayout:swiperefreshlayout:1.1.0"\n    implementation fileTree|' "$BUILD_GRADLE"
    fi
fi

# Remove the Capacitor-generated MainActivity so ours takes effect
CAP_ACTIVITY="app/src/main/java/$PACKAGE_PATH/MainActivity.java.cap"
if [ -f "$CAP_ACTIVITY" ]; then rm -f "$CAP_ACTIVITY"; fi

echo "=== Customization Complete! ==="
