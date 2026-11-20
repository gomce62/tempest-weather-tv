package com.tempest.weather.tv

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import java.util.Locale

class MainActivity : ComponentActivity(), TextToSpeech.OnInitListener {

    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    @Volatile
    private var ttsReady: Boolean = false

    inner class AndroidTtsBridge {
        @JavascriptInterface
        fun isAvailable(): Boolean = ttsReady

        @JavascriptInterface
        fun speak(text: String, rate: Float, pitch: Float): Boolean {
            if (!ttsReady || tts == null || text.isBlank()) return false
            val clampedRate = rate.coerceIn(0.5f, 2.0f)
            val clampedPitch = pitch.coerceIn(0.5f, 2.0f)
            runOnUiThread {
                try {
                    tts?.setSpeechRate(clampedRate)
                    tts?.setPitch(clampedPitch)
                    val params = Bundle()
                    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "tempest_briefing")
                } catch (_: Exception) {
                    webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                }
            }
            return true
        }

        @JavascriptInterface
        fun stop() {
            runOnUiThread {
                try {
                    tts?.stop()
                } catch (_: Exception) {}
                webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep Sony Bravia screen awake while the weather dashboard is open
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        tts = TextToSpeech(this, this)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#101114"))
            isFocusable = true
            isFocusableInTouchMode = true

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                textZoom = 100
                useWideViewPort = true
                loadWithOverviewMode = true
                allowFileAccess = true
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = true
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = false
            }

            addJavascriptInterface(AndroidTtsBridge(), "AndroidTTS")
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
        }

        setContentView(webView)
        enterFullscreen()

        webView.requestFocus()
        webView.loadUrl("file:///android_asset/tv-dashboard.html")
    }

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            ttsReady = false
            return
        }
        try {
            val langResult = tts?.setLanguage(Locale.US)
            ttsReady = langResult != TextToSpeech.LANG_MISSING_DATA &&
                langResult != TextToSpeech.LANG_NOT_SUPPORTED

            // Prefer a warm US English female voice when installed on the TV
            val voices = tts?.voices
            if (voices != null) {
                val preferredFemale = listOf("en-us-x-tpf", "en-us-x-sfg", "en-us-x-tpc", "en-us-x-iob", "female")
                val excludedMale = listOf("iol", "iom", "iog", "male")
                val bestVoice = voices.firstOrNull { v ->
                    val n = (v.name ?: "").lowercase(Locale.US)
                    v.locale?.language == "en" &&
                        v.locale?.country == "US" &&
                        preferredFemale.any { p -> n.contains(p) } &&
                        !v.isNetworkConnectionRequired
                } ?: voices.firstOrNull { v ->
                    val n = (v.name ?: "").lowercase(Locale.US)
                    v.locale?.language == "en" &&
                        v.locale?.country == "US" &&
                        preferredFemale.any { p -> n.contains(p) }
                } ?: voices.firstOrNull { v ->
                    val n = (v.name ?: "").lowercase(Locale.US)
                    v.locale?.language == "en" &&
                        v.locale?.country == "US" &&
                        !v.isNetworkConnectionRequired &&
                        excludedMale.none { m -> n.contains(m) }
                }
                if (bestVoice != null) {
                    tts?.voice = bestVoice
                }
            }

            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsStart && window.__onNativeTtsStart()", null)
                    }
                }

                override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "window.__onNativeTtsRange && window.__onNativeTtsRange($start, $end)",
                            null
                        )
                    }
                }

                override fun onDone(utteranceId: String?) {
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                    }
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                    }
                }

                override fun onError(utteranceId: String?, errorCode: Int) {
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                    }
                }
            })
        } catch (_: Exception) {
            ttsReady = false
        }
    }

    override fun onResume() {
        super.onResume()
        enterFullscreen()
        webView.onResume()
        webView.requestFocus()
    }

    override fun onPause() {
        try {
            tts?.stop()
        } catch (_: Exception) {}
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
            webView.onPause()
        }
        super.onPause()
    }

    override fun onDestroy() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {}
        tts = null
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterFullscreen()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Intercept Sony TV Remote BACK button so it closes modals first
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.evaluateJavascript("window.__tvHandleBack && window.__tvHandleBack()") { result ->
                if (result != "true") {
                    finish()
                }
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun enterFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }
}
