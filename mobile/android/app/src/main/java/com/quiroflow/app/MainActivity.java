package com.quiroflow.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins: Capacitor finds packaged ones by itself.
        registerPlugin(HomeWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
