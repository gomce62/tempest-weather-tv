package com.tempest.weather.tv

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
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
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    @Volatile
    private var ttsReady: Boolean = false
    @Volatile
    private var ttsFailed: Boolean = false
    @Volatile
    private var activeUtteranceId: String? = null
    @Volatile
    private var isResumed: Boolean = false
    private var wentToBackground: Boolean = false
    private var needsAudioWarmup: Boolean = true
    private var utteranceSeq: Long = 0
    private var pendingSpeech: Triple<String, Float, Float>? = null

    private fun speechAudioAttributes(): AudioAttributes {
        return AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    }

    private fun requestSpeechAudioFocus() {
        val am = audioManager ?: return
        try {
            if (audioFocusRequest == null) {
                audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(speechAudioAttributes())
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener { }
                    .build()
            }
            audioFocusRequest?.let { am.requestAudioFocus(it) }
        } catch (_: Exception) {}
    }

    private fun abandonSpeechAudioFocus() {
        val am = audioManager ?: return
        try {
            audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
        } catch (_: Exception) {}
    }

    private fun selectBestFemaleVoice() {
        try {
            val voices = tts?.voices ?: return
            val preferredFemale = listOf("en-us-x-tpf", "en-us-x-sfg", "en-us-x-tpc", "en-us-x-iob", "f00", "female")
            val excludedMale = listOf("iol", "iom", "iog", "tpd", "m00", "male")
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
        } catch (_: Exception) {}
    }

    private fun speakNowOnUiThread(text: String, clampedRate: Float, clampedPitch: Float) {
        try {
            requestSpeechAudioFocus()
            tts?.setAudioAttributes(speechAudioAttributes())
            selectBestFemaleVoice()
            tts?.setSpeechRate(clampedRate)
            tts?.setPitch(clampedPitch)
            val uttId = "tempest_briefing_${++utteranceSeq}"
            activeUtteranceId = uttId
            val params = Bundle().apply {
                putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
            }
            if (needsAudioWarmup) {
                needsAudioWarmup = false
                tts?.playSilentUtterance(280L, TextToSpeech.QUEUE_FLUSH, "tts_warmup")
                tts?.speak(text, TextToSpeech.QUEUE_ADD, params, uttId)
            } else {
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, uttId)
            }
        } catch (_: Exception) {
            activeUtteranceId = null
            abandonSpeechAudioFocus()
            webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
        }
    }

    inner class AndroidTtsBridge {
        @JavascriptInterface
        fun isAvailable(): Boolean = tts != null && !ttsFailed

        @JavascriptInterface
        fun speak(text: String, rate: Float, pitch: Float): Boolean {
            if (tts == null || ttsFailed || text.isBlank()) return false
            val clampedRate = rate.coerceIn(0.5f, 2.0f)
            val clampedPitch = pitch.coerceIn(0.5f, 2.0f)
            runOnUiThread {
                if (!ttsReady) {
                    pendingSpeech = Triple(text, clampedRate, clampedPitch)
                } else {
                    pendingSpeech = null
                    speakNowOnUiThread(text, clampedRate, clampedPitch)
                }
            }
            return true
        }

        @JavascriptInterface
        fun stop() {
            runOnUiThread {
                pendingSpeech = null
                activeUtteranceId = null
                try {
                    tts?.stop()
                } catch (_: Exception) {}
                abandonSpeechAudioFocus()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Bind remote volume keys to media stream & keep Sony Bravia screen awake
        volumeControlStream = AudioManager.STREAM_MUSIC
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            ttsReady = false
            ttsFailed = true
            pendingSpeech = null
            runOnUiThread {
                webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
            }
            return
        }
        try {
            val langResult = tts?.setLanguage(Locale.US)
            ttsReady = langResult != TextToSpeech.LANG_MISSING_DATA &&
                langResult != TextToSpeech.LANG_NOT_SUPPORTED
            if (!ttsReady) {
                ttsFailed = true
                pendingSpeech = null
                runOnUiThread {
                    webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                }
                return
            }

            tts?.setAudioAttributes(speechAudioAttributes())
            selectBestFemaleVoice()

            // Register listener BEFORE draining any queued initial utterance
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    if (utteranceId != activeUtteranceId) return
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsStart && window.__onNativeTtsStart()", null)
                    }
                }

                override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                    if (utteranceId != activeUtteranceId) return
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "window.__onNativeTtsRange && window.__onNativeTtsRange($start, $end)",
                            null
                        )
                    }
                }

                override fun onDone(utteranceId: String?) {
                    if (utteranceId != activeUtteranceId) return
                    activeUtteranceId = null
                    abandonSpeechAudioFocus()
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                    }
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    if (utteranceId != activeUtteranceId) return
                    activeUtteranceId = null
                    abandonSpeechAudioFocus()
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                    }
                }

                override fun onError(utteranceId: String?, errorCode: Int) {
                    if (utteranceId != activeUtteranceId) return
                    activeUtteranceId = null
                    abandonSpeechAudioFocus()
                    runOnUiThread {
                        webView.evaluateJavascript("window.__onNativeTtsEnd && window.__onNativeTtsEnd()", null)
                    }
                }
            })

            val pending = pendingSpeech
            pendingSpeech = null
            if (pending != null && isResumed) {
                runOnUiThread {
                    speakNowOnUiThread(pending.first, pending.second, pending.third)
                }
            }
        } catch (_: Exception) {
            ttsReady = false
        }
    }

    override fun onResume() {
        super.onResume()
        isResumed = true
        enterFullscreen()
        webView.onResume()
        webView.requestFocus()
        if (wentToBackground) {
            wentToBackground = false
            webView.post {
                webView.evaluateJavascript("window.__onAppForegroundResume && window.__onAppForegroundResume()", null)
            }
        }
    }

    override fun onPause() {
        isResumed = false
        pendingSpeech = null
        activeUtteranceId = null
        try {
            tts?.stop()
        } catch (_: Exception) {}
        abandonSpeechAudioFocus()
        if (::webView.isInitialized) {
            webView.evaluateJavascript(
                "window.__onAppBackground ? window.__onAppBackground() : (window.__onNativeTtsEnd && window.__onNativeTtsEnd())",
                null
            )
            webView.onPause()
        }
        super.onPause()
    }

    override fun onStop() {
        wentToBackground = true
        super.onStop()
    }

    override fun onDestroy() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {}
        abandonSpeechAudioFocus()
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
