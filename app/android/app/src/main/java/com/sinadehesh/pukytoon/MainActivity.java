package com.sinadehesh.pukytoon;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Every game in the feed runs in an iframe. Capacitor sends any page that isn't the app's own to the
        // phone's browser; that's right for the app's page, but a game frame must load inside the feed.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
